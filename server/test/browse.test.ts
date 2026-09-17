/**
 * File-manager API tests.
 *
 * The screen these back is the only place in the product that *writes* to the
 * library mount, so the behaviours asserted here are the ones where a mistake
 * costs the reader their files or their reading position: path containment,
 * refusing a write on a read-only mount, and keeping progress attached to a book
 * whose file was moved.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
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
import { TtsService } from '../src/services/tts.ts';
import { BrowseService } from '../src/services/browse.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';

let app: FastifyInstance;
let ctx: AppContext;
let root: string;
let booksDir: string;
let token: string;
let userId: string;

const OPF = (title: string, id: string) => `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${title}</dc:title><dc:creator>作者</dc:creator><dc:language>zh</dc:language>
</metadata>
<manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c"/></spine></package>`;

async function makeEpub(title: string, id: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file('OEBPS/content.opf', OPF(title, id));
  zip.file('OEBPS/c.xhtml', `<html><body><p>${title}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function auth() {
  return { authorization: `Bearer ${token}` };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-browse-'));
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

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'owner', password: 'password123' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const body = created.json() as { session: { accessToken: string }; user: { id: string } };
  token = body.session.accessToken;
  userId = body.user.id;

  await mkdir(join(booksDir, '科幻', '已读'), { recursive: true });
  await writeFile(join(booksDir, '科幻', '三体.epub'), await makeEpub('三体', 'urn:one'));
  await writeFile(join(booksDir, '科幻', '已读', '球状闪电.epub'), await makeEpub('球状闪电', 'urn:two'));
  await writeFile(join(booksDir, '说明.txt'), Buffer.from('hello', 'utf8'));
  await mkdir(join(booksDir, '.trash'), { recursive: true });
  await writeFile(join(booksDir, '.trash', '旧书.epub'), await makeEpub('旧书', 'urn:three'));
});

after(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('library browsing', () => {
  test('the root lists directories, book files and rule-hidden folders alike', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/library/browse', headers: auth() });
    assert.equal(res.statusCode, 200);
    const listing = res.json() as {
      path: string;
      parent: string | null;
      crumbs: Array<{ name: string; path: string }>;
      entries: Array<{ name: string; type: string; scanned: boolean; hidden: boolean; hiddenByRule: boolean }>;
      writable: boolean;
    };
    assert.equal(listing.path, '');
    assert.equal(listing.parent, null);
    assert.deepEqual(listing.crumbs, [{ name: '书库', path: '' }]);
    // A writable mount is the only state in which the UI offers to rename or
    // delete anything, so the flag is part of the contract rather than a nicety.
    assert.equal(listing.writable, true);

    const byName = new Map(listing.entries.map((entry) => [entry.name, entry]));
    assert.equal(byName.get('科幻')?.type, 'dir');
    assert.equal(byName.get('说明.txt')?.scanned, true, 'a .txt is a book the scanner indexes');
    // The hidden folder is listed, not filtered: "my book is missing from the
    // shelf" is answerable only if the screen can show where it actually is.
    assert.equal(byName.get('.trash')?.hidden, true);
    assert.equal(byName.get('.trash')?.hiddenByRule, true);
  });

  test('a nested directory reports its breadcrumb and its own entries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/library/browse?path=${encodeURIComponent('科幻/已读')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200);
    const listing = res.json() as {
      path: string;
      parent: string;
      crumbs: Array<{ name: string; path: string }>;
      entries: Array<{ name: string; indexed: boolean }>;
      dirs: number;
      files: number;
    };
    assert.equal(listing.path, '科幻/已读');
    assert.equal(listing.parent, '科幻');
    assert.deepEqual(listing.crumbs, [
      { name: '书库', path: '' },
      { name: '科幻', path: '科幻' },
      { name: '已读', path: '科幻/已读' },
    ]);
    assert.equal(listing.files, 1);
    assert.equal(listing.dirs, 0);
  });

  test('a traversal attempt is refused, not resolved', async () => {
    for (const path of ['../../etc', '..', '/etc', '科幻/../../..']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/library/browse?path=${encodeURIComponent(path)}`,
        headers: auth(),
      });
      assert.ok(res.statusCode >= 400, `${path} answered ${res.statusCode}`);
    }
  });

  test('the API requires a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/library/browse' });
    assert.equal(res.statusCode, 401);
  });
});

describe('library file management', () => {
  test('renaming a book keeps its identity, its progress and its notes', async () => {
    await ctx.scanner.scan();
    const book = ctx.db.get<{ id: string; title: string }>('SELECT id, title FROM books WHERE title = ?', '三体');
    assert.ok(book, 'the book should be indexed');
    ctx.sync.push(userId, {
      progress: [
        {
          bookId: book.id,
          locator: 'epubcfi(/6/4!/4/2)',
          percentage: 0.42,
          chapterTitle: '第七章',
          device: 'test',
          updatedAt: Date.now(),
        },
      ],
    });

    const renamed = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/rename',
      headers: auth(),
      payload: { path: '科幻/三体.epub', name: '三体（修订版）.epub' },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((renamed.json() as { path: string }).path, '科幻/三体（修订版）.epub');

    // The index is repointed immediately rather than at the next scan: the file
    // manager has to leave the library consistent with itself when it closes.
    const row = ctx.db.get<{ book_id: string; rel_path: string }>(
      'SELECT book_id, rel_path FROM book_files WHERE rel_path = ?',
      '科幻/三体（修订版）.epub',
    );
    assert.equal(row?.book_id, book.id, 'the book must keep its identity across a rename');

    // A rescan must agree: identity is `identifier + content hash`, not a path.
    await ctx.scanner.scan();
    const after = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM books WHERE title = ?', '三体');
    assert.equal(after?.n, 1);
    const progress = ctx.db.get<{ percentage: number }>(
      'SELECT percentage FROM reading_progress WHERE book_id = ?',
      book.id,
    );
    assert.equal(progress?.percentage, 0.42, 'progress must survive a rename');
  });

  test('moving a book into a folder keeps it on the shelf, once', async () => {
    const moved = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/move',
      headers: auth(),
      payload: { paths: ['科幻/三体（修订版）.epub'], target: '科幻/已读' },
    });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal((moved.json() as { moved: number }).moved, 1);

    await ctx.scanner.scan();
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM books WHERE title = ?', '三体');
    assert.equal(count?.n, 1, 'a move must not leave a duplicate behind');

    const listing = await app.inject({
      method: 'GET',
      url: `/api/v1/library/browse?path=${encodeURIComponent('科幻/已读')}`,
      headers: auth(),
    });
    const names = (listing.json() as { entries: Array<{ name: string }> }).entries.map((entry) => entry.name);
    assert.ok(names.includes('三体（修订版）.epub'));
  });

  test('a move onto an existing name is refused rather than silently merged', async () => {
    await mkdir(join(booksDir, '科幻', '其他'), { recursive: true });
    await writeFile(join(booksDir, '科幻', '其他', '球状闪电.epub'), await makeEpub('球状闪电（另一份）', 'urn:four'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/move',
      headers: auth(),
      payload: { paths: ['科幻/已读/球状闪电.epub'], target: '科幻/其他' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'DESTINATION_EXISTS');
    // The source must still be there: refusing a batch means refusing all of it.
    await stat(join(booksDir, '科幻', '已读', '球状闪电.epub'));
  });

  test('a move into itself is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/move',
      headers: auth(),
      payload: { paths: ['科幻'], target: '科幻/已读' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'MOVE_INTO_SELF');
  });

  test('a new folder can be created and deleted, but a traversal cannot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/mkdir',
      headers: auth(),
      payload: { path: '', name: '漫画' },
    });
    assert.equal(created.statusCode, 200, created.body);

    const escaped = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/mkdir',
      headers: auth(),
      payload: { path: '', name: '../外面' },
    });
    assert.equal(escaped.statusCode, 400);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/library/browse', headers: auth() });
    const names = (listed.json() as { entries: Array<{ name: string }> }).entries.map((entry) => entry.name);
    assert.ok(names.includes('漫画'));

    const deleted = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/delete',
      headers: auth(),
      payload: { paths: ['漫画'] },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal((deleted.json() as { removed: number }).removed, 1);
    await assert.rejects(stat(join(booksDir, '漫画')));
  });

  test('deleting a book removes the bytes and leaves the index to the scanner', async () => {
    // A file that is actually indexed: `科幻/已读/三体（修订版）.epub` moved here by
    // an earlier test. A path the scanner never saw would leave the interesting
    // half of this behaviour — what happens to an indexed row — untested.
    await ctx.scanner.scan();
    const relPath = '科幻/已读/三体（修订版）.epub';
    const target = join(booksDir, relPath);
    await readFile(target);
    const before = ctx.db.get<{ book_id: string; missing: number }>(
      'SELECT book_id, missing FROM book_files WHERE rel_path = ?',
      relPath,
    );
    assert.ok(before, 'the book should be indexed before it is deleted');
    assert.equal(before.missing, 0);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/delete',
      headers: auth(),
      payload: { paths: [relPath] },
    });
    assert.equal(res.statusCode, 200, res.body);
    await assert.rejects(stat(target));

    // The row stays live until a scan notices, on purpose: the deletion itself is
    // the risky half, and coupling it to a full rescan would make the UI wait
    // minutes to report success.
    const row = ctx.db.get<{ missing: number }>(
      'SELECT missing FROM book_files WHERE rel_path = ?',
      relPath,
    );
    assert.equal(row?.missing, 0, 'a delete does not rewrite the index');

    await ctx.scanner.scan();
    const after = ctx.db.get<{ missing: number }>(
      'SELECT missing FROM book_files WHERE rel_path = ?',
      relPath,
    );
    assert.equal(after?.missing, 1, 'a scan marks the file missing rather than dropping the book');
    // And the book is remembered: a book on an unmounted share must not vanish
    // from the reader's shelf the moment its file goes away.
    assert.ok(
      ctx.db.get<{ id: string }>('SELECT id FROM books WHERE id = ?', before.book_id),
      'the book row survives a deleted file',
    );
  });

  test('deleting several entries at once is all or nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/delete',
      headers: auth(),
      payload: { paths: ['说明.txt', '科幻/不存在的.epub'] },
    });
    assert.equal(res.statusCode, 404);
    // The existing entry must survive a batch that named a missing one.
    await stat(join(booksDir, '说明.txt'));
  });

  test('a malformed batch is rejected rather than coerced', async () => {
    for (const payload of [{}, { paths: [] }, { paths: '科幻' }, { paths: [1] }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/library/browse/delete',
        headers: auth(),
        payload,
      });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
  });
});

describe('a read-only mount', () => {
  test('reports itself as not writable and refuses writes with 403', async () => {
    const service = new BrowseService(ctx.db, ctx.config);
    const original = service.writable.bind(service);
    // Stands in for a read-only bind mount, which looks writable by mode bits and
    // refuses every write. Simulated on the probe because the alternative is
    // chmod-ing the test's own mount, which CI runs as root and would ignore.
    service.writable = async () => false;
    // The routes hold their own reference to the service, so this only exercises
    // the guard's contract: a probe that says "no" must become a 403 rather than
    // an EROFS stack trace.
    await assert.rejects(
      service.renamePath('科幻/已读/球状闪电.epub', '球状闪电-改名.epub'),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 403,
    );
    service.writable = original;
  });
});
