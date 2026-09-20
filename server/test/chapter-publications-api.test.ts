import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../src/config/index.ts';
import { openDatabase } from '../src/db/index.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { UserService } from '../src/services/users.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';
import { TtsService } from '../src/services/tts.ts';
import { BrowseService } from '../src/services/browse.ts';
import { UploadService } from '../src/services/uploads.ts';

interface Session { token: string; id: string }
interface Item { href: string; resourceRef: string; title: string; seq: number }
interface Chapter { id: string; seq: number; title: string; kind: 'chapter'; mediaType: string; ref: string }
interface FixtureState {
  version: string;
  items: Chapter[];
  resources: Record<string, string>;
  failManifest?: boolean;
  resourceMediaType?: string;
}

const PLUGIN_ID = 'reader.source.chapters-test';
const SOURCE_ID = 'test-chapters';
const BOOK_REF = 'same-book-for-every-user';
const auth = (session: Session) => ({ authorization: `Bearer ${session.token}` });
const chapter = (id: string, seq: number, title: string): Chapter => ({ id, seq, title, kind: 'chapter', mediaType: 'text/plain', ref: id });
const initialState = (): FixtureState => ({
  version: '1',
  items: [chapter('first/稳定?#', 0, '第一章'), chapter('second', 1, '第二章'), chapter('third', 2, '第三章')],
  resources: { 'first/稳定?#': '第一章旧正文\n\n<script>alert("literal text")</script>', second: '第二章旧正文', third: '第三章旧正文' },
});

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'reader-chapter-api-'));
  const booksDir = join(root, 'books');
  const dataDir = join(root, 'data');
  await mkdir(booksDir);
  await mkdir(dataDir);
  const config: AppConfig = {
    booksDir, dataDir, host: '127.0.0.1', port: 0, jwtSecret: 'chapter-api-stable-restart-secret',
    accessTokenTtl: 86400, refreshTokenTtl: 86400, scanInterval: 0, watchInterval: 0,
    logLevel: 'silent', publicUrl: '', corsOrigins: [], webDir: join(root, 'no-web'),
  };
  let app: FastifyInstance;
  let ctx: AppContext;
  let active = false;
  async function start() {
    const db = openDatabase(config);
    ctx = { config, db } as AppContext;
    app = buildApp(ctx);
    ctx.log = app.log;
    ctx.scanner = new Scanner(db, config, { info() {}, warn() {} });
    ctx.users = new UserService(db, config);
    ctx.shelf = new ShelfService(db);
    ctx.sync = new SyncService(db, ctx.shelf);
    ctx.tts = new TtsService(config);
    ctx.browse = new BrowseService(db, config, ctx.shelf);
    ctx.uploads = new UploadService(db, config, ctx.browse, ctx.scanner);
    active = true;
    await app.ready();
  }
  async function stop() {
    if (!active) return;
    active = false;
    try { await app.close(); } finally { ctx.db.close(); }
  }
  await start();
  const registration = await app!.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'owner', password: 'password123' } });
  assert.equal(registration.statusCode, 201, registration.body);
  const admin: Session = { token: registration.json().session.accessToken, id: registration.json().user.id };
  return {
    root, booksDir, dataDir, admin,
    get app() { return app; }, get ctx() { return ctx; },
    async member(): Promise<Session> {
      const creation = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: auth(admin), payload: { username: 'reader', password: 'password123' } });
      assert.equal(creation.statusCode, 201, creation.body);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'reader', password: 'password123' } });
      assert.equal(login.statusCode, 200, login.body);
      return { token: login.json().accessToken, id: login.json().user.id };
    },
    async restart() { await stop(); await start(); },
    async close() { await stop(); await rm(root, { recursive: true, force: true }); },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** A real stdio process whose upstream catalogue can change between requests. */
async function installFixture(h: Harness) {
  const directory = join(h.dataDir, 'plugins', 'chapters-test');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'plugin.json'), JSON.stringify({
    id: PLUGIN_ID, name: '章节集成测试', version: '1.0.0', apiVersion: 1, runtime: 'node', entry: 'main.mjs',
    sourceTypes: [{ id: 'chapters-test', label: '章节测试', capabilities: ['browse', 'detail', 'acquire.chapters', 'content.manifest', 'content.resource', 'content.update'] }],
  }));
  await writeFile(join(directory, 'state.json'), JSON.stringify(initialState()));
  await writeFile(join(directory, 'calls.jsonl'), '');
  await writeFile(join(directory, 'main.mjs'), `
import { createInterface } from 'node:readline';
import { appendFile, readFile } from 'node:fs/promises';
const entry = { ref: ${JSON.stringify(BOOK_REF)}, title: '来自插件的章节书', authors: ['测试作者'] };
const methods = {
  validateConfig: () => null,
  browse: () => ({ items: [entry] }),
  detail: () => entry,
  acquire: () => ({ kind: 'chapters', publicationRef: entry.ref }),
  getManifest: async ({ publicationRef }) => {
    const state = JSON.parse(await readFile(new URL('./state.json', import.meta.url), 'utf8'));
    if (state.failManifest) throw Object.assign(new Error('fixture upstream is unavailable'), { code: 'SOURCE_CHANGED' });
    return { publicationRef, version: state.version, items: state.items };
  },
  readResource: async ({ context, request }) => {
    const state = JSON.parse(await readFile(new URL('./state.json', import.meta.url), 'utf8'));
    const text = state.resources[request.ref];
    if (text === undefined) throw Object.assign(new Error('missing fixture chapter'), { code: 'RESOURCE_GONE' });
    return { mediaType: state.resourceMediaType ?? 'text/plain; charset=utf-8', text: text + '\\nreader=' + context.userId };
  },
};
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.method === '$/cancelRequest') continue;
    await appendFile(new URL('./calls.jsonl', import.meta.url), JSON.stringify({ method: request.method, params: request.params }) + '\\n');
    const result = await methods[request.method](request.params);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request?.id, error: { code: error.code ?? 'PLUGIN_ERROR', message: error.message } }) + '\\n');
  }
}
`);
  const installed = await h.app.inject({ method: 'POST', url: '/api/v1/plugins', headers: auth(h.admin), payload: { folder: 'chapters-test', trusted: true } });
  assert.equal(installed.statusCode, 201, installed.body);
  const source = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload: {
    id: SOURCE_ID, pluginId: PLUGIN_ID, sourceType: 'chapters-test', name: '测试章节来源', config: {},
  } });
  assert.equal(source.statusCode, 201, source.body);
  return {
    async state(state: FixtureState) { await writeFile(join(directory, 'state.json'), JSON.stringify(state)); },
    async calls(method: string) {
      return (await readFile(join(directory, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean)
        .map((line) => JSON.parse(line)).filter((call: { method: string }) => call.method === method);
    },
  };
}

async function acquire(h: Harness, session: Session) {
  const response = await h.app.inject({ method: 'POST', url: `/api/v1/sources/${SOURCE_ID}/acquire`, headers: auth(session), payload: { entryRef: BOOK_REF } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().kind, 'ready', response.body);
  const id = response.json().publicationId as string;
  assert.ok(id);
  return id;
}

async function manifest(h: Harness, session: Session, id: string) {
  const response = await h.app.inject({ method: 'GET', url: `/api/v1/books/${id}/manifest?group=all`, headers: auth(session) });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { book: { id: string; title: string; format: string }; files: unknown[]; content: { revision: string }; items: Item[] };
}

function asset(h: Harness, session: Session, id: string, item: Item) {
  return h.app.inject({ method: 'GET', url: `/api/v1/books/${id}/assets?ref=${encodeURIComponent(item.resourceRef)}`, headers: auth(session) });
}

test('chapter acquisition creates a stable private publication and integrates with shelf, reading and progress', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const fixture = await installFixture(h);
  const member = await h.member();
  const id = await acquire(h, member);
  assert.equal(await acquire(h, member), id, 'repeated acquisition has the same book identity');
  const book = await manifest(h, member, id);
  assert.equal(book.book.format, 'chapters');
  assert.equal(book.book.title, '来自插件的章节书');
  assert.deepEqual(book.files, [], 'chapter publications must not advertise invented files');
  assert.equal(book.items.length, 3);
  assert.ok(book.items.every((item) => item.resourceRef && item.href !== item.resourceRef));

  const first = await asset(h, member, id, book.items[0]!);
  assert.equal(first.statusCode, 200, first.body);
  assert.match(first.headers['content-type'] as string, /^text\/plain/);
  assert.equal(first.headers['x-content-type-options'], 'nosniff');
  assert.match(first.headers['content-security-policy'] as string, /sandbox/);
  assert.match(first.body, /<script>alert\("literal text"\)<\/script>/, 'plain text remains text rather than executable HTML');
  assert.ok(first.body.includes(member.id));
  assert.equal((await asset(h, member, id, book.items[0]!)).body, first.body);
  assert.equal((await fixture.calls('readResource')).length, 1, 'already read chapters use the host cache');

  const items = await h.app.inject({ method: 'GET', url: `/api/v1/books/${id}/items`, headers: auth(member) });
  assert.equal(items.statusCode, 200, items.body);
  assert.deepEqual(items.json().items, book.items);
  const toc = await h.app.inject({ method: 'GET', url: `/api/v1/books/${id}/toc`, headers: auth(member) });
  assert.equal(toc.statusCode, 200, toc.body);
  assert.equal(toc.json().revision, book.content.revision);
  assert.deepEqual(toc.json().toc.map((item: Item) => item.href), book.items.map((item) => item.href));
  const wholeFile = await h.app.inject({ method: 'GET', url: `/api/v1/books/${id}/content`, headers: auth(member) });
  assert.equal(wholeFile.statusCode, 400, wholeFile.body);
  assert.equal(wholeFile.json().error.code, 'CHAPTER_BOOK');
  const locatorAsAsset = await h.app.inject({ method: 'GET', url: `/api/v1/books/${id}/assets?ref=${encodeURIComponent(book.items[0]!.href)}`, headers: auth(member) });
  assert.equal(locatorAsAsset.statusCode, 400, locatorAsAsset.body);
  const locator = `r1:0.42:${book.items[1]!.href}`;
  const progress = await h.app.inject({ method: 'PUT', url: `/api/v1/sync/progress/${id}`, headers: auth(member), payload: {
    locator, percentage: 0.42, chapterTitle: book.items[1]!.title, device: 'chapter-test', updatedAt: Date.now(),
  } });
  assert.equal(progress.statusCode, 200, progress.body);
  const continuing = await h.app.inject({ method: 'GET', url: '/api/v1/library/continue', headers: auth(member) });
  assert.ok(continuing.json().items.some((item: { id: string }) => item.id === id), continuing.body);

  for (const suffix of ['', '/manifest', '/items', '/toc', `/assets?ref=${encodeURIComponent(book.items[0]!.resourceRef)}`]) {
    const denied = await h.app.inject({ method: 'GET', url: `/api/v1/books/${id}${suffix}`, headers: auth(h.admin) });
    assert.equal(denied.statusCode, 404, `${suffix}: ${denied.body}`);
  }
  const deniedRefresh = await h.app.inject({ method: 'POST', url: `/api/v1/books/${id}/refresh`, headers: auth(h.admin) });
  assert.equal(deniedRefresh.statusCode, 404, deniedRefresh.body);
  const deniedAdd = await h.app.inject({ method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(h.admin), payload: { bookIds: [id], action: 'add' } });
  assert.equal(deniedAdd.json().applied, 0, deniedAdd.body);
  for (const url of ['/api/v1/books', '/api/v1/books?scope=library', '/api/v1/library/continue']) {
    const response = await h.app.inject({ method: 'GET', url, headers: auth(h.admin) });
    assert.ok(!response.json().items.some((item: { id: string }) => item.id === id), response.body);
  }

  const ownId = await acquire(h, h.admin);
  assert.notEqual(ownId, id, 'account-specific upstream content must have separate publications and caches');
  const own = await manifest(h, h.admin, ownId);
  const ownAsset = await asset(h, h.admin, ownId, own.items[0]!);
  assert.equal(ownAsset.statusCode, 200, ownAsset.body);
  assert.ok(ownAsset.body.includes(h.admin.id));
  assert.ok(!ownAsset.body.includes(member.id));

  const removed = await h.app.inject({ method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(member), payload: { bookIds: [id], action: 'remove' } });
  assert.equal(removed.json().applied, 1, removed.body);
  assert.equal(await acquire(h, member), id, 'reacquiring a hidden publication restores the same shelf entry');
  const restored = await h.app.inject({ method: 'GET', url: `/api/v1/sync/progress/${id}`, headers: auth(member) });
  assert.equal(restored.json().progress.locator, locator);
});

test('chapter refresh preserves stable locators and distinguishes cached and uncached old snapshots', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const fixture = await installFixture(h);
  const id = await acquire(h, h.admin);
  const before = await manifest(h, h.admin, id);
  const oldFirst = await asset(h, h.admin, id, before.items[0]!);
  assert.equal(oldFirst.statusCode, 200, oldFirst.body);
  const locator = `r1:0.65:${before.items[1]!.href}`;
  const progress = await h.app.inject({ method: 'PUT', url: `/api/v1/sync/progress/${id}`, headers: auth(h.admin), payload: {
    locator, percentage: 0.6, chapterTitle: '第二章', device: 'chapter-test', updatedAt: Date.now(),
  } });
  assert.equal(progress.statusCode, 200, progress.body);

  const updated = initialState();
  updated.version = '2';
  updated.items = [chapter('inserted', 0, '新增序章'), ...updated.items.map((item) => ({ ...item, seq: item.seq + 1 }))];
  updated.resources['inserted'] = '新加入的序章';
  updated.resources['first/稳定?#'] = '第一章修订正文';
  updated.resources['second'] = '第二章修订正文';
  await fixture.state(updated);
  const refreshed = await h.app.inject({ method: 'POST', url: `/api/v1/books/${id}/refresh`, headers: auth(h.admin) });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.equal(refreshed.json().total, 4);
  const after = await manifest(h, h.admin, id);
  assert.notEqual(after.content.revision, before.content.revision);
  assert.deepEqual(after.items.slice(1).map((item) => item.href), before.items.map((item) => item.href), 'inserting a chapter does not change any existing chapter locator');
  assert.notEqual(after.items[1]!.resourceRef, before.items[0]!.resourceRef, 'resource references identify the snapshot separately from the locator');
  const retainedProgress = await h.app.inject({ method: 'GET', url: `/api/v1/sync/progress/${id}`, headers: auth(h.admin) });
  assert.equal(retainedProgress.json().progress.locator, locator);
  const changedFirst = await asset(h, h.admin, id, after.items[1]!);
  assert.equal(changedFirst.statusCode, 200, changedFirst.body);
  assert.match(changedFirst.body, /修订正文/);
  assert.equal((await asset(h, h.admin, id, before.items[0]!)).body, oldFirst.body, 'cached old snapshot keeps its original bytes');
  const readCalls = (await fixture.calls('readResource')).length;
  const expired = await asset(h, h.admin, id, before.items[1]!);
  assert.equal(expired.statusCode, 409, expired.body);
  assert.equal(expired.json().error.code, 'CHAPTER_SNAPSHOT_EXPIRED');
  assert.equal((await fixture.calls('readResource')).length, readCalls, 'uncached stale references do not fetch current upstream bytes');

  await fixture.state({ ...updated, failManifest: true });
  const failed = await h.app.inject({ method: 'POST', url: `/api/v1/books/${id}/refresh`, headers: auth(h.admin) });
  assert.ok(failed.statusCode >= 400, failed.body);
  const retained = await manifest(h, h.admin, id);
  assert.deepEqual(retained.items, after.items, 'refresh failure leaves the last valid directory intact');
  assert.equal(retained.content.revision, after.content.revision);
  assert.equal((await asset(h, h.admin, id, after.items[1]!)).body, changedFirst.body);
  await fixture.state(updated);
  const unchanged = await h.app.inject({ method: 'POST', url: `/api/v1/books/${id}/refresh`, headers: auth(h.admin) });
  assert.equal(unchanged.statusCode, 200, unchanged.body);
  assert.equal(unchanged.json().revision, after.content.revision, 'the same directory keeps the same snapshot identity');
  assert.equal((await asset(h, h.admin, id, after.items[1]!)).body, changedFirst.body);
});

test('cached chapters remain readable after plugin disable, uninstall, scan and server restart', async (t) => {
  const h = await harness(); t.after(() => h.close());
  await installFixture(h);
  const member = await h.member();
  const id = await acquire(h, member);
  const before = await manifest(h, member, id);
  const first = await asset(h, member, id, before.items[0]!);
  assert.equal(first.statusCode, 200, first.body);
  const disabled = await h.app.inject({ method: 'PATCH', url: `/api/v1/plugins/${PLUGIN_ID}`, headers: auth(h.admin), payload: { enabled: false } });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal((await asset(h, member, id, before.items[0]!)).body, first.body);
  const unavailable = await asset(h, member, id, before.items[1]!);
  assert.ok(unavailable.statusCode >= 400, unavailable.body);
  assert.equal(unavailable.json().error.code, 'PLUGIN_UNAVAILABLE');
  await h.ctx.scanner.scan();
  await h.restart();
  const retained = await manifest(h, member, id);
  assert.deepEqual(retained.items, before.items);
  const afterRestart = await asset(h, member, id, retained.items[0]!);
  assert.equal(afterRestart.statusCode, 200, afterRestart.body);
  assert.equal(afterRestart.body, first.body);
  const shelf = await h.app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(member) });
  assert.ok(shelf.json().items.some((book: { id: string }) => book.id === id), shelf.body);
  const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/plugins/${PLUGIN_ID}`, headers: auth(h.admin) });
  assert.equal(removed.statusCode, 200, removed.body);
  await h.ctx.scanner.scan();
  await h.restart();
  assert.equal((await asset(h, member, id, before.items[0]!)).body, first.body);
  assert.equal((await manifest(h, member, id)).book.id, id);
});

test('chapter reading rejects executable upstream resources without replacing already cached content', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const fixture = await installFixture(h);
  const id = await acquire(h, h.admin);
  const book = await manifest(h, h.admin, id);
  const first = await asset(h, h.admin, id, book.items[0]!);
  assert.equal(first.statusCode, 200, first.body);
  await fixture.state({ ...initialState(), resourceMediaType: 'text/html' });
  const rejected = await asset(h, h.admin, id, book.items[1]!);
  assert.ok(rejected.statusCode >= 400, rejected.body);
  assert.doesNotMatch(rejected.headers['content-type'] as string, /^text\/html/);
  assert.equal((await asset(h, h.admin, id, book.items[0]!)).body, first.body);
});
