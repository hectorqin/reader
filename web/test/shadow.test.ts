// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBookHost, extractBody, extractInlineStyles, sanitiseInjectedContent } from '../src/ui/shadow.ts';
import { BOOK_RESOURCE_MARKER } from '../src/formats/book-resource.ts';

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

  it('agrees with the server on the name of the book-resource marker', () => {
    // The server writes this string into the URLs it rewrites
    // (`server/src/indexer/formats/epub.ts`) and the check below reads it. The two
    // are the server and the client, so neither can import the other's constant —
    // each asserts the literal, and a rename that landed on one side would silently
    // stop every illustration in every EPUB from rendering.
    expect(BOOK_RESOURCE_MARKER).toBe('__reader-book-resource__');
  });

  it('keeps a marked absolute asset URL, which is how an illustrated EPUB renders', () => {
    // The report: "epub的图片没有显示出来" — every illustration in the book came
    // out as the browser's broken-image placeholder, and the cause was here.
    //
    // The server rewrites a chapter's relative references to *absolute* URLs,
    // because the chapter is fetched from the asset endpoint and `images/pic.png`
    // resolves to nothing from there. This function then kept an absolute URL only
    // when it started with the page's own `location.origin` — which is the app's
    // origin, not the API's — so every rewritten `src` was dropped. The check has
    // to be "is this the book's resource", which is what the marker says, rather
    // than "does this look like our origin", which is a guess that was wrong.
    const node = parse(
      `<img src="/api/v1/books/abc/assets?${BOOK_RESOURCE_MARKER}=1&ref=OEBPS%2Fimages%2Fpic.png"/>`,
    );
    sanitiseInjectedContent(node);
    const src = node.querySelector('img')?.getAttribute('src') ?? '';
    expect(src).toContain('ref=OEBPS%2Fimages%2Fpic.png');
  });

  it('resolves a relative URL from a book loaded locally', () => {
    // A book read straight from the file system never went through the server's
    // rewriter, so its references are still relative. Resolving them against the
    // document is what makes those illustrations work too — and it is why the
    // rewrite is a resolution rather than an allowlist of strings.
    const node = parse('<img src="images/pic.png"/>');
    sanitiseInjectedContent(node);
    const src = node.querySelector('img')?.getAttribute('src') ?? '';
    expect(src).not.toBe('');
    expect(src.startsWith('http')).toBe(true);
    expect(src.endsWith('images/pic.png')).toBe(true);
  });

  it('still drops a remote URL, marked or not', () => {
    // The marker is a *statement by the server*, so a book cannot forge it into
    // permission to reach a third party: an absolute URL is resolved and then
    // checked against the same rule, and a host that is not the document's own is
    // dropped either way. Stated as a test because the marker must not have
    // weakened the property this function exists for.
    const node = parse(`<img src="https://tracker.example/x.png?${BOOK_RESOURCE_MARKER}=1"/>`);
    sanitiseInjectedContent(node);
    expect(node.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('drops a remote srcset and keeps the local candidates', () => {
    const node = parse(
      '<img srcset="images/a.png 1x, https://tracker.example/b.png 2x, images/c.png 3x"/>',
    );
    sanitiseInjectedContent(node);
    const srcset = node.querySelector('img')?.getAttribute('srcset') ?? '';
    expect(srcset).not.toContain('tracker.example');
    expect(srcset).toContain('images/a.png 1x');
    expect(srcset).toContain('images/c.png 3x');
  });

  it('signs a book resource with the session token, which the browser cannot do itself', () => {
    // The report: "图片还是加载不出来". The address allow-list was already right —
    // the illustration survived with its `src` intact — and the request was still
    // refused, because the asset endpoint is authenticated and a sub-resource request
    // cannot carry an `Authorization` header. The only credential an `<img src>` can
    // present is one in its own URL, and nothing was putting it there.
    //
    // This is the case a functional test cannot see: the request is issued by the
    // browser, not by the client, so "did the client ask correctly" has nothing to do
    // with it. What can be asserted is that the address the browser is *handed* is
    // self-authenticating.
    const node = parse(
      `<img src="/api/v1/books/abc/assets?${BOOK_RESOURCE_MARKER}=1&ref=OEBPS%2Fimages%2Fpic.png"/>`,
    );
    sanitiseInjectedContent(node, {
      signAssetUrl: (url) => `${url}&access_token=tok`,
    });
    const src = node.querySelector('img')?.getAttribute('src') ?? '';
    expect(src).toContain('access_token=tok');
    expect(src).toContain('ref=OEBPS%2Fimages%2Fpic.png');
  });

  it('never hands the token to an address the allow-list refused', () => {
    // Ordering, and it is a security property rather than a nicety: the signer runs
    // *after* the decision that a URL may be fetched. If it ran before, or on the raw
    // markup, a book could name a third party and have the reader's session token
    // appended to the request for it — which is precisely the leak the allow-list
    // exists to prevent.
    const seen: string[] = [];
    const node = parse(
      `<img src="https://tracker.example/x.png?${BOOK_RESOURCE_MARKER}=1"/><img src="reader-res:a.png"/>`,
    );
    sanitiseInjectedContent(node, {
      signAssetUrl: (url) => {
        seen.push(url);
        return `${url}?access_token=tok`;
      },
    });
    expect(seen.some((url) => url.includes('tracker.example'))).toBe(false);
    // The remote one lost its `src`; the internal scheme is signed, because it is a
    // resource of this book and never touches the network.
    expect(node.querySelectorAll('img')[0]?.hasAttribute('src')).toBe(false);
    expect(seen).toEqual(['reader-res:a.png']);
  });

  it('signs a css url inside an injected style block', () => {
    // A publisher ships a background image or a `@font-face` as a CSS URL, and the
    // browser fetches that itself too — the same constraint, the same refusal. The
    // element's `style` attribute and its `<style>` blocks are where an injected
    // chapter's CSS text lives.
    const node = parse(
      `<style>.cover { background: url("/api/v1/books/abc/assets?${BOOK_RESOURCE_MARKER}=1&ref=OEBPS%2Fcover.jpg"); }</style>`,
    );
    sanitiseInjectedContent(node, { signAssetUrl: (url) => `${url}&access_token=tok` });
    expect(node.querySelector('style')?.textContent ?? '').toContain('access_token=tok');
  });

  it('leaves addresses alone when there is no session', () => {
    // No signer means no session (a test, a local file, a signed-out shell), and the
    // chapter must still render: the function returns null and the address is passed
    // through exactly as the allow-list left it.
    const node = parse(
      `<img src="/api/v1/books/abc/assets?${BOOK_RESOURCE_MARKER}=1&ref=a.png"/>`,
    );
    sanitiseInjectedContent(node, { signAssetUrl: () => null });
    expect(node.querySelector('img')?.getAttribute('src')).toBe(
      `/api/v1/books/abc/assets?${BOOK_RESOURCE_MARKER}=1&ref=a.png`,
    );
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
    // A column is one *page*, so it is sized to the box it is paginated into rather
    // than to the viewport. `100vw` was the same number only while the reading
    // surface happened to span the whole screen — and it does not: the two floating
    // bars inset it, and the reader's page margin is a property of the column. A
    // column wider than its page makes the stride arithmetic walk positions that are
    // not page boundaries, and the last column of every chapter becomes unreachable.
    const pagedRule = /:host\(\[data-paginated='true'\]\) .book-flow \{[^}]*\}/.exec(sheet)?.[0] ?? '';
    expect(pagedRule).toContain('column-width: 100%');
    expect(pagedRule).not.toContain('100vw');
  });

  it('keeps the page margin in paged mode, and drops only the vertical padding', () => {
    // The same book looked deliberate in scroll mode and unfinished in paged mode,
    // because the paged rule zeroed the whole `padding` — so a chapter was typeset
    // flush against the edge of the screen the moment the reader chose columns.
    // There is no screenshot assertion that catches this and no functional one
    // either: the text is *there*, it is simply in the wrong place.
    const host = createBookHost();
    const sheet = host.shadow.querySelector('style')?.textContent ?? '';
    const paged = /:host\(\[data-paginated='true'\]\) .book-flow \{[^}]*\}/.exec(sheet)?.[0] ?? '';
    expect(paged).toContain('padding-block: 0');
    expect(paged).not.toMatch(/padding:\s*0/);
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
