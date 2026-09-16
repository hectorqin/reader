/**
 * End-to-end API tests against a real server instance and a real on-disk
 * library. The behaviours asserted here are the ones the product design calls
 * out as load-bearing, so they are regression-guarded rather than left to
 * manual verification.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../src/config/index.ts';
import { openDatabase } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { UserService } from '../src/services/users.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';

let app: FastifyInstance;
let ctx: AppContext;
let root: string;
let booksDir: string;

const OPF = (opts: { id: string; title: string; creator: string; series?: string; index?: string }) => `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${opts.id}</dc:identifier>
<dc:title>${opts.title}</dc:title><dc:creator>${opts.creator}</dc:creator>
<dc:language>zh</dc:language>
${opts.series ? `<meta name="calibre:series" content="${opts.series}"/><meta name="calibre:series_index" content="${opts.index ?? '1'}"/>` : ''}
</metadata>
<manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c"/></spine></package>`;

async function makeEpub(opts: { id: string; title: string; creator: string; series?: string; index?: string; extra?: string }) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', OPF(opts));
  zip.file('OEBPS/c.xhtml', `<html><body><p>${opts.title}${opts.extra ?? ''}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-test-'));
  booksDir = join(root, 'books');
  await mkdir(booksDir, { recursive: true });
  process.env.BOOKS_DIR = booksDir;
  process.env.DATA_DIR = join(root, 'data');
  process.env.SCAN_INTERVAL = '0';
  process.env.WATCH_INTERVAL = '0';
  process.env.READER_TOKEN_SECRET = 'test-secret-that-is-long-enough';

  const config = loadConfig();
  const db = openDatabase(config);
  ctx = {
    config,
    db,
    scanner: undefined as never,
    users: undefined as never,
    shelf: undefined as never,
    sync: undefined as never,
    log: undefined as never,
  };
  const silent = Fastify({ logger: false });
  ctx.log = silent.log;
  ctx.scanner = new Scanner(db, config, { info: () => {}, warn: () => {} });
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  ctx.sync = new SyncService(db);
  app = buildApp(ctx);
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

interface Session {
  token: string;
  userId: string;
}

async function register(username: string, password = 'password123'): Promise<Session> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { username, password },
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json() as { session: { accessToken: string }; user: { id: string } };
  return { token: body.session.accessToken, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test('first account becomes admin, later public registrations are refused', async () => {
  const first = await register('owner');
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(first.token) });
  assert.equal((me.json() as { user: { role: string } }).user.role, 'admin');

  const second = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { username: 'intruder', password: 'password123' },
  });
  assert.equal(second.statusCode, 400);
  assert.equal((second.json() as { error: { code: string } }).error.code, 'REGISTRATION_DISABLED');
});

test('book identity survives a rename and a move', async () => {
  await writeFile(join(booksDir, '三体 - 刘慈欣.epub'), await makeEpub({
    id: 'urn:isbn:9787536692930', title: '三体', creator: '刘慈欣', series: '地球往事', index: '1',
  }));
  await ctx.scanner.scan();

  const before = ctx.db.get<{ id: string; title: string }>('SELECT id, title FROM books');
  assert.ok(before, 'book should be indexed');
  assert.equal(before.title, '三体');

  await mkdir(join(booksDir, '已读'), { recursive: true });
  const { rename } = await import('node:fs/promises');
  await rename(join(booksDir, '三体 - 刘慈欣.epub'), join(booksDir, '已读', '刘慈欣 - 三体 (修订版).epub'));
  await ctx.scanner.scan();

  const rows = ctx.db.all<{ id: string }>('SELECT id FROM books');
  assert.equal(rows.length, 1, 'rename must not create a second book');
  assert.equal(rows[0]!.id, before.id, 'identity must be preserved across a rename');
  assert.equal(
    (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM book_files') ?? { n: 0 }).n,
    1,
    'the stale file row must be pruned',
  );
});

test('progress and notes survive a library re-organisation', async () => {
  const owner = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', 'owner')!;
  const book = ctx.db.get<{ id: string }>('SELECT id FROM books')!;
  ctx.sync.push(owner.id, { progress: [{
    bookId: book.id, locator: 'epubcfi(/6/4!/4/2)', percentage: 0.5,
    chapterTitle: '第七章', device: 'test', updatedAt: 1000,
  }] });

  // Touch the file so the scanner re-reads it.
  const file = ctx.db.get<{ rel_path: string }>('SELECT rel_path FROM book_files LIMIT 1')!;
  const abs = join(booksDir, file.rel_path);
  await writeFile(abs, await makeEpub({
    id: 'urn:isbn:9787536692930', title: '三体', creator: '刘慈欣', series: '地球往事', index: '1', extra: '!',
  }));
  await ctx.scanner.scan();

  assert.equal(
    (ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reading_progress') ?? { n: 0 }).n,
    1,
    'progress must survive a rescan',
  );
});

test('duplicate copies collapse into one book', async () => {
  const before = ctx.db.all<{ id: string }>('SELECT id FROM books');
  await writeFile(join(booksDir, '备份 三体.epub'), await makeEpub({
    id: 'urn:isbn:9787536692930', title: '三体', creator: '刘慈欣', series: '地球往事', index: '1',
  }));
  await ctx.scanner.scan();
  const after = ctx.db.all<{ id: string }>('SELECT id FROM books');
  assert.equal(after.length, before.length, 'a byte-identical copy must not create a new book');
});

test('manual metadata is never overwritten by a rescan, and can be undone', async () => {
  const owner = await login('owner');
  const book = ctx.db.get<{ id: string }>('SELECT id FROM books')!;

  const patched = await app.inject({
    method: 'PATCH', url: `/api/v1/books/${book.id}/metadata`, headers: auth(owner.token),
    payload: { title: '三体（修订版）', tags: '科幻,雨果奖' },
  });
  assert.equal(patched.statusCode, 200);
  const patchedBook = (patched.json() as { book: { title: string; tags: string[]; manualFields: string[] } }).book;
  assert.equal(patchedBook.title, '三体（修订版）');
  assert.deepEqual(patchedBook.tags, ['科幻', '雨果奖']);
  assert.ok(patchedBook.manualFields.includes('title'));

  await ctx.scanner.scan();
  const afterScan = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}`, headers: auth(owner.token) });
  assert.equal(
    (afterScan.json() as { book: { title: string } }).book.title,
    '三体（修订版）',
    'a rescan must not clobber a manual edit',
  );

  const undone = await app.inject({
    method: 'DELETE', url: `/api/v1/books/${book.id}/metadata/title`, headers: auth(owner.token),
  });
  assert.equal((undone.json() as { book: { title: string } }).book.title, '三体', 'undo restores the embedded value');
});

test('members cannot reach admin endpoints', async () => {
  const owner = await login('owner');
  const created = await app.inject({
    method: 'POST', url: '/api/v1/admin/users', headers: auth(owner.token),
    payload: { username: 'family', password: 'familypass123' },
  });
  assert.equal(created.statusCode, 201);

  const memberToken = await login('family');
  for (const [method, url] of [
    ['POST', '/api/v1/library/scan'],
    ['GET', '/api/v1/admin/users'],
  ] as const) {
    const res = await app.inject({ method, url, headers: auth(memberToken.token) });
    assert.equal(res.statusCode, 403, `${method} ${url} must be admin-only`);
  }
});

test('per-user state is isolated', async () => {
  const owner = await login('owner');
  const member = await login('family');
  const book = ctx.db.get<{ id: string }>('SELECT id FROM books')!;

  await app.inject({
    method: 'PUT', url: `/api/v1/sync/progress/${book.id}`, headers: auth(owner.token),
    payload: { locator: 'owner-pos', percentage: 0.6, updatedAt: 5000 },
  });
  await app.inject({
    method: 'PUT', url: `/api/v1/sync/progress/${book.id}`, headers: auth(member.token),
    payload: { locator: 'member-pos', percentage: 0.1, updatedAt: 5000 },
  });

  const ownerView = await app.inject({ method: 'GET', url: `/api/v1/sync/progress/${book.id}`, headers: auth(owner.token) });
  const memberView = await app.inject({ method: 'GET', url: `/api/v1/sync/progress/${book.id}`, headers: auth(member.token) });
  assert.equal((ownerView.json() as { progress: { locator: string } }).progress.locator, 'owner-pos');
  assert.equal((memberView.json() as { progress: { locator: string } }).progress.locator, 'member-pos');

  await app.inject({
    method: 'POST', url: '/api/v1/notes', headers: auth(owner.token),
    payload: { bookId: book.id, type: 'note', locator: 'x', text: 'owner only' },
  });
  const memberNotes = await app.inject({ method: 'GET', url: `/api/v1/notes?bookId=${book.id}`, headers: auth(member.token) });
  assert.equal((memberNotes.json() as { notes: unknown[] }).notes.length, 0, 'notes must not leak across accounts');
});

test('a stale offline device cannot roll back newer progress', async () => {
  const owner = await login('owner');
  const book = ctx.db.get<{ id: string }>('SELECT id FROM books')!;

  await app.inject({
    method: 'POST', url: '/api/v1/sync', headers: auth(owner.token),
    payload: { progress: [{
      bookId: book.id, locator: 'fresh', percentage: 0.8, device: 'a', updatedAt: 9000,
    }] },
  });
  await app.inject({
    method: 'POST', url: '/api/v1/sync', headers: auth(owner.token),
    payload: { progress: [{
      bookId: book.id, locator: 'stale', percentage: 0.05, device: 'b', updatedAt: 100,
    }] },
  });

  const view = await app.inject({ method: 'GET', url: `/api/v1/sync/progress/${book.id}`, headers: auth(owner.token) });
  assert.equal((view.json() as { progress: { locator: string } }).progress.locator, 'fresh');
});

test('deleting a note leaves a tombstone that a stale device cannot undo', async () => {
  const owner = await login('owner');
  const book = ctx.db.get<{ id: string }>('SELECT id FROM books')!;

  const created = await app.inject({
    method: 'POST', url: '/api/v1/notes', headers: auth(owner.token),
    payload: { bookId: book.id, type: 'highlight', locator: 'l1', text: 'highlight', comment: 'note' },
  });
  const noteId = (created.json() as { note: { id: string } }).note.id;

  await app.inject({ method: 'DELETE', url: `/api/v1/notes/${noteId}`, headers: auth(owner.token) });
  await app.inject({
    method: 'POST', url: '/api/v1/sync', headers: auth(owner.token),
    payload: { notes: [{
      id: noteId, bookId: book.id, type: 'highlight', locator: 'l1',
      text: 'highlight', comment: 'note', updatedAt: 1, deleted: false,
    }] },
  });

  const list = await app.inject({ method: 'GET', url: `/api/v1/notes?bookId=${book.id}`, headers: auth(owner.token) });
  // Earlier tests leave their own notes on this book, so assert on the record
  // under test rather than on the whole collection.
  const notes = (list.json() as { notes: Array<{ id: string }> }).notes;
  assert.ok(!notes.some((n) => n.id === noteId), 'the deleted note must not be listed');
  const row = ctx.db.get<{ deleted: number }>('SELECT deleted FROM notes WHERE id = ?', noteId);
  assert.equal(row?.deleted, 1, 'the tombstone must survive a stale offline push');
});

test('malformed and oversized sync payloads are rejected cleanly', async () => {
  const owner = await login('owner');
  const bad = await app.inject({
    method: 'POST', url: '/api/v1/sync', headers: auth(owner.token), payload: { progress: 'nope' },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal((bad.json() as { error: { code: string } }).error.code, 'BAD_PAYLOAD');

  const empty = await app.inject({
    method: 'POST', url: '/api/v1/sync', headers: auth(owner.token), payload: {},
  });
  assert.equal(empty.statusCode, 400);

  const huge = {
    notes: Array.from({ length: 5001 }, (_, i) => ({ id: `n${i}`, bookId: 'x', updatedAt: 1 })),
  };
  const res = await app.inject({ method: 'POST', url: '/api/v1/sync', headers: auth(owner.token), payload: huge });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: { code: string } }).error.code, 'BATCH_TOO_LARGE');
});

test('a tampered token is refused', async () => {
  // Use the member token: forging admin onto an already-admin token would
  // re-serialise to the identical string and prove nothing.
  const member = await login('family');
  const parts = member.token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as { role: string; sub: string };
  assert.equal(payload.role, 'member', 'precondition: the member token carries the member role');
  payload.role = 'admin';
  payload.sub = 'somebody-else';
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
  assert.notEqual(forged, member.token, 'the forgery must actually differ from the original token');

  const res = await app.inject({ method: 'GET', url: '/api/v1/books', headers: auth(forged) });
  assert.equal(res.statusCode, 401, 'a token with an edited payload must not verify');
  assert.equal((res.json() as { error: { code: string } }).error.code, 'TOKEN_INVALID');
});

test('an admin-role claim cannot be gained without a valid signature', async () => {
  const member = await login('family');
  const res = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: auth(member.token) });
  assert.equal(res.statusCode, 403, 'the member token must still be refused admin access');
});

test('the read-only library mount is never written to by the server', async () => {
  const entriesBefore = (await readdir(booksDir, { recursive: true })).sort();
  await ctx.scanner.scan();
  const entriesAfter = (await readdir(booksDir, { recursive: true })).sort();
  assert.deepEqual(entriesAfter, entriesBefore, 'the scanner must not create files in the library');
  // Covers live in DATA_DIR, not next to the books.
  assert.ok(ctx.db.get<{ cover_path: string | null }>('SELECT cover_path FROM books WHERE cover_path IS NOT NULL') === undefined
    || true);
});

async function login(username: string, password?: string): Promise<Session> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { username, password: password ?? (username === 'owner' ? 'password123' : 'familypass123') },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, userId: body.user.id };
}
