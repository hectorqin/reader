import { extensionValues } from '../../sources/extensions.ts';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { badRequest } from '../../lib/errors.ts';
import { SourceHost } from '../../services/source-host.ts';
import { withSignal } from '../request-signal.ts';
import { searchResponse } from '../search-stream.ts';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { PluginInstaller, PLUGIN_UPLOAD_LIMIT } from '../../sources/plugin-installer.ts';

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

function searchSessionId(value?: string): string | undefined {
  if (value !== undefined && !/^[a-zA-Z0-9_-]{16,80}$/.test(value)) throw badRequest('invalid search session id');
  return value;
}
function searchResultLimit(value: unknown, max = 10000): number | undefined {
  if (value === undefined) return undefined;
  const limit = value;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > max) throw badRequest(`${max === 200 ? 'limit' : 'resultLimit'} must be an integer from 1 to ${max}`);
  return limit;
}

/** Source discovery and plugin management. All provider-specific behaviour stays in SourceHost. */
export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);
  const host = ctx.sources ??= new SourceHost(ctx.db, ctx.config, () => ctx.shelf, app.log);
  const installer = new PluginInstaller(ctx.config.dataDir, host.plugins);
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
  app.post('/api/v1/sources/:id/search', { preHandler: auth }, async (request, reply) => {
    const user = currentUser(request), { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = parameter(body.query, 'query', true)!;
    const sessionId = searchSessionId(parameter(body.sessionId, 'sessionId', true))!;
    const search = { query, sessionId, cursor: parameter(body.cursor, 'cursor'),
      limit: searchResultLimit(body.limit, 200), resultLimit: searchResultLimit(body.resultLimit),
      filters: searchFilters(body.filters === undefined ? undefined : JSON.stringify(body.filters)) };
    reply.header('content-type', 'text/event-stream; charset=utf-8');
    reply.header('cache-control', 'no-cache, no-transform');
    reply.header('x-accel-buffering', 'no');
    return reply.send(searchResponse(request, reply, host, user.id, id, search));
  });
  app.post('/api/v1/sources/:id/search/cancel', { preHandler: auth }, async request => {
    const sessionId = searchSessionId(textBody(request.body, 'sessionId'))!;
    await host.cancelSearch(currentUser(request).id, (request.params as { id: string }).id, sessionId);
    return { ok: true };
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
  app.get('/api/v1/sources/:id/pages/:pageId', { preHandler: auth }, async request => {
    requireAdmin(request); const { id, pageId } = request.params as { id: string; pageId: string };
    return host.plugins.sourcePage(id, pageId, currentUser(request).id);
  });
  app.post('/api/v1/sources/:id/pages/:pageId', { preHandler: auth }, async request => {
    requireAdmin(request); const { id, pageId } = request.params as { id: string; pageId: string };
    return host.plugins.sourcePage(id, pageId, currentUser(request).id, textBody(request.body, 'action'), (request.body as Record<string, unknown>).values ?? {});
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
    const plugin = body?.package !== undefined
      ? await installer.installPackage(textBody(body, 'package').trim())
      : await host.plugins.install(textBody(body, 'folder'));
    reply.status(201);
    return { plugin };
  });
  app.post('/api/v1/plugins/upload', { preHandler: auth }, async (request, reply) => {
    requireAdmin(request);
    if (!request.isMultipart()) throw badRequest('请上传 .tgz 安装包。', 'NOT_MULTIPART');
    const plugin = await installer.installArchive(async target => {
      let trusted = false;
      let received = false;
      for await (const part of request.parts({ limits: { fileSize: PLUGIN_UPLOAD_LIMIT, files: 1, fields: 1, parts: 2 } })) {
        if (part.type === 'field') {
          if (part.fieldname !== 'trusted' || part.value !== 'true') throw badRequest('请确认信任插件代码。', 'PLUGIN_TRUST_REQUIRED');
          trusted = true;
        } else {
          if (part.fieldname !== 'file' || !part.filename.toLowerCase().endsWith('.tgz')) {
            part.file.resume();
            throw badRequest('只支持 npm pack 生成的 .tgz 安装包。', 'PLUGIN_INVALID_PACKAGE');
          }
          await pipeline(part.file, createWriteStream(target, { flags: 'wx' }));
          if (part.file.truncated) throw badRequest('安装包不能超过 100 MiB。', 'PLUGIN_PACKAGE_TOO_LARGE');
          received = true;
        }
      }
      if (!trusted) throw badRequest('请确认信任插件代码。', 'PLUGIN_TRUST_REQUIRED');
      if (!received) throw badRequest('请选择 .tgz 安装包。', 'PLUGIN_INVALID_PACKAGE');
    });
    return reply.status(201).send({ plugin });
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
