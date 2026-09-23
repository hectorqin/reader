import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { Db } from '../src/db/index.ts';
import { createBackup, verifyBackup } from '../src/maintenance/backup.ts';
import { uploadBackup } from '../src/maintenance/webdav.ts';

test('WebDAV publishes only verified backup archives, retries staging and never overwrites destinations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-dav-test-')), data = join(root, 'data'), backup = join(root, 'snapshot');
  await mkdir(data); const db = new Db(join(data, 'reader.db')); db.close();
  await writeFile(join(data, 'token.secret'), 'private'); await createBackup(data, backup);
  const objects = new Map<string, Buffer>(); let failOnce = true, tamper = false, conflict = false, requests = 0, puts = 0;
  const server = createServer(async (req, res) => {
    requests++;
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('reader:private-password').toString('base64'));
    const path = req.url!;
    if (req.method === 'HEAD') { res.statusCode = objects.has(path) ? 200 : 404; res.end(); }
    else if (req.method === 'PUT') {
      puts++; const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (failOnce) { failOnce = false; res.statusCode = 503; res.end(); return; }
      objects.set(path, Buffer.concat(chunks)); res.statusCode = 201; res.end();
    } else if (req.method === 'GET') { res.end(tamper ? Buffer.from('corrupt') : objects.get(path)); }
    else if (req.method === 'MOVE') {
      assert.equal(req.headers.overwrite, 'F'); const target = new URL(String(req.headers.destination)).pathname;
      if (conflict || objects.has(target)) { res.statusCode = 412; res.end(); return; }
      objects.set(target, objects.get(path)!); objects.delete(path); res.statusCode = 201; res.end();
    } else if (req.method === 'DELETE') { objects.delete(path); res.statusCode = 204; res.end(); }
    else { res.statusCode = 405; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/backups/`;
  const options = { url, username: 'reader', password: 'private-password', name: 'snapshot.zip' };
  const result = await uploadBackup(backup, options);
  assert.equal(puts, 2); assert.equal(result.bytes, objects.get('/backups/snapshot.zip')!.length);
  assert.equal(objects.size, 1);
  const extracted = join(root, 'extracted'); await mkdir(extracted);
  const zip = await JSZip.loadAsync(objects.get('/backups/snapshot.zip')!);
  for (const file of Object.values(zip.files)) {
    if (file.dir) await mkdir(join(extracted, file.name), { recursive: true });
    else { await mkdir(dirname(join(extracted, file.name)), { recursive: true }); await writeFile(join(extracted, file.name), await file.async('nodebuffer')); }
  }
  assert.deepEqual(await verifyBackup(extracted), await verifyBackup(backup));
  await assert.rejects(uploadBackup(backup, options), /同名/);
  tamper = true; await assert.rejects(uploadBackup(backup, { ...options, name: 'tampered.zip' }), /校验/);
  assert.equal(objects.size, 1);
  tamper = false; conflict = true; await assert.rejects(uploadBackup(backup, { ...options, name: 'conflict.zip' }), /发布失败/);
  assert.equal(objects.size, 1);
  const before = requests;
  await assert.rejects(uploadBackup(backup, { ...options, maxBytes: 1 }), /上限/);
  await assert.rejects(uploadBackup(backup, { ...options, name: '../escape.zip' }), /文件名/);
  await assert.rejects(uploadBackup(backup, { ...options, url: 'http://remote.test/backups' }), /HTTPS/);
  await assert.rejects(uploadBackup(backup, { ...options, signal: AbortSignal.abort() }));
  assert.equal(requests, before);
  await writeFile(join(backup, 'token.secret'), 'changed');
  await assert.rejects(uploadBackup(backup, options), /校验失败/);
  assert.equal(requests, before);
});
