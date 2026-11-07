import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import Fastify from 'fastify';
import { sendAssetPayload } from '../src/http/assets.ts';

test('PDF metadata and ranges do not read the file prefix or buffer the complete file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-pdf-range-'));
  const path = join(root, 'book.pdf');
  const bytes = Buffer.alloc(8 * 1024 * 1024, 'x');
  bytes.write('PDF tail', bytes.length - 8);
  await writeFile(path, bytes);
  const app = Fastify();
  const ranges: Array<[number, number]> = [];
  let fullReads = 0;
  app.get('/pdf', (request, reply) => sendAssetPayload(request, reply, {
    stream: new Readable({ read() { fullReads += 1; this.push(null); } }),
    openRange: (start, end) => { ranges.push([start, end]); return createReadStream(path, { start, end }); },
    contentType: 'application/pdf', size: bytes.length, seekable: true,
  }));
  try {
    const head = await app.inject({ method: 'HEAD', url: '/pdf' });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers['content-length'], String(bytes.length));
    assert.equal(head.headers['accept-ranges'], 'bytes');
    assert.equal(head.body, '');
    assert.equal(fullReads, 0);
    for (const range of [`bytes=${bytes.length - 8}-${bytes.length - 1}`, 'bytes=-8']) {
      const response = await app.inject({ url: '/pdf', headers: { range } });
      assert.equal(response.statusCode, 206);
      assert.equal(response.body, 'PDF tail');
      assert.equal(response.headers['content-range'], `bytes ${bytes.length - 8}-${bytes.length - 1}/${bytes.length}`);
      assert.equal(response.headers['content-length'], '8');
    }
    assert.deepEqual(ranges, Array.from({ length: 2 }, () => [bytes.length - 8, bytes.length - 1]));
    const invalid = await app.inject({ url: '/pdf', headers: { range: `bytes=${bytes.length}-` } });
    assert.equal(invalid.statusCode, 416);
    assert.equal(invalid.headers['content-range'], `bytes */${bytes.length}`);
    assert.equal(fullReads, 0);
    assert.equal(ranges.length, 2);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
