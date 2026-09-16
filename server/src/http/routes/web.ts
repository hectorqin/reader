import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.ts';

/**
 * Serves the built H5 client, when one is present.
 *
 * Why the server hosts it at all: the product's deployment constraint is "one
 * command and it runs" (§8.1), and telling a NAS owner to stand up a second
 * container for the web client would break that. If the bundle is absent the
 * routes are simply not registered, so a server-only deployment is unaffected.
 *
 * Everything here is unauthenticated on purpose: these are static assets. The
 * API behind them still requires a token, so serving the shell to an anonymous
 * request reveals nothing. It does mean the *existence* of an instance is
 * visible to anyone who can reach the port — which is already true of
 * `GET /api/v1/instance`.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function registerWebRoutes(app: FastifyInstance, ctx: AppContext): void {
  const webDir = ctx.config.webDir;
  const indexFile = join(webDir, 'index.html');
  if (!existsSync(indexFile)) {
    ctx.log?.info?.({ webDir }, 'no web client bundle found, serving API only');
    return;
  }

  const sendFile = (filePath: string, reply: FastifyReply): FastifyReply => {
    reply.header('content-type', MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(filePath));
  };

  app.get('/', async (_request, reply) => sendFile(indexFile, reply));

  app.get('/*', async (request, reply) => {
    const raw = (request.params as { '*': string })['*'] ?? '';
    // Resolve under webDir and refuse anything that escapes it: `..%2f..%2f`
    // would otherwise turn the static handler into an arbitrary file read.
    const candidate = resolve(webDir, normalize(raw).replace(/^(\.\.[/\\])+/, ''));
    if (candidate !== webDir && !candidate.startsWith(`${webDir}${sep}`)) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
      return;
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      // Hashed-ish asset names change with each build, and the API promises
      // additive changes only, so a client can hold a bundle across server
      // upgrades without harm. `index.html` itself must never be cached or a
      // deployment would never pick up a new bundle.
      if (extname(candidate) !== '.html') {
        reply.header('cache-control', 'public, max-age=3600');
      } else {
        reply.header('cache-control', 'no-cache');
      }
      return sendFile(candidate, reply);
    }

    // SPA fallback: the client routes by hash, but serving index.html for an
    // unknown path is the safer default than a 404 for a deep link.
    reply.header('cache-control', 'no-cache');
    return sendFile(indexFile, reply);
  });
}
