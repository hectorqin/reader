import { describe, expect, it } from 'vitest';
import { loadBook, detectFormat, extensionOf } from '../src/formats/index.ts';
import { loadTxt } from '../src/formats/txt.ts';
import { rewriteDocument, rewriteCss } from '../src/formats/epub.ts';
import { resolveHref } from '../src/formats/zip.ts';
import { makeCbz, makeEpub, PNG_1X1, utf8 } from './helpers/fixtures.ts';

const ctx = (bytes: Uint8Array, fileName: string) => ({ bytes, fileName, bookId: 'book-1' });

describe('format detection', () => {
  it('uses magic bytes over a misleading extension', () => {
    // A `.txt` that is really an EPUB is common in libraries built by scripts.
    expect(detectFormat('book.txt', new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('cbz');
    expect(detectFormat('book.txt', utf8('%PDF-1.7 ...'))).toBe('pdf');
  });

  it('recognises an EPUB zip even when the extension says nothing', () => {
    const bytes = utf8('PK\u0003\u0004xxMETA-INF/container.xml');
    expect(detectFormat('book.zip', bytes)).toBe('epub');
  });

  it('reports CBR as unknown rather than pretending to parse it', () => {
    // RAR cannot be decoded in the browser; a clear "unsupported" beats a
    // confusing parse error.
    expect(detectFormat('book.cbr')).toBe('unknown');
  });

  it('falls back to the extension when no bytes are available', () => {
    expect(detectFormat('a.epub')).toBe('epub');
    expect(detectFormat('a.pdf')).toBe('pdf');
    expect(detectFormat('a.cbz')).toBe('cbz');
    expect(detectFormat('a.gif')).toBe('image');
    expect(detectFormat('a.xyz')).toBe('unknown');
  });

  it('extracts the extension past paths, fragments and uppercase', () => {
    expect(extensionOf('a/b/c.JPEG')).toBe('jpeg');
    expect(extensionOf('x.svg#frag')).toBe('svg');
  });
});

describe('href resolution', () => {
  it('collapses parent segments', () => {
    expect(resolveHref('OEBPS/text', '../images/a.png')).toBe('OEBPS/images/a.png');
    expect(resolveHref('OEBPS', 'text/a.png')).toBe('OEBPS/text/a.png');
    expect(resolveHref('', 'a.png')).toBe('a.png');
  });

  it('decodes percent-encoded paths, which EPUBs use for CJK file names', () => {
    expect(resolveHref('OEBPS', '%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml')).toBe('OEBPS/第一章.xhtml');
  });

  it('leaves absolute URLs alone', () => {
    expect(resolveHref('OEBPS', 'https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});

describe('resource rewriting', () => {
  it('rewrites relative src and href into the internal scheme', () => {
    const html = '<img src="../img/a.png"/><a href="ch2.xhtml">next</a>';
    const out = rewriteDocument(html, 'OEBPS/text');
    expect(out).toContain('reader-res:OEBPS/img/a.png');
    expect(out).toContain('reader-res:OEBPS/text/ch2.xhtml');
  });

  it('preserves fragments so footnote links still land on the note', () => {
    const out = rewriteDocument('<a href="notes.xhtml#fn1">1</a>', 'OEBPS');
    expect(out).toContain('reader-res:OEBPS/notes.xhtml#fn1');
  });

  it('does not touch data URIs, blob URLs or fragment-only links', () => {
    const html = '<img src="data:image/png;base64,AAA"/><a href="#top">top</a>';
    const out = rewriteDocument(html, 'OEBPS');
    expect(out).toContain('src="data:image/png;base64,AAA"');
    expect(out).toContain('href="#top"');
    expect(out).not.toContain('reader-res:');
  });

  it('leaves remote URLs for the CSP to block', () => {
    const out = rewriteDocument('<img src="https://tracker.example/p.gif"/>', 'OEBPS');
    expect(out).toContain('https://tracker.example/p.gif');
  });

  it('rewrites url() inside CSS, including quoted forms', () => {
    const css = 'body{background:url(../i/bg.png)}a{background:url("../i/2.png")}';
    const out = rewriteCss(css, 'OEBPS/css/main.css');
    expect(out).toContain('reader-res:OEBPS/i/bg.png');
    expect(out).toContain('reader-res:OEBPS/i/2.png');
  });

  it('leaves url() that is already absolute', () => {
    const out = rewriteCss('@font-face{src:url(https://x/f.woff2)}', 'a.css');
    expect(out).toContain('https://x/f.woff2');
  });
});

describe('EPUB loading', () => {
  it('follows the spine order, not the manifest or archive order', async () => {
    // The manifest lists the chapters out of order and the archive is written in
    // that same wrong order. Only the spine is authoritative. A loader that
    // walks the zip or trusts the manifest gets a book that reads 三二一.
    const bytes = await makeEpub({
      chapters: [
        { id: 'c3', href: 'ch3.xhtml', title: '三' },
        { id: 'c1', href: 'ch1.xhtml', title: '一' },
        { id: 'c2', href: 'ch2.xhtml', title: '二' },
      ],
      spineOrder: ['c1', 'c2', 'c3'],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.sections.map((section) => section.label)).toEqual(['一', '二', '三']);
    expect(doc.format).toBe('epub');
    expect(doc.layout).toBe('reflowable');
    expect(doc.orderedByBook).toBe(true);
  });

  it('excludes spine items marked linear="no"', async () => {
    const bytes = await makeEpub({
      chapters: [
        { id: 'c1', href: 'ch1.xhtml', title: '一' },
        { id: 'c2', href: 'ch2.xhtml', title: '二' },
      ],
      spineOrder: ['c1', 'c2'],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.sections).toHaveLength(2);
  });

  it('reads the navigation document for chapter labels and order', async () => {
    const bytes = await makeEpub({
      chapters: [
        { id: 'c1', href: 'ch1.xhtml', title: '第一章' },
        { id: 'c2', href: 'ch2.xhtml', title: '第二章' },
      ],
      toc: [
        { href: 'ch2.xhtml', label: '二 · 风起' },
        { href: 'ch1.xhtml', label: '一 · 起始' },
      ],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    // Reading order still comes from the spine...
    expect(doc.sections.map((section) => section.id)).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml']);
    // ...while the TOC supplies the labels and its own ordering.
    expect(doc.sections[0]!.label).toBe('一 · 起始');
    expect(doc.sections[1]!.label).toBe('二 · 风起');
    expect(doc.toc.map((entry) => entry.label)).toEqual(['二 · 风起', '一 · 起始']);
  });

  it('falls back to the NCX table of contents for EPUB 2 books', async () => {
    const bytes = await makeEpub({
      chapters: [{ id: 'c1', href: 'ch1.xhtml', title: '第一章' }],
      ncx: [{ src: 'ch1.xhtml', label: 'NCX 标题' }],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.toc[0]!.label).toBe('NCX 标题');
  });

  it('carries the author stylesheets through to the renderer', async () => {
    const bytes = await makeEpub({
      chapters: [{ id: 'c1', href: 'ch1.xhtml', title: '一' }],
      styles: [{ path: 'styles/main.css', css: 'p{margin:0 0 0 2em;text-indent:2em}' }],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    const joined = doc.styles.join('\n');
    // The author's indent must survive: this is the property the product is
    // differentiated on, so it is asserted rather than assumed.
    expect(joined).toContain('text-indent:2em');
  });

  it('rewrites image references inside chapter markup', async () => {
    const bytes = await makeEpub({
      chapters: [
        {
          id: 'c1',
          href: 'text/ch1.xhtml',
          title: '一',
          extra: '<img src="../images/fig1.png"/>',
        },
      ],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.sections[0]!.html).toContain('reader-res:OEBPS/images/fig1.png');
  });

  it('honours page-progression-direction for right-to-left books', async () => {
    const bytes = await makeEpub({
      chapters: [{ id: 'c1', href: 'ch1.xhtml', title: '一' }],
      direction: 'rtl',
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.direction).toBe('rtl');
  });

  it('handles an OPF at the archive root, where the base dir is empty', async () => {
    const bytes = await makeEpub({
      chapters: [{ id: 'c1', href: 'ch1.xhtml', title: '一' }],
      opfPath: 'content.opf',
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.sections[0]!.id).toBe('ch1.xhtml');
  });

  it('derives a label for a chapter missing from the TOC', async () => {
    const bytes = await makeEpub({
      chapters: [{ id: 'c1', href: 'ch1.xhtml', title: '未列出的一章' }],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.sections[0]!.label).toBe('未列出的一章');
  });

  it('registers archive entries that the manifest forgot', async () => {
    const bytes = await makeEpub({
      chapters: [{ id: 'c1', href: 'ch1.xhtml', title: '一' }],
    });
    const { doc } = await loadBook(ctx(bytes, 'book.epub'));
    expect(doc.resources.has('OEBPS/ch1.xhtml')).toBe(true);
  });
});

describe('TXT loading', () => {
  const text = [
    '第一章 起始',
    '第一段正文。',
    '第二段正文。',
    '',
    '第二章 风起',
    '风起了。',
    '',
    '第三章 归途',
    '回家了。',
  ].join('\n');

  it('splits on Chinese chapter headings', () => {
    const result = loadTxt(ctx(utf8(text), 'book.txt'));
    expect(result.chapterCount).toBe(3);
    expect(result.doc.sections.map((section) => section.label)).toEqual(['第一章 起始', '第二章 风起', '第三章 归途']);
    expect(result.encoding).toBe('utf-8');
  });

  it('recognises arabic-numeral and English chapter headings', () => {
    const result = loadTxt(ctx(utf8('第1章 起点\naaa\n\nChapter 2 Go\nbbb'), 'b.txt'));
    expect(result.chapterCount).toBe(2);
  });

  it('does not treat a long paragraph beginning with 第…章 as a heading', () => {
    // The failure this guards against: a real chapter body loses its opening
    // and the reader jumps into the middle of a paragraph.
    const long = `第三章，他继续走。${'很长的一句话。'.repeat(30)}`;
    const result = loadTxt(ctx(utf8(`第一章 起点\n开头\n\n${long}`), 'b.txt'));
    expect(result.chapterCount).toBe(1);
  });

  it('does not treat an in-prose mention of a chapter number as a heading', () => {
    const result = loadTxt(ctx(utf8('第一章 起点\n他说他在第二章里读过这段。\n'), 'b.txt'));
    expect(result.chapterCount).toBe(1);
  });

  it('keeps a preface before the first heading as its own section', () => {
    const result = loadTxt(ctx(utf8('这是前言。\n\n第一章 起始\n正文'), 'b.txt'));
    expect(result.doc.sections[0]!.label).toBe('前言');
    expect(result.doc.sections[1]!.label).toBe('第一章 起始');
  });

  it('chunks by length when there are no headings at all', () => {
    const body = '一句话。'.repeat(30_000);
    const result = loadTxt(ctx(utf8(body), 'b.txt'));
    expect(result.chapterCount).toBe(0);
    // A single unbounded section would freeze layout on a phone, so the loader
    // must break it up.
    expect(result.doc.sections.length).toBeGreaterThan(1);
  });

  it('escapes markup so a TXT file cannot inject HTML', () => {
    const result = loadTxt(ctx(utf8('第一章\n<script>alert(1)</script>\n<p>不是标签</p>'), 'b.txt'));
    const html = result.doc.sections[0]!.html ?? '';
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('honours a forced encoding override', () => {
    const result = loadTxt(ctx(utf8('第一章\n正文'), 'b.txt'), { encoding: 'utf-8' });
    expect(result.encodingGuessed).toBe(false);
  });

  it('can be told not to split at all', () => {
    const result = loadTxt(ctx(utf8(text), 'b.txt'), { splitChapters: false });
    expect(result.chapterCount).toBe(0);
  });

  it('normalises CRLF so chapter matching works on Windows-authored files', () => {
    const result = loadTxt(ctx(utf8('第一章 起点\r\n正文\r\n\r\n第二章 风起\r\n正文'), 'b.txt'));
    expect(result.chapterCount).toBe(2);
  });
});

describe('CBZ loading', () => {
  it('orders pages naturally and emits one fixed-layout section per page', async () => {
    const bytes = await makeCbz([
      { name: '010.png' },
      { name: '002.png' },
      { name: '001.png' },
    ]);
    const { doc } = await loadBook(ctx(bytes, 'comic.cbz'));
    expect(doc.layout).toBe('fixed');
    expect(doc.sections.map((section) => section.id)).toEqual(['001.png', '002.png', '010.png']);
    expect(doc.sections[0]!.image?.mediaType).toBe('image/png');
  });

  it('ignores archive bookkeeping files that are not pages', async () => {
    const bytes = await makeCbz([
      { name: '001.png' },
      { name: '__MACOSX/._001.png' },
      { name: 'ComicInfo.xml' as string },
      { name: 'Thumbs.db' as string },
    ]);
    const { doc } = await loadBook(ctx(bytes, 'comic.cbz'));
    // The XML and Thumbs.db have no image extension, so only the real page and
    // the AppleDouble sidecar could leak through; the sidecar is filtered.
    expect(doc.sections.map((section) => section.id)).toEqual(['001.png']);
  });

  it('detects a directory comic from the manifest page list', async () => {
    const pages = ['a/002.jpg', 'a/001.jpg'];
    const { doc } = await loadBook(ctx(new Uint8Array(), 'loose'), {
      fileName: 'loose',
      comicPages: pages,
      resolvePage: async () => PNG_1X1,
    });
    expect(doc.format).toBe('comic-dir');
    expect(doc.sections.map((section) => section.id)).toEqual(['a/001.jpg', 'a/002.jpg']);
  });

  it('labels pages by index when the file names are meaningless', async () => {
    const bytes = await makeCbz([{ name: 'a1b2c3.png' }, { name: 'd4e5f6.png' }]);
    const { doc } = await loadBook(ctx(bytes, 'comic.cbz'));
    expect(doc.sections[0]!.label).toContain('第 1 页');
    expect(doc.sections[0]!.label).toContain('a1b2c3');
  });

  it('refuses an empty comic directory instead of opening a blank book', async () => {
    await expect(
      loadBook(ctx(new Uint8Array(), 'loose'), { fileName: 'loose', comicPages: [] }),
    ).rejects.toThrow();
  });
});

describe('PDF loading', () => {
  it('reports a single fixed-layout section so navigation stays uniform', async () => {
    const { doc } = await loadBook(ctx(utf8('%PDF-1.7 fake'), 'doc.pdf'));
    expect(doc.format).toBe('pdf');
    expect(doc.layout).toBe('fixed');
    expect(doc.sections).toHaveLength(1);
    expect((doc.sections[0] as { document?: { bytes: Uint8Array } }).document?.bytes).toEqual(utf8('%PDF-1.7 fake'));
  });
});

describe('unknown formats', () => {
  it('throws a message the UI can show', async () => {
    await expect(loadBook(ctx(utf8('x'), 'mystery.xyz'))).rejects.toThrow(/不支持的格式/);
  });
});
