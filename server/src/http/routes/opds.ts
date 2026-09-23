import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { OpdsCredentials, xml } from '../../services/opds.ts';
import { FilePublications } from '../../publications/files.ts';
import { allFileHandlers, contentTypeFor } from '../../indexer/formats/index.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { assertSafeRel, resolveInside } from '../../lib/paths.ts';
import { sendAssetPayload } from '../assets.ts';

const feedType = 'application/atom+xml;profile=opds-catalog;kind=acquisition';

export function registerOpdsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const credentials = new OpdsCredentials(ctx.db), auth = authenticate(ctx);
  const formats = allFileHandlers().map(handler => handler.format);
  const root = `${ctx.config.publicUrl.replace(/\/$/, '')}/opds`;
  const access = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = credentials.authenticate(request.headers.authorization);
      const user = ctx.users.byId(id)!;
      request.currentUser = { id, username: user.username, displayName: user.display_name, role: user.role, createdAt: user.created_at };
    } catch (error) { reply.header('www-authenticate', 'Basic realm="Reader OPDS", charset="UTF-8"'); throw error; }
  };
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/opds') || request.url.startsWith('/api/v1/opds/')) {
      reply.header('cache-control', 'private, no-store'); reply.header('referrer-policy', 'no-referrer');
    }
    return payload;
  });
  app.get('/api/v1/opds/credentials', { preHandler: auth }, async request => ({ credentials: credentials.list(currentUser(request).id), catalogUrl: root }));
  app.post('/api/v1/opds/credentials', { preHandler: auth }, async (request, reply) => {
    reply.code(201);
    return { ...credentials.create(currentUser(request).id, (request.body as { name?: unknown } | null)?.name), catalogUrl: root };
  });
  app.delete('/api/v1/opds/credentials/:id', { preHandler: auth }, async request => {
    credentials.revoke(currentUser(request).id, (request.params as { id: string }).id); return { ok: true };
  });
  app.get('/opds/', { preHandler: access }, async (request, reply) => reply.redirect(root + (request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '')));
  app.get('/opds', { preHandler: access }, async (request, reply) => {
    const query = request.query as { page?: unknown; search?: unknown };
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200))) throw badRequest('invalid OPDS query');
    const search = query.search as string | undefined;
    const result = ctx.shelf.list(currentUser(request).id, { page, pageSize: 50, fileFormats: formats, sort: 'title', ...(search ? { search } : {}) });
    const link = (rel: string, href: string, type = feedType) => `<link rel="${rel}" href="${xml(href)}" ${type ? `type="${type}"` : ''}/>`;
    const pageUrl = (number: number) => root + '?' + new URLSearchParams({ page: String(number), ...(search ? { search } : {}) });
    const entries = result.items.map(book => {
      const href = `${root}/books/${encodeURIComponent(book.id)}`;
      const file = new FilePublications(ctx.db, ctx.config).context(book.id);
      return `<entry><id>urn:reader:book:${xml(book.id)}</id><title>${xml(book.title)}</title><updated>${new Date(book.updatedAt).toISOString()}</updated>
        <author><name>${xml(book.author)}</name></author><summary type="text">${xml(book.description)}</summary>
        ${link('http://opds-spec.org/acquisition', href + '/content', contentTypeFor(file.relPath))}
        ${book.coverUrl ? link('http://opds-spec.org/image', href + '/cover', '') : ''}</entry>`;
    }).join('');
    return reply.type(feedType).send(`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
      <id>urn:reader:opds:${xml(currentUser(request).id)}</id><title>Reader 个人书架</title><updated>${new Date().toISOString()}</updated>
      ${link('self', pageUrl(page))}${link('start', root)}${link('search', root + '/search.xml', 'application/opensearchdescription+xml')}
      ${page > 1 ? link('previous', pageUrl(page - 1)) : ''}${page * result.pageSize < result.total ? link('next', pageUrl(page + 1)) : ''}
      <opensearch:totalResults>${result.total}</opensearch:totalResults><opensearch:startIndex>${(page - 1) * result.pageSize + 1}</opensearch:startIndex><opensearch:itemsPerPage>${result.pageSize}</opensearch:itemsPerPage>${entries}</feed>`);
  });
  app.get('/opds/search.xml', { preHandler: access }, async (_request, reply) => reply.type('application/opensearchdescription+xml').send(
    `<?xml version="1.0" encoding="utf-8"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Reader</ShortName><Description>搜索个人书架</Description><Url type="${feedType}" template="${xml(root + '?search={searchTerms}')}"/><InputEncoding>UTF-8</InputEncoding></OpenSearchDescription>`,
  ));
  app.get('/opds/books/:id/content', { preHandler: access }, async (request, reply) => {
    const book = ctx.shelf.get(currentUser(request).id, (request.params as { id: string }).id);
    if (!formats.includes(book.format)) throw notFound('publication not available');
    const files = new FilePublications(ctx.db, ctx.config);
    await containedFile(files.context(book.id).absPath, [ctx.config.booksDir, ctx.config.dataDir]);
    return sendAssetPayload(request, reply, await files.content(book.id, book.format));
  });
  app.get('/opds/books/:id/cover', { preHandler: access }, async (request, reply) => {
    const book = ctx.shelf.get(currentUser(request).id, (request.params as { id: string }).id);
    if (!formats.includes(book.format)) throw notFound('publication not available');
    const row = ctx.db.get<{ cover_path: string | null }>('SELECT cover_path FROM books WHERE id=?', book.id);
    if (!row?.cover_path) throw notFound('cover unavailable');
    const path = resolveInside(ctx.config.dataDir, assertSafeRel(row.cover_path));
    await containedFile(path, [ctx.config.dataDir]);
    return reply.type(contentTypeFor(path)).send(createReadStream(path));
  });
}

async function containedFile(path: string, roots: string[]): Promise<void> {
  let actual: string;
  try { actual = await realpath(path); } catch { throw notFound('file unavailable'); }
  for (const root of roots) {
    const rel = relative(await realpath(root), actual);
    if (rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && (await stat(actual)).isFile()) return;
  }
  throw notFound('file unavailable');
}
