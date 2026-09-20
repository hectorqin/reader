import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.ts';
import type { Db } from '../db/index.ts';
import type { ShelfService } from './shelf.ts';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.ts';
import { SourceRegistry } from '../sources/registry.ts';
import { createLocalProvider } from '../sources/local.ts';
import { createOpdsProvider } from '../sources/opds.ts';
import type { SourceContext, SourceInstance, SourceProvider, SourceStorage, CredentialStore } from '../sources/types.ts';
import { FileAcquisitions } from '../sources/acquisitions.ts';
import { PluginManager } from '../sources/plugin-manager.ts';
import { ChapterPublications } from '../publications/chapters.ts';

function json(value: unknown): string { return JSON.stringify(value ?? {}); }
function parse(value: string): unknown { try { return JSON.parse(value); } catch { return {}; } }

/** Host-owned registry, instance lifecycle and credential boundary. */
export class SourceHost {
  readonly registry = new SourceRegistry();
  readonly plugins: PluginManager;
  readonly chapters: ChapterPublications;
  private readonly key: Buffer;
  private readonly acquisitions: FileAcquisitions;
  private activeCalls = 0;
  private readonly activeSources = new Map<string, number>();

  constructor(private readonly db: Db, private readonly config: AppConfig, shelf: () => ShelfService, private readonly log?: FastifyBaseLogger) {
    this.key = createHash('sha256').update('reader/source-credentials/v1\0').update(config.jwtSecret).digest();
    this.acquisitions = new FileAcquisitions(db, config);
    this.chapters = new ChapterPublications(db, {
      manifest: (userId, sourceId, ref, signal) => this.manifest(userId, sourceId, ref, signal),
      resource: (userId, sourceId, publicationRef, ref, signal) => this.call(userId, sourceId, (provider, ctx) => provider.readResource
        ? provider.readResource(ctx, { publicationRef, ref, rendition: 'text' })
        : Promise.reject(badRequest('source has no chapter resources', 'SOURCE_UNSUPPORTED')), signal),
    });
    this.registry.registerBuiltin('reader.local', createLocalProvider(db, shelf));
    this.registry.registerBuiltin('reader.opds', createOpdsProvider());
    this.plugins = new PluginManager(db, config.dataDir, this.registry);
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
    return this.db.all<{ id: string; plugin_id: string; source_type: string; name: string; config_json: string; enabled: number }>(
      'SELECT id, plugin_id, source_type, name, config_json, enabled FROM source_instances ORDER BY name',
    ).map((row) => ({
      id: row.id, pluginId: row.plugin_id, sourceType: row.source_type, name: row.name,
      enabled: row.enabled === 1,
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
    this.db.run('UPDATE source_instances SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
  }

  setCredential(sourceId: string, userId: string, name: string, value: string): void {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(name) || value.length > 16_384) throw badRequest('invalid credential');
    this.instance(sourceId);
    this.db.run(
      `INSERT INTO source_credentials (source_id, user_id, key, encrypted_value) VALUES (?, ?, ?, ?)
       ON CONFLICT(source_id, user_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value`,
      sourceId, userId, name, this.encrypt(value),
    );
  }

  async browse(userId: string, id: string, request: { ref?: string; cursor?: string; limit?: number }, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.browse
      ? provider.browse(ctx, request) : Promise.reject(badRequest('source does not support browse', 'SOURCE_UNSUPPORTED')), signal);
  }
  async search(userId: string, id: string, request: { query: string; cursor?: string; limit?: number }, signal?: AbortSignal) {
    return this.call(userId, id, (provider, ctx) => provider.search
      ? provider.search(ctx, request) : Promise.reject(badRequest('source does not support search', 'SOURCE_UNSUPPORTED')), signal);
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
    return this.chapters.refresh(userId, bookId, signal);
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
      return await action(registration.provider, this.context(row, userId, signal));
    } catch (error) {
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
      delete: async (key) => this.db.run('DELETE FROM source_credentials WHERE source_id = ? AND user_id = ? AND key = ?', sourceId, userId, key),
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
