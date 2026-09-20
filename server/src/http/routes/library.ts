import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { parseConflictPolicy, type ConflictPolicy, type StagedUpload } from '../../services/uploads.ts';
import { assertSafeRel, normalizeRel, resolveInside } from '../../lib/paths.ts';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  capabilities,
  contentTypeFor,
  directoryHandlerForFormat,
  type ContentItem,
} from '../../indexer/formats/index.ts';
import { sendAssetPayload } from '../assets.ts';
import { FilePublications } from '../../publications/files.ts';
import { withSignal } from '../request-signal.ts';

/**
 * The handler that owns a book, resolved from its recorded format.
 *
 * A missing file still has a handler; only the manifest and asset calls fail.
 */
function resolveHandler(ctx: AppContext, bookId: string, format: string) {
  void bookId;
  return new FilePublications(ctx.db, ctx.config).handler(format);
}

/** Validated storage context, independent of a book's discovery source. */
function sourceContext(ctx: AppContext, bookId: string) {
  return new FilePublications(ctx.db, ctx.config).context(bookId);
}

/** Stored chapter snapshots and local files share the reader's content contract. */
async function contentManifest(ctx: AppContext, userId: string, bookId: string, format: string) {
  if (ctx.sources?.chapters.has(bookId)) return ctx.sources.chapters.manifest(userId, bookId);
  const handler = resolveHandler(ctx, bookId, format);
  return handler ? handler.manifest({ ...sourceContext(ctx, bookId), bookId }) : null;
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

/**
 * Validates a `string[]` body field.
 *
 * Refused rather than coerced: `paths: "a"` and `paths: ["a"]` are one keystroke
 * apart, and a silently wrapped string would make a batch delete of one entry
 * look like a successful delete of many.
 */
function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest(`${field} must be a non-empty array`);
  if (value.length > 500) throw badRequest(`${field} is too long`);
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) throw badRequest(`${field} must contain strings`);
  }
  return value as string[];
}

/**
 * A positive integer from a query string, or the fallback.
 *
 * Junk answers the fallback rather than a 400: a page number is a *position in a
 * list*, and the honest response to `?page=abc` is the first page, not an error the
 * reader cannot act on. The service clamps the upper end.
 */
function numberParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
      ...(q.path !== undefined ? { path: q.path } : {}),
      // `scope=library` is the *index* rather than the reader's shelf: every book in
      // a folder, each carrying `shelfState`. It is what the browsing page asks, and
      // the only reason a card on it can offer 加入书架 at all. Any other value is
      // the shelf, which is where the parameter's absence already pointed.
      ...(q.scope === 'library' ? { scope: 'library' as const } : {}),
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
    const query = request.query as Record<string, string | undefined>;
    const requested = query.group !== undefined ? Number.parseInt(query.group, 10) : null;

    const content = await contentManifest(ctx, user.id, id, book.format);

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
    // A mutable chapter publication ships one complete snapshot. Clients derive
    // TOC and windows from it so a concurrent refresh cannot mix two revisions.
    const wantsAll = query.group === 'all' || book.format === 'chapters';
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
      files: await new FilePublications(ctx.db, ctx.config).files(id, book.format),
      // `content` is null only for a book whose format exposes no addressable
      // structure at all; the client then falls back to the raw file.
      content: windowed,
      ...(windowed ? { items: windowed.items, groups: windowed.groups, kind: windowed.kind, total: windowed.total } : {}),
    };
  });

  app.post('/api/v1/books/:id/refresh', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    ctx.shelf.get(user.id, id);
    if (!ctx.sources?.chapters.has(id)) throw badRequest('this book has no remote chapter directory', 'SOURCE_UNSUPPORTED');
    return withSignal(request, reply, (signal) => ctx.sources!.refreshPublication(user.id, id, signal));
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
    if (book.format === 'chapters') throw badRequest('fetch individual chapters from the manifest', 'CHAPTER_BOOK');
    return sendAssetPayload(request, reply, await new FilePublications(ctx.db, ctx.config).content(id, book.format));
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
    const manifest = await contentManifest(ctx, user.id, id, book.format);
    if (!manifest) throw badRequest(`format ${book.format} does not expose items`, 'UNSUPPORTED_FORMAT');
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
    if (ctx.sources?.chapters.has(id)) {
      const manifest = await ctx.sources.chapters.manifest(user.id, id);
      return {
        revision: manifest.revision,
        toc: manifest.items.map((item) => ({ href: item.href, title: item.title, level: 0, spine: item.seq })),
      };
    }
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

    if (ctx.sources?.chapters.has(id)) {
      const payload = await withSignal(request, reply, (signal) => ctx.sources!.chapters.asset(user.id, id, ref, signal));
      reply.header('x-content-type-options', 'nosniff');
      reply.header('content-security-policy', "default-src 'none'; img-src data:; sandbox");
      return sendAssetPayload(request, reply, payload);
    }

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
    const publications = new FilePublications(ctx.db, ctx.config);
    const managed = publications.managed(id);
    if (managed && managed.rel_path === wanted) {
      return sendAssetPayload(request, reply, await publications.content(id, book.format));
    }

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

  // ---- file manager ----

  /**
   * The library as a tree.
   *
   * Every path here is library-relative and resolved through `resolveInside`, so
   * a traversal attempt is refused before it reaches the disk. Authentication is
   * the same as everywhere else; the mount is the only boundary, and it is the
   * deployment's own.
   */
  app.get('/api/v1/library/browse', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const query = request.query as Record<string, string | undefined>;
    /*
     * `page` and `pageSize` are read here rather than by the service, because they
     * are *transport*: a query string is text, and every other number in this file
     * is parsed at the same boundary for the same reason. A directory can hold
     * thousands of entries, and the response is one page of them — see
     * `BrowseListing.entries`.
     *
     * The caller is passed through because a row's `shelfState` describes *their*
     * shelf. It is the same rule the write endpoints already follow: the screen
     * answers questions about the reader, not about the disk alone.
     */
    return ctx.browse.list(
      query.path ?? '',
      numberParam(query.page, 1),
      numberParam(query.pageSize, 200),
      user.id,
    );
  });

  app.post('/api/v1/library/browse/move', { preHandler: auth }, async (request) => {
    currentUser(request);
    const body = (request.body ?? {}) as { paths?: unknown; target?: unknown };
    const paths = stringList(body.paths, 'paths');
    const target = typeof body.target === 'string' ? body.target : '';
    return ctx.browse.move(paths, target);
  });

  app.post('/api/v1/library/browse/rename', { preHandler: auth }, async (request) => {
    currentUser(request);
    const body = (request.body ?? {}) as { path?: unknown; name?: unknown };
    if (typeof body.path !== 'string' || typeof body.name !== 'string') {
      throw badRequest('path and name are required');
    }
    return ctx.browse.renamePath(body.path, body.name);
  });

  app.post('/api/v1/library/browse/mkdir', { preHandler: auth }, async (request) => {
    currentUser(request);
    const body = (request.body ?? {}) as { path?: unknown; name?: unknown };
    const parent = typeof body.path === 'string' ? body.path : '';
    if (typeof body.name !== 'string') throw badRequest('name is required');
    return ctx.browse.createDirectory(parent, body.name);
  });

  app.post('/api/v1/library/browse/delete', { preHandler: auth }, async (request) => {
    currentUser(request);
    const body = (request.body ?? {}) as { paths?: unknown };
    return ctx.browse.remove(stringList(body.paths, 'paths'));
  });

  // ---- batch management ----

  /**
   * The metadata fields a batch may set.
   *
   * The same allowlist the single-book route uses, and for the same reason: a
   * batch is not a licence to write columns the API never exposes. It also
   * matches the client's form, so "edit 40 books" cannot offer a field that the
   * single-book dialog does not.
   */
  const BATCH_FIELDS = [
    'title', 'author', 'publisher', 'language', 'isbn', 'description',
    'series', 'seriesIndex', 'pubdate', 'tags',
  ];

  app.post('/api/v1/library/browse/metadata', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { paths?: unknown; fields?: unknown };
    const paths = stringList(body.paths, 'paths');
    const fields = (body.fields ?? {}) as Record<string, unknown>;
    if (typeof fields !== 'object' || Array.isArray(fields)) {
      throw badRequest('fields must be an object');
    }
    const patch: Record<string, unknown> = {};
    for (const key of BATCH_FIELDS) {
      if (fields[key] !== undefined) patch[key] = fields[key];
    }
    if (Object.keys(patch).length === 0) throw badRequest('no editable field supplied');
    return ctx.browse.batchMetadata(paths, patch, user.id);
  });

  /**
   * Adds, removes or hides books on the *caller's* shelf.
   *
   * Nothing on disk changes, and that is the point: "hide these forty scans from
   * my shelf" and "move these forty scans into a folder" are one word apart in a
   * list of rows and could not be more different in consequence.
   *
   * **Addressed by `paths` or by `bookIds`**, and exactly one of the two: the file
   * manager selects files and has paths, while a shelf card holds a `Book` and has an
   * id. The id form is what fixed 「找不到「xxx」在磁盘上的路径」 — the client used to
   * reconstruct a path from a title, which is a guess that fails on every book whose
   * metadata was renamed and on every book not on the first page of the root.
   */
  app.post('/api/v1/library/browse/shelf', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { paths?: unknown; bookIds?: unknown; action?: unknown };
    const action = body.action;
    if (action !== 'add' && action !== 'remove' && action !== 'hide' && action !== 'unhide') {
      throw badRequest('action must be one of add, remove, hide, unhide', 'BAD_ACTION');
    }
    /*
     * Both given, or neither, is refused rather than merged: the two address the same
     * write in two vocabularies, and a body carrying both is a client that does not
     * know which one it meant. Merging them would apply the action twice to a book
     * that is named both ways, and the report would count it twice.
     */
    const hasPaths = Array.isArray(body.paths) && body.paths.length > 0;
    const hasIds = Array.isArray(body.bookIds) && body.bookIds.length > 0;
    if (hasPaths === hasIds) {
      throw badRequest('send exactly one of paths or bookIds', 'AMBIGUOUS_TARGETS');
    }
    if (hasIds) return ctx.browse.batchShelfByBookIds(stringList(body.bookIds, 'bookIds'), action, user.id);
    return ctx.browse.batchShelf(stringList(body.paths, 'paths'), action, user.id);
  });

  // ---- uploads ----

  /**
   * Stores uploaded books in the library and indexes them.
   *
   * `multipart/form-data` with repeatable `file` parts and an optional `path`
   * field naming the destination directory. The response reports what landed,
   * what was skipped and why, and what the incremental scan saw — the same shape
   * a scan reports, so the client has one story to tell about a library change
   * rather than two.
   */
  app.post('/api/v1/library/upload', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    if (!request.isMultipart()) {
      throw badRequest('expected multipart/form-data', 'NOT_MULTIPART');
    }

    const staged: StagedUpload[] = [];
    let target = '';
    let policy: ConflictPolicy = 'rename';
    let targetChecked = false;

    // Refused before a single byte is read, rather than reported per file. A
    // destination that escapes the library is not a file's problem, and a
    // per-file `skipped` note would make a client show "已跳过" for something that
    // should never have been attempted.
    const ensureTarget = (raw: string): void => {
      if (targetChecked) return;
      targetChecked = true;
      target = ctx.browse.assertDestination(raw);
    };

    // Every part is drained before any of it is placed, for two reasons that are
    // both about correctness rather than tidiness:
    //
    //  - A form built by a browser puts its fields first, but nothing guarantees
    //    that of a hand-rolled client, and the destination has to be known before
    //    the first file can be stored.
    //  - A batch that is refused should be refused whole. Committing file one
    //    before file two has been received makes "the upload failed" a lie.
    //
    // Parking is safe because a staged part is a *file* in DATA_DIR, not a
    // buffered stream: the multipart plugin will not hand out the next part until
    // this one has been consumed, and a NAS upload must not become heap.
    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'path') ensureTarget(String(part.value ?? ''));
          if (part.fieldname === 'onConflict') policy = parseConflictPolicy(String(part.value ?? ''));
          continue;
        }
        // Registered before it is read: a part that fails halfway has still
        // created its scratch directory, and not leaking that is the subject of
        // the `catch` around this whole loop.
        const item = await ctx.uploads.stage(part.file, part.filename ?? '');
        staged.push(item);
        // Consumed here rather than later: the request body is a stream, and a
        // part that is not read blocks every part behind it.
        await ctx.uploads.receive(item);
      }
    } catch (err) {
      // Nothing reached the library, so the only cleanup owed is the scratch
      // copies — which `commit` would have made, and never got to run.
      await ctx.uploads.discard(staged);
      throw err;
    }

    ensureTarget(target);
    if (staged.length === 0) throw badRequest('no file was uploaded', 'NO_FILES');
    void user;
    return ctx.uploads.commit(staged, target, policy);
  });

  /**
   * A one-off write probe for the upload screen.
   *
   * `browse` already reports whether the mount is writable per directory, and
   * this is the same answer for the *root* — asked before a phone starts
   * uploading 400MB it cannot store. Not cached: a mount is remounted far more
   * often than this is called.
   */
  app.get('/api/v1/library/upload', { preHandler: auth }, async () => {
    const listing = await ctx.browse.list('');
    return { writable: listing.writable };
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
