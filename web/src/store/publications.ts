import type { BlobStore, KeyValueStore } from '../core/platform.ts';
import type { Manifest } from '../api/types.ts';

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
    await this.blobs.put(this.resourceKey(bookId, ref), bytes);
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
