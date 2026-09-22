import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
import type { CatalogPage, SourceProvider } from '../src/sources/types.ts';

interface Session { token: string; id: string }

function auth(session: Session) { return { authorization: `Bearer ${session.token}` }; }

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'reader-sources-api-'));
  const booksDir = join(root, 'books');
  const dataDir = join(root, 'data');
  await mkdir(booksDir);
  await mkdir(dataDir);
  const config: AppConfig = {
    booksDir, dataDir, host: '127.0.0.1', port: 0, jwtSecret: 'sources-api-test-secret-stable-across-restarts',
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
  const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'owner', password: 'password123' } });
  assert.equal(response.statusCode, 201, response.body);
  const created = response.json();
  const admin: Session = { token: created.session.accessToken, id: created.user.id };
  return {
    root, booksDir, dataDir, admin,
    get app() { return app; }, get ctx() { return ctx; },
    async member(): Promise<Session> {
      const create = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: auth(admin), payload: { username: 'reader', password: 'password123' } });
      assert.equal(create.statusCode, 201, create.body);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'reader', password: 'password123' } });
      assert.equal(login.statusCode, 200, login.body);
      return { token: login.json().accessToken, id: login.json().user.id };
    },
    async restart() { await stop(); await start(); },
    async close() { await stop(); await rm(root, { recursive: true, force: true }); },
  };
}

test('source editing validates configuration, clears destination credentials and keeps acquired sources', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const member = await h.member();
  const create = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload: {
    id: 'editable', pluginId: 'reader.opds', sourceType: 'opds', name: 'Before', config: { url: 'https://one.test/opds' },
  } });
  assert.equal(create.statusCode, 201, create.body);
  await h.app.inject({ method: 'PUT', url: '/api/v1/sources/editable/credentials/password', headers: auth(member), payload: { value: 'private' } });
  const forbidden = await h.app.inject({ method: 'PATCH', url: '/api/v1/sources/editable', headers: auth(member), payload: { name: 'bad' } });
  assert.equal(forbidden.statusCode, 403);
  const edited = await h.app.inject({ method: 'PATCH', url: '/api/v1/sources/editable', headers: auth(h.admin), payload: { name: 'After', config: { url: 'https://two.test/opds' } } });
  assert.equal(edited.statusCode, 200, edited.body); assert.equal(edited.json().source.name, 'After');
  assert.equal(h.ctx.db.get<{ count: number }>('SELECT count(*) AS count FROM source_credentials WHERE source_id = ?', 'editable')!.count, 0);
  const invalid = await h.app.inject({ method: 'PATCH', url: '/api/v1/sources/editable', headers: auth(h.admin), payload: { config: { url: 'file:///secret' } } });
  assert.equal(invalid.statusCode, 400);
  const removed = await h.app.inject({ method: 'DELETE', url: '/api/v1/sources/editable', headers: auth(h.admin) });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal((await h.app.inject({ method: 'DELETE', url: '/api/v1/sources/local', headers: auth(h.admin) })).statusCode, 400);
});

async function opdsFixture() {
  const body = '第一章 远程下载\n\n这是经 OPDS 获取的本地可读正文。\n\n第二章 继续阅读\n\n下载后继续复用现有书架和阅读进度。';
  let downloads = 0;
  const server = createServer((request, response) => {
    if (request.url === '/catalog') {
      response.setHeader('content-type', 'application/opds+json');
      response.end(JSON.stringify({
        metadata: { title: 'Test OPDS' },
        publications: [{
          metadata: { identifier: 'urn:reader:test:opds-txt', title: 'OPDS 集成测试书', author: [{ name: '测试作者' }] },
          links: [{ rel: 'http://opds-spec.org/acquisition/open-access', href: '/download/book.txt', type: 'text/plain' }],
        }],
      }));
    } else if (request.url === '/download/book.txt') {
      downloads += 1;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(body);
    } else {
      response.statusCode = 404; response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}/catalog`, body,
    get downloads() { return downloads; },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    },
  };
}

test('built-in source discovery and administrative boundaries preserve configuration and credentials', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const member = await h.member();
  const types = await h.app.inject({ method: 'GET', url: '/api/v1/sources/types', headers: auth(member) });
  assert.equal(types.statusCode, 200, types.body);
  assert.deepEqual(types.json().types.map((type: { id: string }) => type.id).sort(), ['local', 'opds']);
  assert.deepEqual(types.json().types.map((type: { id: string; pluginId: string; builtin: boolean }) =>
    ({ id: type.id, pluginId: type.pluginId, builtin: type.builtin })), [
    { id: 'local', pluginId: 'reader.local', builtin: true },
    { id: 'opds', pluginId: 'reader.opds', builtin: true },
  ]);
  assert.ok(h.ctx.sources, 'buildApp initializes the source host');
  const payload = { id: 'secured-opds', pluginId: 'reader.opds', sourceType: 'opds', name: 'OPDS', config: { url: 'http://127.0.0.1:9999/catalog', username: 'private-config-user' } };
  const deniedCreate = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(member), payload });
  assert.equal(deniedCreate.statusCode, 403, deniedCreate.body);
  const deniedInstall = await h.app.inject({ method: 'POST', url: '/api/v1/plugins', headers: auth(member), payload: { folder: 'demo-chapters', trusted: true } });
  assert.equal(deniedInstall.statusCode, 403, deniedInstall.body);
  const deniedList = await h.app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(member) });
  assert.equal(deniedList.statusCode, 403, deniedList.body);
  const noAuth = await h.app.inject({ method: 'GET', url: '/api/v1/sources' });
  assert.equal(noAuth.statusCode, 401, noAuth.body);

  const created = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload });
  assert.equal(created.statusCode, 201, created.body);
  const password = 'source-password-not-in-a-dto';
  const credential = await h.app.inject({ method: 'PUT', url: '/api/v1/sources/secured-opds/credentials/password', headers: auth(member), payload: { value: password } });
  assert.equal(credential.statusCode, 200, credential.body);
  const stored = h.ctx.db.get<{ encrypted_value: string }>('SELECT encrypted_value FROM source_credentials WHERE source_id = ? AND user_id = ?', 'secured-opds', member.id);
  assert.ok(stored?.encrypted_value);
  assert.ok(!stored.encrypted_value.includes(password));
  const publicSources = await h.app.inject({ method: 'GET', url: '/api/v1/sources', headers: auth(member) });
  assert.equal(publicSources.statusCode, 200, publicSources.body);
  assert.equal(publicSources.json().sources.find((source: { id: string }) => source.id === 'secured-opds').config, undefined);
  assert.ok(!publicSources.body.includes('private-config-user'));
  assert.ok(!publicSources.body.includes(password));
  const adminSources = await h.app.inject({ method: 'GET', url: '/api/v1/sources', headers: auth(h.admin) });
  assert.equal(adminSources.statusCode, 200, adminSources.body);
  assert.equal(adminSources.json().sources.find((source: { id: string }) => source.id === 'secured-opds').config.username, 'private-config-user');
  assert.ok(!adminSources.body.includes(password));
  const inlinePassword = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload: { ...payload, id: 'bad-password', config: { ...payload.config, password } } });
  assert.equal(inlinePassword.statusCode, 400, inlinePassword.body);
});

test('source query validation rejects repeated text parameters and invalid page limits', async (t) => {
  const h = await harness(); t.after(() => h.close());
  for (const query of ['limit=0', 'limit=-1', 'limit=201', 'limit=1.5', 'limit=NaN', 'limit=10&limit=20']) {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/sources/local/browse?${query}`, headers: auth(h.admin) });
    assert.equal(response.statusCode, 400, `${query}: ${response.body}`);
  }
  for (const query of ['q=first&q=second', 'q=', 'q=valid&cursor=one&cursor=two']) {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/sources/local/search?${query}`, headers: auth(h.admin) });
    assert.equal(response.statusCode, 400, `${query}: ${response.body}`);
  }
});

test('local source acquisition restores the existing publication to the requesting users shelf', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const member = await h.member();
  await writeFile(join(h.booksDir, '本地书.txt'), '第一章\n\n本地来源沿用既有内容和身份。');
  await h.ctx.scanner.scan();
  const browse = await h.app.inject({ method: 'GET', url: '/api/v1/sources/local/browse', headers: auth(member) });
  assert.equal(browse.statusCode, 200, browse.body);
  const entry = browse.json().items.find((item: { title: string }) => item.title === '本地书');
  assert.ok(entry, browse.body);
  h.ctx.db.run('UPDATE user_books SET hidden = 1 WHERE user_id = ? AND book_id = ?', member.id, entry.ref);
  const acquired = await h.app.inject({ method: 'POST', url: '/api/v1/sources/local/acquire', headers: auth(member), payload: { entryRef: entry.ref, optionId: 'read' } });
  assert.equal(acquired.statusCode, 200, acquired.body);
  assert.deepEqual(acquired.json(), { kind: 'ready', publicationId: entry.ref });
  const shelf = await h.app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(member) });
  assert.ok(shelf.json().items.some((book: { id: string }) => book.id === entry.ref), shelf.body);
  const content = await h.app.inject({ method: 'GET', url: `/api/v1/books/${entry.ref}/content`, headers: auth(member) });
  assert.equal(content.statusCode, 200, content.body);
  assert.match(content.body, /既有内容和身份/);
});

test('OPDS acquisition feeds existing reading, shelf and progress APIs and survives source disable and restart', async (t) => {
  const h = await harness(); t.after(() => h.close());
  const catalog = await opdsFixture(); t.after(() => catalog.close());
  const member = await h.member();
  const source = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload: {
    id: 'test-opds', pluginId: 'reader.opds', sourceType: 'opds', name: 'Test OPDS', config: { url: catalog.url },
  } });
  assert.equal(source.statusCode, 201, source.body);
  const browse = await h.app.inject({ method: 'GET', url: '/api/v1/sources/test-opds/browse', headers: auth(member) });
  assert.equal(browse.statusCode, 200, browse.body);
  const entry = browse.json().items[0];
  assert.equal(entry.title, 'OPDS 集成测试书');
  const request = { entryRef: entry.ref, optionId: entry.options[0].id };
  const acquired = await h.app.inject({ method: 'POST', url: '/api/v1/sources/test-opds/acquire', headers: auth(member), payload: request });
  assert.equal(acquired.statusCode, 200, acquired.body);
  const { publicationId: bookId, kind } = acquired.json();
  assert.equal(kind, 'ready');
  assert.ok(bookId);
  assert.equal(catalog.downloads, 1);
  const originalFiles = (await readdir(join(h.dataDir, 'acquired'))).sort();
  assert.equal(originalFiles.length, 1);
  const repeated = await h.app.inject({ method: 'POST', url: '/api/v1/sources/test-opds/acquire', headers: auth(member), payload: request });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().publicationId, bookId);
  assert.equal(catalog.downloads, 1, 'repeated acquisition reuses the imported file');
  assert.deepEqual((await readdir(join(h.dataDir, 'acquired'))).sort(), originalFiles, 'repeated acquisition creates no additional files');

  const otherShelf = await h.app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(h.admin) });
  assert.ok(!otherShelf.json().items.some((book: { id: string }) => book.id === bookId), otherShelf.body);
  const otherContent = await h.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/content`, headers: auth(h.admin) });
  assert.equal(otherContent.statusCode, 404, otherContent.body);
  const unauthorizedAdd = await h.app.inject({ method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(h.admin), payload: { bookIds: [bookId], action: 'add' } });
  assert.equal(unauthorizedAdd.statusCode, 200, unauthorizedAdd.body);
  assert.equal(unauthorizedAdd.json().applied, 0);
  assert.deepEqual(unauthorizedAdd.json().failed, [{ path: bookId, reason: 'NO_LIVE_FILE' }]);
  const stillForbidden = await h.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/content`, headers: auth(h.admin) });
  assert.equal(stillForbidden.statusCode, 404, stillForbidden.body);

  const removedFromShelf = await h.app.inject({ method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(member), payload: { bookIds: [bookId], action: 'remove' } });
  assert.equal(removedFromShelf.statusCode, 200, removedFromShelf.body);
  assert.equal(removedFromShelf.json().applied, 1, removedFromShelf.body);
  assert.deepEqual(removedFromShelf.json().failed, []);
  const hiddenShelf = await h.app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(member) });
  assert.ok(!hiddenShelf.json().items.some((book: { id: string }) => book.id === bookId), hiddenShelf.body);
  const restored = await h.app.inject({ method: 'POST', url: '/api/v1/sources/test-opds/acquire', headers: auth(member), payload: request });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().publicationId, bookId);
  assert.equal(catalog.downloads, 1, 'restoring a book to the shelf reuses the existing download');
  assert.deepEqual((await readdir(join(h.dataDir, 'acquired'))).sort(), originalFiles);

  const manifest = await h.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/manifest`, headers: auth(member) });
  assert.equal(manifest.statusCode, 200, manifest.body);
  assert.equal(manifest.json().book.title, 'OPDS 集成测试书');
  const first = manifest.json().items[0]; assert.ok(first);
  const asset = await h.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/assets?ref=${encodeURIComponent(first.href)}`, headers: auth(member) });
  assert.equal(asset.statusCode, 200, asset.body);
  assert.match(asset.body, /远程下载|OPDS/);
  const content = await h.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/content`, headers: auth(member) });
  assert.equal(content.statusCode, 200, content.body);
  assert.equal(content.body, catalog.body);
  const shelf = await h.app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(member) });
  assert.ok(shelf.json().items.some((book: { id: string }) => book.id === bookId), shelf.body);
  const progress = await h.app.inject({ method: 'PUT', url: `/api/v1/sync/progress/${bookId}`, headers: auth(member), payload: {
    locator: first.href, percentage: 0.42, chapterTitle: first.title, device: 'test', updatedAt: Date.now(),
  } });
  assert.equal(progress.statusCode, 200, progress.body);
  assert.equal(progress.json().progress.percentage, 0.42);

  const disabled = await h.app.inject({ method: 'PATCH', url: '/api/v1/sources/test-opds', headers: auth(h.admin), payload: { enabled: false } });
  assert.equal(disabled.statusCode, 200, disabled.body);
  const denied = await h.app.inject({ method: 'GET', url: '/api/v1/sources/test-opds/browse', headers: auth(member) });
  assert.equal(denied.json().error.code, 'SOURCE_DISABLED');
  await h.ctx.scanner.scan();
  await h.restart();
  const retained = await h.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/content`, headers: auth(member) });
  assert.equal(retained.statusCode, 200, retained.body);
  assert.equal(retained.body, catalog.body);
  const retainedProgress = await h.app.inject({ method: 'GET', url: `/api/v1/sync/progress/${bookId}`, headers: auth(member) });
  assert.equal(retainedProgress.json().progress.percentage, 0.42);
  const retainedShelf = await h.app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(member) });
  assert.ok(retainedShelf.json().items.some((book: { id: string }) => book.id === bookId), retainedShelf.body);
});

test('source host enforces per-source and global concurrency limits and releases slots after completion', { timeout: 10_000 }, async (t) => {
  const h = await harness(); t.after(() => h.close());
  const queued: Array<{ sourceId: string; release(): void }> = [];
  const entered = new Map<string, number>();
  const watchers: Array<{ sourceId: string; count: number; resolve(): void }> = [];
  let hold = true;
  const provider: SourceProvider = {
    descriptor: { id: 'blocking', label: 'Concurrency test', version: '1', capabilities: ['browse', 'detail'] },
    async detail(_ctx, ref) { return { ref, title: ref }; },
    async acquire() { return { kind: 'action-required', action: { type: 'external', label: 'Test' } }; },
    async browse(ctx) {
      const count = (entered.get(ctx.instance.id) ?? 0) + 1;
      entered.set(ctx.instance.id, count);
      for (const watcher of watchers) {
        if (watcher.sourceId === ctx.instance.id && count >= watcher.count) watcher.resolve();
      }
      if (!hold) return { items: [] };
      return new Promise<CatalogPage>((resolvePage) => {
        queued.push({ sourceId: ctx.instance.id, release: () => resolvePage({ items: [] }) });
      });
    },
  };
  h.ctx.sources!.registry.register({ pluginId: 'reader.test', provider });
  for (const id of ['limit-one', 'limit-two', 'limit-three', 'limit-four', 'limit-five']) {
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload: {
      id, pluginId: 'reader.test', sourceType: 'blocking', name: id, config: {},
    } });
    assert.equal(created.statusCode, 201, created.body);
  }
  const waitUntilEntered = (sourceId: string, count: number): Promise<void> => {
    if ((entered.get(sourceId) ?? 0) >= count) return Promise.resolve();
    return new Promise((resolveEntered) => watchers.push({ sourceId, count, resolve: resolveEntered }));
  };
  const browse = (sourceId: string) => h.app.inject({
    method: 'GET' as const, url: `/api/v1/sources/${sourceId}/browse`, headers: auth(h.admin),
  });
  const pending: ReturnType<typeof browse>[] = [];
  try {
    const first = browse('limit-one'); const second = browse('limit-one');
    pending.push(first, second);
    await waitUntilEntered('limit-one', 2);
    const blocked = await browse('limit-one');
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.json().error.code, 'RATE_LIMITED');
    assert.equal(entered.get('limit-one'), 2, 'rejected calls never invoke the provider');
    hold = false;
    for (const request of queued.splice(0)) request.release();
    assert.equal((await first).statusCode, 200);
    assert.equal((await second).statusCode, 200);
    const recovered = await browse('limit-one');
    assert.equal(recovered.statusCode, 200, recovered.body);

    hold = true;
    const sourceIds = ['limit-one', 'limit-two', 'limit-three', 'limit-four'];
    const globalRequests: ReturnType<typeof browse>[] = [];
    for (const sourceId of sourceIds) {
      const count = (entered.get(sourceId) ?? 0) + 2;
      const pair = [browse(sourceId), browse(sourceId)];
      globalRequests.push(...pair); pending.push(...pair);
      await waitUntilEntered(sourceId, count);
    }
    const globalBlocked = await browse('limit-five');
    assert.equal(globalBlocked.statusCode, 429, globalBlocked.body);
    assert.equal(globalBlocked.json().error.code, 'RATE_LIMITED');
    assert.equal(entered.get('limit-five'), undefined);
    hold = false;
    queued.shift()!.release();
    assert.equal((await globalRequests[0]!).statusCode, 200);
    const globalRecovered = await browse('limit-five');
    assert.equal(globalRecovered.statusCode, 200, globalRecovered.body);
  } finally {
    hold = false;
    for (const request of queued.splice(0)) request.release();
    await Promise.allSettled(pending);
  }
});

test('trusted example plugins can be installed, queried, disabled, reloaded after restart and uninstalled', async (t) => {
  const h = await harness(); t.after(() => h.close());
  await mkdir(join(h.dataDir, 'plugins'));
  await cp(resolve(import.meta.dirname, '../../examples/plugins/demo-chapters'), join(h.dataDir, 'plugins', 'demo-chapters'), { recursive: true });
  const untrusted = await h.app.inject({ method: 'POST', url: '/api/v1/plugins', headers: auth(h.admin), payload: { folder: 'demo-chapters', trusted: false } });
  assert.ok(untrusted.statusCode >= 400 && untrusted.statusCode < 500, untrusted.body);
  const installed = await h.app.inject({ method: 'POST', url: '/api/v1/plugins', headers: auth(h.admin), payload: { folder: 'demo-chapters', trusted: true } });
  assert.equal(installed.statusCode, 201, installed.body);
  const pluginId = 'reader.source.demo';
  const created = await h.app.inject({ method: 'POST', url: '/api/v1/sources', headers: auth(h.admin), payload: {
    id: 'demo-instance', pluginId, sourceType: 'demo-chapters', name: 'Demo', config: {},
  } });
  assert.equal(created.statusCode, 201, created.body);
  const browse = await h.app.inject({ method: 'GET', url: '/api/v1/sources/demo-instance/browse', headers: auth(h.admin) });
  assert.equal(browse.statusCode, 200, browse.body);
  assert.equal(browse.json().items[0].ref, 'demo-book');
  const acquired = await h.app.inject({ method: 'POST', url: '/api/v1/sources/demo-instance/acquire', headers: auth(h.admin), payload: { entryRef: 'demo-book' } });
  assert.equal(acquired.statusCode, 200, acquired.body);
  assert.equal(acquired.json().kind, 'ready');
  const publicationId = acquired.json().publicationId as string;
  const book = await h.app.inject({ method: 'GET', url: `/api/v1/books/${publicationId}`, headers: auth(h.admin) });
  assert.equal(book.statusCode, 200, book.body);
  assert.equal(book.json().book.format, 'chapters');
  const manifest = await h.app.inject({ method: 'GET', url: '/api/v1/sources/demo-instance/publications/demo-book/manifest', headers: auth(h.admin) });
  assert.equal(manifest.statusCode, 200, manifest.body);
  const resource = await h.app.inject({ method: 'GET', url: '/api/v1/sources/demo-instance/publications/demo-book/resource?ref=chapter-one', headers: auth(h.admin) });
  assert.equal(resource.statusCode, 200, resource.body);
  assert.match(resource.body, /独立 Node 进程/);
  const disabled = await h.app.inject({ method: 'PATCH', url: `/api/v1/plugins/${pluginId}`, headers: auth(h.admin), payload: { enabled: false } });
  assert.equal(disabled.statusCode, 200, disabled.body);
  const unavailable = await h.app.inject({ method: 'GET', url: '/api/v1/sources/demo-instance/browse', headers: auth(h.admin) });
  assert.equal(unavailable.json().error.code, 'PLUGIN_UNAVAILABLE');
  await h.restart();
  const stillUnavailable = await h.app.inject({ method: 'GET', url: '/api/v1/sources/demo-instance/browse', headers: auth(h.admin) });
  assert.equal(stillUnavailable.json().error.code, 'PLUGIN_UNAVAILABLE');
  const enabled = await h.app.inject({ method: 'PATCH', url: `/api/v1/plugins/${pluginId}`, headers: auth(h.admin), payload: { enabled: true } });
  assert.equal(enabled.statusCode, 200, enabled.body);
  await h.restart();
  const reloaded = await h.app.inject({ method: 'GET', url: '/api/v1/sources/demo-instance/browse', headers: auth(h.admin) });
  assert.equal(reloaded.statusCode, 200, reloaded.body);
  assert.equal(reloaded.json().items[0].ref, 'demo-book');
  const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/plugins/${pluginId}`, headers: auth(h.admin) });
  assert.equal(removed.statusCode, 200, removed.body);
  const instances = await h.app.inject({ method: 'GET', url: '/api/v1/sources', headers: auth(h.admin) });
  assert.ok(instances.json().sources.some((source: { id: string }) => source.id === 'demo-instance'), 'uninstall keeps instance configuration');
});

test('search sessions pass generic options and cancellation remains available with saturated search slots', { timeout: 10000 }, async t => {
  const h = await harness(); t.after(() => h.close());
  const member = await h.member(), stopped: Array<{ user: string; source: string; session: string }> = [];
  let entered = 0, ready!: () => void;
  const full = new Promise<void>(resolve => { ready = resolve; });
  const held: Array<() => void> = [];
  const provider: SourceProvider = {
    descriptor: { id: 'sessions', label: 'Sessions', version: '1', capabilities: ['search', 'search.cancel', 'search.session', 'detail'] },
    async detail(_ctx, ref) { return { ref, title: ref }; },
    async acquire() { return { kind: 'action-required', action: { type: 'external', label: 'Test' } }; },
    async search(_ctx, request) {
      assert.equal(request.sessionId, 'search-session-id'); assert.equal(request.resultLimit, 3);
      assert.deepEqual(request.filters, { group: 'chosen' });
      entered++; if (entered === 2) ready();
      await new Promise<void>(resolve => { held.push(resolve); });
      return { items: [], batch: { completed: 0, total: 2 }, nextCursor: 'opaque-heartbeat' };
    },
    async cancelSearch(ctx, sessionId) { stopped.push({ user: ctx.userId, source: ctx.instance.id, session: sessionId }); }
  };
  h.ctx.sources!.registry.register({ pluginId: 'reader.sessions', provider });
  await h.ctx.sources!.create({ id: 'session-test', pluginId: 'reader.sessions', sourceType: 'sessions', name: 'session test', config: {} });
  const url = '/api/v1/sources/session-test/search?q=test&sessionId=search-session-id&resultLimit=3&filters=' + encodeURIComponent(JSON.stringify({ group: 'chosen' }));
  const requests = [h.app.inject({ method: 'GET', url, headers: auth(member) }), h.app.inject({ method: 'GET', url, headers: auth(h.admin) })];
  try {
    await full;
    const response = await h.app.inject({ method: 'POST', url: '/api/v1/sources/session-test/search/cancel', headers: auth(member), payload: { sessionId: 'search-session-id' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(stopped, [{ user: member.id, source: 'session-test', session: 'search-session-id' }]);
    assert.equal((await h.app.inject({ method: 'POST', url: '/api/v1/sources/session-test/search/cancel', payload: { sessionId: 'search-session-id' } })).statusCode, 401);
  } finally { held.forEach(release => release()); await Promise.all(requests); }
  for (const query of ['sessionId=bad', 'sessionId=search-session-id&sessionId=other-session-id', 'resultLimit=0', 'resultLimit=10001', 'resultLimit=1.5']) {
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/v1/sources/session-test/search?q=book&' + query, headers: auth(member) })).statusCode, 400, query);
  }
});
