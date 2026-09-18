// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBookHost, extractBody, extractInlineStyles, sanitiseInjectedContent } from '../src/ui/shadow.ts';

/**
 * Sanitisation and style extraction.
 *
 * These run against a real DOM (jsdom) rather than a string, because the whole
 * point is to catch what the HTML parser produces — a string-level rewrite cannot
 * see the difference between a `<script>` in markup and one the parser moved.
 *
 * The security property being asserted: a book is data. It may describe how it
 * should look; it may not run code or reach the network.
 */

function parse(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('sanitiseInjectedContent', () => {
  it('removes script elements', () => {
    const node = parse('<p>text</p><script>window.pwned = true</script>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('script')).toBeNull();
    expect(node.textContent).toContain('text');
  });

  it('strips inline event handlers', () => {
    // These survive an innerHTML round trip, so they must be removed explicitly
    // rather than trusted to the parser.
    const node = parse('<img src="reader-res:a.png" onerror="window.pwned=1"/>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });

  it('strips a javascript: href but keeps the link text', () => {
    const node = parse('<a href="javascript:alert(1)">click</a>');
    sanitiseInjectedContent(node);
    const anchor = node.querySelector('a');
    expect(anchor?.hasAttribute('href')).toBe(false);
    expect(anchor?.textContent).toBe('click');
  });

  it('drops a remote src so a book cannot report a reading session', () => {
    const node = parse('<img src="https://tracker.example/pixel.gif"/>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('keeps the internal resource scheme and blob/data URLs', () => {
    const node = parse(
      '<img src="reader-res:OEBPS/a.png"/><img src="data:image/png;base64,AA"/><img src="blob:xyz"/>',
    );
    sanitiseInjectedContent(node);
    const sources = [...node.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toEqual(['reader-res:OEBPS/a.png', 'data:image/png;base64,AA', 'blob:xyz']);
  });

  it('removes a base element and a meta refresh, which would navigate away', () => {
    const node = parse('<base href="https://evil.example/"/><meta http-equiv="refresh" content="0;url=https://evil.example"/>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('base')).toBeNull();
    expect(node.querySelector('meta')).toBeNull();
  });

  it('removes target so a footnote link cannot replace the reader', () => {
    const node = parse('<a href="reader-res:notes.xhtml" target="_blank">note</a>');
    sanitiseInjectedContent(node);
    expect(node.querySelector('a')?.hasAttribute('target')).toBe(false);
    expect(node.querySelector('a')?.getAttribute('href')).toBe('reader-res:notes.xhtml');
  });

  it('leaves ordinary content untouched', () => {
    const node = parse('<p>正文</p><em>强调</em><ruby>漢<rt>かん</rt></ruby>');
    sanitiseInjectedContent(node);
    expect(node.textContent).toBe('正文强调漢かん');
    expect(node.querySelector('ruby')).not.toBeNull();
  });
});

describe('extractBody', () => {
  it('returns only the body of a full XHTML document', () => {
    const html = '<html><head><title>t</title></head><body><p>内容</p></body></html>';
    expect(extractBody(html)).toBe('<p>内容</p>');
  });

  it('returns the input unchanged when there is no body element', () => {
    expect(extractBody('<p>fragment</p>')).toBe('<p>fragment</p>');
  });
});

describe('extractInlineStyles', () => {
  it('collects style blocks in document order', () => {
    const html = '<style>a{color:red}</style><p>x</p><style>b{color:blue}</style>';
    expect(extractInlineStyles(html)).toEqual(['a{color:red}', 'b{color:blue}']);
  });

  it('returns an empty list when there are none', () => {
    expect(extractInlineStyles('<p>x</p>')).toEqual([]);
  });
});

/**
 * The host's own styling.
 *
 * These exist because the reading column was, for a while, completely unstyled
 * and nothing said so. `.book-flow` is inside a shadow root, so the rules in
 * `styles/reader.css` matched nothing at all — a document stylesheet cannot reach
 * into a shadow root, and the failure is invisible from the outside: the book's
 * own CSS still applied, so the page looked *styled*, just without a measure, a
 * margin, a font scale or any columns. What is asserted here is the mechanism,
 * not the appearance: the layout sheet is in the shadow root, it survives a
 * chapter change, and it reaches the host's own state attribute through `:host()`
 * rather than through a class selector that cannot match.
 */
describe('BookShadowHost', () => {
  it('injects the reading column rules into the shadow root', () => {
    const host = createBookHost();
    const sheet = host.shadow.querySelector('style')?.textContent ?? '';
    // The measure, the margins, the font scale and the columns: the four things
    // the document stylesheet was supposedly providing.
    expect(sheet).toContain('.book-flow');
    expect(sheet).toContain('max-inline-size: var(--reader-measure');
    expect(sheet).toContain('padding-inline: var(--reader-page-margin');
    expect(sheet).toContain('font-size: calc(1em * var(--reader-font-scale');
    expect(sheet).toContain('column-width: 100vw');
  });

  it('reaches the host state through :host(), not through a class selector', () => {
    // `data-paginated` and `data-animating` are set on the host element, which is
    // *outside* the shadow tree. `.book-host[data-paginated] .book-flow` cannot
    // match it from inside — which is why paged mode silently produced no columns
    // and a page turn had nowhere to go.
    const host = createBookHost();
    const sheet = host.shadow.querySelector('style')?.textContent ?? '';
    expect(sheet).toContain(":host([data-paginated='true']) .book-flow");
    expect(sheet).toContain(":host([data-animating='slide-next']) .book-flow");
    expect(sheet).not.toContain('.book-host[');
  });

  it('keeps the layout sheet when a chapter replaces the book styles', () => {
    // The book's styles change with every chapter; the reader's layout rules must
    // not, or the column loses its measure for a frame on every chapter change.
    const host = createBookHost();
    const before = sheets(host)[0];
    host.setContent('<p>正文</p>', ['p { color: red }']);
    const after = sheets(host);
    expect(after[0]).toBe(before);
    expect(after[after.length - 1]).toContain('p { color: red }');
    // The layout sheet is first, so the book's own rules still win the cascade.
    expect(after[0]).toContain('.book-flow');
  });

  it('keeps the layout sheet through clear()', () => {
    const host = createBookHost();
    host.clear();
    const after = sheets(host);
    expect(after[0]).toContain('.book-flow');
    // Only the *book's* sheet is emptied by a clear; the reader's own sheets are
    // not this method's business.
    expect(after[after.length - 1]).toBe('');
  });

  it('injects the plain-text typesheet only when the book asks for it', () => {
    // A TXT has no author stylesheet to defer to, so the reader supplies one; an
    // EPUB does, so it must be absent rather than merely overridable. The absence
    // is the contract, which is why it is asserted and not just the presence.
    const host = createBookHost();
    expect(sheets(host).join('\n')).not.toContain('.txt-body');

    host.setPlainText(true);
    expect(sheets(host).join('\n')).toContain('.txt-body > p');
    expect(host.hasAttribute('data-plain-text')).toBe(true);

    host.setPlainText(false);
    expect(sheets(host).join('\n')).not.toContain('.txt-body');
    expect(host.hasAttribute('data-plain-text')).toBe(false);
  });

  it('puts the plain-text sheet before the book sheet, so a book still wins', () => {
    // A TXT has no styles to lose, but a book *classified* as one (a `.txt` that is
    // really an XHTML fragment) does, and the cascade has to leave room for it.
    const host = createBookHost();
    host.setPlainText(true);
    host.setContent('<p>正文</p>', ['p { color: red }']);
    const after = sheets(host);
    const txt = after.findIndex((sheet) => sheet.includes('.txt-body'));
    const book = after.findIndex((sheet) => sheet.includes('p { color: red }'));
    expect(txt).toBeGreaterThanOrEqual(0);
    expect(txt).toBeLessThan(book);
  });

  it('keeps the plain-text decision across a chapter change', () => {
    // Which typesheet applies is a property of the *book*, not of the chapter on
    // screen; a TXT that lost its stylesheet on the second chapter would read as a
    // rendering bug at exactly the moment the reader turned the page.
    const host = createBookHost();
    host.setPlainText(true);
    host.setContent('<div class="txt-body"><p>第一章</p></div>', []);
    host.setContent('<div class="txt-body"><p>第二章</p></div>', []);
    expect(host.shadow.querySelector('.txt-body')).not.toBeNull();
    expect(sheets(host).join('\n')).toContain('.txt-body > p');
  });
});

/** The shadow root's sheets, in cascade order. */
function sheets(host: ReturnType<typeof createBookHost>): string[] {
  return [...host.shadow.querySelectorAll('style')].map((node) => node.textContent ?? '');
}

describe('plain-text detection', () => {
  it('is driven by the format, and confirmed against the markup', async () => {
    // The two have to agree, and the client cannot assume they do. A server that
    // windows a TXT as `reflowable` — a reasonable choice, since a TXT is reflowable
    // — declares `format: 'reflowable'` while sending the reader's own plain-text
    // markup; believing the label alone left those paragraphs unstyled and the indent
    // control doing nothing.
    const { ReaderView } = await import('../src/ui/reader-view.ts');
    const container = document.createElement('div');
    document.body.append(container);

    const declared = new ReaderView({ container, doc: textDoc('txt', '<div class="txt-body"><p>一</p></div>') });
    expect(declared.isPlainText()).toBe(true);

    const observed = new ReaderView({ container, doc: textDoc('epub', '<div class="txt-body"><p>一</p></div>') });
    expect(observed.isPlainText()).toBe(true);

    // An EPUB chapter that merely *mentions* the marker in its prose is not one.
    const prose = new ReaderView({ container, doc: textDoc('epub', '<p>他说 div class="txt-body" 是纯文本用的</p>') });
    expect(prose.isPlainText()).toBe(false);

    // Neither is one with no markup at all — *unless* the section declares itself.
    // And that declaration is the case the marker cannot cover: the server now sends
    // a TXT chapter as bare characters with no wrapper at all, so a chapter that is
    // nothing but plain text carries nothing to sniff. Sniffing for the marker
    // answered "not plain text" and the reader drew a novel with no paragraphs, no
    // indent and no stylesheet — a defect that reads as a typography preference
    // rather than a bug.
    const bare = new ReaderView({ container, doc: textDoc('epub', '<p>正文</p>') });
    expect(bare.isPlainText()).toBe(false);

    const declaredBare = new ReaderView({
      container,
      doc: textDoc('epub', '第一章 惊蛰\n\n第 1 段。', { plainText: true }),
    });
    expect(declaredBare.isPlainText()).toBe(true);
  });
});

/** A one-section document, for the detection test. */
function textDoc(format: string, html: string, section: Record<string, unknown> = {}) {
  return {
    format,
    layout: 'reflowable',
    render: 'reflowable',
    direction: 'ltr',
    sections: [{ id: 'c0', label: '一', html, depth: 0, ...section }],
    toc: [],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  } as never;
}
