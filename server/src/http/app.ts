import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import type { AppContext } from './context.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerLibraryRoutes } from './routes/library.ts';
import { registerSyncRoutes } from './routes/sync.ts';
import { registerTtsRoutes } from './routes/tts.ts';
import { registerWebRoutes } from './routes/web.ts';
import { registerSourceRoutes } from './routes/sources.ts';
import { isOriginAllowed, resolveCorsOrigin } from './cors.ts';

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: { level: ctx.config.logLevel },
    // Book bodies are streamed straight from disk, so a JSON limit this small is
    // fine and protects the server from oversized sync payloads. Uploads are the
    // exception and are not bounded here: a multipart body is streamed by the
    // multipart plugin rather than buffered by Fastify, and its own `fileSize`
    // limit is what bounds a request. Raising this number would instead let one
    // JSON request (a sync batch, a batch metadata edit) hold 400MB of heap.
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
    // Source publications use opaque plugin-owned references, often longer than
    // the router's default 100-character parameter limit.
    routerOptions: { maxParamLength: 16_384 },
  });

  registerErrorHandler(app);

  // Uploads arrive as `multipart/form-data`, one part per file, because that is
  // the only encoding a browser and an Android picker both produce without a
  // helper library. `attachFieldsToBody` is deliberately off: the handler wants
  // the file *stream*, not a buffer, so that a 400MB comic does not have to fit
  // in the process's memory before it can be stored.
  //
  // The per-file limit is generous (a scanned volume is genuinely large) and the
  // per-request limit bounds a batch, so a client cannot turn one request into
  // an unbounded amount of disk.
  app.register(multipart, {
    limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 20 },
    throwFileSizeLimit: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!isOriginAllowed(ctx.config, request)) {
      reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'origin not allowed' } });
      return;
    }
    reply.header('access-control-allow-origin', resolveCorsOrigin(ctx.config, request));
    reply.header('access-control-allow-headers', 'authorization, content-type');
    reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    // `vary: origin` is required whenever the allowed origin is reflected rather
    // than fixed, otherwise a shared cache will serve one origin's response to
    // another.
    reply.header('vary', 'origin');
  });

  app.options('/*', async (_request, reply) => reply.status(204).send());

  registerAuthRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerSyncRoutes(app, ctx);
  registerTtsRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  // Registered last: the SPA fallback must not shadow an API route.
  registerWebRoutes(app, ctx);

  return app;
}
