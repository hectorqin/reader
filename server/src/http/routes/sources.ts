import { extensionValues } from '../../sources/extensions.ts';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { badRequest } from '../../lib/errors.ts';
import { SourceHost } from '../../services/source-host.ts';
import { withSignal } from '../request-signal.ts';

function textBody(body: unknown, name: string): string {
  const value = (body as Record<string, unknown> | null)?.[name];
  return parameter(value, name, true)!;
}

function parameter(value: unknown, name: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 16_384) {
    throw badRequest(`${name} must be a nonempty string up to 16384 characters`);
  }
  return value;
}

/** Source discovery and plugin management. All provider-specific behaviour stays in SourceHost. */
export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);
  const host = ctx.sources ??= new SourceHost(ctx.db, ctx.config, () => ctx.shelf, app.log);
  app.addHook('onReady', async () => { await host.plugins.loadInstalled(); host.updates.start(); host.plugins.startTasks(); });
  app.addHook('onClose', async () => { await host.updates.stop(); await host.plugins.close(); });

  app.get('/api/v1/subscriptions', { preHandler: auth }, async (request) => ({ subscriptions: host.updates.list(currentUser(request).id) }));
  app.patch('/api/v1/books/:id/subscription', { preHandler: auth }, async (request) => {
    const user = currentUser(request); const { id } = request.params as { id: string };
    ctx.shelf.get(user.id, id);
    return { subscription: host.updates.configure(user.id, id, (request.body ?? {}) as Record<string, unknown>) };
  });

  app.get('/api/v1/sources/types', { preHandler: auth }, async () => ({
    types: host.registry.list().map(({ pluginId, builtin, provider }) => ({
      ...provider.descriptor, pluginId, builtin: builtin === true,
    })),
  }));
  app.get('/api/v1/sources', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    return { sources: host.list(user.role === 'admin') };
  });
  app.post('/api/v1/sources', { preHandler: auth }, async (request, reply) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pluginId = textBody(body, 'pluginId');
    const sourceType = textBody(body, 'sourceType');
    const name = textBody(body, 'name');
    const id = await host.create({
      id: parameter(body.id, 'id'), pluginId, sourceType, name,
      config: body.config ?? {},
    });
    reply.status(201);
    return { source: host.list(true).find((source) => source.id === id) };
  });
  app.patch('/api/v1/sources/:id', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const patch = (request.body ?? {}) as Record<string, unknown>;
    if (!['name', 'config', 'enabled'].some((key) => key in patch)) throw badRequest('no source changes provided');
    await host.update(id, patch);
    return { source: host.list(true).find((source) => source.id === id) };
  });
  app.delete('/api/v1/sources/:id', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    host.remove((request.params as { id: string }).id);
    return { ok: true };
  });
  app.put('/api/v1/sources/:id/credentials/:key', { preHandler: auth }, async (request) => {
    const user = currentUser(request);
    const { id, key } = request.params as { id: string; key: string };
    const value = (request.body as Record<string, unknown> | null)?.value;
    if (typeof value !== 'string') throw badRequest('credential value must be a string');
    host.setCredential(id, user.id, key, value);
    return { ok: true };
  });
  app.get('/api/v1/sources/:id/browse', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request); const { id } = request.params as { id: string };
    const q = request.query as { ref?: string; cursor?: string; limit?: string };
    return withSignal(request, reply, (signal) => host.browse(user.id, id, {
      ref: parameter(q.ref, 'ref'), cursor: parameter(q.cursor, 'cursor'), limit: pageLimit(q.limit),
    }, signal));
  });
  app.get('/api/v1/sources/:id/search', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request); const { id } = request.params as { id: string };
    const q = request.query as { q?: string; cursor?: string; limit?: string; filters?: string };
    const query = parameter(q.q, 'q', true)!;
    return withSignal(request, reply, (signal) => host.search(user.id, id, {
      query, cursor: parameter(q.cursor, 'cursor'), limit: pageLimit(q.limit), filters: searchFilters(q.filters),
    }, signal));
  });
  app.get('/api/v1/sources/:id/entries', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request); const { id } = request.params as { id: string };
    const q = request.query as { ref?: string };
    const ref = parameter(q.ref, 'ref', true)!;
    return withSignal(request, reply, (signal) => host.detail(user.id, id, ref, signal));
  });
  app.post('/api/v1/sources/:id/acquire', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request); const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> | null;
    const entryRef = textBody(body, 'entryRef');
    const optionId = parameter(body?.optionId, 'optionId');
    return withSignal(request, reply, (signal) => host.acquire(user.id, id, entryRef, optionId, signal));
  });
  app.get('/api/v1/sources/:id/publications/:publicationRef/manifest', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request); const params = request.params as { id: string; publicationRef: string };
    return withSignal(request, reply, (signal) => host.manifest(user.id, params.id, params.publicationRef, signal));
  });
  app.get('/api/v1/sources/:id/publications/:publicationRef/resource', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request); const params = request.params as { id: string; publicationRef: string };
    const ref = parameter((request.query as { ref?: string }).ref, 'ref', true)!;
    const resource = await withSignal(request, reply, (signal) => host.resource(user.id, params.id, params.publicationRef, ref, signal));
    // Development endpoint: JSON only. Untrusted HTML is never served as an app-origin document.
    if (resource.stream) { resource.stream.destroy(); throw badRequest('streaming preview is not supported'); }
    return { mediaType: resource.mediaType, ...(resource.text !== undefined ? { text: resource.text } : {}),
      ...(resource.data ? { base64: Buffer.from(resource.data).toString('base64') } : {}) };
  });
  app.get('/api/v1/sources/:id/search-filters', { preHandler: auth }, async (request, reply) => {
    return withSignal(request, reply, signal => host.searchFilters(currentUser(request).id, (request.params as { id: string }).id, signal));
  });
  app.get('/api/v1/books/:id/source-options', { preHandler: auth }, async request => {
    const user = currentUser(request), { id } = request.params as { id: string }; ctx.shelf.get(user.id, id);
    return { canSwitch: host.chapters.has(id) && host.canSwitch(user.id, id) };
  });
  app.get('/api/v1/books/:id/alternatives', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request), { id } = request.params as { id: string }; ctx.shelf.get(user.id, id);
    const cursor = parameter((request.query as { cursor?: string }).cursor, 'cursor');
    return withSignal(request, reply, signal => host.alternatives(user.id, id, cursor, signal));
  });
  app.post('/api/v1/books/:id/switch-preview', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request), { id } = request.params as { id: string }; ctx.shelf.get(user.id, id);
    const ref = textBody(request.body, 'entryRef');
    return withSignal(request, reply, signal => host.switchPreview(user.id, id, ref, signal));
  });
  app.post('/api/v1/books/:id/switch-source', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request), { id } = request.params as { id: string }; ctx.shelf.get(user.id, id);
    const ref = textBody(request.body, 'entryRef'), chapter = textBody(request.body, 'chapterId'), revision = textBody(request.body, 'revision');
    return withSignal(request, reply, signal => host.switchSource(user.id, id, ref, chapter, revision, signal));
  });
  app.get('/api/v1/plugins/:id/pages/:pageId', { preHandler: auth }, async request => {
    requireAdmin(request); const { id, pageId } = request.params as { id: string; pageId: string };
    return host.plugins.page(id, pageId, currentUser(request).id);
  });
  app.post('/api/v1/plugins/:id/pages/:pageId', { preHandler: auth }, async request => {
    requireAdmin(request); const { id, pageId } = request.params as { id: string; pageId: string };
    return host.plugins.page(id, pageId, currentUser(request).id, textBody(request.body, 'action'), (request.body as Record<string, unknown>).values ?? {});
  });
  app.get('/api/v1/plugins', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    return { plugins: host.plugins.list() };
  });
  app.post('/api/v1/plugins', { preHandler: auth }, async (request, reply) => {
    requireAdmin(request);
    const body = request.body as Record<string, unknown> | null;
    if (body?.trusted !== true) throw badRequest('trusted must be true: installed plugins execute with server OS privileges', 'PLUGIN_TRUST_REQUIRED');
    const plugin = await host.plugins.install(textBody(body, 'folder'));
    reply.status(201);
    return { plugin };
  });
  app.patch('/api/v1/plugins/:id', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    const enabled = (request.body as Record<string, unknown> | null)?.enabled;
    if (typeof enabled !== 'boolean') throw badRequest('enabled must be boolean');
    return { plugin: await host.plugins.setEnabled((request.params as { id: string }).id, enabled) };
  });
  app.delete('/api/v1/plugins/:id', { preHandler: auth }, async (request) => {
    requireAdmin(request);
    await host.plugins.uninstall((request.params as { id: string }).id);
    return { ok: true };
  });
}

function pageLimit(value?: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) throw badRequest('invalid limit');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 200) throw badRequest('limit must be an integer between 1 and 200');
  return number;
}

function searchFilters(value?: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== 'string' || value.length > 16384) throw new Error();
    const filters = extensionValues(JSON.parse(value));
    if (Object.values(filters).some(item => typeof item !== 'string')) throw new Error();
    return filters as Record<string, string>;
  } catch { throw badRequest('Invalid search filters'); }
}
