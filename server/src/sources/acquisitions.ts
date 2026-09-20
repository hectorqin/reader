import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from '../config/index.ts';
import type { Db } from '../db/index.ts';
import { fileHandlerForExtension, type ParsedSource } from '../indexer/formats/index.ts';
import { computeBookId } from '../indexer/identity.ts';
import { saveCover } from '../indexer/metadata.ts';
import { AppError, badRequest } from '../lib/errors.ts';
import { resolveInside } from '../lib/paths.ts';
import type {
  Acquisition, AcquireRequest, CatalogEntry, ResourceResponse, SourceContext, SourceProvider,
} from './types.ts';

export const MAX_ACQUISITION_BYTES = 256 * 1024 * 1024;
type FileAcquisition = Extract<Acquisition, { kind: 'file' }>;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.comicbook+zip': 'cbz',
  'application/x-cbz': 'cbz',
  'application/zip': 'zip',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function mediaType(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase();
}

function tooLarge(): AppError {
  return new AppError(413, 'ACQUISITION_TOO_LARGE', 'download exceeds the acquisition size limit');
}

/** Imports complete files into DATA_DIR without changing the scanned library. */
export class FileAcquisitions {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly maxBytes: number;

  constructor(
    private readonly db: Db,
    private readonly config: Pick<AppConfig, 'dataDir'>,
    options: { maxBytes?: number } = {},
  ) {
    this.maxBytes = options.maxBytes ?? MAX_ACQUISITION_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || this.maxBytes > MAX_ACQUISITION_BYTES) {
      throw new Error('acquisition maxBytes must be between 1 and 256 MiB');
    }
  }

  acquire(
    provider: SourceProvider,
    context: SourceContext,
    request: AcquireRequest,
    acquisition: FileAcquisition,
    entry: CatalogEntry,
  ): Promise<string> {
    const key = JSON.stringify([context.instance.id, context.userId, request.entryRef, request.optionId ?? '']);
    // Serialize instead of sharing promises: one caller's cancellation must not
    // cancel another caller's download. The successor reuses a committed file.
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => this.importFile(provider, context, request, acquisition, entry));
    this.queues.set(key, result);
    void result.finally(() => {
      if (this.queues.get(key) === result) this.queues.delete(key);
    }).catch(() => undefined);
    return result;
  }

  private async importFile(
    provider: SourceProvider,
    context: SourceContext,
    request: AcquireRequest,
    acquisition: FileAcquisition,
    entry: CatalogEntry,
  ): Promise<string> {
    const { signal } = context;
    signal.throwIfAborted();
    const existing = this.db.get<{ book_id: string; rel_path: string }>(
      `SELECT a.book_id, f.rel_path FROM source_acquisitions a
       JOIN acquired_files f ON f.book_id = a.book_id
       WHERE a.source_id = ? AND a.user_id = ? AND a.entry_ref = ? AND a.option_id = ?`,
      context.instance.id, context.userId, request.entryRef, request.optionId ?? '',
    );
    if (existing && existsSync(resolveInside(this.config.dataDir, existing.rel_path))) {
      this.addToShelf(context.userId, existing.book_id, Date.now());
      return existing.book_id;
    }
    if (!provider.openFile) throw badRequest('source does not support file downloads', 'CAPABILITY_UNSUPPORTED');
    const type = mediaType(acquisition.mediaType);
    const extension = EXTENSIONS[type];
    const handler = extension ? fileHandlerForExtension(extension) : null;
    if (!extension || !handler) throw badRequest('unsupported acquisition media type', 'UNSUPPORTED_FORMAT');
    if (acquisition.size !== undefined && acquisition.size > this.maxBytes) throw tooLarge();

    await mkdir(join(this.config.dataDir, 'acquired'), { recursive: true });
    const token = randomUUID();
    const temporaryPath = resolveInside(this.config.dataDir, `acquired/${token}.part`);
    let finalPath: string | undefined;
    let coverPath: string | undefined;
    let keepFile = false;
    let keepCover = false;
    let resource: ResourceResponse | undefined;
    try {
      resource = await provider.openFile(context, acquisition);
      signal.throwIfAborted();
      const responseType = mediaType(resource.mediaType);
      if (responseType !== 'application/octet-stream' && responseType !== type) {
        throw badRequest('download media type does not match its acquisition', 'INVALID_RESOURCE');
      }
      if (resource.size !== undefined && resource.size > this.maxBytes) throw tooLarge();
      const bodies = Number(resource.data !== undefined) + Number(resource.text !== undefined) + Number(resource.stream !== undefined);
      if (bodies !== 1) throw badRequest('download must contain exactly one body', 'INVALID_RESOURCE');
      const input = resource.stream ?? Readable.from([
        resource.data !== undefined ? resource.data : Buffer.from(resource.text!, 'utf8'),
      ]);
      let size = 0;
      const hash = createHash('sha256');
      const maximum = this.maxBytes;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.byteLength;
          if (size > maximum) { callback(tooLarge()); return; }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(input, limit, createWriteStream(temporaryPath, { flags: 'wx' }), { signal });
      signal.throwIfAborted();
      if (size === 0) throw badRequest('download is empty', 'INVALID_RESOURCE');
      const bytes = await readFile(temporaryPath);
      const filename = basename((acquisition.filename ?? resource.filename ?? `${entry.title}.${extension}`).replaceAll('\\', '/'));
      const displayName = `${filename.slice(0, filename.length - extname(filename).length)}.${extension}`;
      const parseContext = { relPath: displayName, absPath: temporaryPath };
      if (type === 'application/pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
        throw badRequest('download is not a PDF', 'INVALID_RESOURCE');
      }
      if (handler.matches && !await handler.matches(parseContext, bytes.subarray(0, 4096))) {
        throw badRequest('download does not match its format', 'INVALID_RESOURCE');
      }
      const parsed = await handler.parse(parseContext, bytes);
      if (parsed.metadata.raw.parseError) {
        throw badRequest('download could not be parsed as its declared format', 'INVALID_RESOURCE');
      }
      const contentHash = hash.digest('hex');
      const bookId = computeBookId(parsed.metadata.identifier, contentHash);
      signal.throwIfAborted();
      const relPath = `acquired/${bookId}-${token}.${extension}`;
      finalPath = resolveInside(this.config.dataDir, relPath);
      await rename(temporaryPath, finalPath);

      if (parsed.cover && !this.db.get('SELECT id FROM books WHERE id = ?', bookId)) {
        // A unique cover name lets rollback remove only this import's bytes,
        // even when another source imports the same publication concurrently.
        coverPath = await saveCover(this.config.dataDir, `${bookId}-${token}`, parsed.cover);
      }
      signal.throwIfAborted();
      const now = Date.now();
      this.db.transaction(() => {
        this.insertBook(bookId, parsed, contentHash, size, coverPath, entry, context, now);
        const file = this.db.get<{ rel_path: string }>('SELECT rel_path FROM acquired_files WHERE book_id = ?', bookId);
        if (!file || !existsSync(resolveInside(this.config.dataDir, file.rel_path))) {
          this.db.run(
            `INSERT INTO acquired_files (book_id, rel_path, size) VALUES (?, ?, ?)
             ON CONFLICT(book_id) DO UPDATE SET rel_path = excluded.rel_path, size = excluded.size`,
            bookId, relPath, size,
          );
        }
        this.db.run(
          `INSERT INTO source_acquisitions (source_id, user_id, entry_ref, option_id, book_id) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(source_id, user_id, entry_ref, option_id) DO UPDATE SET book_id = excluded.book_id`,
          context.instance.id, context.userId, request.entryRef, request.optionId ?? '', bookId,
        );
        this.addToShelf(context.userId, bookId, now);
      });
      keepFile = this.db.get<{ rel_path: string }>('SELECT rel_path FROM acquired_files WHERE book_id = ?', bookId)?.rel_path === relPath;
      keepCover = coverPath !== undefined && this.db.get<{ cover_path: string | null }>('SELECT cover_path FROM books WHERE id = ?', bookId)?.cover_path === coverPath;
      return bookId;
    } finally {
      resource?.stream?.destroy();
      await rm(temporaryPath, { force: true });
      if (finalPath && !keepFile) await rm(finalPath, { force: true });
      if (coverPath && !keepCover) await rm(resolveInside(this.config.dataDir, coverPath), { force: true });
    }
  }

  private addToShelf(userId: string, bookId: string, now: number): void {
    this.db.run(
      `INSERT INTO user_books (user_id, book_id, added_at, hidden) VALUES (?, ?, ?, 0)
       ON CONFLICT(user_id, book_id) DO UPDATE SET hidden = 0`,
      userId, bookId, now,
    );
  }

  private insertBook(
    bookId: string, parsed: ParsedSource, contentHash: string, size: number,
    coverPath: string | undefined, entry: CatalogEntry, context: SourceContext, now: number,
  ): void {
    const m = parsed.metadata;
    const embedded = m.source === 'embedded';
    // Importing another copy must not refresh or overwrite existing metadata.
    this.db.run(
      `INSERT OR IGNORE INTO books (id, identifier, content_hash, format, title, author, publisher, language,
       isbn, description, series, series_index, tags, pubdate, cover_path, file_size, page_count, meta_json,
       source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bookId, m.identifier, contentHash, parsed.format,
      (embedded ? m.title : entry.title) || m.title || entry.title,
      m.author || entry.authors?.join(', ') || '', m.publisher, m.language || entry.language || '',
      m.isbn, m.description || entry.description || '', m.series, m.seriesIndex,
      JSON.stringify(m.tags), m.pubdate || entry.publishedAt || '', coverPath ?? null, size,
      parsed.pageCount, JSON.stringify({ ...m.raw, kind: parsed.kind }),
      embedded ? m.source : `provider:${context.instance.pluginId}`, now, now,
    );
  }
}
