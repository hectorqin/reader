import { SourceAccess } from './source-access.ts';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.ts';
import type { Db } from '../db/index.ts';
import type { ShelfService } from './shelf.ts';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.ts';
import { SourceRegistry } from '../sources/registry.ts';
import { createLocalProvider } from '../sources/local.ts';
import { createOpdsProvider } from '../sources/opds.ts';
import type { SourceContext, SourceInstance, SourceProvider, SourceStorage, CredentialStore, SearchRequest } from '../sources/types.ts';
import { FileAcquisitions } from '../sources/acquisitions.ts';
import { PluginManager } from '../sources/plugin-manager.ts';
import { ChapterPublications } from '../publications/chapters.ts';
import { ChapterUpdates } from './chapter-updates.ts';

function json(value: unknown): string { return JSON.stringify(value ?? {}); }
function parse(value: string): unknown { try { return JSON.parse(value); } catch { return {}; } }

/** Host-owned registry, instance lifecycle and credential boundary. */
export class SourceHost {
  readonly registry = new SourceRegistry();
  readonly plugins: PluginManager;
  readonly chapters: ChapterPublications;
  readonly updates: ChapterUpdates;
  private readonly access: SourceAccess;
  private readonly key: Buffer;
  private readonly acquisitions: FileAcquisitions;
  private activeCalls = 0;
  private readonly activeSources = new Map<string, number>();

  constructor(private readonly db: Db, private readonly config: AppConfig, shelf: () => ShelfService, private readonly log?: FastifyBaseLogger) {
    this.access = new SourceAccess(db);
    this.key = createHash('sha256').update('reader/source-credentials/v1\0').update(config.jwtSecret).digest();
    this.acquisitions = new FileAcquisitions(db, config);
    this.chapters = new ChapterPublications(db, {
      manifest: (userId, sourceId, ref, signal) => this.manifest(userId, sourceId, ref, signal),
      resource: (userId, sourceId, publicationRef, ref, signal) => this.call(userId, sourceId, (provider, ctx) => provider.readResource
        ? provider.readResource(ctx, { publicationRef, ref })
        : Promise.reject(badRequest('source has no chapter resources', 'SOURCE_UNSUPPORTED')), signal),
    });
    this.registry.registerBuiltin('reader.local', createLocalProvider(db, shelf));
    this.updates = new ChapterUpdates(db, this.chapters);
    this.registry.registerBuiltin('reader.opds', createOpdsProvider());
    this.plugins = new PluginManager(db, config.dataDir, this.registry, event => this.log?.info(event, 'source plugin diagnostic'));
    this.ensureLocal();
  }

  private ensureLocal(): void {
    const found = this.db.get<{ id: string }>("SELECT id FROM source_instances WHERE plugin_id = 'reader.local' AND source_type = 'local' LIMIT 1");
    if (!found) this.db.run(
      `INSERT INTO source_instances (id, plugin_id, source_type, name, config_json, enabled, created_at)
       VALUES ('local', 'reader.local', 'local', '本地书库', '{}', 1, ?)`, Date.now(),
    );
  }

  list(includeConfig = false) {
    return this.db.all<{ id: string; plugin_id: string; source_type: string; name: string; config_json: string; enabled: number; is_default: number }>(
      'SELECT id, plugin_id, source_type, name, config_json, enabled, is_default FROM source_instances ORDER BY name',
    ).map((row) => ({
      id: row.id, pluginId: row.plugin_id, sourceType: row.source_type, name: row.name,
      enabled: row.enabled === 1, isDefault: row.is_default === 1,
      ...(includeConfig ? { config: parse(row.config_json) } : {}),
      descriptor: this.registry.get(row.plugin_id, row.source_type)?.provider.descriptor ?? null,
    }));
  }

  async create(input: { id?: string; pluginId: string; sourceType: string; name: string; config: unknown }): Promise<string> {
    const id = input.id?.trim() || randomBytes(12).toString('hex');
    if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) throw badRequest('invalid source instance id');
    if (!input.name.trim() || input.name.length > 128) throw badRequest('invalid source name');
    if (json(input.config).length > 64 * 1024) throw badRequest('source configuration is too large');
    const registration = this.registry.get(input.pluginId, input.sourceType);
    if (!registration) throw notFound('source type is not installed', 'SOURCE_TYPE_NOT_FOUND');
    await registration.provider.validateConfig?.(input.config);
    if (this.registry.get(input.pluginId, input.sourceType) !== registration) {
      throw conflict('source plugin changed during configuration; retry', 'PLUGIN_UNAVAILABLE');
    }
    if (this.db.get('SELECT id FROM source_instances WHERE id = ?', id)) throw conflict('source instance already exists');
    this.db.run(
      `INSERT INTO source_instances (id, plugin_id, source_type, name, config_json, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`, id, input.pluginId, input.sourceType, input.name.trim(), json(input.config), Date.now(),
    );
    return id;
  }

  setEnabled(id: string, enabled: boolean): void {
    const result = this.db.get<{ id: string }>('SELECT id FROM source_instances WHERE id = ?', id);
    if (!result) throw notFound('source instance not found', 'SOURCE_NOT_FOUND');
    this.db.run('UPDATE source_instances SET enabled = ?, is_default = CASE WHEN ? = 0 THEN 0 ELSE is_default END WHERE id = ?', enabled ? 1 : 0, enabled ? 1 : 0, id);
  }

  async update(id: string, patch: { name?: unknown; config?: unknown; enabled?: unknown; isDefault?: unknown }): Promise<void> {
    const row = this.instance(id);
    const name = patch.name ?? row.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 128) throw badRequest('invalid source name');
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw badRequest('enabled must be boolean');
    if (patch.isDefault !== undefined && typeof patch.isDefault !== 'boolean') throw badRequest('isDefault must be boolean');
    if (patch.isDefault === true && (!(patch.enabled ?? row.enabled) || !this.registry.get(row.plugin_id, row.source_type)?.provider.descriptor.capabilities.includes('search'))) {
      throw badRequest('default source must be enabled and support search');
    }
    const configuration = patch.config === undefined ? row.config_json : json(patch.config);
    if (configuration.length > 64 * 1024) throw badRequest('source configuration is too large');
    if (patch.config !== undefined) {
      const registration = this.registry.get(row.plugin_id, row.source_type);
      if (!registration) throw notFound('source type is unavailable', 'SOURCE_TYPE_NOT_FOUND');
      await registration.provider.validateConfig?.(patch.config);
      if (this.registry.get(row.plugin_id, row.source_type) !== registration) throw conflict('plugin changed; retry');
    }
    if (this.instance(id).config_json !== row.config_json) throw conflict('configuration changed; reload and retry');
    if (configuration !== row.config_json && (this.activeSources.get(id) ?? 0) > 0) throw conflict('source is busy; retry configuration when current calls finish', 'SOURCE_BUSY');
    this.db.transaction(() => {
      if (patch.isDefault === true) this.db.run('UPDATE source_instances SET is_default = 0 WHERE is_default = 1');
      if (patch.isDefault !== undefined || patch.enabled === false) this.db.run('UPDATE source_instances SET is_default = ? WHERE id = ?', patch.isDefault === true ? 1 : 0, id);
      this.db.run('UPDATE source_instances SET name = ?, config_json = ?, enabled = ? WHERE id = ?',
        name.trim(), configuration, patch.enabled === undefined ? row.enabled : Number(patch.enabled), id);
      // Changing a destination must not forward existing users' secrets to it.
      if (configuration !== row.config_json) { this.db.run('DELETE FROM source_credentials WHERE source_id = ?', id); this.access.reset(id); }
    });
  }

  remove(id: string): void {
    const row = this.instance(id);
    if (row.plugin_id === 'reader.local') throw badRequest('the built-in local source cannot be removed');
    if (this.db.get('SELECT book_id FROM source_acquisitions WHERE source_id = ? LIMIT 1', id) ||
        this.db.get('SELECT book_id FROM chapter_publications WHERE source_id = ? LIMIT 1', id)) {
      throw conflict('source has acquired books; disable it instead', 'SOURCE_IN_USE');
    }
    this.db.run('DELETE FROM source_instances WHERE id = ?', id);
  }

  credentialStatus(sourceId: string, userId: string) {
    const row = this.instance(sourceId), descriptor = this.registry.get(row.plugin_id,row.source_type)?.provider.descriptor;
    const saved = new Set(this.db.all<{key:string}>('SELECT key FROM source_credentials WHERE source_id=? AND user_id=?',sourceId,userId).map(item=>item.key));
    return { ...this.access.get(sourceId,userId), available: !!row.enabled && !!descriptor,
      fields: (descriptor?.credentialKeys ?? []).map(field=>({key:field.key,label:field.label,configured:saved.has(field.key)})) };
  }
  deleteCredential(sourceId: string, userId: string, name: string): void {
    this.instance(sourceId);
    this.db.transaction(()=>{ this.db.run('DELETE FROM source_credentials WHERE source_id=? AND user_id=? AND key=?',sourceId,userId,name); this.access.reset(sourceId,userId); });
  }
  setCredential(sourceId: string, userId: string, name: string, value: string): void {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(name) || value.length > 16_384) throw badRequest('invalid credential');
    this.instance(sourceId);
    if (!value) { this.deleteCredential(sourceId,userId,name); return; }
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO source_credentials (source_id, user_id, key, encrypted_value) VALUES (?, ?, ?, ?)
       ON CONFLICT(source_id, user_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value`,
        sourceId, userId, name, this.encrypt(value),
      );
      this.access.reset(sourceId, userId);
    });
  }

  async browse(userId: string, id: string, request: { ref?: string; cursor?: string; limit?: number }, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.browse
      ? provider.browse(ctx, request) : Promise.reject(badRequest('source does not support browse', 'SOURCE_UNSUPPORTED')), signal);
  }
  async search(userId: string, id: string, request: SearchRequest, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.search
      ? provider.search(ctx, request) : Promise.reject(badRequest('source does not support search', 'SOURCE_UNSUPPORTED')), signal);
  }
  async cancelSearch(userId: string, id: string, sessionId: string) {
    // Cancellation must still get through when normal request slots are occupied.
    const row = this.instance(id), provider = this.registry.get(row.plugin_id, row.source_type)?.provider;
    if (!provider?.cancelSearch) return;
    await provider.cancelSearch(this.context(row, userId, AbortSignal.timeout(5000)), sessionId);
  }
  async searchFilters(userId: string, id: string, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.searchFilters?.(ctx) ?? Promise.resolve([]), signal);
  }
  async alternatives(userId: string, bookId: string, cursor?: string, signal?: AbortSignal, session?: Pick<SearchRequest, 'sessionId' | 'resultLimit'>) {
    const binding = this.chapters.binding(userId, bookId);
    const book = this.db.get<{ title: string; author: string }>('SELECT title, author FROM books WHERE id = ?', bookId)!;
    return this.call(userId, binding.source_id, (provider, ctx) => provider.alternatives
      ? provider.alternatives(ctx, { publicationRef: binding.publication_ref, query: book.title, authors: [book.author], cursor, ...session })
      : Promise.resolve({ items: [] }), signal);
  }
  canSwitch(userId: string, bookId: string): boolean {
    const binding = this.chapters.binding(userId, bookId);
    const row = this.instance(binding.source_id);
    return !!row.enabled && !!this.registry.get(row.plugin_id, row.source_type)?.provider.alternatives;
  }
  async switchPreview(userId: string, bookId: string, entryRef: string, signal?: AbortSignal) {
    const binding = this.chapters.binding(userId, bookId);
    return this.call(userId, binding.source_id, async (provider, ctx) => {
      if (!provider.alternatives) throw badRequest('source does not support alternatives');
      const acquisition = await provider.acquire(ctx, { entryRef });
      if (acquisition.kind !== 'chapters' || !provider.getManifest) throw badRequest('alternative has no chapters');
      const snapshot = await provider.getManifest(ctx, acquisition.publicationRef);
      return { chapters: snapshot.items.map(item => ({ id: item.id, title: item.title })), latestChapter: [...snapshot.items].sort((a,b)=>a.seq-b.seq).at(-1)?.title ?? '' };
    }, signal);
  }
  async switchQuality(userId: string, bookId: string, entryRef: string, chapterId: string, signal?: AbortSignal) {
    const binding = this.chapters.binding(userId,bookId);
    return this.call(userId,binding.source_id,async (provider,ctx) => {
      if (!provider.alternatives) throw badRequest('source does not support alternatives');
      const acquisition = await provider.acquire(ctx,{entryRef});
      if (acquisition.kind !== 'chapters') throw badRequest('alternative has no chapters');
      return this.chapters.inspect(provider,ctx,acquisition.publicationRef,chapterId);
    },signal);
  }
  async switchSource(userId: string, bookId: string, entryRef: string, chapterId: string, revision: string, signal?: AbortSignal) {
    const binding = this.chapters.binding(userId, bookId);
    return this.call(userId, binding.source_id, async (provider, ctx) => {
      if (!provider.alternatives) throw badRequest('source does not support alternatives');
      const acquisition = await provider.acquire(ctx, { entryRef });
      if (acquisition.kind !== 'chapters') throw badRequest('alternative has no chapters');
      return this.chapters.switchSource(provider, ctx, bookId, entryRef, acquisition.publicationRef, chapterId, revision);
    }, signal);
  }
  async detail(userId: string, id: string, ref: string, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.detail(ctx, ref), signal);
  }
  async acquire(userId: string, id: string, entryRef: string, optionId?: string, signal?: AbortSignal) {
    return this.call(userId, id, async (provider, ctx) => {
      const acquisition = await provider.acquire(ctx, { entryRef, optionId });
      if (acquisition.kind === 'ready') {
        if (ctx.instance.pluginId !== 'reader.local' || ctx.instance.sourceType !== 'local') {
          throw badRequest('external plugins cannot reference host book identities', 'INVALID_ACQUISITION');
        }
        this.db.run(
          `INSERT INTO user_books (user_id, book_id, added_at, hidden) VALUES (?, ?, ?, 0)
           ON CONFLICT(user_id, book_id) DO UPDATE SET hidden = 0,
           added_at = CASE WHEN user_books.hidden = 1 THEN excluded.added_at ELSE user_books.added_at END`,
          userId, acquisition.publicationId, Date.now(),
        );
      }
      if (acquisition.kind !== 'file' && acquisition.kind !== 'chapters') return acquisition;
      const entry = await provider.detail(ctx, entryRef);
      const bookId = acquisition.kind === 'chapters'
        ? await this.chapters.acquire(provider, ctx, { entryRef, optionId }, acquisition.publicationRef, entry)
        : await this.acquisitions.acquire(provider, ctx, { entryRef, optionId }, acquisition, entry);
      this.log?.info({ sourceId: id, bookId, kind: acquisition.kind }, 'source publication acquired');
      return { kind: 'ready' as const, publicationId: bookId };
    }, signal);
  }

  refreshPublication(userId: string, bookId: string, signal?: AbortSignal) {
    return this.updates.check(userId, bookId, signal);
  }

  async manifest(userId: string, id: string, ref: string, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.getManifest
      ? provider.getManifest(ctx, ref) : Promise.reject(badRequest('source has no chapter manifest', 'SOURCE_UNSUPPORTED')), signal);
  }
  async resource(userId: string, id: string, publicationRef: string, ref: string, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.readResource
      ? provider.readResource(ctx, { publicationRef, ref }) : Promise.reject(badRequest('source has no chapter resources', 'SOURCE_UNSUPPORTED')), signal);
  }

  private async call<T>(userId: string, id: string, action: (provider: SourceProvider, ctx: SourceContext) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
    const row = this.instance(id);
    if (!row.enabled) throw badRequest('source is disabled', 'SOURCE_DISABLED');
    const registration = this.registry.get(row.plugin_id, row.source_type);
    if (!registration) throw notFound('source plugin is not installed', 'PLUGIN_UNAVAILABLE');
    const accessVersion = this.access.version(id,userId);
    const active = this.activeSources.get(id) ?? 0;
    if (active >= 2 || this.activeCalls >= 8) {
      throw new AppError(429, 'RATE_LIMITED', 'source is busy; retry after current requests complete');
    }
    this.activeSources.set(id, active + 1);
    this.activeCalls += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); timer.unref();
    const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
    try {
      signal.throwIfAborted();
      const result = await action(registration.provider, this.context(row, userId, signal));
      if (userId && !signal.aborted) {
        const errors = (result as {errors?:Array<{code?:string}>} | null)?.errors;
        const state = errors?.some(e=>e.code === 'VERIFICATION_REQUIRED') ? 'verification-required' : errors?.some(e=>['AUTH_REQUIRED','AUTH_EXPIRED'].includes(e.code ?? '')) ? 'auth-required' : errors?.length ? null : 'reachable';
        if (state) this.access.record(id,userId,accessVersion,state);
      }
      return result;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (userId && !signal.aborted && ['AUTH_REQUIRED','AUTH_EXPIRED','VERIFICATION_REQUIRED'].includes(code)) this.access.record(id,userId,accessVersion,code === 'VERIFICATION_REQUIRED' ? 'verification-required' : 'auth-required');
      if (controller.signal.aborted) throw new AppError(504, 'SOURCE_TIMEOUT', 'source request exceeded its execution deadline');
      if (externalSignal?.aborted) throw new AppError(499, 'SOURCE_CANCELLED', 'source request cancelled');
      throw error;
    } finally {
      clearTimeout(timer);
      this.activeCalls -= 1;
      const remaining = (this.activeSources.get(id) ?? 1) - 1;
      if (remaining) this.activeSources.set(id, remaining);
      else this.activeSources.delete(id);
    }
  }

  private context(row: SourceRow, userId: string, signal: AbortSignal): SourceContext {
    const instance: SourceInstance = {
      id: row.id, pluginId: row.plugin_id, sourceType: row.source_type, name: row.name,
      config: parse(row.config_json), enabled: row.enabled === 1,
    };
    return {
      instance, userId, signal,
      credentials: this.credentials(row.id, userId),
      storage: this.storage(row.id, userId),
      log: this.log ? {
        debug: (message, fields) => this.log?.debug(fields ?? {}, message),
        info: (message, fields) => this.log?.info(fields ?? {}, message),
        warn: (message, fields) => this.log?.warn(fields ?? {}, message),
        error: (message, fields) => this.log?.error(fields ?? {}, message),
      } : undefined,
    };
  }
  private credentials(sourceId: string, userId: string): CredentialStore {
    return {
      get: async (key) => {
        const row = this.db.get<{ encrypted_value: string }>('SELECT encrypted_value FROM source_credentials WHERE source_id = ? AND user_id = ? AND key = ?', sourceId, userId, key);
        return row ? this.decrypt(row.encrypted_value) : undefined;
      },
      set: async (key, value) => this.setCredential(sourceId, userId, key, value),
      delete: async (key) => this.deleteCredential(sourceId,userId,key),
    };
  }
  private storage(sourceId: string, userId: string): SourceStorage {
    const prefix = `source:${sourceId}:${userId}:`;
    return {
      get: async (key) => { const row = this.db.get<{ value: string }>('SELECT value FROM plugin_storage WHERE key = ?', prefix + key); return row ? parse(row.value) : undefined; },
      set: async (key, value) => this.db.run('INSERT INTO plugin_storage (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', prefix + key, json(value)),
      delete: async (key) => this.db.run('DELETE FROM plugin_storage WHERE key = ?', prefix + key),
    };
  }
  private instance(id: string): SourceRow {
    const row = this.db.get<SourceRow>('SELECT id, plugin_id, source_type, name, config_json, enabled FROM source_instances WHERE id = ?', id);
    if (!row) throw notFound('source instance not found', 'SOURCE_NOT_FOUND');
    return row;
  }
  private encrypt(value: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  private decrypt(value: string): string {
    try {
      const [iv, tag, body] = value.split('.');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv!, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body!, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new AppError(401, 'AUTH_REQUIRED', 'stored credentials could not be decrypted; save them again');
    }
  }
}

interface SourceRow { id: string; plugin_id: string; source_type: string; name: string; config_json: string; enabled: number }
