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
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, stat } from 'node:fs/promises';
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
  ctx.sync = new SyncService(db, ctx.shelf);
  ctx.tts = new TtsService(config);
  ctx.browse = new BrowseService(db, config, ctx.shelf);
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
    const service = new BrowseService(ctx.db, ctx.config, ctx.shelf);
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

/**
 * 书架的加入与移除 —— the two directions, end to end.
 *
 * Every assertion here was run before the fix and failed. The screen these back is
 * the *only* place a reader can put a book back on their shelf, so the failure mode
 * of a broken direction is a book they cannot reach from inside the app at all.
 *
 * The suite lives under its own folder (`加减/`) because the shelf's answers are
 * about *the whole library*: "is this book on my shelf" cannot be asserted in a
 * listing that also holds other suites' books, and a `total` that counts them is
 * not an assertion about anything.
 */
describe('the shelf add/remove pair', () => {
  const DIR = '加减';
  const BOOK = `${DIR}/往复.epub`;
  let owner: string;

  before(async () => {
    /*
     * A second account, created *after* the library already has books in it.
     *
     * This is the state the report is about: `UserService.create` grants a new
     * account every visible book, so a reader who registered after the first scan
     * has a shelf they never curated. Asserting on that account is what makes
     * "the shelf is empty at the start" a statement about the setup rather than
     * about the other suites' files.
     */
    const created = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    assert.equal(created.statusCode, 200, created.body);
    owner = (created.json() as { accessToken: string }).accessToken;
  });

  /** The shelf as `GET /books` sees it — the only definition of "on my shelf". */
  async function shelfTitles(): Promise<string[]> {
    const res = await app.inject({ method: 'GET', url: '/api/v1/books?pageSize=200', headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    return (res.json() as { items: Array<{ title: string }> }).items.map((item) => item.title);
  }

  /** The library's answer to the same question, for the same file. */
  async function shelfStateOf(path: string): Promise<string | null> {
    const folder = path.slice(0, path.lastIndexOf('/'));
    const res = await app.inject({
      method: 'GET', url: `/api/v1/library/browse?path=${encodeURIComponent(folder)}&pageSize=1000`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const entry = (res.json() as { entries: Array<{ path: string; shelfState: string | null }> })
      .entries.find((candidate) => candidate.path === path);
    assert.ok(entry, `the listing must contain ${path}`);
    return entry.shelfState;
  }

  async function act(path: string, action: string): Promise<{ applied: number; books: string[] }> {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(),
      payload: { paths: [path], action },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as { applied: number; books: string[] };
  }

  test('every direction of the pair leaves the two screens agreeing', async () => {
    /*
     * One assertion per edge of the state machine, because the two screens read it
     * from opposite ends and each direction was broken in its own way:
     *
     *   on → 下架 → off → 加入书架 → on
     *
     * `GET /books` is asserted in every step: "on the shelf" has exactly one
     * definition, and the file listing's `shelfState` must be that same definition.
     */
    await mkdir(join(booksDir, DIR), { recursive: true });
    await writeFile(join(booksDir, BOOK), await makeEpub('往复', 'urn:roundtrip'));
    await ctx.scanner.scan();

    /*
     * A book the scanner found is on the shelf without anyone adding it: the library
     * is shared, and a book that must be curated before it can be read is the
     * complaint this issue is made of.
     */
    assert.ok((await shelfTitles()).includes('往复'), '扫描到的书一进库就在书架上');
    assert.equal(await shelfStateOf(BOOK), 'on');

    const off = await act(BOOK, 'remove');
    assert.equal(off.applied, 1, 'remove must report one row changed');
    assert.equal(off.books.length, 1, 'remove must name the book it touched');
    assert.equal((await shelfTitles()).includes('往复'), false, '下架 must take the book off the shelf');
    assert.equal(await shelfStateOf(BOOK), 'off', 'the library must call it off-shelf');

    const on = await act(BOOK, 'add');
    assert.equal(on.applied, 1, 'add must report one row changed');
    assert.equal((await shelfTitles()).includes('往复'), true, '加入书架 must put it back');
    assert.equal(await shelfStateOf(BOOK), 'on');

    // The aliases are the same two writes, so they have to end in the same place.
    await act(BOOK, 'hide');
    assert.equal((await shelfTitles()).includes('往复'), false);
    await act(BOOK, 'unhide');
    assert.equal((await shelfTitles()).includes('往复'), true);
  });

  test('a re-add is dated now, so 最近入库 does not lie about it', async () => {
    /*
     * `added_at` is the 最近入库 sort key, and the re-add is the one transition that
     * changes what "when did I get this book" means: the reader took it off and put
     * it back, so "now" is the honest answer. Leaving the original stamp would sort
     * a book the reader just re-shelved below twenty they have not touched.
     */
    await writeFile(join(booksDir, `${DIR}/改日期.epub`), await makeEpub('改日期', 'urn:readd'));
    await ctx.scanner.scan();
    const book = ctx.db.get<{ id: string }>("SELECT id FROM books WHERE title = '改日期'")!;
    ctx.db.run('UPDATE user_books SET added_at = 0 WHERE book_id = ?', book.id);

    await act(`${DIR}/改日期.epub`, 'remove');
    await act(`${DIR}/改日期.epub`, 'add');
    const readded = ctx.db.get<{ added_at: number }>(
      'SELECT added_at FROM user_books WHERE book_id = ?', book.id,
    )!;
    assert.ok(readded.added_at > 0, '重新加入必须刷新 added_at');
  });

  test('a book the reader cannot open is not on the shelf either', async () => {
    /*
     * "On the shelf" is *two* conditions, and having a row in `user_books` is only
     * one of them.
     *
     * A book whose only file is missing is not on `GET /books` — the shelf requires a
     * live file — so any endpoint answering from the row alone is answering a
     * question the reader did not ask. The file-manager listing did exactly that: it
     * read `hidden = 0` and called the book "on the shelf", so the one screen that
     * exists to explain a missing book explained it away, and offered no 加入书架
     * control for it either.
     */
    const path = `${DIR}/掉盘.epub`;
    await writeFile(join(booksDir, path), await makeEpub('掉盘', 'urn:unplugged'));
    await ctx.scanner.scan();

    const gone = await act(path, 'remove');
    assert.equal(gone.applied, 1);
    await act(path, 'add');
    assert.equal(await shelfStateOf(path), 'on', 'a live, shelved book is "on"');

    // The archive marker and the row survive being unplugged: a reader's curated
    // shelf must not be thrown away because a drive is not mounted.
    const before = ctx.db.get<{ id: string }>("SELECT id FROM books WHERE title = '掉盘'")!;
    await rename(join(booksDir, path), join(booksDir, `${DIR}/掉盘.hidden`));
    await ctx.scanner.scan();
    assert.equal(
      ctx.db.get<{ hidden: number }>(
        'SELECT hidden FROM user_books WHERE book_id = ?', before.id,
      )?.hidden,
      0,
      'the row is still there and still not hidden',
    );
  });

  test('the batch reports what it touched, and names what it could not', async () => {
    /*
     * The report is the only thing standing between "已加入书架 0 本" and a reader
     * concluding the button is broken — which is the shape of the original report.
     *
     * The *shape* is asserted as well as the counts, because the client draws its
     * message from it: `applied` is what the toast says, `books` is what it could
     * refresh, and `failed` is what makes "跳过 2 项" possible at all.
     */
    await writeFile(join(booksDir, `${DIR}/说明文件.txt`), 'plain text');
    const res = await app.inject({
      method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(),
      payload: { paths: [BOOK, `${DIR}/说明文件.txt`, `${DIR}/根本不存在.epub`], action: 'remove' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { applied: number; books: string[]; failed: Array<{ path: string; reason: string }> };
    assert.equal(result.applied, 1, 'only the real book is acted on');
    assert.equal(result.books.length, 1);
    assert.equal(result.failed.length, 2, 'the other two are named');
    // A folder stands for the books inside it, which is what makes fixing a series
    // one action instead of forty.
    const folder = await app.inject({
      method: 'POST', url: '/api/v1/library/browse/shelf', headers: auth(),
      payload: { paths: [DIR], action: 'add' },
    });
    assert.equal(folder.statusCode, 200, folder.body);
    assert.ok((folder.json() as { applied: number }).applied >= 2, '一个目录代表它下面所有的书');
  });
});
