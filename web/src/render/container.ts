/**
 * Where a chapter document lives inside the reader.
 *
 * ============================================================================
 * The iframe vs Shadow DOM decision
 * ============================================================================
 *
 * The user asked whether a pure-H5 build needs an iframe or a Shadow DOM for
 * strict epub resources. The short answer is **Shadow DOM for the outer
 * document, and one `srcdoc` iframe per chapter for the book itself.** That is
 * not a hedge; the two problems are genuinely different and each primitive
 * solves exactly one of them.
 *
 * ## What Shadow DOM does and does not do
 *
 * It is NOT isolation from the publisher's stylesheet, and anyone who reaches for
 * it expecting that has misread the primitive. The publisher's CSS is not "the
 * document's rules" — it is a chapter asset that has to end up inside the root to
 * do anything at all. Inside, it styles the book exactly as it would in an
 * iframe. The book must style itself; that is the product.
 *
 * What it *does* provide, and the reason it is the outer container:
 *
 *  - The client's own UI rules cannot leak in and restyle a footnote or a
 *    blockquote. `all: unset` and `!important` in the shell's CSS are contained,
 *    which is precisely the failure mode this product exists to avoid.
 *  - Per-chapter resources are discarded with the chapter, so a book whose
 *    chapters each link their own stylesheet cannot corrupt later chapters.
 *  - The shell keeps its own DOM: dialogs, gestures, overlays and selection
 *    handling all live outside the root and cannot be matched by a book's `*`
 *    selector.
 *
 * ## Why the book itself is an iframe
 *
 * This is the part that the first version of this module got wrong, and the
 * browser test is what caught it. A chapter document is not a fragment: it has a
 * `<head>` with `<link rel=stylesheet>` and a `<body>` with `<img src>`. Those
 * are **sub-resource requests**, and they are issued by the browser, not by our
 * code. Two consequences:
 *
 *  1. **They cannot carry an `Authorization` header.** There is no API to attach
 *     a request header to an `<img>` or a `<link>`. Injecting the chapter's CSS
 *     and images into the host document therefore breaks every one of them with a
 *     401 — the book renders as unstyled text with no pictures, which is exactly
 *     what happened before this file was rewritten.
 *  2. **They resolve against the document's base URL.** The chapter's `src` is
 *     already rewritten to an absolute asset URL by the server, so this is
 *     satisfied — but only because it is a real document with a real base.
 *
 * A shadow root solves neither. An `iframe` solves both: it is a real browsing
 * context, so its `src`/`href` requests are ordinary navigations that can carry
 * whatever URL (including a token query parameter) they were written with, and
 * its base URL is its own.
 *
 * `srcdoc` rather than a Blob URL: a Blob URL's origin is opaque, so the frame's
 * requests would be cross-origin and the asset endpoint would refuse them. A
 * `srcdoc` frame inherits the parent's origin, which is what makes the rewritten
 * absolute URLs work without CORS.
 *
 * ## What an iframe costs, and why it is worth paying
 *
 * A frame is a nested browsing context with its own layout and lifecycle. That
 * cost is only paid per chapter — one frame is reused and its `srcdoc` replaced,
 * not one frame per chapter — and it buys the guarantee that a chapter is a
 * *document*, rendered by an engine that has been rendering documents for thirty
 * years, rather than a fragment we hope is equivalent.
 *
 * The paginator therefore drives the inner document's scroller. That is the same
 * amount of work as driving a local one, and it is the only arrangement in which
 * `document.styleSheets`, `@page`, `@font-face` and `:root` in a book's CSS mean
 * what the publisher intended — `:root` inside a shadow root refers to the shadow
 * root itself, not to an element the client can set variables on, which is the
 * second bug the browser test caught.
 */

/** A mounted chapter. */
export interface MountedChapter {
  /** Document the chapter was loaded into, once it has loaded. */
  document(): Document | null;
  /** The element the paginator scrolls. */
  scroller(): HTMLElement;
}

/**
 * The reading frame.
 *
 * One `iframe`, reused across chapters. `srcdoc` is replaced rather than the
 * frame being recreated: tearing down and rebuilding a browsing context per
 * chapter is measurable on a 200-chapter book, and a reused frame keeps the
 * same compositing layer.
 */
export class ChapterContainer {
  readonly host: HTMLElement;
  private frame: HTMLIFrameElement;
  private ready: Promise<void> | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.frame = document.createElement('iframe');
    this.frame.className = 'reader-frame';
    // Set inline as well as in the stylesheet: this element's default sizing
    // (`display: inline`, 2px border) is wrong in a way that breaks pagination
    // rather than merely looking off, and a stylesheet that fails to load must
    // not be able to reintroduce it.
    this.frame.style.display = 'block';
    this.frame.style.width = '100%';
    this.frame.style.height = '100%';
    this.frame.style.border = '0';
    // Same-origin is required for the client to read the chapter's layout for
    // pagination and text selection. There is no script in a chapter document
    // that could exploit it: `allow-scripts` is deliberately absent, so a book's
    // own `<script>` cannot run even if it has one.
    this.frame.setAttribute('sandbox', 'allow-same-origin');
    this.frame.setAttribute('title', '正文');
    host.replaceChildren(this.frame);
  }

  /**
   * Load a chapter document.
   *
   * The server has already made the document self-contained: relative resource
   * references are rewritten to absolute asset URLs, so the frame needs nothing
   * from us beyond the markup and the token the URLs carry.
   */
  async mount(html: string, settings: ReaderStyle): Promise<MountedChapter> {
    const doc = this.frame.contentDocument;
    if (!doc) throw new Error('chapter frame has no document');

    const styled = injectReaderStyle(html, settings, this.width());
    this.ready = waitForLoad(this.frame);
    this.frame.srcdoc = styled;
    await this.ready;

    const chapter = this.frame.contentDocument;
    if (!chapter) throw new Error('chapter frame lost its document');
    return {
      document: () => this.frame.contentDocument,
      scroller: () => (chapter.scrollingElement ?? chapter.documentElement) as HTMLElement,
    };
  }

  /** The element the paginator scrolls: the chapter's own scrolling element. */
  scroller(): HTMLElement | null {
    const doc = this.frame.contentDocument;
    if (!doc?.body) return null;
    return (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
  }

  /** The chapter's document, once it has loaded. */
  document(): Document | null {
    return this.frame.contentDocument;
  }

  /**
   * Width of one page.
   *
   * Read from the frame rather than from the host: the frame is the element the
   * document actually lays out in, and a host with padding or a scrollbar would
   * give a different answer than the page geometry the CSS computed.
   */
  width(): number {
    // `clientWidth` is 0 before the frame has been laid out, which happens on the
    // first mount. Falling back to the host keeps the first chapter from being
    // paginated against a zero-width page.
    return this.frame.clientWidth || this.host.clientWidth || 360;
  }

  destroy(): void {
    this.host.replaceChildren();
  }
}

/** The subset of reader settings a chapter document needs. */
export interface ReaderStyle {
  fontSize: number;
  pageWidth: number;
  columnGap: number;
  pagePadding: number;
  background: string;
  text: string;
}

/**
 * Build the complete chapter document.
 *
 * Everything the document needs is inlined, because an `srcdoc` frame has no
 * base URL of its own to resolve a client stylesheet against — and because a
 * chapter that loaded its reader CSS from the network would be unstyled for one
 * frame, which is visible on every chapter turn.
 *
 * The styles appended last are the reader's own, and they are deliberately
 * minimal: page geometry, and a font size the book may override. See
 * `render/theme.ts` for why the list stops there.
 */
function injectReaderStyle(html: string, settings: ReaderStyle, frameWidth: number): string {
  const style = `<style id="reader-page">${pageCss(settings, frameWidth)}</style>`;
  const withViewport = /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${viewportMeta()}`)
    : html;
  if (/<\/head>/i.test(withViewport)) return withViewport.replace(/<\/head>/i, `${style}</head>`);
  return `${style}${withViewport}`;
}

/** A phone-width viewport, so a chapter authored for a desktop window reflows. */
function viewportMeta(): string {
  return '<meta name="viewport" content="width=device-width, initial-scale=1">';
}

/**
 * Page geometry for a chapter.
 *
 * `column-width` is what creates pages; the frame's scroller then moves between
 * them by `scrollLeft`, exactly as it would for a horizontal list. Nothing here
 * selects a content element, so nothing here can flatten a publisher's layout.
 *
 * ## The height that makes columns work
 *
 * `column-fill: auto` only fragments content when the container has a *definite*
 * height. Left alone, `html` and `body` size to their content, the computed
 * height becomes the content's own height, and the whole chapter lays out in a
 * single column as tall as the text — `scrollWidth` equals `clientWidth` and
 * every "page" is the entire chapter. That is what this file did before the
 * browser test looked at `scrollWidth`, and it is not a subtle failure: the
 * reader shows one page per chapter and the page-turn gesture does nothing.
 *
 * So the document is pinned to the frame's viewport height: 100vh inside an
 * iframe is the frame's own viewport, which is exactly the page height wanted.
 * The body deliberately does NOT clip its overflow — clipping it also clips the
 * columns it generated, so content past the first page never becomes scrollable
 * and the chapter reports a single page.
 *
 * The one rule that does touch content is `font-size` on `html`, and it is
 * expressed so a book can win: a book that sets an absolute size keeps it, and a
 * book that uses relative sizes scales with the reader's choice. That is the only
 * way a font-size control can work without overriding the book.
 */
function pageCss(settings: ReaderStyle, frameWidth: number): string {
  // `pageWidth` is a CEILING on how wide a page may be, not the width itself: on
  // a 390px phone a 720px column would lay the whole chapter out in one column
  // wider than the screen, and every page turn would scroll nowhere. The column
  // takes the smaller of the reader's preference and the space that exists.
  const width = Math.max(80, Math.min(settings.pageWidth, frameWidth));
  const usable = Math.max(80, width - settings.pagePadding * 2);
  return `
html {
  font-size: ${settings.fontSize}px;
  background: ${settings.background};
  color: ${settings.text};
  /* The document is the scroll container; the frame is sized to one page. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  /* No scroll-snap here. Snapping to the columns sounds right and is not: the
     snap target is each column's own edge, so a programmatic scrollLeft lands
     wherever the browser decides the nearest snap point is — and a snap point
     inside a column is not a page boundary. The paginator sets scrollLeft
     explicitly, and a gesture handler keeps user swipes on the same grid. */
}
html::-webkit-scrollbar { display: none; }
body {
  /* Columns are the pagination: one column is exactly one page. The column
     width is set below in pixels rather than left to the publisher's rules, and
     nothing else about the body typography is touched. */
  column-width: ${usable}px;
  column-gap: ${settings.columnGap}px;
  column-fill: auto;
  /* A definite height is what lets the content fragment into columns at all. */
  height: 100vh;
  /* No overflow: hidden here. Clipping the body also clips the columns it
     generated, so content past the first page never becomes scrollable and the
     chapter reports a single page. The document's own scroller is what has to
     see the overflow. */
  margin: 0;
  padding: 0 ${settings.pagePadding}px;
  box-sizing: border-box;
  /* No forced font-family and no line-height: the publisher's body rules decide
     the typography, as they should. */
}
img, svg {
  /* An image that overflows its column breaks the geometry for the whole
     chapter, not just for itself. Clamping is the one place where fidelity has
     to give way, and it is stated here rather than hidden in a reset. */
  max-width: 100%;
  max-height: 90vh;
  object-fit: contain;
  break-inside: avoid;
}
`;
}

/** Resolve when a frame finishes loading its `srcdoc`. */
function waitForLoad(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      frame.removeEventListener('load', done);
      // One animation frame after `load`, so the first layout has happened and
      // the paginator's `scrollWidth` is not the pre-layout value.
      requestAnimationFrame(() => resolve());
    };
    frame.addEventListener('load', done);
  });
}
