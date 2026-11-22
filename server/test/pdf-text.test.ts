import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildPdfBook,
  namesTitle,
  PAGES_PER_CHAPTER,
  type PdfLine,
  type PdfText,
} from '../src/indexer/formats/pdf-text.ts';
import { fileHandlerForExtension } from '../src/indexer/formats/index.ts';
import { AppError } from '../src/lib/errors.ts';
import { buildPdf } from './helpers/pdf-fixture.ts';

/** A page of lines going down from the top, 16 units apart, unless placed explicitly. */
function page(lines: Array<string | (Partial<PdfLine> & { t: string })>): PdfText['pages'][number] {
  let y = 780;
  return {
    w: 595,
    h: 842,
    lines: lines.map((line) => {
      const value = typeof line === 'string' ? { t: line } : line;
      const placed = { x: 72, r: 520, s: 11, y, ...value };
      y = placed.y - 16;
      return placed;
    }),
  };
}
const body = (html: string) =>
  html
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '')
    .replace(/<span[^>]*><\/span>/g, '');

test('lines become paragraphs: CJK joins without spaces, Latin with one, hyphenated words rejoin', () => {
  const book = buildPdfBook({
    version: 1,
    outline: [],
    pages: [
      page([
        '这是第一段的第一行，',
        { t: '一直延续到第二行。', r: 300 },
        { t: '第二段首行缩进。', x: 94 },
        'An English para-',
        'graph goes on and',
        { t: 'ends here.', r: 200 },
      ]),
    ],
  });
  assert.equal(
    body(book.chapters[0]!.html),
    '<p>这是第一段的第一行，一直延续到第二行。</p>\n<p>第二段首行缩进。An English paragraph goes on and ends here.</p>',
  );
});

test('running heads and page numbers are dropped; a paragraph runs on across a page break', () => {
  const words = ['春', '夏', '秋', '冬', '雪'];
  const pages = Array.from({ length: 5 }, (_, index) =>
    page([
      { t: `书名 · 第 ${index + 1} 页`, y: 810, s: 9 },
      `${words[index]}天的正文延续上一页，`,
      `${words[index]}这一行写满了整行。`,
      { t: String(index + 1), y: 40, x: 290, r: 300 },
    ]),
  );
  const html = buildPdfBook({ version: 1, outline: [], pages }).chapters[0]!.html;
  assert.doesNotMatch(html, /书名/);
  assert.doesNotMatch(html, /<p>\d<\/p>/);
  // One paragraph, with a page marker where each page begins.
  assert.equal(html.match(/<p>/g)?.length, 1);
  assert.equal(html.match(/class="pdf-page"/g)?.length, 5);
  assert.match(html, /写满了整行。<span class="pdf-page" id="pdf-page-2" data-page="2"><\/span>夏天的正文/);
});

test('bookmarks cut chapters at their own title line, render it as a heading, and nest the rest as anchors', () => {
  const book = buildPdfBook({
    version: 1,
    pages: [
      page(['封面文字']),
      page([
        { t: '1 起点', y: 810, x: 450, s: 9 },
        { t: '1 起点', y: 700, s: 11 },
        '第一章正文。',
        { t: '1.1 小节', y: 600 },
        '小节正文。',
      ]),
      page([{ t: '第2章 终点', y: 760, s: 16 }, '第二章正文。']),
    ],
    outline: [
      // Recorded a little below the heading, as typesetters do.
      { title: '1 起点', level: 0, page: 1, top: 690 },
      { title: '1.1 小节', level: 1, page: 1, top: 590 },
      { title: '第2章 终点', level: 0, page: 2, top: null },
    ],
  });
  assert.deepEqual(
    book.chapters.map((chapter) => [chapter.title, chapter.page]),
    [
      ['开头', 1],
      ['1 起点', 2],
      ['第2章 终点', 3],
    ],
  );
  // The running head repeating the title is gone; the title line is the chapter's heading.
  assert.equal(
    body(book.chapters[1]!.html),
    '<h2>1 起点</h2>\n<p>第一章正文。</p>\n<h3>1.1 小节</h3>\n<p>小节正文。</p>',
  );
  assert.deepEqual(
    book.toc.map((entry) => [entry.title, entry.level, entry.chapter, entry.anchor]),
    [
      ['1 起点', 0, 1, ''],
      ['1.1 小节', 1, 1, 'pdf-toc-1'],
      ['第2章 终点', 0, 2, ''],
    ],
  );
  assert.match(book.chapters[1]!.html, /<h3><span id="pdf-toc-1"><\/span>/);
});

test('one top-level bookmark wrapping the book makes its children the chapters', () => {
  const book = buildPdfBook({
    version: 1,
    pages: [page(['甲章', '甲章的正文写在这里。']), page(['乙章', '乙章的正文写在那里。'])],
    outline: [
      { title: '全书', level: 0, page: 0, top: null },
      { title: '甲章', level: 1, page: 0, top: null },
      { title: '乙章', level: 1, page: 1, top: null },
    ],
  });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    ['甲章', '乙章'],
  );
});

test('without bookmarks, chapters are runs of pages; a page with no text says so', () => {
  const pages = Array.from({ length: PAGES_PER_CHAPTER + 3 }, (_, index) =>
    index === 4
      ? { w: 595, h: 842, lines: [] }
      : page([`第 ${index + 1} 页的内容写满一整行。`.repeat(index + 1).slice(0, 30 + index)]),
  );
  const book = buildPdfBook({ version: 1, outline: [], pages });
  assert.deepEqual(
    book.chapters.map((chapter) => chapter.title),
    [`第 1–${PAGES_PER_CHAPTER} 页`, `第 ${PAGES_PER_CHAPTER + 1}–${PAGES_PER_CHAPTER + 3} 页`],
  );
  assert.match(book.chapters[0]!.html, /<p class="pdf-no-text" id="pdf-page-5" data-page="5">第 5 页没有可提取的文字/);
});

test('a note in the margin does not split the sentence beside it; a second column is kept', () => {
  const noted = buildPdfBook({
    version: 1,
    outline: [],
    pages: [
      page([
        { t: '选择学位，可选：bachelor，master，doctor。本节中的选项', x: 113, y: 573 },
        { t: 'degree', x: 79, r: 108, y: 573, s: 9.9 },
        { t: '只能在文档类的选项中进行设置。', x: 113, r: 400, y: 557 },
        { t: '下一段从这里开始，写满一整行的文字内容。', x: 134, y: 520 },
      ]),
    ],
  });
  assert.equal(
    body(noted.chapters[0]!.html),
    '<p>选择学位，可选：bachelor，master，doctor。本节中的选项只能在文档类的选项中进行设置。</p>\n<p>下一段从这里开始，写满一整行的文字内容。</p>',
  );
  // Two columns: the left column's lines are as wide as the right's, and all of them stay.
  const columns = buildPdfBook({
    version: 1,
    outline: [],
    pages: [
      page([
        ...['左栏第一行文字', '左栏第二行文字', '左栏第三行文字'].map((t, i) => ({
          t,
          x: 50,
          r: 280,
          y: 700 - i * 16,
        })),
        ...['右栏第一行文字', '右栏第二行文字', '右栏第三行文字', '右栏第四行文字'].map((t, i) => ({
          t,
          x: 310,
          r: 540,
          y: 700 - i * 16,
        })),
      ]),
    ],
  });
  assert.match(columns.chapters[0]!.html, /左栏第一行文字/);
  assert.match(columns.chapters[0]!.html, /左栏第三行文字/);
});

test('a scan, with no text layer to speak of, is not reflowed', () => {
  const pages = Array.from({ length: 10 }, (_, index) =>
    index === 0 ? page(['封面']) : { w: 595, h: 842, lines: [] },
  );
  assert.deepEqual(buildPdfBook({ version: 1, outline: [], pages }), { hasText: false, chapters: [], toc: [] });
});

test('a title line may carry its number, but not just any line that ends with the words', () => {
  assert.equal(namesTitle('2 Background', 'Background'), true);
  assert.equal(namesTitle('第1章 引言', '引言'), true);
  assert.equal(namesTitle('3.1 模板的组成', '3.1 模板的组成'), true);
  assert.equal(namesTitle('This is the Background', 'Background'), false);
  assert.equal(namesTitle('一', '一'), false);
});

async function onDisk(t: { after(fn: () => Promise<void>): void }, bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-text-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const absPath = join(dir, 'book.pdf');
  await writeFile(absPath, bytes);
  return { dir, ctx: { relPath: 'book.pdf', absPath, bookId: 'b1', cacheDir: join(dir, 'derived') } };
}

test('the handler serves pages by default and chapters when asked for the text, and keeps the extraction', async (t) => {
  const pdf = buildPdf(
    [
      [
        { text: 'Chapter One', y: 760, size: 18 },
        { text: 'The first line of a para-', y: 720 },
        { text: 'graph that carries on.', y: 706 },
        { text: '1', y: 40, x: 290 },
      ],
      [
        { text: 'Chapter Two', y: 760, size: 18 },
        { text: 'Second chapter <text> & more.', y: 720 },
        { text: '2', y: 40, x: 290 },
      ],
    ],
    [
      { title: 'Chapter One', page: 0, top: 780 },
      { title: 'Chapter Two', page: 1, top: 780 },
    ],
  );
  const { dir, ctx } = await onDisk(t, pdf);
  const handler = fileHandlerForExtension('pdf')!;
  assert.equal((await handler.manifest(ctx)).kind, 'document');
  assert.equal((await handler.manifest({ ...ctx, variant: 'pdfjs' })).kind, 'document');

  const manifest = await handler.manifest({ ...ctx, variant: 'enhanced' });
  assert.equal(manifest.kind, 'reflowable');
  assert.match(manifest.revision!, /^pdf-text:/);
  assert.deepEqual(
    manifest.items.map((item) => [item.href, item.title, item.mediaType, item.note]),
    [
      ['xhtml:pdf/part0000.xhtml', 'Chapter One', 'text/html', '第 1 页起'],
      ['xhtml:pdf/part0001.xhtml', 'Chapter Two', 'text/html', '第 2 页起'],
    ],
  );
  const toc = await handler.toc!({ ...ctx, variant: 'enhanced' });
  assert.deepEqual(
    toc.map((entry) => [entry.href, entry.title]),
    [
      ['xhtml:pdf/part0000.xhtml', 'Chapter One'],
      ['xhtml:pdf/part0001.xhtml', 'Chapter Two'],
    ],
  );
  // A chapter is served by its ref whatever mode asked; its text is escaped.
  const chapter = (await handler.asset(ctx, { ref: 'xhtml:pdf/part0001.xhtml' })).data!.toString('utf8');
  assert.match(chapter, /<p>Second chapter &lt;text&gt; &amp; more\.<\/p>/);
  assert.match(
    (await handler.asset(ctx, { ref: 'xhtml:pdf/part0000.xhtml' })).data!.toString('utf8'),
    /The first line of a paragraph that carries on\./,
  );
  await assert.rejects(
    handler.asset(ctx, { ref: 'xhtml:pdf/part0009.xhtml' }),
    (error: AppError) => error.statusCode === 404,
  );
  // The file itself is still served for the pages mode.
  assert.equal((await handler.asset(ctx, { ref: 'document' })).contentType, 'application/pdf');
  // The extraction is kept in DATA_DIR for the next start.
  assert.equal((await readdir(join(dir, 'derived', 'pdf-text'))).filter((name) => name.endsWith('.json')).length, 1);
});

test('a scanned PDF asked for as text opens as pages, and says why', async (t) => {
  const { ctx } = await onDisk(t, buildPdf([[], [], []]));
  const manifest = await fileHandlerForExtension('pdf')!.manifest({ ...ctx, variant: 'enhanced' });
  assert.equal(manifest.kind, 'document');
  assert.match(manifest.notice!, /没有文字层/);
});

test('a file that is not a PDF fails with a reason when asked for as text', async (t) => {
  const { ctx } = await onDisk(t, Buffer.from('not a pdf at all'));
  await assert.rejects(
    fileHandlerForExtension('pdf')!.manifest({ ...ctx, variant: 'enhanced' }),
    (error: AppError) => error.statusCode === 422 && error.code === 'PDF_TEXT_FAILED',
  );
});
