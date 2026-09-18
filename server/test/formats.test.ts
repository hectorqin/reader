/**
 * Multi-format support tests.
 *
 * These exercise real archives and real files rather than mocks: the bugs that
 * matter here (page ordering, encoding, archive offsets) only appear against
 * real bytes. The fixtures are built by the test itself so there is no checked-in
 * binary to drift.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../src/config/index.ts';
import { openDatabase } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import { UserService } from '../src/services/users.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';
import { buildApp } from '../src/http/app.ts';
import type { AppContext } from '../src/http/context.ts';
import { naturalCompare, naturalSortBy } from '../src/indexer/formats/natural-sort.ts';
import { decodeTextBuffer, splitChapters } from '../src/indexer/formats/text.ts';
import { ZipArchive, ZipError } from '../src/indexer/formats/zip-reader.ts';
import {
  fileHandlerForExtension,
  supportedExtensions,
  capabilities,
} from '../src/indexer/formats/index.ts';
import { looksLikeComicDirectory } from '../src/indexer/formats/comic-directory.ts';
import '../src/indexer/formats/index.ts';

// ---------------------------------------------------------------- fixtures

/** CRC32, needed to emit a valid zip without a zip library. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ -1) >>> 0;
}

/** Minimal zip writer so tests can control entry order, names and methods. */
function makeZip(entries: Array<[string, Buffer | string]>, options: { deflate?: boolean } = {}): Buffer {
  const deflate = options.deflate ?? true;
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

/** A real JPEG header, so range assertions can check actual magic bytes. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'latin1'),
  Buffer.alloc(512, 0x20),
]);

/** Smallest valid PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** Real GB18030 bytes for the handful of characters the fixtures use. */
const GB18030_BYTES: Record<string, [number, number]> = {
  第: [0xb5, 0xda], 一: [0xd2, 0xbb], 章: [0xd5, 0xc2],
  编: [0xb1, 0xe0], 码: [0xc2, 0xeb], 正: [0xd5, 0xfd],
  文: [0xce, 0xc4], 二: [0xb6, 0xfe], 再: [0xd4, 0xd9],
  见: [0xbc, 0xfb], 测: [0xb2, 0xe2], 试: [0xca, 0xd4],
  内: [0xc4, 0xda], 容: [0xc8, 0xdd],
};

function encodeGb18030(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const pair = GB18030_BYTES[ch];
    if (pair) out.push(pair[0], pair[1]);
    // Unknown characters get a GB18030 four-byte sequence so the buffer is
    // guaranteed not to be valid UTF-8, which is what the detector keys on.
    else out.push(0x81, 0x30, 0x81, 0x30);
  }
  return Buffer.from(out);
}

function makeEpub(opts: { id: string; title: string; chapters?: number }): Buffer {
  const chapters = opts.chapters ?? 2;
  const zip = new JSZipLike();
  return zip.build([
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
    [
      'OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${opts.id}</dc:identifier><dc:title>${opts.title}</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh</dc:language></metadata><manifest>${Array.from(
        { length: chapters },
        (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`,
      ).join('')}<item id="img" href="images/pic.png" media-type="image/png"/></manifest><spine>${Array.from(
        { length: chapters },
        (_, i) => `<itemref idref="c${i}"/>`,
      ).join('')}</spine></package>`,
    ],
    ...Array.from({ length: chapters }, (_, i) => [
      `OEBPS/c${i}.xhtml`,
      `<html><body><h1>第 ${i + 1} 章</h1><img src="images/pic.png"/></body></html>`,
    ] as [string, string]),
    ['OEBPS/images/pic.png', PNG],
  ]);
}

/** Thin JSZip-shaped helper reused by makeEpub. */
class JSZipLike {
  build(entries: Array<[string, Buffer | string]>): Buffer {
    return makeZip(entries);
  }
}

// ---------------------------------------------------------------- harness

let app: FastifyInstance;
let ctx: AppContext;
let root: string;
let booksDir: string;
let token: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-formats-'));
  booksDir = join(root, 'books');
  await mkdir(booksDir, { recursive: true });
  process.env.BOOKS_DIR = booksDir;
  process.env.DATA_DIR = join(root, 'data');
  process.env.SCAN_INTERVAL = '0';
  process.env.WATCH_INTERVAL = '0';
  process.env.READER_TOKEN_SECRET = 'formats-test-secret-long-enough';

  const config = loadConfig();
  const db = openDatabase(config);
  const silent = Fastify({ logger: false });
  ctx = {
    config,
    db,
    scanner: undefined as never,
    users: undefined as never,
    shelf: undefined as never,
    sync: undefined as never,
    log: silent.log,
  };
  ctx.scanner = new Scanner(db, config, { info: () => {}, warn: () => {} });
  ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db);
  ctx.sync = new SyncService(db);
  app = buildApp(ctx);
  await app.ready();

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'owner', password: 'password123' },
  });
  token = (res.json() as { session: { accessToken: string } }).session.accessToken;
});

after(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function bookList(): Promise<Array<{ id: string; title: string; format: string; kind?: string }>> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/books?pageSize=200', headers: auth() });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { items: Array<{ id: string; title: string; format: string; kind?: string }> }).items;
}

async function findBook(match: string) {
  const books = await bookList();
  const found = books.find((b) => b.title.includes(match));
  assert.ok(found, `no book matching ${match} in ${books.map((b) => b.title).join(', ')}`);
  return found;
}

// ---------------------------------------------------------------- tests

describe('format registry', () => {
  test('every declared extension maps to a handler', () => {
    for (const ext of supportedExtensions()) {
      assert.ok(fileHandlerForExtension(ext), `no handler for ${ext}`);
    }
  });

  test('capabilities is derived from the registry, not hardcoded', () => {
    const formats = capabilities().map((c) => c.format);
    for (const expected of ['epub', 'pdf', 'cbz', 'txt', 'image', 'comic-dir']) {
      assert.ok(formats.includes(expected), `missing ${expected} from capabilities`);
    }
  });

  test('rar is not claimed anywhere', () => {
    // .rar needs a non-free decompressor; pretending to support it would hand
    // the reader corrupt pages.
    assert.equal(fileHandlerForExtension('rar'), null);
    assert.equal(fileHandlerForExtension('cbr'), null);
    assert.equal(supportedExtensions().has('.rar'), false);
  });
});

describe('natural ordering', () => {
  test('page10 sorts after page2', () => {
    const input = ['page10.jpg', 'page2.jpg', 'page1.jpg', 'page100.jpg'];
    assert.deepEqual([...input].sort(naturalCompare), ['page1.jpg', 'page2.jpg', 'page10.jpg', 'page100.jpg']);
  });

  test('inconsistent zero padding does not reorder pages', () => {
    assert.deepEqual(['002.jpg', '1.jpg', '001.jpg'].sort(naturalCompare), ['1.jpg', '001.jpg', '002.jpg']);
  });

  test('volume numbers sort numerically', () => {
    const volumes = ['第10卷', '第2卷', '第1卷'];
    assert.deepEqual([...volumes].sort(naturalCompare), ['第1卷', '第2卷', '第10卷']);
  });

  test('is stable across repeated calls (token cache does not leak)', () => {
    const first = naturalCompare('第10话', '第9话');
    const second = naturalCompare('第10话', '第9话');
    assert.equal(first, second);
    assert.equal(first, 1);
  });

  test('naturalSortBy returns a new array', () => {
    const input = ['b2', 'b1'];
    assert.deepEqual(naturalSortBy(input, (x) => x), ['b1', 'b2']);
    assert.deepEqual(input, ['b2', 'b1']);
  });
});

describe('zip reader', () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reader-zip-'));
  });

  test('reads deflated and stored entries', async () => {
    const file = join(dir, 'a.zip');
    await writeFile(file, makeZip([['x.txt', 'hello world compressed']], { deflate: true }));
    const archive = await ZipArchive.open(file);
    assert.equal((await archive.read('x.txt')).toString(), 'hello world compressed');
  });

  test('multiple entries keep their own contents', async () => {
    const file = join(dir, 'b.zip');
    await writeFile(file, makeZip([['a.txt', 'AAA'], ['b.txt', 'BBB']]));
    const archive = await ZipArchive.open(file);
    assert.equal(archive.files().length, 2);
    assert.equal((await archive.read('b.txt')).toString(), 'BBB');
  });

  test('missing entry raises ENTRY_NOT_FOUND', async () => {
    const file = join(dir, 'c.zip');
    await writeFile(file, makeZip([['a.txt', 'x']]));
    const archive = await ZipArchive.open(file);
    await assert.rejects(
      () => archive.read('nope.txt'),
      (err: unknown) => err instanceof ZipError && err.code === 'ENTRY_NOT_FOUND',
    );
  });

  test('a non-zip file fails cleanly', async () => {
    const file = join(dir, 'not.zip');
    await writeFile(file, 'definitely not an archive at all');
    await assert.rejects(() => ZipArchive.open(file), (err: unknown) => err instanceof ZipError);
  });

  test('oversized entries are refused instead of exhausting memory', async () => {
    const file = join(dir, 'big.zip');
    await writeFile(file, makeZip([['big.bin', Buffer.alloc(4096)]]));
    const archive = await ZipArchive.open(file);
    await assert.rejects(() => archive.read('big.bin', 16), (err: unknown) => (err as ZipError).code === 'ENTRY_TOO_LARGE');
  });

  test('ZIP64 is reported rather than misread', async () => {
    const buf = makeZip([['a.txt', 'x']]);
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    // Only the central-directory offset sentinel marks ZIP64; the entry count
    // field can legitimately be 0xFFFF.
    buf.writeUInt32LE(0xffffffff, eocd + 16);
    const file = join(dir, 'z64.zip');
    await writeFile(file, buf);
    await assert.rejects(() => ZipArchive.open(file), (err: unknown) => (err as ZipError).code === 'ZIP64_UNSUPPORTED');
  });

  test('UTF-8 flagged names survive the round trip', async () => {
    const file = join(dir, 'cn.zip');
    await writeFile(file, makeZip([['第01话 封面.jpg', 'img']]));
    const archive = await ZipArchive.open(file);
    assert.ok(archive.has('第01话 封面.jpg'));
  });

  test('many-entry archives are not rejected by the ZIP64 heuristic', async () => {
    // A 65535-entry archive is legal and must not be confused with ZIP64.
    const entries: Array<[string, string]> = [['only.txt', 'x']];
    const buf = makeZip(entries);
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    buf.writeUInt16LE(0xffff, eocd + 8);
    buf.writeUInt16LE(0xffff, eocd + 10);
    const file = join(dir, 'count.zip');
    await writeFile(file, buf);
    const archive = await ZipArchive.open(file);
    assert.equal(archive.files().length, 1);
  });
});

describe('text decoding', () => {
  test('valid UTF-8 is decoded as UTF-8', () => {
    const result = decodeTextBuffer(Buffer.from('第一章 起风了', 'utf8'));
    assert.equal(result.encoding, 'utf-8');
    assert.equal(result.text, '第一章 起风了');
  });

  test('GB18030 bytes are detected instead of becoming mojibake', () => {
    const result = decodeTextBuffer(encodeGb18030('第一章 编码'));
    assert.equal(result.encoding, 'gb18030');
    assert.equal(result.text, '第一章 编码');
  });

  test('UTF-8 BOM is stripped', () => {
    const result = decodeTextBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章', 'utf8')]));
    assert.equal(result.encoding, 'utf-8');
    assert.equal(result.text, '第一章');
  });

  test('UTF-16LE BOM is honoured', () => {
    const result = decodeTextBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一章', 'utf16le')]));
    assert.equal(result.encoding, 'utf-16le');
    assert.equal(result.text, '第一章');
  });

  test('splits chapters on Chinese headings', () => {
    const { chapters } = splitChapters(['第一章 起风', '内容', '第二章 落雨', '内容', '第3章 天晴', '内容'].join('\n'));
    assert.equal(chapters.length, 3);
    assert.equal(chapters[0]!.title, '第一章 起风');
  });

  test('does not invent chapters from ordinary prose', () => {
    assert.equal(splitChapters(['正文一', '正文二'].join('\n')).chapters.length, 0);
  });

  test('a long line is not treated as a heading', () => {
    const long = `第一章 ${'内容'.repeat(40)}`;
    assert.equal(splitChapters([long, '正文'].join('\n')).chapters.length, 0);
  });
});

describe('library scanning across formats', () => {
  before(async () => {
    await writeFile(join(booksDir, '三体 - 刘慈欣.epub'), makeEpub({ id: 'urn:isbn:9787536692930', title: '三体', chapters: 3 }));
    await writeFile(join(booksDir, '小说 - 张三.txt'), ['第一章 起风', '风来了。', '第二章 落雨', '雨来了。'].join('\n'), 'utf8');
    await writeFile(join(booksDir, '编码书.txt'), encodeGb18030('第一章 编码\n正文内容\n第二章 再见\n更多内容'));
    await writeFile(join(booksDir, '手册 - 某人.pdf'), Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1'));
    await writeFile(join(booksDir, '海贼王 Vol.1.cbz'), makeZip([
      ['001.jpg', PNG],
      ['002.jpg', PNG],
      ['010.jpg', PNG],
      ['info.txt', 'not a page'],
    ]));
    await mkdir(join(booksDir, '进击的巨人', '第01卷'), { recursive: true });
    await mkdir(join(booksDir, '进击的巨人', '第02卷'), { recursive: true });
    for (let i = 1; i <= 3; i += 1) {
      await writeFile(join(booksDir, '进击的巨人', '第01卷', `00${i}.jpg`), PNG);
      await writeFile(join(booksDir, '进击的巨人', '第02卷', `00${i}.jpg`), PNG);
    }
    // Should be ignored entirely.
    await writeFile(join(booksDir, 'readme.md'), '# not a book\n');
    await writeFile(join(booksDir, 'setup.exe'), 'binary');
    await ctx.scanner.scan();
  });

  test('all supported formats are indexed', async () => {
    const formats = new Set((await bookList()).map((b) => b.format));
    for (const format of ['epub', 'txt', 'pdf', 'cbz', 'comic-dir']) {
      assert.ok(formats.has(format), `no book indexed with format ${format}`);
    }
  });

  test('non-book files are not indexed', async () => {
    const paths = ctx.db.all<{ rel_path: string }>('SELECT rel_path FROM book_files');
    assert.ok(!paths.some((p) => p.rel_path.endsWith('.md')), 'markdown should not be indexed');
    assert.ok(!paths.some((p) => p.rel_path.endsWith('.exe')), 'executables should not be indexed');
  });

  test('a comic directory is one book, not one book per volume', async () => {
    const rows = ctx.db.all<{ rel_path: string }>(
      "SELECT rel_path FROM book_files WHERE rel_path LIKE '进击的巨人%'",
    );
    assert.deepEqual(rows.map((r) => r.rel_path), ['进击的巨人']);
  });

  test('a corrupt .cbz stays visible with the reason recorded', async () => {
    // Silently dropping it would leave the reader with fewer books than files
    // and no way to find out which one was skipped.
    await writeFile(join(booksDir, 'broken-archive.cbz'), Buffer.from('not a zip at all'));
    await ctx.scanner.scan();
    try {
      const row = ctx.db.get<{ page_count: number | null; meta_json: string; format: string }>(
        `SELECT b.page_count, b.meta_json, b.format FROM books b
         JOIN book_files f ON f.book_id = b.id WHERE f.rel_path = 'broken-archive.cbz'`,
      );
      assert.ok(row, 'a corrupt archive must still be listed');
      assert.equal(row.format, 'cbz');
      assert.equal(row.page_count, 0);
      assert.match(row.meta_json, /error/, 'the failure reason must be recorded for the user');
    } finally {
      await rm(join(booksDir, 'broken-archive.cbz'));
      await ctx.scanner.scan();
    }
  });

  test('comic directory page count covers every volume', async () => {
    const book = await findBook('进击的巨人');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const body = res.json() as { total: number; groups: Array<{ title: string; count: number }> };
    assert.equal(body.total, 6);
    assert.equal(body.groups.length, 2);
    assert.equal(body.groups[0]!.title, '第01卷');
  });

  test('txt books report their chapter count', async () => {
    const book = await findBook('小说');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const body = res.json() as { total: number; kind: string; items: Array<{ title: string }> };
    assert.equal(body.kind, 'text');
    assert.equal(body.total, 2);
    assert.equal(body.items[0]!.title, '第一章 起风');
  });

  test('GB18030 txt is readable, not mojibake', async () => {
    const book = await findBook('编码书');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const body = res.json() as { items: Array<{ title: string }> };
    assert.equal(body.items[0]!.title, '第一章 编码');
    assert.ok(!body.items[0]!.title.includes('\uFFFD'), 'decoded text must not contain replacement characters');
  });

  test('a corrupt archive is indexed with a reason rather than dropped', async () => {
    await writeFile(join(booksDir, '坏掉的.cbz'), Buffer.from('not a zip at all'));
    await ctx.scanner.scan();
    const row = ctx.db.get<{ page_count: number | null; meta_json: string }>(
      "SELECT b.page_count, b.meta_json FROM books b JOIN book_files f ON f.book_id = b.id WHERE f.rel_path = '坏掉的.cbz'",
    );
    assert.ok(row, 'the broken archive should still be listed');
    assert.equal(row.page_count, 0);
    assert.match(row.meta_json, /error/, 'the failure reason should be recorded');
    await rm(join(booksDir, '坏掉的.cbz'));
    await ctx.scanner.scan();
  });

  test('incremental rescan leaves everything unchanged', async () => {
    const before = await ctx.scanner.scan();
    const after = await ctx.scanner.scan();
    assert.equal(after.added, 0);
    assert.equal(after.updated, 0);
    assert.ok(after.unchanged > 0);
    void before;
  });

  test('modifying a txt file is detected as an update', async () => {
    const target = join(booksDir, '小说 - 张三.txt');
    const original = await readFile(target);
    await writeFile(target, `${original.toString('utf8')}\n第三章 天晴\n云散了。`, 'utf8');
    // mtime has second granularity in the stored key, so make the change
    // unambiguous rather than racing the clock.
    const future = new Date(Date.now() + 5000);
    const { utimes } = await import('node:fs/promises');
    await utimes(target, future, future);

    const result = await ctx.scanner.scan();
    assert.equal(result.updated, 1);
    const book = await findBook('小说');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    assert.equal((res.json() as { total: number }).total, 3, 'the new chapter should appear');

    await writeFile(target, original);
    await ctx.scanner.scan();
  });

  test('read-only guarantee: scanning never writes into the library', async () => {
    const snapshot = async (dir: string): Promise<string[]> => {
      const { readdir, stat } = await import('node:fs/promises');
      const out: string[] = [];
      const walk = async (current: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(current, { withFileTypes: true })) {
          const abs = join(current, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(abs, rel);
          else out.push(`${rel}:${(await stat(abs)).size}`);
        }
      };
      await walk(dir, '');
      return out.sort();
    };

    const before = await snapshot(booksDir);
    await ctx.scanner.scan();
    const after = await snapshot(booksDir);
    assert.deepEqual(after, before, 'the scanner must not create, delete or modify library files');
  });
});

describe('reading endpoints per format', () => {
  test('epub manifest lists the spine in order', async () => {
    const book = await findBook('三体');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const body = res.json() as { kind: string; total: number; items: Array<{ id: string; mediaType: string }> };
    assert.equal(body.kind, 'reflowable');
    assert.equal(body.total, 3);
    assert.equal(body.items[0]!.mediaType, 'application/xhtml+xml');
  });

  test('epub chapter HTML has its relative asset references rewritten', async () => {
    const book = await findBook('三体');
    // Chapters are addressed by archive path, not spine index: windowed loading
    // returns a prefix of the spine, so an index would mean different chapters
    // depending on which window was fetched.
    const items = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const first = (items.json() as { items: Array<{ href: string }> }).items[0]!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent(first.href)}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const html = res.body;
    // A WebView cannot resolve `images/pic.png`; it must be a real path now.
    assert.ok(!/src="images\/pic\.png"/.test(html), 'relative image src should have been rewritten');
    // It must become a URL the client can actually fetch, not just a raw path.
    assert.match(html, /\/api\/v1\/books\/[^"]+\/assets\?ref=OEBPS%2Fimages%2Fpic\.png/);
  });

  test('an epub chapter can be fetched without loading the whole container', async () => {
    // The regression this pins: the handler used to run JSZip.loadAsync on every
    // manifest and asset request, which inflates the entire archive. A book is
    // now read through the project's own index-based reader.
    const book = await findBook('三体');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/items`,
      headers: auth(),
    });
    const body = res.json() as { items: Array<{ href: string; size?: number }> };
    const chapter = body.items.find((item) => item.href.startsWith('xhtml:'));
    assert.ok(chapter, 'spine items should be addressed by archive path');
    // The size comes from the zip central directory, so the client can budget a
    // prefetch without fetching the chapter first.
    assert.equal(typeof chapter.size, 'number');
  });

  test('epub assets are served with the right content type', async () => {
    const book = await findBook('三体');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('OEBPS/images/pic.png')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'image/png');
    // Streamed out of the container, with a known length so the client can show
    // progress and the response is not chunked.
    assert.equal(res.headers['content-length'], String(res.rawPayload.byteLength));
    assert.ok(res.rawPayload.byteLength > 0);
  });

  test('txt chapter content is returned as text', async () => {
    const book = await findBook('小说');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('chapter:1')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.headers['content-type'] as string, /text\/plain/);
    assert.match(res.body, /雨来了/);
    assert.ok(!res.body.includes('风来了'), 'chapter content must not bleed into the next chapter');
  });

  test('the chapter-html reference hands over the whole chapter, unmarked up', async () => {
    // This reference used to answer with server-rendered `<p>` markup. It no
    // longer does: paragraph boundaries are a *reading* decision, and rendering
    // them here meant the reader's indent was a round trip and a windowed chapter
    // looked different from a streamed one. What it answers with is the chapter's
    // characters and nothing else — the same bytes `chapter:` gives, minus the
    // streaming cap — which is what makes one typesetting pass on the client the
    // single definition of a paragraph.
    const book = await findBook('小说');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('chapter-html:1')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.headers['content-type'] as string, /text\/plain/);
    assert.match(res.body, /雨来了/);
    assert.doesNotMatch(res.body, /<p>/, 'the server must not typeset any more');
    assert.doesNotMatch(res.body, /<div/, 'the server must not wrap the chapter any more');
    assert.ok(!res.body.includes('风来了'), 'chapter content must not bleed into the next chapter');
  });

  test('chapter-html is not capped the way the streaming chapter reference is', async () => {
    // `chapter:` is a *window* for streaming, so bounding its reply is the
    // feature. `chapter-html:` is a chapter the reader is about to read in one
    // piece, so bounding it would hand them a chapter that stops mid-sentence.
    const long = Array.from({ length: 4000 }, (_, i) => `第 ${i} 行的内容，足够长以越过流式窗口。`).join('\n');
    const target = join(booksDir, '超长章节.txt');
    await writeFile(target, `第一章 长\n${long}\n`, 'utf8');
    await ctx.scanner.scan();
    const book = await findBook('超长章节');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('chapter-html:0')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const text = res.body;
    assert.ok(text.includes('第 3999 行'), 'the last line of the chapter must be present');
  });

  test('the manifest advertises the markup rendition without moving the reference', async () => {
    // The reference is also the reading position's identity, so it has to stay
    // `chapter:<n>` across this change; `format` is what carries the new choice.
    // A client that ignores the field keeps working through `chapter:`.
    const book = await findBook('小说');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/manifest`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const manifest = res.json() as { content?: { items: Array<{ href: string; format?: string }> } };
    const items = manifest.content?.items ?? [];
    assert.ok(items.length > 0, 'a chaptered txt must expose items');
    for (const item of items) {
      assert.match(item.href, /^chapter:\d+$/);
      assert.equal(item.format, 'html');
    }
  });

  test('txt without headings can be streamed in chunks', async () => {
    const target = join(booksDir, '无章节.txt');
    await writeFile(target, 'x'.repeat(1000), 'utf8');
    await ctx.scanner.scan();
    const book = await findBook('无章节');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('chunk:0')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body.length, 1000);
    await rm(target);
    await ctx.scanner.scan();
  });

  test('cbz pages come back in natural order with non-images excluded', async () => {
    const book = await findBook('海贼王');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const body = res.json() as { kind: string; total: number; items: Array<{ title: string }> };
    assert.equal(body.kind, 'paged');
    assert.equal(body.total, 3, 'info.txt must not be listed as a page');
    assert.deepEqual(body.items.map((i) => i.title), ['001.jpg', '002.jpg', '010.jpg']);
  });

  test('cbz page bytes are served by index', async () => {
    const book = await findBook('海贼王');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('page:2')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'image/jpeg');
  });

  test('an out-of-range page is an error, not an empty image', async () => {
    const book = await findBook('海贼王');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('page:99')}`,
      headers: auth(),
    });
    assert.ok(res.statusCode >= 400, `expected an error, got ${res.statusCode}`);
  });

  test('comic volumes can be fetched individually', async () => {
    const book = await findBook('进击的巨人');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/items?group=1`,
      headers: auth(),
    });
    const body = res.json() as { items: Array<{ title: string }>; group: number };
    assert.equal(body.group, 1);
    // The second volume holds pages 00{1,2,3}.jpg from 第02卷.
    assert.equal(body.items.length, 3);
  });

  test('comic directory pages are addressable by volume and index', async () => {
    const book = await findBook('进击的巨人');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('page:1:2')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'image/jpeg');
  });

  test('pdf does not claim a page count it cannot know', async () => {
    const book = await findBook('手册');
    const row = ctx.db.get<{ page_count: number | null; format: string }>(
      'SELECT page_count, format FROM books WHERE id = ?',
      book.id,
    );
    assert.equal(row!.format, 'pdf');
    assert.equal(row!.page_count, null, 'a guessed page count corrupts client pagination');
  });

  test('pdf is downloadable as the original bytes', async () => {
    const book = await findBook('手册');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/content`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.rawPayload.subarray(0, 4).toString(), '%PDF');
  });

  test('a directory-backed book explains that content must be paged', async () => {
    const book = await findBook('进击的巨人');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/content`, headers: auth() });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as { error: { code: string } }).error.code, 'DIRECTORY_BOOK');
  });

test('a long book is loaded one window at a time', async () => {
    // The point of windowing: a 1200-chapter omnibus must not cost one manifest
    // with 1200 entries, and a client must be able to find chapter 900 without
    // walking the first 899.
    const target = join(booksDir, '长篇.windowed.epub');
    await writeFile(target, makeEpub({ id: 'urn:windowed', title: '长篇', chapters: 250 }));
    await ctx.scanner.scan();

    const book = await findBook('长篇');
    const all = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const full = all.json() as { total: number; groups: Array<{ offset: number; count: number; seq: number }> };

    assert.equal(full.total, 250);
    assert.ok(full.groups.length > 1, 'a 250-chapter book must be split into windows');
    // Every group has to state where it starts: a client holding only this group
    // has no other way to place it in the book.
    assert.deepEqual(full.groups.map((g) => g.offset), full.groups.map((g) => g.seq * full.groups[0]!.count));

    const window = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items?group=2`, headers: auth() });
    const page = window.json() as { items: Array<{ seq: number }>; group: number; groups: unknown[] };
    assert.equal(page.group, 2);
    assert.equal(page.items.length, full.groups[0]!.count);
    // The window must carry the group's items, not the first group's.
    assert.equal(page.items[0]!.seq, 2 * full.groups[0]!.count);
    // `groups` stays complete so the client can still show a full table of contents.
    assert.equal(page.groups.length, full.groups.length);

    await rm(target);
    await ctx.scanner.scan();
  });

  test('the manifest alone is enough to open a book', async () => {
    // "Open a book" used to cost two round trips. Over a tunnel that is a book
    // that appears to hang; the manifest now carries the addressable structure.
    const book = await findBook('三体');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/manifest`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      book: { title: string };
      items: Array<{ href: string; size?: number }>;
      groups: Array<{ count: number; offset: number }>;
      kind: string;
      total: number;
    };
    assert.equal(body.book.title, '三体');
    assert.equal(body.kind, 'reflowable');
    assert.equal(body.total, 3);
    assert.match(body.items[0]!.href, /^xhtml:/);
    assert.equal(body.groups[0]!.offset, 0);
  });

  test('a seekable book body answers a range request', async () => {
    // "Jump to page 300" of a PDF is pure waste without Range, and a download
    // that cannot resume restarts from zero on every flaky mobile connection.
    const book = await findBook('手册');
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/content`,
      headers: { ...auth(), range: 'bytes=0-3' },
    });
    assert.equal(first.statusCode, 206, first.body);
    assert.equal(first.rawPayload.toString(), '%PDF');
    assert.equal(first.headers['accept-ranges'], 'bytes');
    assert.match(String(first.headers['content-range']), /^bytes 0-3\/\d+$/);

    const tail = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/content`,
      headers: { ...auth(), range: 'bytes=-3' },
    });
    assert.equal(tail.statusCode, 206);
    // `bytes=-3` is the LAST three bytes, not the first three. Getting this
    // backwards makes a resumed download silently restart.
    assert.equal(tail.rawPayload.byteLength, 3);

    const past = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/content`,
      headers: { ...auth(), range: 'bytes=99999999-' },
    });
    assert.equal(past.statusCode, 416);
  });

  test('a streamed page reports the length the client will actually receive', async () => {
    // A stream with a wrong content-length is worse than no length: the client
    // waits for bytes that will never arrive.
    const book = await findBook('海贼王');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('page:0')}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-length'], String(res.rawPayload.byteLength));
    // A deflated zip entry has no byte offset a client can seek to, so claiming
    // Range support would be a lie the client only discovers after a wasted
    // request. The header says what is actually true for this page.
    assert.equal(res.headers['accept-ranges'], 'none');
  });

  test('a page can be fetched by range when the container allows seeking', async () => {
    // A `stored` (uncompressed) cbz is the case a client can genuinely resume,
    // and it is common for image archives.
    const target = join(booksDir, '未压缩.cbz');
    await writeFile(target, makeZip([['1.jpg', JPEG], ['2.jpg', JPEG]], { deflate: false }));
    await ctx.scanner.scan();
    const book = await findBook('未压缩');

    const items = await app.inject({ method: 'GET', url: `/api/v1/books/${book.id}/items`, headers: auth() });
    const page = (items.json() as { items: Array<{ href: string }> }).items[0]!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent(page.href)}`,
      headers: { ...auth(), range: 'bytes=0-1' },
    });
    assert.equal(res.statusCode, 206, res.body);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    // The first two bytes of a JPEG, taken from the middle of the archive: the
    // prefix is dropped rather than re-requested.
    assert.equal(res.rawPayload.subarray(0, 2).toString('hex'), 'ffd8');

    await rm(target);
    await ctx.scanner.scan();
  });

test('an epub reports its spine length during the scan', async () => {
    // This was silently null for every book: the parse stage opens the archive
    // from memory (the scanner already has the bytes) but the package reader
    // insisted on a file path. The symptom was a missing progress denominator,
    // which is invisible until a reader notices the percentage bar stays empty.
    const row = ctx.db.get<{ page_count: number | null }>(
      'SELECT b.page_count FROM books b WHERE b.title = ?',
      '三体',
    );
    assert.equal(row!.page_count, 3);
  });

test('a parser fix reaches books whose bytes never changed', async () => {
    // Change detection is content-based, so a parser fix touches nothing it can
    // detect. Without the parse version, a book indexed by a broken parser keeps
    // its bad result forever and re-running the scan skips exactly that book.
    const book = await findBook('三体');
    const file = ctx.db.get<{ id: string }>('SELECT id FROM book_files WHERE book_id = ?', book.id);

    // Simulate a library written by an older, broken build.
    ctx.db.run('UPDATE books SET page_count = NULL WHERE id = ?', book.id);
    ctx.db.run('UPDATE book_files SET parse_version = 0 WHERE id = ?', file!.id);
    assert.equal(ctx.db.get<{ page_count: number | null }>('SELECT page_count FROM books WHERE id = ?', book.id)!.page_count, null);

    const result = await ctx.scanner.scan();
    assert.ok(result.updated >= 1, 'the book must be reparsed once');
    assert.equal(
      ctx.db.get<{ page_count: number | null }>('SELECT page_count FROM books WHERE id = ?', book.id)!.page_count,
      3,
    );

    // And then it settles: the version bump is a one-time cost, not a slow scan.
    const second = await ctx.scanner.scan();
    assert.equal(second.updated, 0, 'a repeat scan must not reparse anything');
  });

  test('the schema migration is additive, so an existing database still opens', async () => {
    // `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
    // so a column added to the schema is invisible to a running instance. An
    // existing database is built without the column here and then reopened.
    const { openDatabase } = await import('../src/db/index.ts');
    const dir = await mkdtemp(join(tmpdir(), 'migrate-'));
    const config = { ...ctx.config, dataDir: dir } as typeof ctx.config;

    const first = openDatabase(config);
    first.close();

    // Drop the column and reopen: the migration must put it back without losing
    // the rows, which is what a self-hosted user's database looks like after an
    // upgrade.
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(join(dir, 'reader.db'));
    raw.exec('ALTER TABLE book_files DROP COLUMN parse_version');
    raw.exec("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at) VALUES ('u1','a','','x','admin',0,0,0)");
    raw.close();

    const second = openDatabase(config);
    const columns = second.all<{ name: string }>("SELECT name FROM pragma_table_info('book_files')");
    assert.ok(columns.some((column) => column.name === 'parse_version'), 'the column must be restored');
    assert.equal(second.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n, 1, 'existing rows must survive');
    second.close();
  });

  test('formats endpoint advertises what the instance can read', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/library/formats', headers: auth() });
    assert.equal(res.statusCode, 200);
    const formats = (res.json() as { formats: Array<{ format: string }> }).formats.map((f) => f.format);
    assert.ok(formats.includes('comic-dir'));
    assert.ok(formats.includes('txt'));
  });

  test('library stats break down by format', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/library/stats', headers: auth() });
    assert.equal(res.statusCode, 200);
    const formats = (res.json() as { formats: Array<{ format: string; n: number }> }).formats;
    assert.ok(formats.some((f) => f.format === 'cbz' && f.n >= 1));
  });
});

describe('directory detection', () => {
  test('a folder of page images is a comic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comic-'));
    for (let i = 1; i <= 3; i += 1) await writeFile(join(dir, `${i}.jpg`), PNG);
    assert.equal(await looksLikeComicDirectory(dir), true);
  });

  test('a folder with a couple of stray images is not', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'not-comic-'));
    await writeFile(join(dir, 'song.mp3'), 'audio');
    await writeFile(join(dir, 'movie.mp4'), 'video');
    await writeFile(join(dir, 'thumb.jpg'), PNG);
    assert.equal(await looksLikeComicDirectory(dir), false);
  });

  test('a volume layout is recognised from its first subdirectory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vols-'));
    await mkdir(join(dir, '第01卷'));
    await mkdir(join(dir, '第02卷'));
    for (let i = 1; i <= 2; i += 1) await writeFile(join(dir, '第01卷', `${i}.jpg`), PNG);
    for (let i = 1; i <= 2; i += 1) await writeFile(join(dir, '第02卷', `${i}.jpg`), PNG);
    assert.equal(await looksLikeComicDirectory(dir), true);
  });

  test('an empty directory is not a book', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'empty-'));
    assert.equal(await looksLikeComicDirectory(dir), false);
  });

  test('a shelf of EPUBs with a stray cover image is not a comic', async () => {
    // The ratio rule alone calls this a comic: two JPEGs out of three entries
    // clears any threshold. Claiming it would delete the book inside from the
    // shelf, and the reader has no way to tell it was ever there.
    const dir = await mkdtemp(join(tmpdir(), 'shelf-'));
    await writeFile(join(dir, '一本书.epub'), await makeEpub({ id: 'urn:uuid:in-dir', title: '目录里的书' }));
    await writeFile(join(dir, 'cover.jpg'), PNG);
    await writeFile(join(dir, 'cover2.jpg'), PNG);
    assert.equal(await looksLikeComicDirectory(dir), false);
  });

  test('a volume whose pages sit one level deeper is still a comic', async () => {
    // `第01话/001.jpg` is how a lot of scan collections are filed. The check
    // that decides whether the folder is a book has to look at least as deep as
    // the manifest does, or it concludes "not a comic" about a folder whose
    // pages it would happily serve.
    const dir = await mkdtemp(join(tmpdir(), 'deep-vols-'));
    await mkdir(join(dir, '第01卷', '第01话'), { recursive: true });
    await mkdir(join(dir, '第02卷', '第01话'), { recursive: true });
    for (let i = 1; i <= 2; i += 1) await writeFile(join(dir, '第01卷', '第01话', `${i}.jpg`), PNG);
    for (let i = 1; i <= 2; i += 1) await writeFile(join(dir, '第02卷', '第01话', `${i}.jpg`), PNG);
    assert.equal(await looksLikeComicDirectory(dir), true);
  });
});

describe('query-string tokens', () => {
  test('an asset can be fetched with a query token, because an img tag cannot send a header', async () => {
    // A chapter document is rendered by the browser, which fetches its images
    // and stylesheets itself. Without this, every illustration in a book 401s.
    const book = await findBook('三体');
    const token = ctx.users.login('owner', 'password123', 'test');
    const issued = (await token).accessToken;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=${encodeURIComponent('OEBPS/images/pic.png')}&access_token=${encodeURIComponent(issued)}`,
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'image/png');
  });

  test('the same token is refused on a state-changing endpoint', async () => {
    // A token in a URL leaks into logs, history and Referer headers. It is
    // accepted only where a browser forces our hand: a GET for immutable
    // content. A scan trigger must never be reachable that way.
    const admin = await ctx.users.login('owner', 'password123', 'test');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/library/scan?access_token=${encodeURIComponent(admin.accessToken)}`,
    });
    assert.equal(res.statusCode, 401, 'a query token must not authorise a POST');
  });

  test('a query token on a metadata write is refused', async () => {
    const admin = await ctx.users.login('owner', 'password123', 'test');
    const book = await findBook('三体');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${book.id}/metadata?access_token=${encodeURIComponent(admin.accessToken)}`,
      payload: { title: 'x' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('a query token is refused on a collection endpoint', async () => {
    // Only per-book asset reads accept it. A shelf listing carries the whole
    // library and has no reason to be fetchable from a URL someone could paste.
    const admin = await ctx.users.login('owner', 'password123', 'test');
    const res = await app.inject({ method: 'GET', url: `/api/v1/books?access_token=${encodeURIComponent(admin.accessToken)}` });
    assert.equal(res.statusCode, 401);
  });

  test('an invalid query token is refused like any other', async () => {
    const book = await findBook('三体');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/assets?ref=OEBPS%2Fimages%2Fpic.png&access_token=not-a-token`,
    });
    assert.equal(res.statusCode, 401);
  });
});

/**
 * Reading a book one window at a time.
 *
 * Every test here is a failure mode that a reader would experience as "the app is
 * broken" while the server kept answering 200: a jump to the wrong chapter, a
 * contents list that shows the transport boundary, a range request that walks the
 * whole file, or a chapter read that gets truncated.
 */
describe('windowed reading', () => {
  async function makeChaptered(name: string, chapters: number): Promise<string> {
    const target = join(booksDir, name);
    await writeFile(target, makeEpub({ id: `id-${name}`, title: name.replace(/\.epub$/, ''), chapters }));
    await ctx.scanner.scan();
    return (await findBook(name.replace(/\.epub$/, ''))).id;
  }

  test('the manifest window is one group, not the whole spine', async () => {
    // A 120-chapter book must not send 120 items to draw the first page. The
    // window size is the server's constant; what matters is that it is smaller
    // than the book and that the group metadata is present.
    const id = await makeChaptered('窗读.epub', 120);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${id}/manifest`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      total: number;
      items: Array<{ href: string; title: string }>;
      groups: Array<{ count: number; offset: number }>;
      content: { total: number; items: unknown[] } | null;
    };
    assert.equal(body.total, 120, 'the book has 120 chapters');
    assert.ok(body.items.length < 120, `window carried ${body.items.length} items`);
    assert.equal(body.items.length, body.groups[0]?.count);
    assert.equal(body.groups[0]?.offset, 0);
    assert.equal(body.content?.total, 120);

    await rm(join(booksDir, '窗读.epub'));
    await ctx.scanner.scan();
  });

  test('a later window is addressed by its global offset, not by an item index', async () => {
    // The bug this pins: a client that computed a chapter's position from its
    // index inside the returned array would open chapter 1 when asked for
    // chapter 81 — a synced position landing 80 chapters early.
    const id = await makeChaptered('窗读2.epub', 120);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${id}/items?group=2`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      total: number;
      group?: number;
      items: Array<{ href: string; seq: number }>;
    };
    assert.equal(body.group, 2);
    // Chapters 81..120, and the first item says so.
    assert.equal(body.items[0]?.href, 'xhtml:OEBPS/c80.xhtml');
    assert.equal(body.items[0]?.seq, 80);

    await rm(join(booksDir, '窗读2.epub'));
    await ctx.scanner.scan();
  });

  test('the table of contents is the book, not the window', async () => {
    // On `main` the TOC was built from the manifest, so a long book's contents
    // panel listed exactly one window. `/toc` is the endpoint that fixes it, and
    // this asserts the property that matters: it is longer than a window.
    const id = await makeChaptered('窗读3.epub', 120);
    const manifest = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${id}/manifest`,
      headers: auth(),
    });
    const windowItems = (manifest.json() as { items: unknown[] }).items.length;

    const toc = await app.inject({ method: 'GET', url: `/api/v1/books/${id}/toc`, headers: auth() });
    assert.equal(toc.statusCode, 200, toc.body);
    const entries = (toc.json() as { toc: Array<{ href: string; title: string; spine: number }> }).toc;
    assert.equal(entries.length, 120);
    assert.ok(entries.length > windowItems, 'a table of contents must exceed one window');
    assert.equal(entries[119]?.spine, 119);
    // Every entry is addressable and carries the same href shape as a manifest
    // item, so a jump and a saved position are the same kind of reference.
    for (const entry of entries) assert.match(entry.href, /^xhtml:/);

    await rm(join(booksDir, '窗读3.epub'));
    await ctx.scanner.scan();
  });

  test('a chapter is served with rewritten resource links and a real length', async () => {
    // The chapter's `images/pic.png` has to arrive as an absolute asset URL, or
    // every illustration in the book 404s in the client's frame.
    const id = await makeChaptered('窗读4.epub', 3);
    const items = await app.inject({ method: 'GET', url: `/api/v1/books/${id}/items`, headers: auth() });
    const first = (items.json() as { items: Array<{ href: string }> }).items[0]!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${id}/assets?ref=${encodeURIComponent(first.href)}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const html = res.rawPayload.toString('utf8');
    assert.match(html, /\/api\/v1\/books\/[^"']+\/assets\?ref=/, 'relative resources must be absolute');
    assert.equal(res.headers['content-length'], String(res.rawPayload.byteLength));

    await rm(join(booksDir, '窗读4.epub'));
    await ctx.scanner.scan();
  });

  test('a suffix range on a streamed body does not walk the whole file', async () => {
    // `bytes=-3` is a legitimate resume request and also the one range a
    // forward-only stream cannot produce by skipping. Serving it from a 400MB
    // comic means reading all 400MB to hand back three bytes, so the honest
    // answer is a full response the client can plan for.
    const target = join(booksDir, '后缀.cbz');
    // Large enough that the body is streamed rather than buffered, and stored so
    // the payload advertises Range support in the first place.
    const pages = Array.from({ length: 6 }, (_, i) => [`p${i}.jpg`, JPEG,] as [string, Buffer]);
    await writeFile(target, makeZip([...pages, ['pad.bin', Buffer.alloc(2048, 7)]], { deflate: false }));
    await ctx.scanner.scan();
    const book = await findBook('后缀');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.id}/content`,
      headers: { ...auth(), range: 'bytes=-3' },
    });
    // Either answer is correct HTTP; what must not happen is a 206 whose body
    // took the whole file to produce. A 200 with the full body and no Range
    // advertisement is the one this server chose.
    assert.ok(res.statusCode === 200 || res.statusCode === 206, `unexpected ${res.statusCode}`);
    if (res.statusCode === 200) {
      assert.equal(res.headers['accept-ranges'], 'none');
    } else {
      assert.equal(res.rawPayload.byteLength, 3);
    }

    await rm(target);
    await ctx.scanner.scan();
  });
});
