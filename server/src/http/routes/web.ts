import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AppContext } from '../context.ts';

/**
 * The H5 client, served by the same process as the API.
 *
 * This is what makes 「H5 是一个完整的客户端」 actually true rather than a claim in
 * a README: the server the user just started with `docker compose up` also serves
 * a complete reading client at `/`. There is no second deployment, no CORS
 * configuration, no separate static host to keep in sync, and no app store.
 *
 * The build is looked up in two places, in order:
 *
 *  1. `WEB_DIR` / `server/public` — a build copied in by the Docker image.
 *  2. `web/dist` — a developer's `npm run build` in the sibling directory.
 *
 * The second exists so `npm run dev` in `server/` and `vite build` in `web/` work
 * together without a copy step, which is what keeps the iteration loop short
 * enough that client work actually happens.
 *
 * If neither exists, the server does not fail. It serves a page that says so and
 * points at the API documentation. A self-hosted server that refuses to start
 * because a frontend bundle is missing would be a worse failure than one that
 * boots and explains itself — the API is genuinely usable on its own, and several
 * clients (the Android shell among them) never load this bundle at all.
 */

/** Where a built client may live, most specific first. */
function webRoots(config: AppContext['config']): string[] {
  const roots: string[] = [];
  if (process.env.WEB_DIR) roots.push(resolve(process.env.WEB_DIR));
  roots.push(resolve(process.cwd(), 'public'));
  roots.push(resolve(process.cwd(), 'web/dist'));
  roots.push(resolve(process.cwd(), '../web/dist'));
  void config;
  return roots;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function registerWebRoutes(app: FastifyInstance, ctx: AppContext): void {
  const roots = webRoots(ctx.config);
  const build = roots.find((root) => existsSync(join(root, 'index.html'))) ?? null;

  if (build) {
    app.log.info({ webRoot: build }, 'serving H5 client');
  } else {
    app.log.warn({ searched: roots }, 'no H5 build found; serving API-only landing page');
  }

  /**
   * Everything that is not the API.
   *
   * Registered as a catch-all rather than as a static directory because the
   * client is a single-page app: a request for `/books/abc` that is not a file
   * must return `index.html`, not a 404. The API prefix is excluded explicitly so
   * an unknown endpoint still gets the API's own JSON 404 instead of an HTML
   * page that a client would fail to parse.
   */
  app.get('/*', async (request, reply) => {
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    if (path.startsWith('/api/')) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `no route for GET ${request.url}` },
      });
    }

    if (!build) {
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .send(landingPage(roots));
    }

    // `normalize` collapses `..` before the prefix check; comparing the resolved
    // path against the root afterwards is what keeps a traversal attempt from
    // reading a file outside the build.
    const relative = normalize(path).replace(/^([/\\])+/, '');
    const candidate = resolve(build, relative);
    if (candidate.startsWith(build + sep) && isFile(candidate)) {
      const body = createReadStream(candidate);
      reply.header('content-type', CONTENT_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream');
      // Hashed asset names are immutable; `index.html` must not be, or a client
      // keeps loading a bundle that was replaced by an upgrade.
      reply.header(
        'cache-control',
        relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      // The stream must be the handler's RETURN value, not a `reply.send()`
      // followed by a bare `return`. The latter makes Fastify send the response
      // twice: the second send is empty, so every asset arrives as a 200 with
      // `content-length: 0` and the client parses nothing. It fails silently —
      // the log line is "stream closed prematurely" and the page just stays
      // blank, which is a genuinely confusing way to lose an afternoon.
      return reply.send(body);
    }

    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('cache-control', 'no-cache');
    return reply.send(readFileSync(join(build, 'index.html')));
  });
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * What a user sees when the server has no bundled client.
 *
 * Written for the person who just ran `docker compose up` and opened the port:
 * it says the server works, says where the API is, and says how to get a client.
 * An empty page or a stack trace would be the difference between "it's working"
 * and "it's broken" for someone who has not read the README yet.
 */
function landingPage(searched: string[]): string {
  const paths = searched.map((path) => `<code>${escapeHtml(path)}</code>`).join('、');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>书库服务端</title>
<style>
  body { font-family: system-ui, -apple-system, 'Noto Sans SC', sans-serif; line-height: 1.7;
         max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #1f2328; }
  code { background: #f3f4f6; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
  h1 { font-size: 1.4rem; }
  .ok { color: #15803d; }
</style>
</head>
<body>
<h1>服务端在运行 <span class="ok">✓</span></h1>
<p>这个实例的 API 可用，但没有找到 H5 客户端构建产物。</p>
<p>已查找的位置：${paths}</p>
<p>要自己构建：<code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code>，
然后重启服务端，或者用 <code>WEB_DIR</code> 指向构建目录。</p>
<p>只用 API 的话，端点清单在 <code>docs/api.md</code>，健康检查在
<a href="/api/v1/health"><code>/api/v1/health</code></a>。</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}
