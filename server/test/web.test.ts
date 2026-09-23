/**
 * H5 hosting tests.
 *
 * Two things here are security-relevant rather than cosmetic: the static handler
 * is a catch-all, so a path traversal would expose the whole filesystem, and the
 * API prefix has to keep answering with JSON so a client never has to parse HTML.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerWebRoutes } from '../src/http/routes/web.ts';
import type { AppContext } from '../src/http/context.ts';

let root: string;
let app: FastifyInstance;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'web-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>reader</title>');
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'assets', 'client.js'), 'console.log(2)');
  await writeFile(join(root, 'sw.js'), 'self.addEventListener("install", () => {})');
  await writeFile(join(root, 'manifest.webmanifest'), '{"name":"reader"}');
  // A file one level above the build, to prove traversal is refused.
  await writeFile(join(root, '..', `secret-${process.pid}.txt`), 'do not serve me');

  process.env.WEB_DIR = root;
  app = Fastify();
  registerWebRoutes(app, {} as AppContext);
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(join(root, '..', `secret-${process.pid}.txt`), { force: true });
  await rm(root, { recursive: true, force: true });
  delete process.env.WEB_DIR;
});

describe('static client hosting', () => {
  test('the root serves the client', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
    assert.match(res.body, /reader/);
    // Not cached: a client holding a stale index.html keeps loading a bundle an
    // upgrade already replaced.
    assert.equal(res.headers['cache-control'], 'no-cache');
  });

  test('hashed assets are cached forever', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /javascript/);
    assert.match(res.headers['cache-control'] as string, /immutable/);
  });

  test('fixed-name bundles and PWA metadata must revalidate after deployment', async () => {
    for (const url of ['/assets/client.js', '/sw.js', '/manifest.webmanifest']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'no-cache');
    }
    const worker = await app.inject({ method: 'GET', url: '/sw.js' });
    assert.match(worker.headers['content-type'] as string, /javascript/);
    const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    assert.match(manifest.headers['content-type'] as string, /application\/manifest\+json/);
  });

test('an asset is served with its real bytes, not an empty second send', async () => {
    // This was a 200 with `content-length: 0` for every asset. The cause was a
    // `reply.send(stream)` followed by a bare `return` in an async handler:
    // Fastify sends the response twice, the second send is empty, and the
    // client's module never loads — a blank page with no error anywhere except
    // a "stream closed prematurely" log line.
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.rawPayload.byteLength > 0, 'a streamed asset must not be empty');
    assert.equal(res.body, 'console.log(1)');
  });

  test('index.html is served with its real bytes', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.rawPayload.byteLength > 0);
    assert.match(res.body, /<title>reader<\/title>/);
  });

  test('a client-side route falls back to index.html instead of 404', async () => {
    // A single-page app's deep links are not files; returning 404 would break a
    // reload on any screen but the shelf.
    const res = await app.inject({ method: 'GET', url: '/books/abc123' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
  });

  test('an unknown API path still answers with JSON', async () => {
    // The catch-all must not swallow the API's own 404 shape, or a client that
    // parses `error.code` gets an HTML page and reports "server broken".
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'NOT_FOUND');
  });

  test('path traversal is refused', async () => {
    const res = await app.inject({ method: 'GET', url: `/../secret-${process.pid}.txt` });
    const leaked = res.body.includes('do not serve me');
    assert.equal(leaked, false, 'a traversal must never read outside the build');
  });

  test('an encoded traversal is refused too', async () => {
    const res = await app.inject({ method: 'GET', url: `/%2e%2e/secret-${process.pid}.txt` });
    assert.equal(res.body.includes('do not serve me'), false);
  });
});
