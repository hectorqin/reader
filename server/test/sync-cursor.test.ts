import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../src/db/index.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';

function seed(db: Pick<Db, 'run'>): void {
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('user','reader','unused','member',1,1),('other','other','unused','member',1,1)");
  db.run("INSERT INTO books(id,content_hash,format,created_at,updated_at) VALUES('book','hash','txt',1,1),('second','second','txt',1,1)");
}

function progress(bookId = 'book', updatedAt = 1) {
  return { bookId, updatedAt, locator: 'chapter1', percentage: 0.5, chapterTitle: 'one', device: 'phone' };
}

test('offline writes and tombstones are visible after an already-issued server cursor', () => {
  const db = new Db(':memory:');
  try {
    seed(db);
    const sync = new SyncService(db, new ShelfService(db));
    const before = sync.pull('user', 0).serverTime;
    sync.push('user', { progress: [progress()], notes: [{ id: 'note', bookId: 'book', type: 'note', locator: '', text: 'offline', comment: '', color: '', updatedAt: 1, deleted: false }] });
    const changed = sync.pull('user', before);
    assert.equal(changed.progress.length, 1);
    assert.equal(changed.notes.length, 1);
    assert.equal(changed.progress[0]!.updatedAt, 1);
    assert.ok(changed.serverTime > before);
    db.run("UPDATE notes SET deleted = 1 WHERE id = 'note'");
    assert.equal(sync.pull('user', changed.serverTime).notes[0]!.deleted, true);
    assert.deepEqual(sync.pull('other', before).notes, []);
    assert.deepEqual(sync.pull('user', before, 'second').progress, []);
  } finally { db.close(); }
});

test('pagination shares one boundary across progress and notes with identical client timestamps', () => {
  const db = new Db(':memory:');
  try {
    seed(db);
    const sync = new SyncService(db, new ShelfService(db));
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO notes(id,user_id,book_id,type,updated_at) VALUES(?,'user','book','note',1)");
      for (let index = 0; index < 4999; index++) insert.run(`note-${index}`);
      db.run("INSERT INTO reading_progress(user_id,book_id,updated_at) VALUES('user','book',1)");
      insert.run('last-note');
    });
    const first = sync.pull('user', 0);
    assert.equal(first.progress.length + first.notes.length, 5000);
    assert.equal(first.hasMore, true);
    assert.equal(first.progress.length, 1);
    const second = sync.pull('user', first.serverTime);
    assert.equal(second.notes.length, 1);
    assert.equal(second.notes[0]!.id, 'last-note');
    assert.equal(second.hasMore, false);
    assert.equal(sync.pull('user', second.serverTime).notes.length, 0);
    const notesOnly = sync.pull('user', 0, undefined, false);
    assert.equal(notesOnly.progress.length, 0);
    assert.equal(notesOnly.notes.length, 5000);
    assert.equal(notesOnly.hasMore, false);
  } finally { db.close(); }
});

test('cursor advances for tied timestamps and does not regress with the wall clock', () => {
  const db = new Db(':memory:');
  try {
    seed(db);
    const sync = new SyncService(db, new ShelfService(db));
    db.run('UPDATE sync_clock SET revision = ? WHERE id = 1', Date.now() + 60_000);
    const before = sync.pull('user', 0).serverTime;
    sync.push('user', { progress: [progress()] });
    const first = sync.pull('user', before);
    assert.ok(first.serverTime > before);
    sync.push('user', { progress: [{ ...progress(), locator: 'changed' }] });
    const second = sync.pull('user', first.serverTime);
    assert.ok(second.serverTime > first.serverTime);
    assert.equal(second.progress[0]!.locator, 'changed');
    sync.push('user', { progress: [{ ...progress('book', 0), locator: 'stale' }] });
    const reconciled = sync.pull('user', second.serverTime);
    assert.equal(reconciled.progress[0]!.locator, 'changed');
    assert.equal(reconciled.progress[0]!.updatedAt, 1);
  } finally { db.close(); }
});

test('existing databases are backfilled once and retain their cursor after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reader-sync-migration-'));
  const path = join(directory, 'reader.db');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(SCHEMA_SQL);
    seed({ run(sql: string) { legacy.exec(sql); } });
    legacy.exec("INSERT INTO reading_progress(user_id,book_id,updated_at) VALUES('user','book',1)");
    legacy.exec("INSERT INTO notes(id,user_id,book_id,type,updated_at) VALUES('old-note','user','book','note',1)");
    legacy.close();
    const upgraded = new Db(path);
    const first = new SyncService(upgraded, new ShelfService(upgraded)).pull('user', 0);
    assert.equal(first.progress.length, 1);
    assert.equal(first.notes.length, 1);
    upgraded.close();
    const reopened = new Db(path);
    try {
      const next = new SyncService(reopened, new ShelfService(reopened)).pull('user', first.serverTime);
      assert.equal(next.progress.length + next.notes.length, 0);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('invalid records fail validation before any batch records are written', () => {
  const db = new Db(':memory:');
  try {
    seed(db);
    const sync = new SyncService(db, new ShelfService(db));
    for (const invalid of [null, [], { ...progress(), locator: {} }, { ...progress(), updatedAt: Infinity }, { ...progress(), percentage: 'wrong' }]) {
      assert.throws(() => sync.push('user', { progress: [progress(), invalid as never] }), { code: 'BAD_PAYLOAD' });
      assert.equal(sync.progressFor('user', 'book'), null);
    }
  } finally { db.close(); }
});
