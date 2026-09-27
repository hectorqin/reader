import { Readable } from 'node:stream';
import { AppError, badRequest } from '../../lib/errors.ts';
import { StorageError } from './types.ts';
import type { ByteRange, MediaStorage, StorageEntry } from './types.ts';

export interface OpenListConnection { baseUrl: string; token?: string; password?: string }
interface RemoteObject { name: string; size: number; is_dir: boolean; modified: string; raw_url?: string }
const PAGE_SIZE = 200;
const MAX_JSON = 4 * 1024 * 1024;
const REQUEST_TIMEOUT = 15_000;
const MAX_CACHED_DIRECTORIES = 64;
const MAX_CACHED_ENTRIES = 20_000;
const remoteError = (code = 'MEDIA_OPENLIST_UNAVAILABLE') => new AppError(502, code,
  code === 'MEDIA_OPENLIST_AUTH' ? 'OpenList 凭据或目录权限无效，请更新接入配置' :
  code === 'MEDIA_OPENLIST_RANGE' ? 'OpenList 上游未正确支持分段读取，无法定位播放' :
  code === 'MEDIA_OPENLIST_CHANGED' ? 'OpenList 目录或资源已变化，请重新扫描' : 'OpenList 连接或资源读取失败，请检查服务地址和目录');

function httpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw badRequest('OpenList 服务地址必须是 HTTP 或 HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw badRequest('OpenList 地址不能包含登录凭据、片段或其他协议');
  return url;
}
function segment(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(value);
}
export function normalizeOpenList(input: OpenListConnection, root: string): { connection: OpenListConnection; root: string } {
  if (!input || typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) throw badRequest('invalid OpenList configuration');
  const url = httpUrl(input.baseUrl.trim());
  if (url.search) throw badRequest('OpenList 服务地址不能包含查询参数');
  for (const value of [input.token, input.password]) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)))
      throw badRequest('invalid OpenList credential');
  }
  if (typeof root !== 'string' || root.length > 4000 || !root.startsWith('/') || root.includes('\\'))
    throw badRequest('OpenList 目录必须使用以 / 开头的远端路径');
  const normalized = root === '/' ? '/' : root.replace(/\/+$/, '');
  if (normalized !== '/' && normalized.slice(1).split('/').some(part => !segment(part))) throw badRequest('invalid OpenList directory');
  return { root: normalized, connection: { baseUrl: url.href.replace(/\/+$/, ''), token: input.token || '', password: input.password || '' } };
}

/** Read-only OpenList v4 fs API. Secrets and signed URLs never leave this adapter. */
export class OpenListMediaStorage implements MediaStorage {
  private readonly connection: OpenListConnection;
  private readonly root: string;
  // Storage instances are scoped to one scan/request, never reused across scans.
  private readonly directories = new Map<string, RemoteObject[]>();
  private readonly pendingDirectories = new Map<string, Promise<RemoteObject[]>>();
  private cachedEntries = 0;
  constructor(connection: OpenListConnection, root: string, private readonly request: typeof fetch = fetch, private readonly timeout = REQUEST_TIMEOUT) {
    const normalized = normalizeOpenList(connection, root);
    this.connection = normalized.connection;
    this.root = normalized.root;
  }
  private path(ref: string): string {
    if (!ref || ref.length > 4000 || ref.split('/').some(part => !segment(part))) throw new StorageError('invalid-ref', 'Invalid media resource reference');
    return `${this.root === '/' ? '' : this.root}/${ref}`;
  }
  private object(value: unknown): RemoteObject {
    const obj = value as RemoteObject;
    if (!obj || typeof obj.name !== 'string' || !segment(obj.name) || typeof obj.is_dir !== 'boolean' ||
      !Number.isSafeInteger(obj.size) || obj.size < 0 || typeof obj.modified !== 'string' || !Number.isFinite(Date.parse(obj.modified))) throw remoteError();
    return obj;
  }
  private entry(ref: string, obj: RemoteObject): StorageEntry {
    if (obj.is_dir) throw new StorageError('not-file', 'Media resource is not a regular file');
    return { ref, name: obj.name, size: obj.size, modifiedAt: Date.parse(obj.modified), fileIdentity: null };
  }
  private async api<T>(method: 'list' | 'get', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const controller = new AbortController(), abort = () => controller.abort();
    const timer = setTimeout(abort, this.timeout);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.request(`${this.connection.baseUrl}/api/fs/${method}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(this.connection.token ? { Authorization: this.connection.token } : {}) },
        body: JSON.stringify({ ...body, password: this.connection.password || '' }),
      });
      if (!response.ok) { await response.body?.cancel(); throw remoteError([401,403].includes(response.status) ? 'MEDIA_OPENLIST_AUTH' : undefined); }
      if (!response.body) throw remoteError();
      let size = 0; const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_JSON) { controller.abort(); throw remoteError(); }
        chunks.push(chunk);
      }
      const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { code: number; data: T };
      if (json.code !== 200) throw remoteError([401,403].includes(json.code) ? 'MEDIA_OPENLIST_AUTH' : undefined);
      if (!json.data || typeof json.data !== 'object') throw remoteError();
      return json.data;
    } catch (error) {
      signal?.throwIfAborted();
      // Upstream exceptions may include signed URLs, headers or directory passwords.
      throw error instanceof AppError ? error : remoteError();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async validate(): Promise<void> {
    const data = await this.api<{content: unknown[] | null; total: number}>('list', { path: this.root, page: 1, per_page: 1, refresh: false });
    if (!Number.isSafeInteger(data.total) || data.total < 0 || (data.content !== null && !Array.isArray(data.content)) ||
      (data.total > 0 && !data.content?.length)) throw remoteError();
    for (const obj of data.content || []) this.object(obj);
  }
  private async directory(ref: string, signal?: AbortSignal): Promise<RemoteObject[]> {
    signal?.throwIfAborted();
    const cached=this.directories.get(ref);
    if(cached){this.directories.delete(ref);this.directories.set(ref,cached);return cached;}
    const pending=this.pendingDirectories.get(ref);
    if(pending)return pending;
    const task=this.fetchDirectory(ref,signal);
    this.pendingDirectories.set(ref,task);
    try{
      const entries=await task;
      if(entries.length<=MAX_CACHED_ENTRIES){
        while(this.directories.size&&(this.directories.size>=MAX_CACHED_DIRECTORIES||this.cachedEntries+entries.length>MAX_CACHED_ENTRIES)){
          const key=this.directories.keys().next().value!;
          this.cachedEntries-=this.directories.get(key)!.length;this.directories.delete(key);
        }
        this.directories.set(ref,entries);this.cachedEntries+=entries.length;
      }
      return entries;
    }finally{this.pendingDirectories.delete(ref);}
  }
  private async fetchDirectory(ref: string, signal?: AbortSignal): Promise<RemoteObject[]> {
    const entries: RemoteObject[] = [], seen = new Set<string>(); let total: number | undefined;
    for (let page = 1; ; page++) {
      const data = await this.api<{content: unknown[] | null; total: number}>('list', {
        path: ref ? this.path(ref) : this.root, page, per_page: PAGE_SIZE, refresh: false,
      }, signal);
      if (!Number.isSafeInteger(data.total) || data.total < 0 || data.total > 100_000 ||
        (total !== undefined && total !== data.total) || (data.content !== null && !Array.isArray(data.content))) throw remoteError('MEDIA_OPENLIST_CHANGED');
      total = data.total;
      const content = data.content || [];
      if (content.length > PAGE_SIZE || (!content.length && entries.length < total)) throw remoteError('MEDIA_OPENLIST_CHANGED');
      for (const value of content) {
        const obj = this.object(value);
        if (seen.has(obj.name)) throw remoteError('MEDIA_OPENLIST_CHANGED');
        seen.add(obj.name); entries.push(obj);
      }
      if (entries.length > total) throw remoteError('MEDIA_OPENLIST_CHANGED');
      if (entries.length === total) return entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    }
  }
  async *list(signal?: AbortSignal): AsyncIterable<StorageEntry> {
    const pending = ['']; let directories = 0;
    while (pending.length) {
      signal?.throwIfAborted();
      const prefix = pending.pop()!;
      if (++directories > 10_000 || prefix.split('/').length > 64) throw remoteError();
      for (const obj of await this.directory(prefix, signal)) {
        const ref = prefix ? `${prefix}/${obj.name}` : obj.name;
        this.path(ref);
        if (obj.is_dir) pending.push(ref); else yield this.entry(ref, obj);
      }
    }
  }
  private async get(ref: string, signal?: AbortSignal): Promise<RemoteObject> {
    const obj = this.object(await this.api('get', { path: this.path(ref) }, signal));
    if (obj.name !== ref.split('/').at(-1)) throw remoteError('MEDIA_OPENLIST_CHANGED');
    return obj;
  }
  async stat(ref: string): Promise<StorageEntry> { return this.entry(ref, await this.get(ref)); }
  async siblings(ref: string): Promise<StorageEntry[]> {
    this.path(ref);
    const slash = ref.lastIndexOf('/'), prefix = slash < 0 ? '' : ref.slice(0, slash);
    return (await this.directory(prefix)).filter(obj => !obj.is_dir).map(obj => this.entry(prefix ? `${prefix}/${obj.name}` : obj.name, obj));
  }
  async siblingNames(ref: string): Promise<Set<string>> { return new Set((await this.siblings(ref)).map(obj => obj.name)); }
  async open(ref: string, range?: ByteRange, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const obj = await this.get(ref, signal), entry = this.entry(ref, obj);
    const start = range?.start ?? 0, end = range?.end ?? entry.size - 1;
    if (range && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= entry.size))
      throw new StorageError('invalid-range', 'Byte range is outside the resource');
    if (typeof obj.raw_url !== 'string' || !obj.raw_url) throw remoteError();
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timer = setTimeout(abort, this.timeout);
    const reset = () => { clearTimeout(timer); timer = setTimeout(abort, this.timeout); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    try {
      let url = httpUrl(obj.raw_url), response: Response | undefined;
      // Never forward API Authorization to storage URLs, even when the origin matches.
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await this.request(url, { redirect: 'manual', signal: controller.signal,
          headers: { 'accept-encoding': 'identity', ...(range ? { Range: `bytes=${start}-${end}` } : {}) } });
        if (![301,302,303,307,308].includes(response.status)) break;
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === 5) throw remoteError();
        url = httpUrl(new URL(location, url).href);
      }
      if (!response || ![200,206].includes(response.status) || !response.body) throw remoteError();
      const expected = Math.max(0, end - start + 1), length = response.headers.get('content-length');
      if ((length !== null && Number(length) !== expected) ||
        (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')) throw remoteError('MEDIA_OPENLIST_RANGE');
      if (response.status === 206) {
        if (response.headers.get('content-range') !== `bytes ${start}-${end}/${entry.size}`) throw remoteError('MEDIA_OPENLIST_RANGE');
      } else if (range && (start !== 0 || end !== entry.size - 1)) throw remoteError('MEDIA_OPENLIST_RANGE');
      reset();
      const body = response.body;
      const stream = Readable.from((async function* () {
        let received = 0;
        try {
          for await (const chunk of body) {
            // A slow/paused client is backpressure, not a stalled remote read.
            clearTimeout(timer); received += chunk.length;
            if (received > expected) throw remoteError('MEDIA_OPENLIST_CHANGED');
            yield Buffer.from(chunk);
            reset();
          }
          if (received !== expected) throw remoteError('MEDIA_OPENLIST_CHANGED');
        } catch { throw remoteError(); }
        finally { controller.abort(); cleanup(); }
      })());
      stream.once('close', () => { controller.abort(); cleanup(); });
      return { stream, entry, start, end };
    } catch (error) { controller.abort(); cleanup(); throw error instanceof AppError ? error : remoteError(); }
  }
}
