import type { Db } from '../db/index.ts';
import type { ShelfService, BookDto } from '../services/shelf.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import type { SourceProvider, CatalogEntry } from './types.ts';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { assertSafeRel, resolveInside } from '../lib/paths.ts';

/** The one resource a local entry has: its cover. */
const COVER_REF = 'cover';

function entry(book: Pick<BookDto, 'id' | 'title' | 'author' | 'description' | 'format'> & { coverUrl?: string | null }): CatalogEntry {
  return {
    ref: book.id, title: book.title, authors: book.author ? [book.author] : [],
    description: book.description, ...(book.coverUrl ? { coverRef: COVER_REF } : {}),
    options: [{ id: 'read', label: '加入书架', available: true }], metadata: { format: book.format },
  };
}

export function createLocalProvider(db: Db, shelf: () => ShelfService, dataDir: string): SourceProvider {
  const detail = async (_ctx: unknown, ref: string): Promise<CatalogEntry> => {
    const row = db.get<BookDto>(
      `SELECT id, title, author, description, format FROM books b
       WHERE b.id = ? AND EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)`, ref,
    );
    if (!row) throw notFound('local book not found', 'ENTRY_NOT_FOUND');
    return entry({ ...row, coverUrl: shelf().coverPath(row.id) });
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
    /**
     * The library folder by folder: a page is one folder, its subfolders are the
     * navigation and its own books the items, so it reads like any other source in 发现.
     */
    async browse(ctx, request) {
      const path = request.ref ? assertSafeRel(request.ref) : '';
      const result = shelf().list(ctx.userId, {
        scope: 'library', ...(path ? { path } : {}), direct: true, page: page(request.cursor), pageSize: request.limit ?? 40,
      });
      const folders = request.cursor ? [] : shelf().folders(path);
      return {
        title: path ? path.split('/').at(-1)! : '本地书库', items: result.items.map(entry),
        ...(folders.length ? { navigation: folders.map((name) => ({ title: name, ref: path ? `${path}/${name}` : name, kind: 'catalog' as const })) } : {}),
        ...(result.page * result.pageSize < result.total ? { nextCursor: String(result.page + 1) } : {}),
      };
    },
    /** A local entry's cover, so a browser never needs a second way to load one. */
    async readResource(_ctx, request) {
      const coverPath = request.ref === COVER_REF ? shelf().coverPath(request.publicationRef) : null;
      if (!coverPath) throw notFound('local book has no cover', 'RESOURCE_GONE');
      const ext = extname(coverPath).toLowerCase();
      return { mediaType: ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg',
        data: await readFile(resolveInside(dataDir, assertSafeRel(coverPath))) };
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
