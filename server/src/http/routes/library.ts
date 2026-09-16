import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { assertSafeRel, resolveInside } from '../../lib/paths.ts';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  capabilities,
  contentTypeFor,
  directoryHandlerForFormat,
  fileHandlerForFormat,
  type AssetPayload,
} from '../../indexer/formats/index.ts';


/** The single live path backing a book, if it is file-backed. */
function resolveBookSource(
  ctx: AppContext,
  bookId: string,
  format: string,
): { relPath: string; isDirectory: boolean } | null {
  const file = ctx.db.get<{ rel_path: string }>(
    'SELECT rel_path FROM book_files WHERE book_id = ? AND missing = 0 ORDER BY rel_path LIMIT 1',
    bookId,
  );
  if (!file) return null;
  // Directory books are recorded under a path with no extension; a file handler
  // for the format means the path is a real file.
  const isDirectory = format === 'comic-dir' || fileHandlerForFormat(format) === null;
  return { relPath: file.rel_path, isDirectory };
}

/** The handler that owns a book, resolved from its recorded format. */
function resolveHandler(ctx: AppContext, bookId: string, format: string) {
  const source = resolveBookSource(ctx, bookId, format);
  // A missing file still has a handler; only the manifest/asset calls fail.
  void source;
  void ctx;
  void bookId;
  return fileHandlerForFormat(format) ?? directoryHandlerForFormat(format) ?? null;
}

/** Absolute path plus library-relative path for a book's backing store. */
function sourceContext(ctx: AppContext, bookId: string, format: string) {
  const file = ctx.db.get<{ rel_path: string }>(
    'SELECT rel_path FROM book_files WHERE book_id = ? AND missing = 0 ORDER BY rel_path LIMIT 1',
    bookId,
  );
  if (!file) throw notFound('no available file for this book', 'FILE_MISSING');
  const relPath = assertSafeRel(file.rel_path);
  void format;
  return { relPath, absPath: resolveInside(ctx.config.booksDir, relPath) };
}

/** Offset of the first item belonging to a group, computed from group counts. */
function groupOffset(groups: Array<{ count: number }>, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += groups[i]?.count ?? 0;
  return offset;
}

/** Serialise an asset payload with caching headers suited to immutable content. */
function sendAsset(reply: FastifyReply, payload: AssetPayload) {
  reply.header('content-type', payload.contentType);
  // Assets are addressed by book id, which is derived from content, so they can
  // never change under the same URL.
  reply.header('cache-control', 'private, max-age=31536000, immutable');
  if (payload.filename) {
    reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(payload.filename)}`);
  }
  return reply.send(payload.data);
}

export function registerLibraryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);

  app.get('/api/v1/library/facets', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    return ctx.shelf.facets(user.id);
  });

  app.get('/api/v1/books', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const q = request.query as Record<string, string | undefined>;
    return ctx.shelf.list(user.id, {
      ...(q.search !== undefined ? { search: q.search } : {}),
      ...(q.author !== undefined ? { author: q.author } : {}),
      ...(q.series !== undefined ? { series: q.series } : {}),
      ...(q.tag !== undefined ? { tag: q.tag } : {}),
      ...(q.format !== undefined ? { format: q.format } : {}),
      ...(q.sort !== undefined ? { sort: q.sort as 'title' } : {}),
      ...(q.order !== undefined ? { order: q.order as 'asc' } : {}),
      ...(q.page !== undefined ? { page: Number.parseInt(q.page, 10) || 1 } : {}),
      ...(q.pageSize !== undefined ? { pageSize: Number.parseInt(q.pageSize, 10) || 50 } : {}),
    });
  });

  app.get('/api/v1/books/:id', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    const progress = ctx.sync.progressFor(user.id, id);
    return { book, progress };
  });

  /**
   * The manifest a renderer needs before it can lay out a chapter. Kept
   * deliberately format-neutral so PDF support can reuse the same contract.
   */
  app.get('/api/v1/books/:id/manifest', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    return {
      book,
      contentUrl: `/api/v1/books/${id}/content`,
      coverUrl: book.coverUrl,
      // The list of files backing this book, so a client can tell a duplicate
      // copy apart from a genuinely missing file.
      files: ctx.db.all<{ rel_path: string; size: number; missing: number }>(
        'SELECT rel_path, size, missing FROM book_files WHERE book_id = ? ORDER BY rel_path',
        id,
      ),
    };
  });

  /**
   * Streams the whole book file.
   *
   * Kept as the "give me the bytes" endpoint for offline caching, and widened so
   * every format can be downloaded for local reading: a comic archive or a PDF
   * is exactly what the client wants to store on device.
   */
  app.get('/api/v1/books/:id/content', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    const source = resolveBookSource(ctx, id, book.format);
    if (!source) throw notFound('no available file for this book', 'FILE_MISSING');

    // Directory books have no file to stream; the client caches page by page.
    if (source.isDirectory) {
      throw badRequest(
        'this book is backed by a directory; fetch pages from the manifest instead',
        'DIRECTORY_BOOK',
      );
    }

    const abs = resolveInside(ctx.config.booksDir, assertSafeRel(source.relPath));
    if (!existsSync(abs)) throw notFound('file is no longer on disk', 'FILE_MISSING');
    const info = await stat(abs);

    reply.header('content-type', contentTypeFor(source.relPath));
    reply.header('content-length', String(info.size));
    // Progress and notes are the only synced state, so a book body is immutable
    // per hash and can be cached aggressively by the client.
    reply.header('etag', `"${id}"`);
    reply.header('accept-ranges', 'none');
    reply.header(
      'content-disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(source.relPath.split('/').pop() ?? 'book')}`,
    );
    return reply.send(createReadStream(abs));
  });

  /**
   * The addressable structure of a book: chapters, pages, volumes.
   *
   * Format-neutral on purpose. The client asks every book the same question and
   * gets the same shape back; `kind` tells it whether to expect reflowable text
   * or fixed pages. Adding a format does not change this contract.
   */
  app.get('/api/v1/books/:id/items', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    const handler = resolveHandler(ctx, id, book.format);
    if (!handler) throw badRequest(`format ${book.format} does not expose items`, 'UNSUPPORTED_FORMAT');

    const manifest = await handler.manifest({ ...sourceContext(ctx, id, book.format), bookId: id });
    const query = request.query as Record<string, string | undefined>;
    const groupIndex = query.group !== undefined ? Number.parseInt(query.group, 10) : null;

    // Filtering by group lets the client fetch one comic volume at a time
    // instead of a 2000-entry manifest for the whole series.
    if (groupIndex !== null && Number.isFinite(groupIndex) && manifest.groups[groupIndex]) {
      const group = manifest.groups[groupIndex]!;
      const items = manifest.items.filter((item) => item.seq >= groupOffset(manifest.groups, groupIndex));
      const limited = items.slice(0, group.count);
      return { ...manifest, items: limited, group: groupIndex };
    }

    return manifest;
  });

  /**
   * A single addressable resource: a chapter document, a page image, a font.
   *
   * `ref` is opaque and format specific (`chapter:2`, `page:17`), which keeps the
   * route stable as formats evolve and lets each handler decide how to address
   * its own contents.
   */
  app.get('/api/v1/books/:id/assets', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    const ref = (request.query as Record<string, string | undefined>).ref;
    if (!ref) throw badRequest('ref is required');
    if (ref.length > 512) throw badRequest('ref is too long');

    const handler = resolveHandler(ctx, id, book.format);
    if (!handler) throw badRequest(`format ${book.format} has no assets`, 'UNSUPPORTED_FORMAT');

    const payload = await handler.asset({ ...sourceContext(ctx, id, book.format), bookId: id }, { ref });
    return sendAsset(reply, payload);
  });

  app.get('/api/v1/books/:id/cover', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = ctx.db.get<{ cover_path: string | null }>('SELECT cover_path FROM books WHERE id = ?', id);
    if (!row?.cover_path) throw notFound('no cover for this book', 'NO_COVER');
    const abs = resolveInside(ctx.config.dataDir, assertSafeRel(row.cover_path));
    if (!existsSync(abs)) throw notFound('cover cache missing', 'NO_COVER');
    const ext = extname(abs).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
    reply.header('content-type', mime);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(abs));
  });

  /**
   * Manual metadata completion (§6): the layer that sits above everything else
   * and is never auto-overwritten.
   */
  app.patch('/api/v1/books/:id/metadata', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    ctx.shelf.get(user.id, id);
    const patch = (request.body ?? {}) as Record<string, unknown>;
    const allowed = [
      'title', 'author', 'publisher', 'language', 'isbn', 'description',
      'series', 'seriesIndex', 'pubdate', 'tags',
    ];
    const filtered: Record<string, unknown> = {};
    for (const key of allowed) {
      if (patch[key] !== undefined) filtered[key] = patch[key];
    }
    if (Object.keys(filtered).length === 0) throw badRequest('no editable field supplied');
    ctx.shelf.setOverrides(id, filtered, user.id);
    return { book: ctx.shelf.get(user.id, id) };
  });

  /** Undo a manual field, falling back to the embedded/base value. */
  app.delete('/api/v1/books/:id/metadata/:field', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id, field } = request.params as { id: string; field: string };
    ctx.shelf.get(user.id, id);
    ctx.shelf.clearOverride(id, field);
    return { book: ctx.shelf.get(user.id, id) };
  });

  // ---- instance administration ----

  app.post('/api/v1/library/scan', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    requireAdmin(request);
    void user;
    const result = await ctx.scanner.scan();
    return { result };
  });

  app.get('/api/v1/library/scan', { preHandler: auth }, async () => {
    return { progress: ctx.scanner.getProgress() };
  });

  /**
   * What this instance can read. Clients use it to decide which entry points to
   * show, and the README points at it as the authoritative list, so it is built
   * from the registry rather than a hand-maintained array.
   */
  app.get('/api/v1/library/formats', { preHandler: auth }, async () => ({
    formats: capabilities(),
  }));

  app.get('/api/v1/library/stats', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const books = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND hidden = 0', user.id);
    const library = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM books');
    const files = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM book_files WHERE missing = 0');
    const missing = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM book_files WHERE missing = 1');
    const formats = ctx.db.all<{ format: string; n: number }>('SELECT format, COUNT(*) AS n FROM books GROUP BY format');
    return {
      myBooks: books?.n ?? 0,
      libraryBooks: library?.n ?? 0,
      files: files?.n ?? 0,
      missingFiles: missing?.n ?? 0,
      formats,
      scan: ctx.scanner.getProgress(),
    };
  });

  app.get('/api/v1/admin/users', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    return { users: ctx.users.list() };
  });

  app.post('/api/v1/admin/users', { preHandler: auth }, async (request, reply) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as { username?: string; password?: string; displayName?: string; role?: 'admin' | 'member' };
    if (!body.username || !body.password) throw badRequest('username and password are required');
    const user = await ctx.users.createAsAdmin({
      username: body.username,
      password: body.password,
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
    });
    reply.status(201);
    return { user };
  });

  app.patch('/api/v1/admin/users/:id', { preHandler: auth }, async (request) => {
    const actor = currentUser(request);
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { disabled?: boolean; role?: 'admin' | 'member' };
    if (id === actor.id && body.disabled) throw badRequest('cannot disable your own account', 'SELF_LOCKOUT');
    if (body.disabled !== undefined) ctx.users.setDisabled(id, body.disabled);
    if (body.role !== undefined) ctx.users.setRole(id, body.role);
    return { users: ctx.users.list() };
  });

  app.get('/api/v1/providers', { preHandler: auth }, async () => {
    const { providers } = await import('../../providers/index.ts');
    return { providers: providers.list() };
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    booksDir: ctx.config.booksDir,
    // Reported so an operator can confirm the mount is where they think it is.
    dataDir: ctx.config.dataDir,
    version: process.env.npm_package_version ?? '0.1.0',
    dataDirIsInsideBooks: ctx.config.dataDir.startsWith(join(ctx.config.booksDir, '/')),
  }));
}
