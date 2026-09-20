import type { Db } from '../db/index.ts';
import type { ShelfService, BookDto } from '../services/shelf.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import type { SourceProvider, CatalogEntry } from './types.ts';

function entry(book: Pick<BookDto, 'id' | 'title' | 'author' | 'description' | 'format'>): CatalogEntry {
  return {
    ref: book.id, title: book.title, authors: book.author ? [book.author] : [],
    description: book.description,
    options: [{ id: 'read', label: '加入书架', available: true }], metadata: { format: book.format },
  };
}

export function createLocalProvider(db: Db, shelf: () => ShelfService): SourceProvider {
  const detail = async (_ctx: unknown, ref: string): Promise<CatalogEntry> => {
    const row = db.get<BookDto>(
      `SELECT id, title, author, description, format FROM books b
       WHERE b.id = ? AND EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)`, ref,
    );
    if (!row) throw notFound('local book not found', 'ENTRY_NOT_FOUND');
    return entry(row);
  };
  function page(cursor?: string): number {
    if (cursor && !/^[1-9]\d{0,5}$/.test(cursor)) throw badRequest('invalid catalog cursor');
    return Number(cursor ?? 1);
  }
  return {
    descriptor: { id: 'local', label: '本地书库', version: '1.0.0', capabilities: ['browse', 'search', 'detail'] },
    validateConfig(config) {
      if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).length) {
        throw badRequest('local uses the configured BOOKS_DIR and accepts no instance settings');
      }
    },
    async browse(ctx, request) {
      const result = shelf().list(ctx.userId, {
        scope: 'library', path: request.ref, page: page(request.cursor), pageSize: request.limit ?? 40,
      });
      return { items: result.items.map(entry), ...(result.page * result.pageSize < result.total
        ? { nextCursor: String(result.page + 1) } : {}) };
    },
    async search(ctx, request) {
      const result = shelf().list(ctx.userId, {
        scope: 'library', search: request.query, page: page(request.cursor), pageSize: request.limit ?? 40,
      });
      return { items: result.items.map(entry), ...(result.page * result.pageSize < result.total
        ? { nextCursor: String(result.page + 1) } : {}) };
    },
    detail,
    async acquire(ctx, request) {
      if (request.optionId && request.optionId !== 'read') throw badRequest('unknown acquisition option');
      await detail(ctx, request.entryRef);
      return { kind: 'ready', publicationId: request.entryRef };
    },
  };
}
