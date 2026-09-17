/**
 * HTTP TTS tests.
 *
 * The proxy has two failure modes that are worse than an error, and both are
 * asserted here:
 *
 *  - **Silence with a 200.** A misconfigured `TTS_URL` (a wrong host landing on
 *    a web page) answers `text/html` with a status of 200. Streaming that into an
 *    `<audio>` element plays nothing and reports nothing, so the proxy refuses any
 *    content type that is not audio.
 *  - **An open relay.** `TTS_URL` is a URL the *server* holds, so a client must
 *    never be able to point the request somewhere else, and the route must be
 *    authenticated so a stray instance cannot spend someone else's quota.
 *
 * A stub upstream is used rather than a real service: the contract being tested
 * is *this* proxy's behaviour, and a network dependency in a unit test is a test
 * that fails on a train.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../src/config/index.ts';
import { openDatabase } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { UserService } from '../src/services/users.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';
import { TtsService } from '../src/services/tts.ts';
import { BrowseService } from '../src/services/browse.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';

let root: string;
let app: FastifyInstance;
let ctx: AppContext;
let token = '';
let upstream: Server | null = null;
let upstreamUrl = '';
/** What the stub upstream should answer with on the next call. */
let upstreamBehaviour: 'audio' | 'html' | 'error' = 'audio';
let lastUpstreamQuery = '';

/** Minimal stand-in for an edge-tts-compatible service. */
function startUpstream(): Promise<void> {
  return new Promise((resolve) => {
    upstream = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      lastUpstreamQuery = url.search;
      if (url.pathname === '/voices') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', lang: 'zh-CN' }]));
        return;
      }
      if (upstreamBehaviour === 'html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body>not audio</body></html>');
        return;
      }
      if (upstreamBehaviour === 'error') {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('bad gateway');
        return;
      }
      // A recognisable, deterministic body: the tests assert the bytes came from
      // upstream rather than being invented here.
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(Buffer.from(`AUDIO:${url.searchParams.get('text') ?? ''}`));
    });
    upstream.listen(0, '127.0.0.1', () => {
      const address = upstream!.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      upstreamUrl = `http://127.0.0.1:${port}/tts`;
      // Same origin, different path: the convention the docs describe, made
      // explicit because a proxy that *guesses* the voice path is a proxy that
      // asks a stranger's server for a URL nobody configured.
      process.env.TTS_VOICES_URL = `http://127.0.0.1:${port}/voices`;
      resolve();
    });
  });
}

async function buildInstance(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config);
  ctx = {
    config,
    db,
    scanner: undefined as never,
    users: undefined as never,
    shelf: undefined as never,
    sync: undefined as never,
    tts: undefined as never,
    browse: undefined as never,
    log: undefined as never,
  };
  const silent = Fastify({ logger: false });
  ctx.log = silent.log;
  ctx.scanner = new Scanner(db, config, { info: () => {}, warn: () => {} });
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  ctx.sync = new SyncService(db);
  ctx.tts = new TtsService(config);
  ctx.browse = new BrowseService(db, config);
  app = buildApp(ctx);
  await app.ready();
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-tts-test-'));
  process.env.BOOKS_DIR = join(root, 'books');
  process.env.DATA_DIR = join(root, 'data');
  process.env.SCAN_INTERVAL = '0';
  process.env.WATCH_INTERVAL = '0';
  process.env.READER_TOKEN_SECRET = 'test-secret-that-is-long-enough';
  process.env.TTS_CACHE_BYTES = '0';
  await startUpstream();
});

after(async () => {
  await app?.close();
  await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

/** Rebuilds the instance so the environment (`TTS_URL`) is read fresh. */
beforeEach(async () => {
  await app?.close();
  await buildInstance();
  if (!token) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'tts-user', password: 'password123' },
    });
    assert.equal(res.statusCode, 201, res.body);
    token = (res.json() as { session: { accessToken: string } }).session.accessToken;
  }
});

test('an instance with no TTS_URL reports http:false rather than 404', async () => {
  delete process.env.TTS_URL;
  await app.close();
  await buildInstance();

  const res = await app.inject({ method: 'GET', url: '/api/v1/tts/voices', headers: auth() });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { http: boolean; maxLength: number };
  assert.equal(body.http, false);
  // The ceiling is advertised whether or not the proxy is on: the client splits
  // sentences against it before deciding which engine to use.
  assert.equal(body.maxLength, 800);
});

test('synthesis is refused with a clear error when TTS_URL is unset', async () => {
  delete process.env.TTS_URL;
  await app.close();
  await buildInstance();

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tts?text=${encodeURIComponent('你好')}&access_token=${token}`,
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'TTS_DISABLED');
});

test('a sentence is proxied to the upstream service and streamed back as audio', async () => {
  process.env.TTS_URL = upstreamUrl;
  await app.close();
  await buildInstance();
  upstreamBehaviour = 'audio';

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tts?text=${encodeURIComponent('床前明月光。')}&speed=1.2&access_token=${token}`,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['content-type'], 'audio/mpeg');
  assert.equal(res.body, 'AUDIO:床前明月光。');
  // The query is built with `URLSearchParams`, so a Chinese sentence survives the
  // trip; a hand-built URL would have sent mojibake.
  assert.match(lastUpstreamQuery, /text=%E5%BA%8A%E5%89%8D%E6%98%8E%E6%9C%88%E5%85%89/);
  assert.match(lastUpstreamQuery, /speed=1\.2/);
});

test('an upstream that answers HTML is refused instead of served as silence', async () => {
  process.env.TTS_URL = upstreamUrl;
  await app.close();
  await buildInstance();
  upstreamBehaviour = 'html';

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tts?text=hello&access_token=${token}`,
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'TTS_UPSTREAM');
});

test('an upstream error is reported as such, not as a 200', async () => {
  process.env.TTS_URL = upstreamUrl;
  await app.close();
  await buildInstance();
  upstreamBehaviour = 'error';

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tts?text=hello&access_token=${token}`,
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'TTS_UPSTREAM');
});

test('an over-long utterance is refused before it reaches the upstream', async () => {
  process.env.TTS_URL = upstreamUrl;
  await app.close();
  await buildInstance();
  upstreamBehaviour = 'audio';
  lastUpstreamQuery = '';

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tts?text=${encodeURIComponent('长'.repeat(900))}&access_token=${token}`,
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'TEXT_TOO_LONG');
  assert.equal(lastUpstreamQuery, '', 'the upstream must not be called at all');
});

test('the voice list is passed through from the upstream service', async () => {
  process.env.TTS_URL = upstreamUrl;
  await app.close();
  await buildInstance();

  const res = await app.inject({ method: 'GET', url: '/api/v1/tts/voices', headers: auth() });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { http: boolean; voices: Array<{ id: string; lang: string }> };
  assert.equal(body.http, true);
  assert.deepEqual(body.voices, [{ id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', lang: 'zh-CN' }]);
});

test('the audio route requires a token, in the header or the query', async () => {
  process.env.TTS_URL = upstreamUrl;
  await app.close();
  await buildInstance();

  const anonymous = await app.inject({ method: 'GET', url: '/api/v1/tts?text=hello' });
  assert.equal(anonymous.statusCode, 401);

  // A query token is allowed on this route only because an `<audio src>` cannot
  // carry a header. Anything else must use the header.
  const viaQuery = await app.inject({ method: 'GET', url: `/api/v1/tts?text=hello&access_token=${token}` });
  assert.equal(viaQuery.statusCode, 200);

  const viaHeader = await app.inject({ method: 'GET', url: '/api/v1/tts?text=hello', headers: auth() });
  assert.equal(viaHeader.statusCode, 200);

  // The capability route is an API call, so a query token is not accepted there.
  const capabilityWithQuery = await app.inject({
    method: 'GET',
    url: `/api/v1/tts/voices?access_token=${token}`,
  });
  assert.equal(capabilityWithQuery.statusCode, 401);
});

function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
