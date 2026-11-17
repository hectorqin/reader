import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { fileHandlerForExtension } from '../src/indexer/formats/index.ts';
import { inlineStylesheets } from '../src/indexer/formats/epub.ts';

async function epub(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>T</dc:title></metadata><manifest><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>');
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('an EPUB chapter carries its linked stylesheets, with their own urls resolved from the stylesheet', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'epub-css-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const absPath = join(dir, 'book.epub');
  await writeFile(absPath, await epub({
    'OEBPS/styles/book.css': '@font-face { src: url("../fonts/a.ttf"); } p { color: red; background: url(../images/bg.png#x); } .e { background: url(https://example.com/x.png); } /* </style> */',
    'OEBPS/fonts/a.ttf': 'font',
    'OEBPS/images/bg.png': 'png',
    'OEBPS/text/c1.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" type="text/css" href="../styles/book.css"/><link rel="alternate stylesheet" href="../styles/book.css"/><link rel="stylesheet" href="../styles/missing.css"/></head><body><p>正文</p></body></html>',
  }));
  const handler = fileHandlerForExtension('epub')!;
  const payload = await handler.asset({ relPath: 'book.epub', absPath, bookId: 'b1' }, { ref: 'xhtml:OEBPS/text/c1.xhtml' });
  const html = payload.data!.toString('utf8');
  const base = '/api/v1/books/b1/assets?__reader-book-resource__=1&ref=';
  assert.ok(html.includes(`<style data-href="OEBPS/styles/book.css">@font-face { src: url("${base}OEBPS%2Ffonts%2Fa.ttf"); } p { color: red; background: url(${base}OEBPS%2Fimages%2Fbg.png#x); }`), html);
  // Another host stays as written (the reader drops it), and a style end inside the CSS cannot close the block.
  assert.ok(html.includes('url(https://example.com/x.png)'));
  assert.ok(html.includes('/* <\\/style> */</style>'));
  // An alternate stylesheet is not applied, and a missing one is left for the reader to ignore.
  assert.match(html, /<link rel="alternate stylesheet"/);
  assert.match(html, /href="\.\.\/styles\/missing\.css"/);
});

test('without stylesheet links a chapter is unchanged', async () => {
  const html = '<html><head><title>t</title></head><body><p>x</p></body></html>';
  assert.equal(await inlineStylesheets(html, 'OEBPS', { exists: () => true, size: () => 1, read: async () => 'p{}', assetUrl: p => p }), html);
});
