import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerLibraryRoutes } from './routes/library.ts';
import { registerSyncRoutes } from './routes/sync.ts';
import { registerWebRoutes } from './routes/web.ts';

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: { level: ctx.config.logLevel },
    // Book bodies are streamed straight from disk, so the default 1MB body
    // limit is fine and protects the server from oversized sync payloads.
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });

  registerErrorHandler(app);

  // Permissive CORS by default: a self-hosted reader is expected to be reached
  // from a LAN address, a reverse proxy and possibly a local file origin. There
  // are no cookies in the design, so this does not widen the attack surface to
  // the extent a cookie-based session would.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', request.headers.origin ?? '*');
    reply.header('access-control-allow-headers', 'authorization, content-type');
    reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    reply.header('vary', 'origin');
  });

  app.options('/*', async (_request, reply) => reply.status(204).send());

  registerAuthRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerSyncRoutes(app, ctx);
  // Registered last: it is the catch-all that serves the H5 client, and the API
  // routes above must win. Fastify matches in registration order, so this order
  // is load-bearing rather than stylistic.
  registerWebRoutes(app, ctx);

  return app;
}
