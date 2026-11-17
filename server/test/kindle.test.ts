import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileHandlerForExtension } from '../src/indexer/formats/index.ts';
import { legacySpacing, readKindle } from '../src/indexer/formats/mobi.ts';
import { decompressPalmDoc, trimTrailingEntries } from '../src/indexer/formats/mobi-reader.ts';
import { Db } from '../src/db/index.ts';
import { Scanner } from '../src/indexer/scanner.ts';
import type { AppConfig } from '../src/config/index.ts';
import { AppError } from '../src/lib/errors.ts';
import { PNG, buildKf8, buildMobi6 } from './helpers/kindle-fixture.ts';

const handler = fileHandlerForExtension('azw3')!;

async function onDisk(t: { after(fn: () => Promise<void>): void }, name: string, bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'kindle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const absPath = join(dir, name);
  await writeFile(absPath, bytes);
  return { relPath: name, absPath, bookId: 'book-1' };
}

async function text(payload: { data?: Buffer }): Promise<string> {
  return payload.data!.toString('utf8');
}

test('the handler owns .mobi, .azw3 and .azw and serves them as reflowable books', () => {
  for (const ext of ['mobi', 'azw3', 'azw']) assert.equal(fileHandlerForExtension(ext)?.format, 'mobi');
  assert.equal(handler.kind, 'reflowable');
});

test('PalmDOC: literals, runs, back-references and space+character pairs', () => {
  // "ab" + copy 3 from distance 2 ("aba") + space+'c' + a literal run of 2 bytes.
  const input = Buffer.from([0x61, 0x62, 0x80, (2 << 3) | 0, 0xe3, 0x02, 0xc3, 0xa9]);
  assert.equal(decompressPalmDoc(input).toString('utf8'), 'ababa cé');
  assert.throws(() => decompressPalmDoc(Buffer.from([0x80, 0x18])), /回溯越界/);
});

test('trailing entries and the multibyte overlap come off the end of a record', () => {
  const record = Buffer.concat([Buffer.from('text'), Buffer.from([0]), Buffer.from('AB'), Buffer.from([0x83])]);
  assert.equal(trimTrailingEntries(record, 3).toString(), 'text');
  assert.equal(trimTrailingEntries(record, 0).length, record.length);
});

test('MOBI 6: metadata, cover, chapters at page breaks, images, links and the NCX', async t => {
  const { file } = buildMobi6({
    title: '围城', author: '钱锺书', compression: 2, trailingFlags: 3, ncx: true,
    chapters: [
      '<p width="2em" height="1em">第一章 {{img}} 跳到 {{link:2}} 和 {{link:0}}</p>',
      '<p></p>',
      '<p>第三章</p>' + '<p>很长的正文。</p>'.repeat(400),
    ],
  });
  const book = readKindle(file);
  assert.equal(book.generation, 'mobi6');
  // The empty chapter joins the next one rather than becoming a blank page.
  assert.deepEqual(book.chapters.map(chapter => chapter.path), ['text/part0000.xhtml', 'text/part0001.xhtml']);
  assert.deepEqual(book.toc.map(entry => [entry.title, entry.spine]), [['Chapter 1', 0], ['Chapter 2', 1], ['Chapter 3', 1]]);
  assert.equal(book.chapters[0]!.title, 'Chapter 1');

  const ctx = await onDisk(t, '围城.mobi', file);
  const parsed = await handler.parse(ctx, file);
  assert.equal(parsed.format, 'mobi');
  assert.equal(parsed.pageCount, 2);
  assert.deepEqual([parsed.metadata.title, parsed.metadata.author, parsed.metadata.publisher, parsed.metadata.isbn, parsed.metadata.tags, parsed.metadata.source],
    ['围城', '钱锺书', 'Test Press', '9780000000001', ['Fiction'], 'embedded']);
  assert.deepEqual(parsed.cover, { data: PNG, contentType: 'image/png' });

  const manifest = await handler.manifest(ctx);
  assert.deepEqual(manifest.items.map(item => [item.href, item.mediaType]), [['xhtml:text/part0000.xhtml', 'text/html'], ['xhtml:text/part0001.xhtml', 'text/html']]);
  const chapter = await text(await handler.asset(ctx, { ref: 'xhtml:text/part0000.xhtml' }));
  assert.match(chapter, /<img src="\/api\/v1\/books\/book-1\/assets\?__reader-book-resource__=1&ref=res%2F0" \/>/);
  // A link to another chapter is the marked asset URL the client reads as a chapter change.
  assert.match(chapter, /<a href="\/api\/v1\/books\/book-1\/assets\?__reader-book-resource__=1&ref=text%2Fpart0001\.xhtml#filepos-\d+">to 2<\/a>/);
  // A link within the chapter is a bare fragment.
  assert.match(chapter, /<a href="#filepos-\d+">to 0<\/a>/);
  assert.match(chapter, /<p style="text-indent:2em;margin-top:1em">|<p style="margin-top:1em;text-indent:2em">/);
  const image = await handler.asset(ctx, { ref: 'res/0' });
  assert.deepEqual([image.contentType, image.data], ['image/png', PNG]);
  await assert.rejects(handler.asset(ctx, { ref: 'text/part0009.xhtml' }), (error: AppError) => error.statusCode === 404);
  await assert.rejects(handler.asset(ctx, { ref: '../../etc/passwd' }), (error: AppError) => error.statusCode === 404);
});

test('legacy spacing keeps the publisher\'s own style and leaves zero values out', () => {
  assert.equal(legacySpacing('<p width="0pt" height="3pt" style="color:red">x</p>'), '<p style="margin-top:3pt;color:red">x</p>');
  assert.equal(legacySpacing('<div align="center">x</div>'), '<div align="center">x</div>');
  assert.equal(legacySpacing('<p width="-2em">x</p>'), '<p style="text-indent:-2em">x</p>');
});

test('KF8: skeletons and fragments, stylesheet flows, kindle: links and the NCX', async t => {
  const file = buildKf8({ title: 'KF8 Book', chapters: ['<p>One {{img}} {{link:1}}</p>', '<p>Two {{link:1}}</p>'] });
  const book = readKindle(file);
  assert.equal(book.generation, 'kf8');
  assert.deepEqual(book.toc.map(entry => [entry.href, entry.title, entry.spine]),
    [['xhtml:text/part0000.xhtml#ch0', '第 1 章', 0], ['xhtml:text/part0001.xhtml#ch1', '第 2 章', 1]]);
  const ctx = await onDisk(t, 'book.azw3', file);
  const first = await text(await handler.asset(ctx, { ref: 'xhtml:text/part0000.xhtml' }));
  // The fragment sits inside the skeleton's body.
  assert.match(first, /<body aid="0" id="aid-0"><div aid="1" id="ch0"><p>One /);
  assert.match(first, /<link rel="stylesheet" href="\/api\/v1\/books\/book-1\/assets\?__reader-book-resource__=1&ref=flow%2F1\.css"\/>/);
  assert.match(first, /<img src="\/api\/v1\/books\/book-1\/assets\?__reader-book-resource__=1&ref=res%2F0"\/>/);
  assert.match(first, /<a href="\/api\/v1\/books\/book-1\/assets\?__reader-book-resource__=1&ref=text%2Fpart0001\.xhtml#ch1">to 1<\/a>/);
  const second = await text(await handler.asset(ctx, { ref: 'xhtml:text/part0001.xhtml' }));
  assert.match(second, /<a href="#ch1">to 1<\/a>/);
  const css = await handler.asset(ctx, { ref: 'flow/1.css' });
  assert.equal(css.contentType, 'text/css; charset=utf-8');
  // In a stylesheet no entity is decoded, so the URL has a bare `&`.
  assert.equal(await text(css), 'p { color: navy; background: url(/api/v1/books/book-1/assets?__reader-book-resource__=1&ref=res%2F0); }');
  await assert.rejects(handler.asset(ctx, { ref: 'flow/0.css' }), (error: AppError) => error.statusCode === 404);
  assert.deepEqual((await handler.toc!(ctx)).map(entry => entry.title), ['第 1 章', '第 2 章']);
});

test('a hybrid .mobi is read from its KF8 half, with images numbered from the first header', async t => {
  const file = buildKf8({ hybrid: true, title: 'Hybrid', chapters: ['<p>New {{img}}</p>'] });
  const book = readKindle(file);
  assert.equal(book.generation, 'kf8');
  assert.match(book.chapters[0]!.html(), /New/);
  const ctx = await onDisk(t, 'hybrid.mobi', file);
  assert.deepEqual((await handler.asset(ctx, { ref: 'res/0' })).data, PNG);
  assert.equal((await handler.parse(ctx, file)).metadata.title, 'Hybrid');
});

test('a book with DRM is listed under its file name and says why it cannot be opened', async t => {
  const { file } = buildMobi6({ chapters: ['<p>secret</p>'], encryption: 2 });
  const ctx = await onDisk(t, '加密的书.azw', file);
  const parsed = await handler.parse(ctx, file);
  assert.equal(parsed.metadata.title, '加密的书');
  assert.equal(parsed.pageCount, null);
  assert.equal(parsed.metadata.raw.parseErrorCode, 'DRM');
  await assert.rejects(handler.manifest(ctx), (error: AppError) => error.statusCode === 422 && error.code === 'BOOK_DRM' && /DRM/.test(error.message));
});

test('a file that is not a Kindle book is listed by name and refused on opening', async t => {
  const file = Buffer.from('not a book at all'.repeat(10));
  const ctx = await onDisk(t, 'fake.mobi', file);
  assert.equal((await handler.parse(ctx, file)).metadata.raw.parseErrorCode, 'NOT_MOBI');
  await assert.rejects(handler.manifest(ctx), (error: AppError) => error.code === 'BOOK_UNREADABLE');
});

test('the scanner indexes a Kindle book with its embedded title and cover', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kindle-scan-')), booksDir = join(root, 'books'), dataDir = join(root, 'data');
  await mkdir(booksDir); await mkdir(dataDir);
  const db = new Db(':memory:');
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  await writeFile(join(booksDir, 'some-file.azw3'), buildKf8({ title: '自造', chapters: ['<p>一</p>', '<p>二</p>'] }));
  await new Scanner(db, { booksDir, dataDir } as AppConfig, { info: () => {}, warn: () => {} }).scan();
  const row = db.get<{ title: string; author: string; format: string; cover_path: string | null }>('SELECT title, author, format, cover_path FROM books');
  assert.equal(row?.title, '自造');
  assert.equal(row?.author, 'Ada Writer');
  assert.equal(row?.format, 'mobi');
  assert.ok(row?.cover_path, 'the cover was extracted');
});
