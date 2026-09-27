import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';

test('creation receipts survive retries and concurrency but reject changed input and unauthorized callers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-media-receipt-'));
  const db = new Db(':memory:');
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  for (const id of ['admin', 'second']) db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,\'admin\',0,0)', id, id, 'unused');
  const libraries = new MediaLibraries(db), admin = { id: 'admin', role: 'admin' } as const;
  const input = { name: '音乐', kind: 'music', root, access: 'restricted', requestId: 'creation-request-001' } as const;
  const results = await Promise.all([libraries.create(admin, input), libraries.create(admin, input)]);
  assert.equal(results[0]!.id, results[1]!.id);
  assert.equal(libraries.list(admin).length, 1);
  assert.equal((await new MediaLibraries(db).create(admin, input)).id, results[0]!.id);
  await assert.rejects(libraries.create(admin, { ...input, name: 'different' }), { statusCode: 409 });
  await assert.rejects(libraries.create({ ...admin, role: 'member' }, input), { statusCode: 403 });
  await assert.rejects(libraries.create(admin, { ...input, requestId: '' }), { statusCode: 400 });
  const other = await libraries.create({ id: 'second', role: 'admin' }, input);
  assert.notEqual(other.id, results[0]!.id);
  await rm(root, { recursive: true, force: true });
  assert.equal((await libraries.create(admin, input)).id, results[0]!.id, 'receipt remains valid when the original directory goes offline');
  assert.equal(libraries.list(admin).length, 2);
});

test('media grants are isolated, revoked immediately and never expose server paths to members', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-media-library-'));
  const db = new Db(':memory:');
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  for (const [id,role] of [['admin','admin'],['alice','member'],['bob','member']]) {
    db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)',id!,id!,'unused',role!);
  }
  const readingSchema = db.all("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name");
  const libraries = new MediaLibraries(db);
  const admin = {id:'admin',role:'admin'} as const;
  const alice = {id:'alice',role:'member'} as const;
  const bob = {id:'bob',role:'member'} as const;
  const lib = await libraries.create(admin,{name:'音频',kind:'audiobook',root,access:'restricted'});
  assert.deepEqual(libraries.list(alice), []);
  assert.throws(() => libraries.get(bob,lib.id), { statusCode:404 });
  await assert.rejects(libraries.create(alice,{name:'invalid',kind:'music',root,access:'all'}),{statusCode:403});
  libraries.setAccess(admin,lib.id,'restricted',['alice','alice']);
  assert.equal(libraries.list(alice).length,1);
  assert.equal('root' in libraries.get(alice,lib.id),false);
  assert.throws(() => libraries.configuration(alice,lib.id), {statusCode:403});
  assert.deepEqual(libraries.configuration(admin,lib.id).userIds,['alice']);
  db.run("UPDATE users SET disabled=1 WHERE id='alice'");
  libraries.setAccess(admin,lib.id,'restricted',['alice','bob']);
  assert.deepEqual(libraries.configuration(admin,lib.id).userIds,['alice','bob']);
  libraries.setAccess(admin,lib.id,'restricted',['bob']);
  assert.throws(()=>libraries.setAccess(admin,lib.id,'restricted',['alice','bob']),{statusCode:400});
  assert.deepEqual(libraries.configuration(admin,lib.id).userIds,['bob']);
  db.run("UPDATE users SET disabled=0 WHERE id='alice'");
  libraries.setAccess(admin,lib.id,'restricted',['alice']);
  assert.throws(() => libraries.setAccess(admin,lib.id,'all',['unknown']),{statusCode:400});
  assert.equal(libraries.get(alice,lib.id).access,'restricted');
  libraries.setAccess(admin,lib.id,'restricted',[]);
  await assert.rejects(libraries.storage(alice,lib.id),{statusCode:404});
  libraries.setAccess(admin,lib.id,'all',[]);
  assert.equal(libraries.list(bob).length,1);
  new MediaLibraries(db);
  assert.equal(libraries.list(admin).length,1);
  assert.deepEqual(db.all("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'media_%' ORDER BY name"),readingSchema);
});
