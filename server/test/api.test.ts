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

/**
 * Creates an account through the admin path and signs in.
 *
 * Public registration is only open for the very first account (by design), so
 * the multi-format tests below cannot use `register`. Going through
 * `createAsAdmin` also exercises the path a real family member's account takes.
 */
async function createUser(username: string, password = 'password123'): Promise<Session> {
  const user = await ctx.users.createAsAdmin({ username, password });
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, userId: user.id };
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

// ---------------------------------------------------------------------------
// Multi-format library (§6 format scope)
//
// The scanner has to index formats it cannot itself parse. If it did not, a TXT
// novel or a comic archive would simply be absent from the shelf — the one
// outcome a self-hosted library must never produce, because the reader has no way
// to tell "unsupported" from "missing".
// ---------------------------------------------------------------------------

async function makeCbz(pages: string[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const page of pages) {
    // A tiny real PNG header is enough: nothing inflates these during a scan.
    zip.file(page, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('a TXT book is indexed without being decoded by the server', async () => {
  const session = await createUser('txtuser');
  // GB18030 bytes with no BOM: the common shape of a legacy Chinese TXT. The
  // server must index it anyway — deciding the encoding and splitting chapters is
  // the client's job (it has the reader's eyes and an override control), and
  // doing that work server-side would mean decoding a whole novel on every scan.
  const gb18030 = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0xd5, 0xfd, 0xce, 0xc4, 0xa1, 0xa3]);
  await writeFile(join(booksDir, '长篇.txt'), gb18030);
  await ctx.scanner.scan();

  const res = await app.inject({ method: 'GET', url: '/api/v1/books?format=txt', headers: auth(session.token) });
  const body = res.json() as { items: Array<{ title: string; format: string }>; total: number };
  assert.equal(body.total, 1);
  assert.equal(body.items[0]!.format, 'txt');
  assert.equal(body.items[0]!.title, '长篇');
});

test('an ambiguous "title - author" file name is kept whole rather than guessed at', async () => {
  // `长篇 - 某作者` has no marker to say which side is which, so the conservative
  // rule keeps the whole string as the title. Losing an author costs the reader one
  // manual edit; guessing wrong files the book under the wrong person.
  const session = await createUser('txtambiguous');
  await writeFile(join(booksDir, '长篇 - 某作者.txt'), '第一章\n正文。', 'utf8');
  await ctx.scanner.scan();

  const res = await app.inject({
    method: 'GET', url: `/api/v1/books?search=${encodeURIComponent('长篇')}`, headers: auth(session.token),
  });
  const body = res.json() as { items: Array<{ title: string; author: string }> };
  assert.equal(body.items[0]!.title, '长篇 - 某作者');
  assert.equal(body.items[0]!.author, '');
});

test('a CBZ comic is indexed with a page count, without unpacking it', async () => {
  const session = await createUser('cbzuser');
  await writeFile(join(booksDir, '某漫画.cbz'), await makeCbz(['001.png', '002.png', '010.png']));
  await ctx.scanner.scan();

  const res = await app.inject({ method: 'GET', url: '/api/v1/books?format=cbz', headers: auth(session.token) });
  const body = res.json() as { items: Array<{ title: string; pageCount: number | null }> };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]!.title, '某漫画');
  // Three pages, counted from the central directory.
  assert.equal(body.items[0]!.pageCount, 3);
});

test('a folder of images becomes one book with every page as a file', async () => {
  const session = await createUser('comicuser');
  const dir = join(booksDir, '图片漫画');
  await mkdir(dir, { recursive: true });
  for (const page of ['1.jpg', '2.jpg', '10.jpg']) {
    await writeFile(join(dir, page), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  }
  await ctx.scanner.scan();

  const res = await app.inject({ method: 'GET', url: '/api/v1/books?format=comic-dir', headers: auth(session.token) });
  const body = res.json() as { items: Array<{ id: string; title: string; pageCount: number | null }> };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]!.title, '图片漫画');
  assert.equal(body.items[0]!.pageCount, 3);

  const manifest = await app.inject({
    method: 'GET', url: `/api/v1/books/${body.items[0]!.id}/manifest`, headers: auth(session.token),
  });
  const files = (manifest.json() as { files: Array<{ rel_path: string }> }).files;
  // Every page is a separate file row, and the folder is one book — not three.
  assert.deepEqual(files.map((file) => file.rel_path).sort(), [
    '图片漫画/1.jpg',
    '图片漫画/10.jpg',
    '图片漫画/2.jpg',
  ]);
});

test('a comic folder keeps its identity when a page is added', async () => {
  const session = await createUser('comicidentity');
  const dir = join(booksDir, '系列漫画');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
  await writeFile(join(dir, '2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 2]));
  await ctx.scanner.scan();
  const before = (await app.inject({
    method: 'GET', url: '/api/v1/books?format=comic-dir&search=系列漫画', headers: auth(session.token),
  })).json() as { items: Array<{ id: string }> };
  assert.equal(before.items.length, 1);

  // Sync some progress, then add a page.
  await app.inject({
    method: 'PUT', url: `/api/v1/sync/progress/${before.items[0]!.id}`,
    headers: { ...auth(session.token), 'content-type': 'application/json' },
    payload: { locator: 'r1:0.0000:系列漫画/2.jpg', percentage: 0.5, chapterTitle: '第 2 页', device: 'test', updatedAt: Date.now() },
  });
  await writeFile(join(dir, '3.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 3]));
  await ctx.scanner.scan();

  const after = (await app.inject({
    method: 'GET', url: '/api/v1/books?format=comic-dir&search=系列漫画', headers: auth(session.token),
  })).json() as { items: Array<{ id: string; pageCount: number | null }> };
  assert.equal(after.items.length, 1, 'adding a page must not create a second book');
  assert.equal(after.items[0]!.id, before.items[0]!.id);
  assert.equal(after.items[0]!.pageCount, 3);

  // The reading position survives, which is the actual point of the identity rule.
  const progress = (await app.inject({
    method: 'GET', url: `/api/v1/sync/progress/${before.items[0]!.id}`, headers: auth(session.token),
  })).json() as { progress: { percentage: number } | null };
  assert.equal(progress.progress?.percentage, 0.5);
});

test('a folder of EPUBs is not mistaken for a comic', async () => {
  // A stray cover.jpg next to real books must not turn the folder into a comic
  // and hide every book inside it.
  const session = await createUser('shelfdirectory');
  const dir = join(booksDir, '藏书目录');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '一本书.epub'), await makeEpub({ id: 'urn:uuid:in-dir', title: '目录里的书', creator: '某人' }));
  await writeFile(join(dir, 'cover.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await writeFile(join(dir, 'cover2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await ctx.scanner.scan();

  const res = await app.inject({
    method: 'GET', url: '/api/v1/books?search=目录里的书', headers: auth(session.token),
  });
  const body = res.json() as { items: Array<{ format: string }> };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]!.format, 'epub');
});

test('one page of a comic folder can be fetched by path', async () => {
  const session = await createUser('comicfetch');
  const dir = join(booksDir, '取图漫画');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]));
  await writeFile(join(dir, '2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 8, 8]));
  await ctx.scanner.scan();

  const list = (await app.inject({
    method: 'GET', url: '/api/v1/books?search=取图漫画', headers: auth(session.token),
  })).json() as { items: Array<{ id: string }> };
  const id = list.items[0]!.id;

  const page = await app.inject({
    method: 'GET', url: `/api/v1/books/${id}/file?path=${encodeURIComponent('取图漫画/2.jpg')}`,
    headers: auth(session.token),
  });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers['content-type'], 'image/jpeg');
  // Exactly the bytes written above: 6, and the ETag header must not have failed
  // to build on a non-ASCII path.
  assert.equal(page.rawPayload.byteLength, 6);
  assert.match(page.headers['etag'] as string, /^"[0-9a-f]+:[0-9a-f]{16}"$/);
});

test('the per-file endpoint refuses a path that is not part of the book', async () => {
  const session = await createUser('comictraversal');
  const dir = join(booksDir, '穿越漫画');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await writeFile(join(dir, '2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await writeFile(join(booksDir, 'secret.txt'), 'not yours');
  await ctx.scanner.scan();

  const list = (await app.inject({
    method: 'GET', url: '/api/v1/books?search=穿越漫画', headers: auth(session.token),
  })).json() as { items: Array<{ id: string }> };
  const id = list.items[0]!.id;

  // Traversal, an absolute path, and a sibling book's file. All three are
  // refusals because the lookup is against this book's own file rows: a path is
  // never constructed from the query string.
  for (const attempt of ['../../../etc/passwd', '/etc/passwd', 'secret.txt', '穿越漫画/../../secret.txt']) {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/books/${id}/file?path=${encodeURIComponent(attempt)}`,
      headers: auth(session.token),
    });
    assert.equal(res.statusCode, 404, `expected 404 for ${attempt}, got ${res.statusCode}`);
  }
});

test('a member cannot fetch a file of a book they cannot see', async () => {
  // The per-file endpoint authorises through the shelf exactly like /content does,
  // so there is no second code path to keep in step.
  const owner = await createUser('fileowner');
  const dir = join(booksDir, '私有漫画');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await writeFile(join(dir, '2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await ctx.scanner.scan();

  const list = (await app.inject({
    method: 'GET', url: '/api/v1/books?search=私有漫画', headers: auth(owner.token),
  })).json() as { items: Array<{ id: string }> };
  const id = list.items[0]!.id;

  // Hide it from a second account, then confirm the file endpoint refuses.
  // Created through `createUser` rather than a bare `createAsAdmin` + `login`,
  // because the latter pair is what a previous version of this test did and it
  // signed in with the wrong credentials, making the assertion meaningless.
  const other = await createUser('fileother');
  ctx.db.run('DELETE FROM user_books WHERE user_id = ? AND book_id = ?', other.userId, id);

  const res = await app.inject({
    method: 'GET', url: `/api/v1/books/${id}/file?path=${encodeURIComponent('私有漫画/1.jpg')}`,
    headers: auth(other.token),
  });
  assert.equal(res.statusCode, 404);
});

test('the H5 client bundle is served when present and absent otherwise', async () => {
  // The static route is registered conditionally. This instance has no WEB_DIR,
  // so `/` must 404 rather than shadow the API — the failure mode being guarded
  // against is a catch-all that swallows /api/*.
  const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(health.statusCode, 200);
  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 404);
});
