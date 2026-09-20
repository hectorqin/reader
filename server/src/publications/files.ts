import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { AppConfig } from '../config/index.ts';
import type { Db } from '../db/index.ts';
import { assertSafeRel, resolveInside } from '../lib/paths.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import {
  contentTypeFor, directoryHandlerForFormat, fileHandlerForFormat,
  type AssetPayload, type HandlerContext,
} from '../indexer/formats/index.ts';

/** Resolves stored content independently of where a book was discovered. */
export class FilePublications {
  constructor(private readonly db: Db, private readonly config: AppConfig) {}

  handler(format: string) {
    return fileHandlerForFormat(format) ?? directoryHandlerForFormat(format);
  }

  managed(bookId: string): { rel_path: string; size: number } | undefined {
    return this.db.get('SELECT rel_path, size FROM acquired_files WHERE book_id = ?', bookId);
  }

  context(bookId: string): HandlerContext {
    const local = this.db.get<{ rel_path: string }>(
      'SELECT rel_path FROM book_files WHERE book_id = ? AND missing = 0 ORDER BY rel_path LIMIT 1', bookId,
    );
    const managed = this.managed(bookId);
    const useLocal = local && (!managed || existsSync(resolveInside(this.config.booksDir, assertSafeRel(local.rel_path))));
    const file = useLocal ? local : managed ?? local;
    if (!file) throw notFound('no available file for this book', 'FILE_MISSING');
    const relPath = assertSafeRel(file.rel_path);
    return { bookId, relPath, absPath: resolveInside(useLocal ? this.config.booksDir : this.config.dataDir, relPath) };
  }

  async files(bookId: string, format: string) {
    const handler = this.handler(format);
    if (handler && 'files' in handler && handler.files) {
      return (await handler.files(this.context(bookId))).map((file) => ({
        rel_path: file.relPath, ref: file.ref, size: file.size, missing: file.missing,
      }));
    }
    const local = this.db.all<{ rel_path: string; size: number; missing: number }>(
      'SELECT rel_path, size, missing FROM book_files WHERE book_id = ? ORDER BY rel_path', bookId,
    );
    const managed = this.managed(bookId);
    return managed ? [...local, { ...managed, missing: 0 }] : local;
  }

  async content(bookId: string, format: string): Promise<AssetPayload> {
    if (!fileHandlerForFormat(format)) {
      throw badRequest('this book is backed by a directory; fetch pages from the manifest instead', 'DIRECTORY_BOOK');
    }
    const context = this.context(bookId);
    if (!existsSync(context.absPath)) throw notFound('file is no longer on disk', 'FILE_MISSING');
    const info = await stat(context.absPath);
    return {
      stream: createReadStream(context.absPath), contentType: contentTypeFor(context.relPath),
      filename: context.relPath.split('/').pop() ?? 'book', size: info.size,
      seekable: true, etag: bookId, lastModified: info.mtimeMs,
    };
  }
}
