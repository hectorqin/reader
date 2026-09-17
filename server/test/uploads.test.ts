/**
 * Upload tests.
 *
 * The feature is the only one that writes *new* bytes into the library, so the
 * behaviour worth asserting is not "the file arrived" — it is everything around
 * that: that a name cannot become a path, that a refused mount is refused before
 * anything is written, that a failed upload costs nothing, and that a zip of
 * forty volumes lands as forty books rather than as a zip.
 *
 * Real bytes throughout. The parts that break (an archive's central directory, a
 * Chinese filename, a truncated stream) only break against real input.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
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
import { UploadService, moveIntoLibrary, sanitizeUploadName } from '../src/services/uploads.ts';
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

/** A real zip, built by hand so the test controls entry names and order. */
function makeZip(entries: Array<[string, Buffer | string]>, deflate = true): Buffer {
  const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    return table;
  })();
  const crc32 = (buf: Buffer): number => {
    let crc = -1;
    for (const byte of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
    return (crc ^ -1) >>> 0;
  };

  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(raw);
    const useDeflate = deflate && deflated.byteLength < raw.byteLength;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(raw.byteLength, 22);
    local.writeUInt16LE(nameBuf.byteLength, 26);
    locals.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc32(raw), 16);
    cen.writeUInt32LE(data.byteLength, 20);
    cen.writeUInt32LE(raw.byteLength, 24);
    cen.writeUInt16LE(nameBuf.byteLength, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.byteLength + nameBuf.byteLength + data.byteLength;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function auth() {
  return { authorization: `Bearer ${token}` };
}

/**
 * Builds a `multipart/form-data` body. Written by hand rather than with a
 * library: the boundary and the exact bytes are part of what is being tested, and
 * a helper that quietly normalised a weird filename would hide the case that
 * matters most.
 */
function multipart(
  files: Array<{ field: string; filename: string; content: Buffer }>,
  fields: Record<string, string> = {},
): { body: Buffer; contentType: string } {
  const boundary = '----reader-test-boundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `content-type: application/octet-stream\r\n\r\n`,
        'utf8',
      ),
      file.content,
      Buffer.from('\r\n', 'utf8'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-uploads-'));
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
    uploads: undefined as never,
    log: undefined as never,
  };
  const silent = Fastify({ logger: false });
  ctx.log = silent.log;
  ctx.scanner = new Scanner(db, config, { info: () => {}, warn: () => {} });
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  ctx.sync = new SyncService(db);
  ctx.tts = new TtsService(config);
  ctx.browse = new BrowseService(db, config, ctx.shelf);
  ctx.uploads = new UploadService(db, config, ctx.browse, ctx.scanner);
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

  await mkdir(join(booksDir, '待整理'), { recursive: true });
});

after(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe('uploading a book', () => {
  /**
   * A directory of its own per test.
   *
   * The prompt's library is shared between tests by design — that is what makes
   * the conflict policies testable at all — so the collision cases name their
   * own folder instead of relying on a particular file being uploaded first.
   */
  let caseIndex = 0;
  const freshTarget = async (): Promise<string> => {
    caseIndex += 1;
    const dir = `用例${caseIndex}`;
    await mkdir(join(booksDir, dir), { recursive: true });
    return dir;
  };

  test('stores the file, indexes it, and reports the book it became', async () => {
    const target = await freshTarget();
    const epub = await makeEpub('三体', 'urn:upload-one');
    const { body, contentType } = multipart(
      [{ field: 'file', filename: '三体.epub', content: epub }],
      { path: target },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as {
      uploaded: Array<{ path: string; name: string; size: number; bookId?: string; title?: string }>;
      skipped: unknown[];
      scan: { added: number };
    };
    assert.equal(result.uploaded.length, 1);
    assert.equal(result.uploaded[0]!.path, `${target}/三体.epub`);
    assert.equal(result.uploaded[0]!.title, '三体');
    // Indexed before the response is written, not at the next scheduled scan:
    // a file on disk that the shelf cannot see is the exact state this product
    // exists to avoid.
    assert.ok(result.uploaded[0]!.bookId, 'the upload should be indexed already');
    assert.equal(result.uploaded[0]!.size, epub.byteLength);

    const onDisk = await readFile(join(booksDir, target, '三体.epub'));
    assert.equal(onDisk.byteLength, epub.byteLength);
  });

  test('a Chinese name written by a Windows client lands as a name, not a path', async () => {
    const epub = await makeEpub('斗破苍穹', 'urn:upload-two');
    const { body, contentType } = multipart([
      { field: 'file', filename: 'C:\\Users\\me\\我的书\\斗破苍穹.epub', content: epub },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { uploaded: Array<{ path: string }> };
    // Only the leaf is meaningful, and the backslashes must not survive as part
    // of a file name.
    assert.equal(result.uploaded[0]!.path, '斗破苍穹.epub');
    assert.ok((await readdir(booksDir)).includes('斗破苍穹.epub'));
  });

  test('a name that tries to escape the library is refused rather than sanitised into place', () => {
    for (const name of ['..', '../..', '/', '.', '']) {
      assert.throws(() => sanitizeUploadName(name));
    }
    // A traversal inside a *path* collapses to the leaf, which is inside.
    assert.equal(sanitizeUploadName('../../etc/passwd.epub'), 'passwd.epub');
    assert.equal(sanitizeUploadName('a\u0000b.epub'), 'ab.epub');
    // A leading dot is not cosmetic: the scanner skips dot-prefixed entries by
    // design, so a book uploaded as `.三体.epub` would be on disk and absent from
    // the shelf forever.
    assert.equal(sanitizeUploadName('.三体.epub'), '三体.epub');
    assert.equal(sanitizeUploadName('..\\.hidden.epub'), 'hidden.epub');
    // A trailing dot or space is invisible on Windows and dropped by SMB; the
    // name that gets indexed has to be the name the user will see.
    assert.equal(sanitizeUploadName('三体.epub.'), '三体.epub');
  });

  test('traversal in the destination directory is refused', async () => {
    const epub = await makeEpub('逃逸', 'urn:upload-three');
    for (const target of ['../外面', '..', '/etc', '待整理/../..']) {
      const { body, contentType } = multipart(
        [{ field: 'file', filename: '逃逸.epub', content: epub }],
        { path: target },
      );
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/library/upload',
        headers: { ...auth(), 'content-type': contentType },
        payload: body,
      });
      assert.ok(res.statusCode >= 400, `${target} answered ${res.statusCode}`);
    }
  });

  test('a name already taken is renamed, skipped or refused according to the policy', async () => {
    const target = await freshTarget();
    const first = await makeEpub('重名', 'urn:dupe-1');
    const second = await makeEpub('重名', 'urn:dupe-2');

    const upload = async (content: Buffer, onConflict?: string) => {
      const { body, contentType } = multipart(
        [{ field: 'file', filename: '重名.epub', content }],
        { path: target, ...(onConflict ? { onConflict } : {}) },
      );
      return app.inject({
        method: 'POST',
        url: '/api/v1/library/upload',
        headers: { ...auth(), 'content-type': contentType },
        payload: body,
      });
    };

    // The first copy takes the name; every upload after it is the conflict the
    // policy exists for.
    const initial = await upload(first);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal((initial.json() as { uploaded: Array<{ name: string }> }).uploaded[0]!.name, '重名.epub');

    const renamed = await upload(second);
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((renamed.json() as { uploaded: Array<{ name: string }> }).uploaded[0]!.name, '重名 (2).epub');

    const skipped = await upload(first, 'skip');
    assert.equal(skipped.statusCode, 200, skipped.body);
    const skippedBody = skipped.json() as { uploaded: unknown[]; skipped: Array<{ reason: string }> };
    assert.equal(skippedBody.uploaded.length, 0);
    assert.equal(skippedBody.skipped.length, 1);
  });

  test('an empty upload is refused, and a failed upload leaves nothing behind', async () => {
    const { body, contentType } = multipart([{ field: 'file', filename: '空.epub', content: Buffer.alloc(0) }]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'EMPTY_UPLOAD');

    // Every upload copies its bytes into DATA_DIR/uploads before touching the
    // library, so the scratch area is where a failure could accumulate. It must
    // not: a library that cannot be uploaded to twice is worse than no feature.
    //
    // Asked of a *fresh* scratch root, because node:test runs the cases in this
    // file concurrently against one library: asserting on the shared directory
    // would be asserting on whichever other case happens to be mid-flight.
    const isolated = await mkdtemp(join(root, 'scratch-'));
    const service = new UploadService(ctx.db, { ...ctx.config, dataDir: isolated }, ctx.browse, ctx.scanner);
    const empty = await makeEpub('空', 'urn:empty');
    await assert.rejects(
      service.store({ name: '空.epub', stream: Readable.from(Buffer.alloc(0)), target: '' }),
      (err: unknown) => (err as { code?: string }).code === 'EMPTY_UPLOAD',
    );
    const left = await readdir(join(isolated, 'uploads')).catch(() => []);
    assert.deepEqual(left, [], 'a failed upload must not leave scratch behind');
    void empty;
    assert.ok(!(await readdir(booksDir)).includes('空.epub'));
  });

  test('a stream that dies mid-transfer is reported as an incomplete upload', async () => {
    const broken = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('connection reset'));
      },
    });
    await assert.rejects(
      ctx.uploads.store({ name: '半本.epub', stream: broken, target: '' }),
      (err: unknown) => (err as { code?: string }).code === 'UPLOAD_INCOMPLETE',
    );
    assert.ok(!(await readdir(booksDir)).includes('半本.epub'));
  });

  test('a batch is stored together and indexed once', async () => {
    const target = await freshTarget();
    const { body, contentType } = multipart(
      [
        { field: 'file', filename: '合集一.epub', content: await makeEpub('合集一', 'urn:batch-a') },
        { field: 'file', filename: '合集二.epub', content: await makeEpub('合集二', 'urn:batch-b') },
      ],
      { path: target },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as {
      uploaded: Array<{ path: string; bookId?: string }>;
      scan: { startedAt: number; finishedAt: number };
    };
    assert.equal(result.uploaded.length, 2);
    assert.ok(result.uploaded.every((item) => item.bookId), 'both files should be indexed');
    // One scan, not one per file: a batch is one library change.
    assert.ok(result.scan.finishedAt >= result.scan.startedAt);
  });

  test('a batch whose later name is taken is still refused whole', async () => {
    const target = await freshTarget();
    const taken = await makeEpub('占用', 'urn:taken');
    const seed = multipart([{ field: 'file', filename: '占用.epub', content: taken }], { path: target });
    const seeded = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': seed.contentType },
      payload: seed.body,
    });
    assert.equal(seeded.statusCode, 200, seeded.body);

    const { body, contentType } = multipart(
      [
        { field: 'file', filename: '新书.epub', content: await makeEpub('新书', 'urn:new') },
        { field: 'file', filename: '占用.epub', content: taken },
      ],
      { path: target, onConflict: 'fail' },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    // `fail` names the one conflict that has no reasonable guess behind it, so
    // the whole request is refused. Nothing may have been written for the first
    // file either — a half-applied batch is the shape a user cannot reason about.
    assert.equal(res.statusCode, 409, res.body);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'DESTINATION_EXISTS');
    const names = await readdir(join(booksDir, target));
    assert.deepEqual(names, ['占用.epub']);
  });

  test('a JSON body is refused, so the client gets a usable error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': 'application/json' },
      payload: { file: 'nope' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'NOT_MULTIPART');
  });

  test('the endpoint requires a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/library/upload' });
    assert.equal(res.statusCode, 401);
  });

  test('the write probe answers before a phone starts sending bytes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/library/upload', headers: auth() });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as { writable: boolean }).writable, true);
  });
});

describe('uploading an archive', () => {
  let archiveCase = 0;
  const freshArchiveTarget = async (): Promise<string> => {
    archiveCase += 1;
    const dir = `压缩包${archiveCase}`;
    await mkdir(join(booksDir, dir), { recursive: true });
    return dir;
  };

  test('a zip of books is unpacked into the library, one book each', async () => {
    const target = await freshArchiveTarget();
    const archive = makeZip([
      ['系列/第01卷.epub', await makeEpub('第一卷', 'urn:series-1')],
      ['系列/第02卷.epub', await makeEpub('第二卷', 'urn:series-2')],
      ['系列/说明.txt', '第一卷：开始\n第二卷：结束\n'],
    ]);
    const { body, contentType } = multipart(
      [{ field: 'file', filename: '系列合集.zip', content: archive }],
      { path: target },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { uploaded: Array<{ path: string; title?: string; kind: string }> };
    assert.equal(result.uploaded.length, 3);
    const paths = result.uploaded.map((item) => item.path).sort();
    // The single wrapping folder is flattened, because that is what every
    // "download this series" zip looks like.
    assert.deepEqual(paths, [`${target}/第01卷.epub`, `${target}/第02卷.epub`, `${target}/说明.txt`]);
    assert.ok(result.uploaded.every((item) => item.kind === 'archive-entry'));
    assert.ok(result.uploaded.some((item) => item.title === '第一卷'));
  });

  test('a nested comic archive keeps its structure, because that is what makes it a book', async () => {
    const target = await freshArchiveTarget();
    const archive = makeZip([
      ['套图/第01卷/001.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
      ['套图/第01卷/002.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
      ['套图/第02卷/001.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ]);
    const { body, contentType } = multipart(
      [{ field: 'file', filename: '漫画.zip', content: archive }],
      { path: target },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { uploaded: Array<{ path: string; bookId?: string; title?: string }> };
    // `漫画/` is one folder, so it is flattened; the volumes inside it are not.
    // Flattening those would destroy the volume layout the comic handler reads.
    assert.deepEqual(
      result.uploaded.map((item) => item.path).sort(),
      [`${target}/第01卷/001.jpg`, `${target}/第01卷/002.jpg`, `${target}/第02卷/001.jpg`],
    );
    assert.ok(result.uploaded.every((item) => item.bookId), 'the folder as a whole should be a book');
  });

  test('an entry name cannot escape the target directory', async () => {
    const archive = makeZip([
      ['../../逃逸.txt', 'nope'],
      ['/绝对路径.txt', 'nope'],
      ['ok/正常.txt', '这本书在目录里\n'],
    ]);
    const { body, contentType } = multipart([
      { field: 'file', filename: '恶意.zip', content: archive },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { uploaded: Array<{ path: string }>; skipped: Array<{ name: string }> };
    const paths = result.uploaded.map((item) => item.path);
    // Nothing outside the library, and nothing that is not simply a name.
    for (const path of paths) {
      assert.ok(!path.includes('..'), `${path} should not be a traversal`);
      assert.ok(!path.startsWith('/'), `${path} should not be absolute`);
    }
    // The two hostile names are refused rather than rewritten into place.
    assert.ok(!paths.some((path) => path.includes('逃逸')));
    assert.ok(!paths.some((path) => path.includes('绝对路径')));
    await assert.rejects(stat(join(root, '逃逸.txt')));
  });

  test('a zip that contains nothing is refused', async () => {
    const { body, contentType } = multipart([
      { field: 'file', filename: '空.zip', content: makeZip([]) },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/upload',
      headers: { ...auth(), 'content-type': contentType },
      payload: body,
    });
    assert.ok(res.statusCode >= 400, res.body);
  });
});

describe('batch management', () => {
  let batchRoot: string;

  before(async () => {
    batchRoot = '批量';
    await mkdir(join(booksDir, batchRoot), { recursive: true });
    await writeFile(join(booksDir, batchRoot, '卷一.epub'), await makeEpub('合集第一卷', 'urn:batch-1'));
    await writeFile(join(booksDir, batchRoot, '卷二.epub'), await makeEpub('合集第二卷', 'urn:batch-2'));
    await ctx.scanner.scan();
  });

  test('one patch rewrites the metadata of a whole folder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/metadata',
      headers: auth(),
      payload: { paths: [batchRoot], fields: { author: '批量作者', series: '合集' } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { applied: number; books: string[]; failed: Array<{ path: string }> };
    assert.equal(result.applied, 2);
    assert.equal(result.books.length, 2);
    assert.deepEqual(result.failed, []);

    // Read through the shelf, not the base column: a manual override is applied
    // when the book is read, so a test that inspected `books.author` would see
    // the embedded value and conclude the edit had been lost.
    const books = ctx.db.all<{ book_id: string }>(
      'SELECT book_id FROM book_files WHERE rel_path LIKE ?',
      `${batchRoot}/%`,
    );
    assert.equal(books.length, 2);
    const authors = books.map((row) => ctx.shelf.get(userId, row.book_id).author);
    assert.deepEqual(authors, ['批量作者', '批量作者']);
  });

  test('a path that is not a book is reported rather than failing the batch', async () => {
    await mkdir(join(booksDir, '空目录'), { recursive: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/metadata',
      headers: auth(),
      payload: { paths: [`${batchRoot}/卷一.epub`, '空目录'], fields: { publisher: '某社' } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json() as { applied: number; failed: Array<{ path: string; reason: string }> };
    assert.equal(result.applied, 1);
    assert.deepEqual(result.failed, [{ path: '空目录', reason: 'NOT_A_BOOK' }]);
  });

  test('books can be taken off the shelf and put back without touching the disk', async () => {
    const before = ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND hidden = 0',
      userId,
    );
    const removed = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/shelf',
      headers: auth(),
      payload: { paths: [batchRoot], action: 'remove' },
    });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((removed.json() as { applied: number }).applied, 2);

    const after = ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND hidden = 0',
      userId,
    );
    assert.equal(after!.n, before!.n - 2);
    // The files are still there. This is a shelf operation, not a delete, and
    // conflating the two is the mistake this endpoint is shaped to prevent.
    await stat(join(booksDir, batchRoot, '卷一.epub'));

    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/shelf',
      headers: auth(),
      payload: { paths: [batchRoot], action: 'unhide' },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    const back = ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND hidden = 0',
      userId,
    );
    assert.equal(back!.n, before!.n);
  });

  test('an unknown shelf action is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/shelf',
      headers: auth(),
      payload: { paths: [batchRoot], action: 'delete' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'BAD_ACTION');
  });

  test('a batch with no editable field is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library/browse/metadata',
      headers: auth(),
      payload: { paths: [batchRoot], fields: { id: 'nope' } },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('a read-only mount', () => {
  /**
   * Stands in for a read-only bind mount, which looks writable by mode bits and
   * refuses every write with `EPERM`.
   *
   * Simulated on the probe because the alternative is remounting the test's own
   * filesystem, which CI runs as root and would let straight through — the whole
   * reason the writability check probes by writing rather than reading mode bits.
   */
  const withReadOnly = async <T>(fn: () => Promise<T>): Promise<T> => {
    const original = ctx.browse.writable.bind(ctx.browse);
    ctx.browse.writable = async () => false;
    try {
      return await fn();
    } finally {
      ctx.browse.writable = original;
    }
  };

  test('the probes agree that the mount cannot be written to', async () => {
    await withReadOnly(async () => {
      const probe = await app.inject({ method: 'GET', url: '/api/v1/library/upload', headers: auth() });
      assert.equal(probe.statusCode, 200);
      assert.equal((probe.json() as { writable: boolean }).writable, false);
    });
  });

  test('refuses an upload with 403 before storing a byte', async () => {
    const epub = await makeEpub('只读', 'urn:ro');
    const { body, contentType } = multipart([{ field: 'file', filename: '只读.epub', content: epub }], {
      path: '待整理',
    });
    const res = await withReadOnly(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/library/upload',
        headers: { ...auth(), 'content-type': contentType },
        payload: body,
      }),
    );
    // A 403 with a code the client can act on, rather than an `EROFS` stack
    // trace: the mount is the deployment's, and the answer has to say so.
    assert.equal(res.statusCode, 403, res.body);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'READ_ONLY_MOUNT');
    await assert.rejects(stat(join(booksDir, '待整理', '只读.epub')));
  });

  test('leaves no scratch behind when the mount refuses the write', async () => {
    const epub = await makeEpub('只读二', 'urn:ro-2');
    const { body, contentType } = multipart([{ field: 'file', filename: '只读二.epub', content: epub }]);
    const res = await withReadOnly(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/library/upload',
        headers: { ...auth(), 'content-type': contentType },
        payload: body,
      }),
    );
    assert.equal(res.statusCode, 403);
    // Asked of a *fresh* scratch root, because node:test runs the cases in this
    // file concurrently against one library: asserting on the shared directory
    // would be asserting on whichever other case happens to be mid-flight.
    const isolated = await mkdtemp(join(root, 'ro-scratch-'));
    const service = new UploadService(ctx.db, { ...ctx.config, dataDir: isolated }, ctx.browse, ctx.scanner);
    await withReadOnly(() =>
      assert.rejects(
        service.store({ name: '只读三.epub', stream: Readable.from(epub), target: '待整理' }),
        (err: unknown) => (err as { code?: string }).code === 'READ_ONLY_MOUNT',
      ),
    );
    // The bytes were received before the mount was consulted, so the scratch copy
    // is exactly what a refusal has to clean up.
    const left = await readdir(join(isolated, 'uploads')).catch(() => []);
    assert.deepEqual(left, [], 'a refused upload must not leave scratch behind');
  });
});

describe('moving a staged file into the library', () => {
  /**
   * The scratch directory and the library are different mounts in every real
   * deployment — `DATA_DIR` is the container's writable layer, `BOOKS_DIR` is a
   * bind mount — so `rename` across them fails with `EXDEV`. The move has to
   * fall back to copying instead of surfacing a raw errno to the user.
   *
   * The cross-device rename is injected rather than staged on two real mounts:
   * ownership of the branch under test is the `EXDEV` handling, not the kernel's.
   */
  const exdev = (): never => {
    const err = new Error('EXDEV: cross-device link not permitted, rename') as NodeJS.ErrnoException;
    err.code = 'EXDEV';
    throw err;
  };

  test('copies when the rename reports EXDEV, and removes the scratch file', async () => {
    const dir = await mkdtemp(join(root, 'cross-'));
    const source = join(dir, 'part');
    const destination = join(booksDir, '跨设备.epub');
    await writeFile(source, 'the bytes');
    await moveIntoLibrary(source, destination, exdev as unknown as typeof rename);
    assert.equal(await readFile(destination, 'utf8'), 'the bytes');
    await assert.rejects(stat(source), 'the scratch copy must not be left behind');
  });

  test('relies on rename when the filesystems match', async () => {
    const dir = await mkdtemp(join(root, 'same-'));
    const source = join(dir, 'part');
    const destination = join(booksDir, '同设备.epub');
    await writeFile(source, 'the bytes');
    await moveIntoLibrary(source, destination);
    assert.equal(await readFile(destination, 'utf8'), 'the bytes');
    await assert.rejects(stat(source));
  });

  test('does not swallow any other errno', async () => {
    const dir = await mkdtemp(join(root, 'enosys-'));
    const source = join(dir, 'part');
    await writeFile(source, 'the bytes');
    const enoent = (): never => {
      const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };
    await assert.rejects(
      moveIntoLibrary(source, join(booksDir, '不会存在.epub'), enoent as unknown as typeof rename),
      (err: unknown) => (err as { code?: string }).code === 'ENOENT',
    );
    // A failed move must not have copied anything either.
    await assert.rejects(stat(join(booksDir, '不会存在.epub')));
  });
});
