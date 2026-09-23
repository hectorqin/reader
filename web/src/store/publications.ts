import type { ReadingOverrides } from '../api/types.ts';
import type { BlobStore, KeyValueStore } from '../core/platform.ts';
import type { BookContent, Manifest, TocEntry } from '../api/types.ts';

export interface CachedResource { bookId: string; ref: string; bytes: number }
const writes = new Map<string, Promise<unknown>>();
export const OFFLINE_FILE = '__complete_file__';

/**
 * Device cache for staged publications.
 *
 * The cache namespace includes both the server and account.  A book id is only
 * unique inside one account, and using it on its own would let signing out and
 * into another server expose the previous account's chapter text.
 */
export class PublicationCache {
  private readonly scopeKey: string;

  constructor(
    private readonly kv: KeyValueStore,
    private readonly blobs: BlobStore,
    scope: string,
  ) {
    this.scopeKey = encodeURIComponent(scope);
  }

  async manifest(bookId: string): Promise<Manifest | null> {
    const raw = await this.kv.get(this.metaKey(bookId));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Manifest;
      return value?.book?.id === bookId ? value : null;
    } catch {
      return null;
    }
  }

  async putManifest(bookId: string, manifest: Manifest): Promise<void> {
    await this.kv.set(this.metaKey(bookId), JSON.stringify(manifest));
  }

  async resource(bookId: string, ref: string): Promise<Uint8Array | null> {
    return this.blobs.get(this.resourceKey(bookId, ref));
  }

  async putResource(bookId: string, ref: string, bytes: Uint8Array): Promise<void> {
    await this.exclusive(async () => {
      const entries = await this.entries();
      const retained = entries.filter(e => e.bookId !== bookId || e.ref !== ref);
      const used = retained.reduce((sum, entry) => sum + entry.bytes, 0);
      if (used + bytes.byteLength > await this.quota()) throw new Error('离线缓存配额不足，请清理缓存或提高配额');
      const key = this.resourceKey(bookId, ref);
      const previous = await this.blobs.get(key);
      await this.blobs.put(key, bytes);
      try { await this.kv.set(this.indexKey(), JSON.stringify([...retained, { bookId, ref, bytes: bytes.byteLength }])); }
      catch (error) { if (previous) await this.blobs.put(key, previous); else await this.blobs.remove(key); throw error; }
    });
  }

  async overrides(bookId: string): Promise<ReadingOverrides | null> { const raw = await this.kv.get(this.metaKey(bookId) + ':overrides'); try { return raw ? JSON.parse(raw) as ReadingOverrides : null; } catch { return null; } }
  async putOverrides(bookId: string, value: ReadingOverrides): Promise<void> { await this.kv.set(this.metaKey(bookId) + ':overrides',JSON.stringify(value)); }
  async window(bookId: string, group: number): Promise<BookContent | null> {
    const raw = await this.kv.get(this.metaKey(bookId) + ':window:' + group);
    try { return raw ? JSON.parse(raw) as BookContent : null; } catch { return null; }
  }
  async putWindow(bookId: string, group: number, content: BookContent): Promise<void> {
    await this.kv.set(this.metaKey(bookId) + ':window:' + group, JSON.stringify(content));
  }
  async toc(bookId: string): Promise<TocEntry[] | null> {
    const value = await this.kv.get(this.metaKey(bookId) + ':toc');
    try { return value ? JSON.parse(value) as TocEntry[] : null; } catch { return null; }
  }
  async putToc(bookId: string, toc: TocEntry[]): Promise<void> { await this.kv.set(this.metaKey(bookId) + ':toc', JSON.stringify(toc)); }
  async task(bookId: string): Promise<string | null> { return this.kv.get(this.metaKey(bookId) + ':task'); }
  async putTask(bookId: string, value: string): Promise<void> { await this.kv.set(this.metaKey(bookId) + ':task', value); }
  async quota(): Promise<number> { return Number(await this.kv.get(this.indexKey() + ':quota')) || 256 * 1024 * 1024; }
  async setQuota(bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 1024 * 1024 || bytes > 10 * 1024 * 1024 * 1024) throw new Error('缓存配额应为 1–10240 MiB');
    await this.exclusive(async () => {
      if ((await this.entries()).reduce((n, e) => n + e.bytes, 0) > bytes) throw new Error('新配额低于当前占用，请先清理缓存');
      await this.kv.set(this.indexKey() + ':quota', String(bytes));
    });
  }
  async entries(): Promise<CachedResource[]> {
    const raw = await this.kv.get(this.indexKey());
    if (raw) return JSON.parse(raw) as CachedResource[];
    // Adopt previously read chapters into the quota without exposing another account.
    const prefix = `reader.publication.resource.v1:${this.scopeKey}:`;
    const entries: CachedResource[] = [];
    for (const key of await this.blobs.list()) {
      if (!key.startsWith(prefix)) continue;
      const [book, ref] = key.slice(prefix.length).split(':');
      const bytes = await this.blobs.get(key);
      if (book && ref && bytes) entries.push({ bookId: decodeURIComponent(book), ref: decodeURIComponent(ref), bytes: bytes.byteLength });
    }
    return entries;
  }
  async removeBook(bookId: string): Promise<void> {
    await this.exclusive(async () => {
      const entries = await this.entries();
      for (const entry of entries.filter(e => e.bookId === bookId)) await this.blobs.remove(this.resourceKey(bookId, entry.ref));
      await this.kv.set(this.indexKey(), JSON.stringify(entries.filter(e => e.bookId !== bookId)));
      await this.kv.remove(this.metaKey(bookId) + ':task');
      // Keep the lightweight manifest and reading records; never delete the user's source file.
    });
  }
  private indexKey(): string { return `reader.publication.index.v1:${this.scopeKey}`; }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const key = this.indexKey();
    const next = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
    writes.set(key, next);
    try { return await next; } finally { if (writes.get(key) === next) writes.delete(key); }
  }

  private metaKey(bookId: string): string {
    return `reader.publication.v1:${this.scopeKey}:${bookId}`;
  }

  private resourceKey(bookId: string, ref: string): string {
    return `reader.publication.resource.v1:${this.scopeKey}:${encodeURIComponent(bookId)}:${encodeURIComponent(ref)}`;
  }
}

export function publicationScope(serverUrl: string, userId: string): string {
  return JSON.stringify([serverUrl.replace(/\/+$/, ''), userId]);
}
