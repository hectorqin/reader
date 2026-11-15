import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { ShelfService } from '../src/services/shelf.ts';

/** 在读 / 想读 / 已读 on the shelf: marks win, otherwise progress decides; 想读 yields to reading. */
test('the shelf derives reading state from progress and marks, and filters by it', () => {
  const db = new Db(':memory:'), shelf = new ShelfService(db);
  try {
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','reader','x','member',0,0),('v','other','x','member',0,0)");
    const books = ['new', 'started', 'done', 'wanted', 'wanted-started', 'marked-done', 'reread'];
    books.forEach((id, index) => {
      db.run(`INSERT INTO books(id,content_hash,format,title,author,created_at,updated_at) VALUES(?,?,'epub',?,'作者',1,?)`, id, 'h-' + id, id, index + 1);
      db.run('INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) VALUES(?,?,?,100,1,1,1)', 'f-' + id, id, id + '.epub');
      db.run('INSERT INTO user_books(user_id,book_id,added_at,hidden) VALUES(?,?,?,0)', 'u', id, index);
    });
    const progress = (book: string, percentage: number) => db.run(
      "INSERT INTO reading_progress(user_id,book_id,locator,percentage,chapter_title,device,updated_at) VALUES('u',?,'',?,'','web',0)", book, percentage);
    progress('started', 0.42); progress('done', 1); progress('wanted-started', 0.1); progress('reread', 1);
    shelf.setReadingStatus('u', 'wanted', 'want');
    shelf.setReadingStatus('u', 'wanted-started', 'want');
    shelf.setReadingStatus('u', 'marked-done', 'finished');
    // Reading a finished book again: an explicit 在读 beats the 100% progress.
    shelf.setReadingStatus('u', 'reread', 'reading');

    const states = Object.fromEntries(shelf.list('u', { pageSize: 50 }).items.map(book => [book.id, book.readingState]));
    assert.deepEqual(states, { new: null, started: 'reading', done: 'finished', wanted: 'want', 'wanted-started': 'reading', 'marked-done': 'finished', reread: 'reading' });
    const ids = (status: 'reading' | 'want' | 'finished') => shelf.list('u', { status, pageSize: 50, sort: 'title', order: 'asc' });
    assert.deepEqual(ids('reading').items.map(book => book.id), ['reread', 'started', 'wanted-started']);
    assert.equal(ids('reading').total, 3);
    assert.deepEqual(ids('want').items.map(book => book.id), ['wanted']);
    assert.deepEqual(ids('finished').items.map(book => book.id), ['done', 'marked-done']);

    // Clearing a mark lets progress decide again; the library scope never carries a state.
    shelf.setReadingStatus('u', 'reread', null);
    assert.equal(shelf.list('u', { status: 'finished', pageSize: 50 }).total, 3);
    assert.ok(shelf.list('u', { scope: 'library', pageSize: 50 }).items.every(book => !('readingState' in book)));
    assert.ok(!('readingState' in shelf.get('u', 'done')));

    assert.throws(() => shelf.setReadingStatus('v', 'done', 'want'), { statusCode: 404 }, 'not on that account\'s shelf');
    assert.throws(() => shelf.setReadingStatus('u', 'done', 'paused' as never), { statusCode: 400 });
    assert.throws(() => shelf.list('u', { status: 'paused' as never }), { statusCode: 400 });
  } finally { db.close(); }
});

/** 最近阅读: the shelf's `updated` order is when this reader last read, not when the book last changed. */
test('the shelf orders 最近阅读 by this reader\'s own reading time', () => {
  const db = new Db(':memory:'), shelf = new ShelfService(db);
  try {
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','reader','x','member',0,0),('v','other','x','member',0,0)");
    // The book rows' own timestamps run the *other* way, as they do after a metadata edit.
    [['first', 900, 1], ['second', 800, 2], ['unread-old', 700, 3], ['unread-new', 600, 4]].forEach(([id, bookUpdated, added]) => {
      db.run(`INSERT INTO books(id,content_hash,format,title,author,created_at,updated_at) VALUES(?,?,'epub',?,'作者',1,?)`, id!, 'h-' + id, id!, bookUpdated!);
      db.run('INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) VALUES(?,?,?,100,1,1,1)', 'f-' + id, id!, id + '.epub');
      for (const user of ['u', 'v']) db.run('INSERT INTO user_books(user_id,book_id,added_at,hidden) VALUES(?,?,?,0)', user, id!, added!);
    });
    const read = (user: string, book: string, at: number) => db.run(
      `INSERT INTO reading_progress(user_id,book_id,locator,percentage,chapter_title,device,updated_at) VALUES(?,?,'',0.3,'','web',?)
       ON CONFLICT(user_id,book_id) DO UPDATE SET updated_at=excluded.updated_at`, user, book, at);
    const order = (user: string) => shelf.list(user, { sort: 'updated', order: 'desc', pageSize: 50 }).items.map(book => book.id);

    read('u', 'first', 100);
    assert.deepEqual(order('u'), ['first', 'unread-new', 'unread-old', 'second'], 'the one book read, then the unread ones, newest on the shelf first');
    read('u', 'second', 200);
    assert.deepEqual(order('u'), ['second', 'first', 'unread-new', 'unread-old'], 'reading a second book moves it to the front');
    read('u', 'first', 300);
    assert.deepEqual(order('u').slice(0, 2), ['first', 'second']);
    // Another account's reading does not reorder this one's shelf.
    read('v', 'unread-old', 999);
    assert.deepEqual(order('u').slice(0, 2), ['first', 'second']);
    assert.equal(order('v')[0], 'unread-old');
    // Paging follows the same order.
    assert.deepEqual(shelf.list('u', { sort: 'updated', order: 'desc', pageSize: 2, page: 2 }).items.map(book => book.id), ['unread-new', 'unread-old']);
    // The index keeps asking when the book changed, and an unknown key is a 400 rather than a broken query.
    assert.deepEqual(shelf.list('u', { scope: 'library', sort: 'updated', order: 'desc', pageSize: 50 }).items.map(book => book.id), ['first', 'second', 'unread-old', 'unread-new']);
    assert.throws(() => shelf.list('u', { sort: 'recent' as never }), { statusCode: 400 });
  } finally { db.close(); }
});
