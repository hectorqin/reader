import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerLibraryRoutes } from './routes/library.ts';
import { registerSyncRoutes } from './routes/sync.ts';
import { registerWebRoutes } from './routes/web.ts';
import { isOriginAllowed, resolveCorsOrigin } from './cors.ts';

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: { level: ctx.config.logLevel },
    // Book bodies are streamed straight from disk, so the default 1MB body
    // limit is fine and protects the server from oversized sync payloads.
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });

  registerErrorHandler(app);

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
  // Registered last: the SPA fallback must not shadow an API route.
  registerWebRoutes(app, ctx);

  return app;
}
