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
  // WEB_DIR is read from the environment when the context was built without a
  // resolved config (tests, embedding), because the bundle location is a
  // deployment concern rather than application state.
  const webDir = ctx.config?.webDir ?? resolve(process.env.WEB_DIR ?? join(process.cwd(), 'web'));
  const indexFile = join(webDir, 'index.html');
  if (!existsSync(indexFile)) {
    ctx.log?.info?.({ webDir }, 'no web client bundle found, serving API only');
    return;
  }

  const sendFile = (filePath: string, reply: FastifyReply, cacheControl: string): FastifyReply => {
    reply.header('content-type', MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream');
    reply.header('cache-control', cacheControl);
    // A bundle served from disk can never change under the same name unless a
    // deployment replaced it, and the file handle is released when the response
    // ends — so a stream is safe here, but it must be handed to `send` exactly
    // once. An earlier version sent the stream and then returned nothing from an
    // async handler, which made Fastify send a second, empty response.
    return reply.send(createReadStream(filePath));
  };

  app.get('/', async (_request, reply) => sendFile(indexFile, reply, 'no-cache'));

  app.get('/*', async (request, reply) => {
    const raw = (request.params as { '*': string })['*'] ?? '';
    // The API keeps its own 404 shape. Without this the catch-all SPA fallback
    // swallows `/api/...` misses and answers with HTML, so a client that parses
    // `error.code` reports "server broken" instead of "not found".
    if (raw === 'api' || raw.startsWith('api/')) {
      reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `no route for ${request.method} ${request.url}` },
      });
      return;
    }
    // Resolve under webDir and refuse anything that escapes it: `..%2f..%2f`
    // would otherwise turn the static handler into an arbitrary file read.
    const candidate = resolve(webDir, normalize(raw).replace(/^(\.\.[/\\])+/, ''));
    if (candidate !== webDir && !candidate.startsWith(`${webDir}${sep}`)) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
      return;
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      // The Android-compatible build uses fixed names (client.js, sw.js, etc.).
      // Only explicitly fingerprinted assets can safely be cached forever.
      const immutable = raw.startsWith('assets/') && /-[a-zA-Z0-9_-]{6,}\.[^.]+$/.test(raw);
      return sendFile(
        candidate,
        reply,
        immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    }

    // SPA fallback: the client routes by hash, but serving index.html for an
    // unknown path is the safer default than a 404 for a deep link.
    return sendFile(indexFile, reply, 'no-cache');
  });
}
