/**
 * Shadow-root host for book content.
 *
 * The book's own markup and stylesheets have to live somewhere. Three options,
 * and only one of them is defensible:
 *
 *  - into the app document: a chapter's `p { color: red }` would restyle the
 *    shelf, and `.topbar` collisions would be a matter of luck;
 *  - in an iframe: correct isolation, but every chapter change tears down a
 *    document, which loses scroll position, breaks in-page animation and costs
 *    several times the memory on Android;
 *  - in a shadow root: full style isolation, no document boundary, and the app
 *    can still reach in for pagination and selection.
 *
 * The third is what this is. Note what is *not* done: no reset stylesheet is
 * injected into the shadow root. A reset would override the author's margins and
 * font stacks, which is the exact failure mode this product exists to avoid.
 */



/**
 * The reading column's own stylesheet, for the shadow root.
 *
 * A selector in the document's stylesheet cannot reach into a shadow root, and
 * that is the whole reason this constant exists. `.book-flow` is the content
 * column — the element that carries the measure, the margins, the font scale and
 * the pagination columns — and it lives in *here*, so every one of those rules has
 * to be declared *here*. They used to be declared in `styles/reader.css`, matched
 * nothing, and the column therefore rendered at the browser's default: full
 * width, no padding, a 42rem measure it never applied, and — in paged mode — no
 * columns at all. It did not look like a missing stylesheet, because the parts
 * that *did* work (the book's own CSS, which is injected here) still applied; it
 * looked like the reader simply had no margin setting.
 *
 * The same reason dictates `:host(...)` rather than `.book-host[...]` in the rules
 * below. `data-paginated` and `data-animating` are set on the *host element*, and a
 * shadow root's own stylesheet cannot match its host with a class selector — the
 * host is outside the shadow tree and the class is on it, not in it. `:host()` is
 * the only selector that crosses that line, and without it paged mode silently did
 * nothing: the columns were never created, so every "page" was the whole chapter
 * and a page turn had nowhere to go.
 *
 * What must not be duplicated between the two copies is the *values* — every one
 * of them is a custom property, and the properties themselves are defined on
 * `:root`, which a shadow root inherits.
 */
const FLOW_STYLESHEET = `
.book-flow {
  position: relative;
  max-inline-size: var(--reader-measure, 42rem);
  margin-inline: auto;
  padding-block: var(--reader-page-padding-block, 1.25rem);
  padding-inline: var(--reader-page-margin, 1.5rem);
  font-size: calc(1em * var(--reader-font-scale, 1));
  line-height: var(--reader-line-height, inherit);
  font-family: var(--reader-font-family, inherit);
  text-align: var(--reader-text-align, inherit);
  isolation: isolate;
}
:host([data-paginated='true']) .book-flow {
  height: 100%;
  max-inline-size: none;
  padding: 0;
  column-gap: 0;
  columns: 1;
  column-width: 100vw;
  column-fill: auto;
  overflow: hidden;
}
:host([data-paginated='true']) .book-flow > * {
  break-inside: auto;
}
:host([data-animating='slide-next']) .book-flow {
  animation: slide-next 180ms ease-out;
}
:host([data-animating='slide-previous']) .book-flow {
  animation: slide-previous 180ms ease-out;
}
:host([data-animating='fade-next']) .book-flow {
  animation: fade-next 160ms ease-out;
}
:host([data-animating='fade-previous']) .book-flow {
  animation: fade-previous 160ms ease-out;
}
@keyframes slide-next {
  from { transform: translateX(8px); opacity: 0.4; }
  to { transform: none; opacity: 1; }
}
@keyframes slide-previous {
  from { transform: translateX(-8px); opacity: 0.4; }
  to { transform: none; opacity: 1; }
}
@keyframes fade-next {
  from { opacity: 0.35; }
  to { opacity: 1; }
}
@keyframes fade-previous {
  from { opacity: 0.35; }
  to { opacity: 1; }
}
.reader-speech-highlight {
  position: absolute;
  pointer-events: none;
  z-index: -1;
  border-radius: 3px;
  background: color-mix(in srgb, var(--reader-accent, #7a5c3e) 34%, transparent);
  transition: top 120ms linear, left 120ms linear, width 120ms linear, height 120ms linear;
}
.fixed-page {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
}
.fixed-page[data-fit='contain'] img,
.fixed-page[data-fit='contain'] .pdf-frame {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.fixed-page[data-fit='width'] img,
.fixed-page[data-fit='width'] .pdf-frame {
  width: 100%;
}
.fixed-page img {
  display: block;
}
.fixed-page .pdf-frame {
  border: 0;
  width: 100%;
  height: 100%;
}
@media (prefers-reduced-motion: reduce) {
  :host([data-animating]) .book-flow { animation: none; }
  .reader-speech-highlight { transition: none; }
}
`;

export class BookShadowHost extends HTMLElement {
  readonly shadow: ShadowRoot;
  private readonly styleEl: HTMLStyleElement;
  /** The reader's own layout rules, injected once and never replaced. */
  private readonly layoutEl: HTMLStyleElement;
  private readonly contentEl: HTMLDivElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.layoutEl = document.createElement('style');
    this.styleEl = document.createElement('style');
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'book-flow';
    // The layout sheet goes first so the book's own styles, which follow in
    // `styleEl`, can still override it — the same cascade order the document
    // stylesheet gives them.
    this.layoutEl.textContent = FLOW_STYLESHEET;
    this.shadow.append(this.layoutEl, this.styleEl, this.contentEl);
  }

  /**
   * Replaces the reading surface and the *book's* stylesheets.
   *
   * Only the book's own styles live in `styleEl`, which is replaced on every
   * chapter: the reader's layout rules are in `layoutEl` and are never touched,
   * because a chapter change is not a reason for the column to lose its measure
   * for one frame.
   */
  setContent(html: string, styles: string[]): void {
    this.styleEl.textContent = styles.join('\n');
    this.contentEl.innerHTML = html;
  }

  /** The element pagination and scroll measurement should look at. */
  get flow(): HTMLDivElement {
    return this.contentEl;
  }

  clear(): void {
    this.contentEl.innerHTML = '';
    this.styleEl.textContent = '';
  }
}

/**
 * Neutralises the parts of an injected document that would break the reader.
 *
 * Applied after injection, on the live DOM, so it catches constructs a
 * string-level rewrite cannot — notably anything the HTML parser normalises.
 *
 * Removed: `script` (a book must not run code), and navigation-away constructs
 * (`<base>`, meta refresh, `target` on links) which would otherwise turn a tap
 * on a footnote into an exit from the reader.
 */
export function sanitiseInjectedContent(root: ParentNode): void {
  for (const element of root.querySelectorAll('script, base, meta[http-equiv="refresh" i]')) {
    element.remove();
  }

  for (const element of root.querySelectorAll('a[target], a[download]')) {
    element.removeAttribute('target');
    element.removeAttribute('download');
  }

  // Inline event handlers survive an innerHTML round trip, so they must be
  // stripped explicitly rather than trusted to the parser.
  for (const element of root.querySelectorAll('*')) {
    const attributes = element.getAttributeNames();
    for (const name of attributes) {
      if (name.toLowerCase().startsWith('on')) {
        element.removeAttribute(name);
      } else if (name.toLowerCase() === 'href') {
        const value = element.getAttribute(name) ?? '';
        if (/^\s*javascript:/i.test(value)) {
          element.removeAttribute(name);
        }
      } else if (name.toLowerCase() === 'src') {
        const value = element.getAttribute(name) ?? '';
        // Only the internal scheme and blobs are allowed. An absolute URL would
        // leak a reading session to a third party; the book has no reason to
        // need one.
        if (!value.startsWith('reader-res:') && !value.startsWith('blob:') && !value.startsWith('data:')) {
          element.removeAttribute(name);
        }
      }
    }
  }
}

/** Keeps only the body of a full XHTML document, dropping `html`/`head` wrappers. */
export function extractBody(html: string): string {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return bodyMatch?.[1] ?? html;
}

/** Collects `<style>` blocks and inline `<link>` stylesheets for the shadow root. */
export function extractInlineStyles(html: string): string[] {
  const styles: string[] = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) styles.push(match[1]);
  }
  return styles;
}

if (typeof customElements !== 'undefined' && !customElements.get('book-content')) {
  customElements.define('book-content', BookShadowHost);
}

export function createBookHost(): BookShadowHost {
  return document.createElement('book-content') as BookShadowHost;
}
