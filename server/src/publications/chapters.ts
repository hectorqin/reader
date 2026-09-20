import { createHash } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { AssetPayload, Manifest } from '../indexer/formats/registry.ts';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.ts';
import { decodeManifest } from '../sources/protocol.ts';
import type {
  AcquireRequest, CatalogEntry, ManifestSnapshot, ResourceResponse, SourceContext, SourceProvider,
} from '../sources/types.ts';

export const MAX_CHAPTER_BYTES = 2 * 1024 * 1024;
export const MAX_CHAPTERS = 10_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

interface ChapterLoader {
  manifest(userId: string, sourceId: string, publicationRef: string, signal?: AbortSignal): Promise<ManifestSnapshot>;
  resource(userId: string, sourceId: string, publicationRef: string, ref: string, signal?: AbortSignal): Promise<ResourceResponse>;
}

interface PublicationRow {
  book_id: string;
  user_id: string;
  source_id: string;
  publication_ref: string;
  revision: string;
  snapshot_json: string;
}

interface ResourceRow {
  provider_ref: string;
  body: string | null;
  content_hash: string | null;
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isPlainUtf8(type: string): boolean {
  const [mediaType, ...parameters] = type.split(';');
  if (mediaType?.trim().toLowerCase() !== 'text/plain') return false;
  return parameters.every((parameter) => {
    const [name, value] = parameter.split('=');
    return name?.trim().toLowerCase() !== 'charset' || /^(?:utf-8|utf8)$/i.test((value ?? '').trim().replace(/^"|"$/g, ''));
  });
}

/** Stable reader identities, versioned directories and cached plain-text chapters. */
export class ChapterPublications {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly db: Db, private readonly loader: ChapterLoader) {}

  has(bookId: string): boolean {
    return !!this.db.get('SELECT book_id FROM chapter_publications WHERE book_id = ?', bookId);
  }

  manifest(userId: string, bookId: string): Manifest {
    const publication = this.owned(userId, bookId);
    const snapshot = JSON.parse(publication.snapshot_json) as ManifestSnapshot;
    return {
      kind: 'text', revision: publication.revision, total: snapshot.items.length,
      groups: snapshot.items.length ? [{ id: 'chapters', seq: 0, title: '章节', count: snapshot.items.length, offset: 0 }] : [],
      items: snapshot.items.map((item, seq) => {
        const id = hash(item.id);
        return {
          id, seq, title: item.title, kind: 'chapter', href: `chapter:${id}`,
          resourceRef: `chapter-resource:${publication.revision}:${id}`,
          // The TXT reader typesets plain characters itself; never label a
          // plugin's characters as HTML or run a markup parser over them.
          mediaType: 'text/plain; charset=utf-8', format: 'html',
        };
      }),
    };
  }

  acquire(
    provider: SourceProvider, context: SourceContext, request: AcquireRequest,
    publicationRef: string, entry: CatalogEntry,
  ): Promise<string> {
    const bookId = hash(JSON.stringify(['reader/chapter-publication/v1', context.instance.id, context.userId, publicationRef]));
    return this.serial(`publication:${bookId}`, async () => {
      context.signal.throwIfAborted();
      if (!this.has(bookId)) {
        if (!provider.getManifest || !provider.readResource) throw badRequest('source has no chapter content', 'SOURCE_UNSUPPORTED');
        const snapshot = this.normalize(await provider.getManifest(context, publicationRef), publicationRef);
        context.signal.throwIfAborted();
        const snapshotJson = JSON.stringify(snapshot);
        const revision = hash(snapshotJson);
        const now = Date.now();
        this.db.transaction(() => {
          this.db.run(
            `INSERT INTO books (id, content_hash, content_hash_kind, format, title, author, language, description,
             pubdate, page_count, meta_json, source, created_at, updated_at) VALUES (?, ?, 'manifest', 'chapters', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            bookId, revision, entry.title, entry.authors?.join(', ') ?? '', entry.language ?? '',
            entry.description ?? '', entry.publishedAt ?? '', snapshot.items.length,
            JSON.stringify({ kind: 'text' }), `provider:${context.instance.pluginId}`, now, now,
          );
          this.db.run(
            `INSERT INTO chapter_publications (book_id, user_id, source_id, publication_ref, revision, version, snapshot_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            bookId, context.userId, context.instance.id, publicationRef, revision, snapshot.version ?? null, snapshotJson, now,
          );
          this.saveSnapshot(bookId, revision, snapshot, snapshotJson, now);
          this.addAcquisition(context, request, bookId, now);
        });
      } else {
        this.owned(context.userId, bookId);
        this.db.transaction(() => this.addAcquisition(context, request, bookId, Date.now()));
      }
      return bookId;
    });
  }

  refresh(userId: string, bookId: string, signal?: AbortSignal): Promise<Manifest> {
    this.owned(userId, bookId);
    return this.serial(`publication:${bookId}`, async () => {
      signal?.throwIfAborted();
      const publication = this.owned(userId, bookId);
      const snapshot = this.normalize(await this.loader.manifest(userId, publication.source_id, publication.publication_ref, signal), publication.publication_ref);
      signal?.throwIfAborted();
      const snapshotJson = JSON.stringify(snapshot);
      const revision = hash(snapshotJson);
      if (revision !== publication.revision) {
        const now = Date.now();
        this.db.transaction(() => {
          this.saveSnapshot(bookId, revision, snapshot, snapshotJson, now);
          this.db.run(
            'UPDATE chapter_publications SET revision = ?, version = ?, snapshot_json = ?, updated_at = ? WHERE book_id = ?',
            revision, snapshot.version ?? null, snapshotJson, now, bookId,
          );
          this.db.run('UPDATE books SET content_hash = ?, page_count = ?, updated_at = ? WHERE id = ?', revision, snapshot.items.length, now, bookId);
        });
      }
      return this.manifest(userId, bookId);
    });
  }

  asset(userId: string, bookId: string, ref: string, signal?: AbortSignal): Promise<AssetPayload> {
    this.owned(userId, bookId);
    const match = /^chapter-resource:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(ref);
    if (!match) return Promise.reject(badRequest('chapter assets require the manifest resourceRef', 'INVALID_RESOURCE'));
    const [, revision, chapterId] = match;
    return this.serial(`resource:${bookId}:${ref}`, async () => {
      signal?.throwIfAborted();
      const publication = this.owned(userId, bookId);
      const resource = this.db.get<ResourceRow>(
        'SELECT provider_ref, body, content_hash FROM chapter_resources WHERE book_id = ? AND revision = ? AND chapter_id = ?',
        bookId, revision!, chapterId!,
      );
      if (!resource) throw notFound('chapter resource does not exist', 'RESOURCE_GONE');
      if (resource.body !== null) return this.payload(resource.body, resource.content_hash!);
      this.requireCurrent(publication, revision!);
      const response = await this.loader.resource(userId, publication.source_id, publication.publication_ref, resource.provider_ref, signal);
      const body = this.readBody(response, signal);
      signal?.throwIfAborted();
      // The provider protocol cannot request an old version. If a refresh won
      // while this request was in flight, never cache new bytes as old content.
      this.requireCurrent(this.owned(userId, bookId), revision!);
      const contentHash = hash(body);
      this.db.run(
        'UPDATE chapter_resources SET body = ?, content_hash = ? WHERE book_id = ? AND revision = ? AND chapter_id = ?',
        body, contentHash, bookId, revision!, chapterId!,
      );
      return this.payload(body, contentHash);
    });
  }

  private owned(userId: string, bookId: string): PublicationRow {
    const publication = this.db.get<PublicationRow>(
      'SELECT book_id, user_id, source_id, publication_ref, revision, snapshot_json FROM chapter_publications WHERE book_id = ? AND user_id = ?',
      bookId, userId,
    );
    if (!publication) throw notFound('chapter publication not found', 'BOOK_NOT_FOUND');
    return publication;
  }

  private requireCurrent(publication: PublicationRow, revision: string): void {
    if (publication.revision !== revision) {
      throw conflict('uncached content from an old directory is unavailable; reopen the current directory', 'CHAPTER_SNAPSHOT_EXPIRED');
    }
  }

  private normalize(input: ManifestSnapshot, publicationRef: string): ManifestSnapshot {
    const snapshot = decodeManifest(input, publicationRef);
    if (snapshot.items.length > MAX_CHAPTERS || Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_MANIFEST_BYTES) {
      throw new AppError(413, 'MANIFEST_TOO_LARGE', 'chapter directory exceeds its size limit');
    }
    if (snapshot.version !== undefined && (typeof snapshot.version !== 'string' || snapshot.version.length > 1024)) {
      throw badRequest('invalid chapter directory version', 'INVALID_MANIFEST');
    }
    for (const item of snapshot.items) {
      if (item.kind !== 'chapter' || !isPlainUtf8(item.mediaType)) {
        throw badRequest('chapter publications currently support UTF-8 plain text only', 'UNSUPPORTED_FORMAT');
      }
    }
    return {
      publicationRef,
      ...(snapshot.version === undefined ? {} : { version: snapshot.version }),
      items: [...snapshot.items].sort((left, right) => left.seq - right.seq).map((item, seq) => ({
        id: item.id, seq, title: item.title, kind: 'chapter', mediaType: 'text/plain; charset=utf-8', ref: item.ref,
      })),
    };
  }

  private saveSnapshot(bookId: string, revision: string, snapshot: ManifestSnapshot, snapshotJson: string, now: number): void {
    this.db.run(
      'INSERT OR IGNORE INTO chapter_snapshots (book_id, revision, snapshot_json, created_at) VALUES (?, ?, ?, ?)',
      bookId, revision, snapshotJson, now,
    );
    for (const item of snapshot.items) {
      this.db.run(
        'INSERT OR IGNORE INTO chapter_resources (book_id, revision, chapter_id, provider_ref) VALUES (?, ?, ?, ?)',
        bookId, revision, hash(item.id), item.ref,
      );
    }
  }

  private addAcquisition(context: SourceContext, request: AcquireRequest, bookId: string, now: number): void {
    this.db.run(
      `INSERT INTO source_acquisitions (source_id, user_id, entry_ref, option_id, book_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, user_id, entry_ref, option_id) DO UPDATE SET book_id = excluded.book_id`,
      context.instance.id, context.userId, request.entryRef, request.optionId ?? '', bookId,
    );
    this.db.run(
      `INSERT INTO user_books (user_id, book_id, added_at, hidden) VALUES (?, ?, ?, 0)
       ON CONFLICT(user_id, book_id) DO UPDATE SET hidden = 0,
       added_at = CASE WHEN user_books.hidden = 1 THEN excluded.added_at ELSE user_books.added_at END`,
      context.userId, bookId, now,
    );
  }

  private readBody(resource: ResourceResponse, signal?: AbortSignal): string {
    try {
      signal?.throwIfAborted();
      if (!isPlainUtf8(resource.mediaType)) throw badRequest('chapter resource must be UTF-8 plain text', 'INVALID_RESOURCE');
      const bodies = Number(resource.text !== undefined) + Number(resource.data !== undefined) + Number(resource.stream !== undefined);
      if (bodies !== 1) throw badRequest('chapter resource must contain exactly one body', 'INVALID_RESOURCE');
      // Chapter RPCs are bounded messages. A stream returned after the host call
      // finishes would outlive its timeout and concurrency permit.
      if (resource.stream) throw badRequest('chapter resources must return text or bytes', 'INVALID_RESOURCE');
      if (resource.size !== undefined && (!Number.isSafeInteger(resource.size) || resource.size < 0 || resource.size > MAX_CHAPTER_BYTES)) {
        throw new AppError(413, 'CHAPTER_TOO_LARGE', 'chapter resource exceeds its size limit');
      }
      const size = resource.text !== undefined ? Buffer.byteLength(resource.text, 'utf8') : resource.data!.byteLength;
      if (size > MAX_CHAPTER_BYTES) throw new AppError(413, 'CHAPTER_TOO_LARGE', 'chapter resource exceeds its size limit');
      const bytes = resource.text !== undefined ? Buffer.from(resource.text, 'utf8') : resource.data!;
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw badRequest('chapter resource is not valid UTF-8', 'INVALID_RESOURCE');
      }
    } finally {
      resource.stream?.destroy();
    }
  }

  private payload(body: string, contentHash: string): AssetPayload {
    const data = Buffer.from(body, 'utf8');
    return { data, contentType: 'text/plain; charset=utf-8', size: data.byteLength, etag: contentHash };
  }

  private serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(action);
    this.queues.set(key, result);
    void result.finally(() => {
      if (this.queues.get(key) === result) this.queues.delete(key);
    }).catch(() => undefined);
    return result;
  }
}
