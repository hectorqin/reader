import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { assertSafeRel, normalizeRel, resolveInside } from '../../lib/paths.ts';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  capabilities,
  contentTypeFor,
  directoryHandlerForFormat,
  fileHandlerForFormat,
  type ContentItem,
} from '../../indexer/formats/index.ts';
import { sendAssetPayload } from '../assets.ts';

/**
 * The single live path backing a book, if it is file-backed.
 *
 * A directory book has no file to stream, so the caller is told which of the two
 * shapes it is rather than being handed a path that may not exist.
 */
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

/**
 * The handler that owns a book, resolved from its recorded format.
 *
 * A missing file still has a handler; only the manifest and asset calls fail.
 */
function resolveHandler(ctx: AppContext, bookId: string, format: string) {
  void ctx;
  void bookId;
  return fileHandlerForFormat(format) ?? directoryHandlerForFormat(format) ?? null;
}

/** Absolute path plus library-relative path for a book's backing store. */
function sourceContext(ctx: AppContext, bookId: string) {
  const file = ctx.db.get<{ rel_path: string }>(
    'SELECT rel_path FROM book_files WHERE book_id = ? AND missing = 0 ORDER BY rel_path LIMIT 1',
    bookId,
  );
  if (!file) throw notFound('no available file for this book', 'FILE_MISSING');
  const relPath = assertSafeRel(file.rel_path);
  return { relPath, absPath: resolveInside(ctx.config.booksDir, relPath) };
}

/**
 * The path of the folder a library path lives in, or `null` for a top-level path.
 *
 * Used to answer "is this file inside that directory book's folder" without a
 * prefix match, which cannot tell `第01卷.cbz` inside `整卷系列/` apart from a
 * sibling file that merely starts with the same characters.
 */
function parentPath(relPath: string): string | null {
  const cut = relPath.lastIndexOf('/');
  return cut < 0 ? null : relPath.slice(0, cut);
}

/**
 * Offset of the first item belonging to a group.
 *
 * Taken from the declared group sizes rather than from the items themselves, so
 * a client that only fetched one group still gets the right global offset.
 */
function groupOffset(groups: Array<{ count: number }>, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += groups[i]?.count ?? 0;
  return offset;
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
   * Everything a renderer needs before it can lay out the first screen, in one
   * round trip.
   *
   * This used to be a book summary plus a file list, which meant a client had to
   * make a second call to `/items` before it could draw anything. On a LAN that
   * is invisible; over a tunnel it is the difference between a book opening and
   * a book appearing to hang. It now carries the addressable structure too, so
   * "open a book" is one request.
   *
   * The items are still windowed: `?group=N` narrows the items to one group
   * while `groups` stays complete, so opening a 40-volume comic transfers one
   * volume's worth of entries.
   */
  app.get('/api/v1/books/:id/manifest', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    const handler = resolveHandler(ctx, id, book.format);
    const query = request.query as Record<string, string | undefined>;
    const requested = query.group !== undefined ? Number.parseInt(query.group, 10) : null;

    const content = handler
      ? await handler.manifest({ ...sourceContext(ctx, id), bookId: id })
      : null;

    /**
     * One window, chosen by the client or by the server.
     *
     * `?group=N` asks for a specific one. Omitting it used to mean "send every
     * item", which quietly defeated the point of windowing: a 1200-chapter
     * omnibus answered its *first* request — the one that has to be fast — with
     * 1200 entries, and a 40-volume comic with every page of every volume. The
     * default is therefore window 0, and a client that genuinely wants the whole
     * structure asks for it with `?group=all`.
     *
     * This is an additive change to a documented contract: a client that passed
     * no `group` received more than it needed and now receives exactly what it
     * needs to draw the first screen, which is what that parameter-less call was
     * always for.
     */
    const wantsAll = query.group === 'all';
    const groupIndex = wantsAll
      ? null
      : requested !== null && Number.isFinite(requested)
        ? requested
        : 0;

    const windowed =
      content && !wantsAll && groupIndex !== null && content.groups[groupIndex]
        ? {
            ...content,
            items: content.items.slice(
              groupOffset(content.groups, groupIndex),
              groupOffset(content.groups, groupIndex) + content.groups[groupIndex]!.count,
            ),
            group: groupIndex,
          }
        : content;

    return {
      book,
      contentUrl: `/api/v1/books/${id}/content`,
      coverUrl: book.coverUrl,
      // The list of files backing this book, so a client can tell a duplicate
      // copy apart from a genuinely missing file.
      //
      // Directory books are the exception, and they are the reason this is asked
      // of the handler rather than read straight from `book_files`. Their recorded
      // row is the *folder*, because that is the path the scanner discovers; the
      // pages that make up the book live inside it, and a client fetching pages
      // one by one (the only way to read a 20GB scan collection) needs their
      // paths. Whoever owns the page walk owns this list: a second implementation
      // here listed the *titles* of pages inside an embedded archive, which are
      // not paths at all, and every page of such a comic answered 404.
      //
      // This is a contract, not an inventory: `/books/:id/file` serves exactly the
      // paths named here, and nothing else.
      files: content && handler && 'files' in handler && handler.files
        ? (await handler.files({ ...sourceContext(ctx, id), bookId: id })).map((file) => ({
            rel_path: file.relPath,
            // The handler's own reference, passed through untouched. It is what
            // makes the listed path fetchable: a directory book addresses a page
            // as `page:<volume>:<page>`, and only its handler knows where the
            // volumes begin.
            ref: file.ref,
            size: file.size,
            missing: file.missing,
          }))
        : ctx.db.all<{ rel_path: string; size: number; missing: number }>(
            'SELECT rel_path, size, missing FROM book_files WHERE book_id = ? ORDER BY rel_path',
            id,
          ),
      // `content` is null only for a book whose format exposes no addressable
      // structure at all; the client then falls back to the raw file.
      content: windowed,
      ...(windowed ? { items: windowed.items, groups: windowed.groups, kind: windowed.kind, total: windowed.total } : {}),
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

    return sendAssetPayload(request, reply, {
      stream: createReadStream(abs),
      contentType: contentTypeFor(source.relPath),
      filename: source.relPath.split('/').pop() ?? 'book',
      size: (await stat(abs)).size,
      seekable: true,
      etag: id,
      lastModified: (await stat(abs)).mtimeMs,
    });
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

    const manifest = await handler.manifest({ ...sourceContext(ctx, id), bookId: id });
    const query = request.query as Record<string, string | undefined>;
    const groupIndex = query.group !== undefined ? Number.parseInt(query.group, 10) : null;

    // Windowing is what makes a long book openable: a 1200-chapter omnibus or a
    // 40-volume comic must not cost one manifest with thousands of entries, and
    // must not cost the client the whole archive either. The response keeps the
    // full `groups` list so the client can still render a complete table of
    // contents, but only the requested group's items are materialised.
    if (groupIndex !== null && Number.isFinite(groupIndex) && manifest.groups[groupIndex]) {
      const offset = groupOffset(manifest.groups, groupIndex);
      return {
        ...manifest,
        items: manifest.items.slice(offset, offset + manifest.groups[groupIndex]!.count),
        group: groupIndex,
      };
    }

    return manifest;
  });

  /**
   * The book's table of contents.
   *
   * Separate from `/items` on purpose. `/items` is a *transfer* window: it is
   * windowed, and it carries everything a renderer needs to lay out a page. A
   * table of contents is a list of names, it must be complete to be useful, and
   * it is a few kilobytes even for a 1200-chapter book. Making one endpoint do
   * both jobs gave the reader a "table of contents" reading
   * 「第 1 章 – 第 40 章」, which is the server's pagination leaking into the UI.
   */
  app.get('/api/v1/books/:id/toc', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const book = ctx.shelf.get(user.id, id);
    const handler = resolveHandler(ctx, id, book.format);
    if (!handler) return { toc: [] };

    const context = { ...sourceContext(ctx, id), bookId: id };
    if (handler.toc) return { toc: await handler.toc(context) };

    // Default: the format has no navigation of its own, so its items are its
    // table of contents. `pdf` and `image` land here.
    const manifest = await handler.manifest(context);
    return {
      toc: manifest.items.map((item: ContentItem) => ({ href: item.href, title: item.title, level: 0, spine: item.seq })),
    };
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

    const payload = await handler.asset({ ...sourceContext(ctx, id), bookId: id }, { ref });
    return sendAssetPayload(request, reply, payload);
  });

  /**
   * Streams one file of a multi-file book.
   *
   * Needed for the one format that is not a single file: a comic stored as a
   * folder of images. Compositing those into an archive server-side would mean
   * writing into DATA_DIR on demand and re-doing the work whenever the folder
   * changes, so the client fetches pages individually instead and caches them
   * per page.
   *
   * Authorisation is the same as `/content`: the caller must be able to see the
   * book, and the requested path must be one of that book's *known* files. The
   * lookup is by `book_files.rel_path`, never by constructing a path from the
   * query, so a traversal attempt simply matches no row.
   */
  app.get('/api/v1/books/:id/file', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    const book = ctx.shelf.get(user.id, id); // authorises access
    if (!query.path) throw badRequest('path is required');

    // Normalised first, so `穿越漫画/../../secret.txt` collapses to `secret.txt`
    // and is judged as the path it really names rather than as the prefix of a
    // legitimate one. Without this a traversal inside a directory book passes the
    // "is it under the folder" test.
    const wanted = normalizeRel(query.path);

    // Two shapes of book, and each owns a different set of paths.
    //
    // A single-file book owns exactly the paths recorded against it — normally
    // one. A directory book (a comic stored as a folder of images) has no book
    // file of its own: the scanner records the *folder*, and the pages that make
    // it up are not rows at all. Its handler therefore answers with the page
    // paths, and that answer is the whole contract — the manifest publishes the
    // same list, so anything refused here was never offered to a client.
    //
    // A directory book also needs its *own* path to resolve, because a page may
    // live inside an embedded archive: `第01卷/vol.cbz` is the archive, and
    // serving that *path* is how a client fetches the volume's pages out of it.
    const dirHandler = directoryHandlerForFormat(book.format);
    const owned = dirHandler?.files
      ? await dirHandler.files({ ...sourceContext(ctx, id), bookId: id })
      : null;
    const rows = ctx.db.all<{ rel_path: string; size: number }>(
      'SELECT rel_path, size FROM book_files WHERE book_id = ? AND missing = 0',
      id,
    );
    const row = rows.find((candidate) => candidate.rel_path === wanted);
    const entry = owned?.find((candidate) => candidate.relPath === wanted);
    // A directory book records its *folder*, so every page path under that folder
    // belongs to this book. `owned` is the authoritative list — it is the same
    // walk the manifest published — but a path directly under the folder that the
    // walk skips (or an older client asking for one) still resolves here.
    const folderRow = rows.find(
      (candidate) => normalizeRel(candidate.rel_path) === parentPath(wanted),
    );
    const ownsFolder = dirHandler !== null && folderRow !== undefined;
    if (!row && !entry && !ownsFolder) throw notFound('no such file for this book', 'FILE_MISSING');

    // The registry owns the extension -> content-type mapping, so a page image
    // served here and the same image listed in a manifest can never disagree.
    const contentType = contentTypeFor(wanted);
    const size = row?.size ?? entry?.size ?? 0;

    // An embedded page is served out of its archive, not off disk. The database
    // refuses to call this a file of the library — it is not one — so the bytes
    // come from the handler that knows how to open the container, addressed by
    // the reference that came with the list entry.
    //
    // Gated on the path carrying the folder. The handler's references are only
    // meaningful inside a directory book: a folder candidate answers with one
    // entry per volume and per loose page (`page:0:0`), while the same file as a
    // book of its own is addressed as `page:0` by a different handler. Asking one
    // through the other's branch answers a request for a page with a different
    // page — a silent off-by-one. A row-backed file therefore always goes to disk
    // below, and only a page inside an archive is asked of the handler.
    if (!row && entry && ownsFolder) {
      const absOwner = resolveInside(ctx.config.booksDir, assertSafeRel(wanted));
      if (!existsSync(absOwner)) throw notFound('file is no longer on disk', 'FILE_MISSING');
      const payload = await dirHandler?.asset(
        { ...sourceContext(ctx, id), bookId: id },
        { ref: entry.ref },
      );
      if (!payload) throw notFound('no such file for this book', 'FILE_MISSING');
      reply.header('etag', `"${id}:${createHash('sha256').update(wanted).digest('hex').slice(0, 16)}"`);
      reply.header('cache-control', 'private, max-age=86400');
      return sendAssetPayload(request, reply, payload);
    }

    const abs = resolveInside(ctx.config.booksDir, assertSafeRel(wanted));
    if (!existsSync(abs)) throw notFound('file is no longer on disk', 'FILE_MISSING');

    reply.header('content-type', contentType);
    reply.header('content-length', String(size || (await stat(abs)).size));
    // Unlike `/content`, this is one page of many, so the ETag is per file rather
    // than per book.
    //
    // Hashed rather than embedding the path: an HTTP header value must be
    // ISO-8859-1, and a comic page's path is routinely Chinese or Japanese. Putting
    // the raw path in the header throws `ERR_INVALID_CHAR` and turns a page request
    // into a 500 — which is exactly what happened the first time this was written.
    reply.header('etag', `"${id}:${createHash('sha256').update(wanted).digest('hex').slice(0, 16)}"`);
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(createReadStream(abs));
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
