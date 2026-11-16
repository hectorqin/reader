import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Db } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { NotesLibraryService } from '../src/services/notes-library.ts';
import { SyncService, encodeTags } from '../src/services/sync.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { UserService } from '../src/services/users.ts';
import { buildApp } from '../src/http/app.ts';
import { signAccessToken } from '../src/services/tokens.ts';
import type { AppConfig } from '../src/config/index.ts';
import type { AppContext } from '../src/http/context.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1, 20); // 2026-11-01T20:00Z, already 11-02 in UTC+8

function addNote(db: Db, id: string, user: string, book: string, type: string, text: string, comment: string, at: number, deleted = 0): void {
  db.run('INSERT INTO notes(id,user_id,book_id,type,locator,text,comment,color,updated_at,deleted) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id, user, book, type, `r1:0.5:${id}`, text, comment, '#ffd54f', at, deleted);
}

function fixture() {
  const db = new Db(':memory:');
  for (const id of ['alice', 'bob']) db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,'x','member',0,0)", id, id);
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b1','h1','围城','钱锺书','epub',0,0)");
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b2','h2','# 局外人\n','加缪','epub',0,0)");
  addNote(db, 'n1', 'alice', 'b1', 'highlight', '城外的人想冲进去', '', T0);
  addNote(db, 'n2', 'alice', 'b1', 'note', '婚姻是一座围城\n第二行', '100% 同意', T0 + DAY);
  addNote(db, 'n3', 'alice', 'b1', 'bookmark', '', '', T0 + 2 * DAY);
  addNote(db, 'n4', 'alice', 'b2', 'highlight', '今天，妈妈死了', '', T0 + 3 * DAY);
  addNote(db, 'n5', 'alice', 'b2', 'highlight', '已删除的一条', '', T0 + 4 * DAY, 1);
  addNote(db, 'n6', 'bob', 'b1', 'highlight', '别人的笔记', '', T0 + 5 * DAY);
  db.run("UPDATE notes SET chapter_title = '第三章', tags = ? WHERE id = 'n1'", encodeTags(['婚姻']));
  db.run("UPDATE notes SET chapter_title = '第三章', tags = ? WHERE id = 'n2'", encodeTags(['婚姻', '金句 摘抄']));
  db.run("UPDATE notes SET tags = ? WHERE id = 'n6'", encodeTags(['别人的标签']));
  // b1 is on alice's shelf with a manual title; b2 is not on her shelf.
  const shelf = { getMany: (_user: string, ids: string[]) => new Map(ids.includes('b1') ? [['b1', { title: '围城（手动）', author: '钱锺书' }]] : []) } as unknown as ShelfService;
  return { db, notes: new NotesLibraryService(db, shelf) };
}

test('the list is one account\'s live notes, newest first, with each book named as the shelf names it', () => {
  const { db, notes } = fixture();
  const result = notes.list('alice', {});
  assert.deepEqual(result.items.map(item => item.id), ['n4', 'n3', 'n2', 'n1']);
  assert.equal(result.total, 4);
  assert.deepEqual([result.items[0]!.bookTitle, result.items[3]!.bookTitle], ['# 局外人\n', '围城（手动）']);
  db.close();
});

test('the list filters by type, book and words, and pages on the server', () => {
  const { db, notes } = fixture();
  assert.deepEqual(notes.list('alice', { type: 'highlight' }).items.map(item => item.id), ['n4', 'n1']);
  assert.deepEqual(notes.list('alice', { bookId: 'b1', type: 'note' }).items.map(item => item.id), ['n2']);
  // Words are found in the quote and in the comment.
  assert.deepEqual(notes.list('alice', { q: '围城' }).items.map(item => item.id), ['n2']);
  assert.deepEqual(notes.list('alice', { q: '同意' }).items.map(item => item.id), ['n2']);
  // % is the reader's character, not a wildcard.
  assert.deepEqual(notes.list('alice', { q: '100%' }).items.map(item => item.id), ['n2']);
  assert.deepEqual(notes.list('alice', { q: '%' }).items.map(item => item.id), ['n2']);
  assert.deepEqual(notes.list('alice', { q: '_' }).items, []);

  const second = notes.list('alice', { page: 2, pageSize: 3 });
  assert.deepEqual([second.items.map(item => item.id), second.total, second.page], [['n1'], 4, 2]);
  // Past the end: an empty page that still says how many there are.
  const beyond = notes.list('alice', { page: 9, pageSize: 3 });
  assert.deepEqual([beyond.items, beyond.total], [[], 4]);
  assert.equal(notes.list('alice', { pageSize: 100000 }).pageSize, 200);
  assert.throws(() => notes.list('alice', { page: 0 }), /page/);
  assert.throws(() => notes.list('alice', { type: 'review' }), /unsupported note type/);
  db.close();
});

test('the book facet counts under the other filters and ignores the book filter itself', () => {
  const { db, notes } = fixture();
  assert.deepEqual(notes.books('alice', { bookId: 'b1' }).map(book => [book.bookId, book.title, book.count]),
    [['b2', '# 局外人\n', 1], ['b1', '围城（手动）', 3]]);
  assert.deepEqual(notes.books('alice', { type: 'bookmark' }).map(book => [book.bookId, book.count]), [['b1', 1]]);
  db.close();
});

test('markdown export groups by book, quotes the text, leaves bookmarks out and dates in the viewer\'s zone', () => {
  const { db, notes } = fixture();
  const out = notes.export('alice', { tz: 480 }, T0 + 10 * DAY);
  assert.equal(out.filename, 'reader-notes-2026-11-12.md');
  assert.equal(out.count, 3);
  assert.equal(out.content, [
    '# 读书笔记', '', '> 导出于 2026-11-12 · 2 本书 · 3 条', '',
    '## 局外人', '', '作者：加缪', '',
    '> 今天，妈妈死了', '', '— 2026-11-05 高亮', '',
    '## 围城（手动）', '', '作者：钱锺书', '',
    '### 第三章', '',
    '> 城外的人想冲进去', '', '— 2026-11-02 高亮 #婚姻', '',
    '> 婚姻是一座围城', '> 第二行', '', '100% 同意', '', '— 2026-11-03 批注 #婚姻 #金句_摘抄', '',
  ].join('\n'));
  assert.equal(notes.export('alice', { bookId: 'b2' }).count, 1);
  assert.throws(() => notes.export('alice', { format: 'pdf' }), /format/);
  db.close();
});

test('tags filter exactly, and the vocabulary is the account\'s own, most used first', () => {
  const { db, notes } = fixture();
  assert.deepEqual(notes.list('alice', { tag: '婚姻' }).items.map(item => item.id), ['n2', 'n1']);
  assert.deepEqual(notes.list('alice', { tag: '金句 摘抄' }).items.map(item => [item.id, item.chapterTitle, item.tags]), [['n2', '第三章', ['婚姻', '金句 摘抄']]]);
  // Part of a tag is not the tag.
  assert.deepEqual(notes.list('alice', { tag: '金句' }).items, []);
  assert.deepEqual(notes.tags('alice'), [{ tag: '婚姻', count: 2 }, { tag: '金句 摘抄', count: 1 }]);
  assert.deepEqual(notes.books('alice', { tag: '婚姻' }).map(book => [book.bookId, book.count]), [['b1', 2]]);
  db.close();
});

test('sync carries chapter titles and tags, and a client that sends neither leaves them as they were', () => {
  const db = new Db(':memory:');
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('alice','alice','x','member',0,0)");
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b1','h1','围城','钱锺书','epub',0,0)");
  const sync = new SyncService(db, { getMany: () => new Map() } as unknown as ShelfService);
  const base = { id: 'n1', bookId: 'b1', type: 'highlight' as const, locator: 'r1:0:c', text: '原文', comment: '', color: '', deleted: false };
  sync.push('alice', { notes: [{ ...base, chapterTitle: '第一章', tags: [' 婚姻 ', '婚姻', '金句'], updatedAt: 10 }] });
  const pulled = () => sync.pull('alice', 0).notes.map(note => [note.comment, note.chapterTitle, note.tags]);
  assert.deepEqual(pulled(), [['', '第一章', ['婚姻', '金句']]]);
  // An older client edits the comment and knows nothing of the new fields.
  sync.push('alice', { notes: [{ ...base, comment: '旧客户端的批注', updatedAt: 20 }] });
  assert.deepEqual(pulled(), [['旧客户端的批注', '第一章', ['婚姻', '金句']]]);
  // An explicit empty list clears the tags; a stale write changes nothing.
  sync.push('alice', { notes: [{ ...base, comment: '旧客户端的批注', chapterTitle: '第一章', tags: [], updatedAt: 30 }] });
  sync.push('alice', { notes: [{ ...base, tags: ['过期'], updatedAt: 5 }] });
  assert.deepEqual(pulled(), [['旧客户端的批注', '第一章', []]]);
  db.close();
});

test('json export keeps bookmarks and locators', () => {
  const { db, notes } = fixture();
  const out = notes.export('alice', { format: 'json', bookId: 'b1' }, T0);
  const doc = JSON.parse(out.content) as { version: number; books: Array<{ id: string; title: string; notes: Array<{ id: string; type: string; locator: string }> }> };
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.books.map(book => [book.id, book.title]), [['b1', '围城（手动）']]);
  assert.deepEqual(doc.books[0]!.notes.map(note => [note.id, note.type, note.locator]),
    [['n1', 'highlight', 'r1:0.5:n1'], ['n2', 'note', 'r1:0.5:n2'], ['n3', 'bookmark', 'r1:0.5:n3']]);
  db.close();
});

test('the HTTP routes answer for the signed-in account only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notes-library-')), db = new Db(':memory:');
  const config: AppConfig = { booksDir: root, dataDir: root, host: '127.0.0.1', port: 0, jwtSecret: 'notes-library-test-secret-16chars', accessTokenTtl: 604800, refreshTokenTtl: 31536000, scanInterval: 1800, watchInterval: 60, logLevel: 'silent', publicUrl: '', corsOrigins: [], webDir: join(root, 'web') };
  const ctx = { config, db, shelf: undefined, users: undefined } as unknown as AppContext;
  const app = buildApp(ctx);
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  await app.ready();
  t.after(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  for (const id of ['alice', 'bob']) db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,'x','member',0,0)", id, id);
  db.run("INSERT INTO books(id,content_hash,title,author,format,created_at,updated_at) VALUES('b1','h1','围城','钱锺书','epub',0,0)");
  addNote(db, 'n1', 'alice', 'b1', 'highlight', '城外的人想冲进去', '', T0);
  addNote(db, 'n6', 'bob', 'b1', 'highlight', '别人的笔记', '', T0);
  const headers = { authorization: 'Bearer ' + signAccessToken(config, { id: 'alice', role: 'member' }).token };

  const list = await app.inject({ url: '/api/v1/notes/library?q=' + encodeURIComponent('城外'), headers });
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(list.json().items.map((item: { id: string; bookTitle: string }) => [item.id, item.bookTitle]), [['n1', '围城']]);
  const books = await app.inject({ url: '/api/v1/notes/library/books', headers });
  assert.deepEqual(books.json().books.map((book: { bookId: string; count: number }) => [book.bookId, book.count]), [['b1', 1]]);
  const exported = await app.inject({ url: '/api/v1/notes/export?format=json', headers });
  assert.equal(exported.json().count, 1);
  assert.ok(!exported.json().content.includes('别人的笔记'));
  assert.equal((await app.inject({ url: '/api/v1/notes/library?type=review', headers })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/v1/notes/library' })).statusCode, 401);
});

test('a scan keeps a book whose file is gone while a reader still has notes in it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notes-scan-')), booksDir = join(root, 'books'), dataDir = join(root, 'data');
  await mkdir(booksDir); await mkdir(dataDir);
  const db = new Db(':memory:');
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const config = { booksDir, dataDir } as AppConfig;
  const scanner = new Scanner(db, config, { info: () => {}, warn: () => {} });
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('alice','alice','x','member',0,0)");
  await writeFile(join(booksDir, '有笔记.txt'), '第一章\n' + '有笔记的书。'.repeat(200));
  await writeFile(join(booksDir, '没笔记.txt'), '第一章\n' + '没有笔记的书。'.repeat(200));
  await scanner.scan();
  const id = (name: string) => db.get<{ book_id: string }>('SELECT book_id FROM book_files WHERE rel_path = ?', name)!.book_id;
  const kept = id('有笔记.txt'), plain = id('没笔记.txt'), tombstoned = plain;
  addNote(db, 'n1', 'alice', kept, 'highlight', '有笔记的书', '', T0);
  // A deleted note is not a reason to keep a book.
  addNote(db, 'n2', 'alice', tombstoned, 'highlight', '删掉的', '', T0, 1);
  await rm(join(booksDir, '有笔记.txt')); await rm(join(booksDir, '没笔记.txt'));
  await scanner.scan();
  const exists = (book: string) => !!db.get('SELECT 1 AS ok FROM books WHERE id = ?', book);
  assert.equal(exists(plain), false, 'a book nobody shelved or annotated is still cleaned up');
  assert.equal(exists(kept), true, 'the annotated book stays');
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE id = 'n1'")!.n, 1);
});
