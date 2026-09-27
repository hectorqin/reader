import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStorage } from '../src/media/storage/local.ts';

test('local media enumerates nested resources and streams exact byte ranges without modifying files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Album'));
  await writeFile(join(root, 'Album', '01.flac'), '0123456789');
  const storage = await LocalMediaStorage.create(root);
  const entries = await Array.fromAsync(storage.list());
  assert.equal(entries[0]?.ref, 'Album/01.flac');
  const { stream, entry } = await storage.open('Album/01.flac', { start: 2, end: 5 });
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), '2345');
  assert.equal(entry.size, 10);
  assert.deepEqual(await storage.stat('Album/01.flac'), entry);
  await assert.rejects(storage.open('Album/01.flac', { start: 10 }), { code: 'invalid-range' });
  for (const ref of ['../secret', '/absolute', 'C:/secret', 'Album/../secret', 'Album\\01.flac']) {
    await assert.rejects(storage.stat(ref), { code: 'invalid-ref' });
  }
});

test('missing roots and cancellation fail enumeration instead of reporting an empty library', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = await LocalMediaStorage.create(root);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(Array.fromAsync(storage.list(controller.signal)), { name: 'AbortError' });
  await rm(root, { recursive: true });
  await assert.rejects(Array.fromAsync(storage.list()), { code: 'ENOENT' });
});

test('junctions and symlinks cannot expose files outside the library', async t => {
  const base = await mkdtemp(join(tmpdir(), 'reader-media-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'library'), outside = join(base, 'outside');
  await mkdir(root); await mkdir(outside); await writeFile(join(outside, 'secret.mp4'), 'secret');
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const storage = await LocalMediaStorage.create(root);
  assert.deepEqual(await Array.fromAsync(storage.list()), []);
  await assert.rejects(storage.open('linked/secret.mp4'), { code: 'unsafe-path' });
});
