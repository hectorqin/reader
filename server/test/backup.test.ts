import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { createBackup, restoreBackup, verifyBackup } from '../src/maintenance/backup.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'reader-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'data'); await mkdir(data);
  const db = new Db(join(data, 'reader.db'));
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','reader','hash','admin',1,1)");
  db.run("INSERT INTO books(id,content_hash,title,format,created_at,updated_at) VALUES('b','hash','书','txt',1,1)");
  db.run("INSERT INTO reading_progress(user_id,book_id,locator,percentage,updated_at) VALUES('u','b','chapter:12',0.6,10)");
  db.run("INSERT INTO notes(id,user_id,book_id,type,locator,text,updated_at) VALUES('n','u','b','highlight','chapter:12','选中文字',10)");
  db.close();
  await writeFile(join(data, 'token.secret'), 'test-secret');
  await mkdir(join(data, 'plugin-data', 'source'), { recursive: true });
  await writeFile(join(data, 'plugin-data', 'source', 'state.json'), '{"enabled":true}');
  return { root, data, backup: join(root, 'snapshot'), restored: join(root, 'restored') };
}

test('offline backup verifies and restores accounts, progress, notes, secret and plugin state', async t => {
  const f = await fixture(t);
  const manifest = await createBackup(f.data, f.backup);
  assert.ok(manifest.entries.some(e => e.path === 'reader.db'));
  assert.ok(!manifest.entries.some(e => e.path === 'reader.db-shm'));
  assert.deepEqual(await verifyBackup(f.backup), manifest);
  await restoreBackup(f.backup, f.restored);
  const db = new Db(join(f.restored, 'reader.db'));
  try {
    assert.equal(db.get<{ locator: string }>('SELECT locator FROM reading_progress')?.locator, 'chapter:12');
    assert.equal(db.get<{ text: string }>('SELECT text FROM notes')?.text, '选中文字');
    assert.equal(db.get<{ username: string }>('SELECT username FROM users')?.username, 'reader');
  } finally { db.close(); }
  assert.equal(await readFile(join(f.restored, 'token.secret'), 'utf8'), 'test-secret');
  assert.equal(await readFile(join(f.restored, 'plugin-data', 'source', 'state.json'), 'utf8'), '{"enabled":true}');
  // Restored directories can themselves be backed up; they are not snapshot directories.
  await createBackup(f.restored, join(f.root, 'second'));
});

test('refuses existing destinations and overlapping paths without touching original data', async t => {
  const f = await fixture(t);
  await assert.rejects(createBackup(f.data, join(f.data, 'nested')), /重叠/);
  await assert.rejects(createBackup(f.data, f.data), /重叠/);
  await createBackup(f.data, f.backup);
  await assert.rejects(restoreBackup(f.backup, f.data), /EEXIST/);
  assert.equal(await readFile(join(f.data, 'token.secret'), 'utf8'), 'test-secret');
});

test('tampered, incomplete and missing files are rejected before creating restore destination', async t => {
  const f = await fixture(t); await createBackup(f.data, f.backup);
  await writeFile(join(f.backup, '.reader-backup-incomplete'), 'incomplete');
  await assert.rejects(restoreBackup(f.backup, f.restored), /未完成/);
  await rm(join(f.backup, '.reader-backup-incomplete'));
  await writeFile(join(f.backup, 'token.secret'), 'changed');
  await assert.rejects(verifyBackup(f.backup), /校验失败/);
  await rm(join(f.backup, 'token.secret'));
  await assert.rejects(restoreBackup(f.backup, f.restored), /校验失败/);
  await assert.rejects(readFile(join(f.restored, 'reader.db')), /ENOENT/);
});

test('rejects manifest path injection instead of writing outside the destination', async t => {
  const f = await fixture(t); const manifest = await createBackup(f.data, f.backup);
  manifest.entries[0]!.path = '../outside';
  await writeFile(join(f.backup, 'reader-backup.json'), JSON.stringify(manifest));
  await assert.rejects(restoreBackup(f.backup, f.restored), /校验失败/);
});

test('preserves internal plugin symlinks and rejects external links', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  await symlink('token.secret', join(f.data, 'internal'));
  await createBackup(f.data, f.backup); await restoreBackup(f.backup, f.restored);
  assert.equal(await readFile(join(f.restored, 'internal'), 'utf8'), 'test-secret');
  await symlink('../snapshot/token.secret', join(f.data, 'external'));
  await assert.rejects(createBackup(f.data, join(f.root, 'bad')), /数据目录外/);
});
