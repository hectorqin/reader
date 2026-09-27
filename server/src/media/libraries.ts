import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { LocalMediaStorage } from './storage/local.ts';
import { OpenListMediaStorage, normalizeOpenList } from './storage/openlist.ts';
import type { OpenListConnection } from './storage/openlist.ts';
import type { MediaStorage } from './storage/types.ts';
import { DatabaseMediaAccounts } from './accounts.ts';
import type { MediaAccounts } from './accounts.ts';
import type { MediaAccountReferences } from './accounts.ts';

export type MediaLibraryKind = 'video' | 'music' | 'audiobook';
export interface MediaActor { id: string; role: 'admin' | 'member' }
export interface MediaLibrary {
  id: string; name: string; kind: MediaLibraryKind; access: 'all' | 'restricted';
  storage: 'local' | 'openlist';
  createdAt: number; updatedAt: number;
}
export interface CreateMediaLibrary {
  name: string; kind: MediaLibraryKind; root: string; access: 'all' | 'restricted'; requestId?: string;
  storage?: 'local' | 'openlist'; openlist?: OpenListConnection;
}
interface OpenListRow { base_url: string; token: string; password: string }
interface LibraryRow {
  id: string; name: string; kind: MediaLibraryKind; root: string;
  access: 'all' | 'restricted'; created_at: number; updated_at: number;
}

/** Independent, additive media schema. The reading tables are not migrated here. */
export class MediaLibraries {
  constructor(private readonly db: MediaDatabase, initialize = true,private readonly accounts:MediaAccounts=new DatabaseMediaAccounts(db),private readonly references?:MediaAccountReferences) {
    if (!initialize) return;
    db.transaction(() => {
      db.run(`CREATE TABLE IF NOT EXISTS media_libraries (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('video','music','audiobook')),
        storage TEXT NOT NULL DEFAULT 'local' CHECK(storage = 'local'),
        root TEXT NOT NULL,
        access TEXT NOT NULL CHECK(access IN ('all','restricted')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      db.run(`CREATE TABLE IF NOT EXISTS media_library_users (
        library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(library_id,user_id))`);
      db.run(`CREATE TABLE IF NOT EXISTS media_library_creations (
        actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL, input_json TEXT NOT NULL,
        library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,
        PRIMARY KEY(actor_id,request_id))`);
      // An additive adapter table preserves legacy local-library constraints and all foreign keys.
      db.run(`CREATE TABLE IF NOT EXISTS media_library_openlist (
        library_id TEXT PRIMARY KEY REFERENCES media_libraries(id) ON DELETE CASCADE,
        base_url TEXT NOT NULL, token TEXT NOT NULL, password TEXT NOT NULL)`);
    });
  }

  private public(row: LibraryRow): MediaLibrary {
    return { id: row.id, name: row.name, kind: row.kind, access: row.access,
      storage: this.openlist(row.id) ? 'openlist' : 'local',
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private openlist(id: string): OpenListRow | undefined {
    return this.db.get<OpenListRow>('SELECT base_url,token,password FROM media_library_openlist WHERE library_id=?', id);
  }

  private admin(actor: MediaActor): void {
    if (actor.role !== 'admin') throw forbidden('admin role required', 'ADMIN_REQUIRED');
  }

  list(actor: MediaActor): MediaLibrary[] {
    return this.db.all<LibraryRow>(`SELECT l.* FROM media_libraries l WHERE ? = 'admin'
      OR l.access = 'all' OR EXISTS (SELECT 1 FROM media_library_users u
        WHERE u.library_id=l.id AND u.user_id=?) ORDER BY l.created_at,l.id`, actor.role, actor.id).map(row => this.public(row));
  }

  get(actor: MediaActor, id: string): MediaLibrary {
    return this.public(this.accessible(actor, id));
  }

  private accessible(actor: MediaActor, id: string): LibraryRow {
    const row = this.db.get<LibraryRow>(`SELECT l.* FROM media_libraries l WHERE l.id=? AND
      (?='admin' OR l.access='all' OR EXISTS (SELECT 1 FROM media_library_users u
        WHERE u.library_id=l.id AND u.user_id=?))`, id, actor.role, actor.id);
    if (!row) throw notFound('media library not found');
    return row;
  }

  async create(actor: MediaActor, input: CreateMediaLibrary): Promise<MediaLibrary> {
    this.admin(actor);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 ||
      !['video','music','audiobook'].includes(input.kind) || !['all','restricted'].includes(input.access) ||
      typeof input.root !== 'string' || !['local','openlist'].includes(input.storage || 'local')) {
      throw badRequest('invalid media library configuration');
    }
    if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId))) {
      throw badRequest('invalid library creation request id');
    }
    const remote = input.storage === 'openlist' ? normalizeOpenList(input.openlist!, input.root) : undefined;
    if (!remote && (!isAbsolute(input.root) || input.openlist !== undefined)) throw badRequest('invalid media library configuration');
    // Keep local receipts compatible; never duplicate remote credentials in receipt records.
    const fingerprint = remote ? createHash('sha256').update(JSON.stringify([input.name.trim(), input.kind, remote, input.access])).digest('hex') :
      JSON.stringify([input.name.trim(), input.kind, input.root, input.access]);
    const previous = () => {
      if (!input.requestId) return null;
      const receipt = this.db.get<{input_json:string;library_id:string}>(
        'SELECT input_json,library_id FROM media_library_creations WHERE actor_id=? AND request_id=?', actor.id, input.requestId);
      if (!receipt) return null;
      if (receipt.input_json !== fingerprint) throw conflict('creation request already used for different configuration', 'MEDIA_CREATION_CONFLICT');
      return this.get(actor, receipt.library_id);
    };
    const existing = previous();
    if (existing) return existing;
    if (remote) await new OpenListMediaStorage(remote.connection, remote.root).validate();
    else await LocalMediaStorage.create(input.root);
    const root = remote?.root ?? await realpath(input.root);
    return this.db.transaction(() => {
      // Another request can finish while the directory validation is awaiting I/O.
      const existing = previous();
      if (existing) return existing;
      const id = randomUUID(), now = Date.now();
      this.db.run(`INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`, id, input.name.trim(), input.kind, root, input.access, now, now);
      if (remote) this.db.run('INSERT INTO media_library_openlist(library_id,base_url,token,password) VALUES(?,?,?,?)',
        id, remote.connection.baseUrl, remote.connection.token || '', remote.connection.password || '');
      if (input.requestId) this.db.run('INSERT INTO media_library_creations(actor_id,request_id,input_json,library_id) VALUES(?,?,?,?)', actor.id, input.requestId, fingerprint, id);
      return this.get(actor, id);
    });
  }

  configuration(actor: MediaActor, id: string) {
    this.admin(actor);
    const row = this.accessible(actor, id);
    const remote = this.openlist(id);
    return { ...this.public(row), root: row.root,
      ...(remote ? { openlist: { baseUrl: remote.base_url, hasToken: !!remote.token, hasPassword: !!remote.password } } : {}),
      userIds: this.db.all<{user_id: string}>('SELECT user_id FROM media_library_users WHERE library_id=? ORDER BY user_id', id).map(u => u.user_id) };
  }

  rename(actor: MediaActor, id: string, name: string): MediaLibrary {
    this.admin(actor);
    this.accessible(actor, id);
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw badRequest('invalid library name');
    this.db.run('UPDATE media_libraries SET name=?,updated_at=? WHERE id=?', name.trim(), Date.now(), id);
    return this.get(actor, id);
  }

  async update(actor: MediaActor, id: string, input: { name?: string; openlist?: Pick<OpenListConnection, 'token' | 'password'> }): Promise<MediaLibrary> {
    this.admin(actor);
    const row = this.accessible(actor, id), old = this.openlist(id);
    if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200)) throw badRequest('invalid library name');
    if (input.openlist !== undefined) {
      if (!old) throw badRequest('this library is not connected to OpenList');
      const next = normalizeOpenList({ baseUrl: old.base_url, token: input.openlist.token ?? old.token, password: input.openlist.password ?? old.password }, row.root);
      await new OpenListMediaStorage(next.connection, next.root).validate();
      return this.db.transaction(() => {
        // Do not silently overwrite another administrator's concurrently refreshed credentials.
        const latest = this.openlist(id);
        if (!latest || JSON.stringify(latest) !== JSON.stringify(old)) throw conflict('OpenList 配置已变更，请刷新后重试', 'MEDIA_CONFIGURATION_CHANGED');
        this.db.run('UPDATE media_library_openlist SET token=?,password=? WHERE library_id=?', next.connection.token || '', next.connection.password || '', id);
        return this.rename(actor, id, input.name ?? this.accessible(actor, id).name);
      });
    }
    return input.name === undefined ? this.get(actor, id) : this.rename(actor, id, input.name);
  }

  setAccess(actor: MediaActor, id: string, access: 'all' | 'restricted', userIds: string[]): void {
    this.admin(actor);
    this.accessible(actor, id);
    if (!['all','restricted'].includes(access) || !Array.isArray(userIds) ||
      userIds.length > 1000 || userIds.some(u => typeof u !== 'string')) {
      throw badRequest('invalid media library access');
    }
    this.db.transaction(() => {
      for (const userId of new Set(userIds)) {
        const user=this.accounts.get(userId);
        if (!user || (user.disabled!==0&&!this.db.get('SELECT 1 FROM media_library_users WHERE library_id=? AND user_id=?',id,userId))) {
          throw badRequest('unknown or disabled user');
        }
      }
      this.db.run('DELETE FROM media_library_users WHERE library_id=?', id);
      for (const userId of new Set(userIds)) {
        this.references?.ensure(userId);
        this.db.run('INSERT INTO media_library_users(library_id,user_id) VALUES(?,?)', id, userId);
      }
      this.db.run('UPDATE media_libraries SET access=?,updated_at=? WHERE id=?', access, Date.now(), id);
    });
  }

  /** Check permission at use time, including when opening a previously known resource. */
  async storage(actor: MediaActor, id: string): Promise<MediaStorage> {
    const row = this.accessible(actor, id), remote = this.openlist(id);
    return remote ? new OpenListMediaStorage({baseUrl: remote.base_url, token: remote.token, password: remote.password}, row.root) : LocalMediaStorage.create(row.root);
  }
}
