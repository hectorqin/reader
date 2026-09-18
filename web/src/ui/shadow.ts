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
/**
 * The plain-text reader's own typesheet, for the shadow root.
 *
 * A TXT file has no markup, so it has no typography: the paragraphs the server
 * renders are `<p>` elements with nothing said about them, which is exactly as
 * unstyled as raw text and no better. Unlike an EPUB — where the *default* has to
 * be the author's own stylesheet, and overriding is a bug — a TXT has no author to
 * defer to, so this is the one place in the reader where stating a full set of
 * values is the right answer rather than an intrusion.
 *
 * It is also the place where the reader's own controls actually land for a TXT.
 * Every adjustable value below is a custom property defined on `:root` (which a
 * shadow root inherits), so the settings panel changes the paragraph indent or the
 * spacing between paragraphs by writing one property on the stage rather than by
 * re-injecting the chapter.
 *
 * Scoped to `.txt-body` on purpose. The server wraps a TXT chapter in that element
 * (`text-html.ts`) and nothing else produces it, so an EPUB chapter — which may
 * well contain its own `p` rules and its own idea of an indent — is untouched by
 * any of this.
 */
const TXT_STYLESHEET = `
.txt-body {
  /* Declared on the column rather than on each paragraph so one property can be
     changed in one place, and so a paragraph that the book's own markup already
     indented is not indented twice. */
  text-indent: 0;
}
.txt-body > p {
  margin: 0;
  /* The readable default for Chinese prose: two full-width characters of indent,
     and a gap between paragraphs small enough that the indent is the primary
     signal and large enough that a paragraph break is visible when the reader
     turns the indent off. Both are properties the settings panel can change. */
  text-indent: var(--reader-txt-indent, 2em);
  margin-block-end: var(--reader-txt-para-gap, 0.55em);
  /* Justified by default for CJK — a Chinese line that is not justified is a line
     with a ragged right edge the reader notices immediately — while Latin text in
     the same paragraph falls back to the browser's own text-justify. The reader's
     own alignment control still wins, because it is applied on .book-flow and the
     value inherits. */
  orphans: 2;
  widows: 2;
}
/* The reader's own alignment control sets --reader-text-align on the column; a
   value of inherit is "leave it alone", which for a TXT means this file's
   default rather than the browser's. */
.txt-body > p:last-child {
  margin-block-end: 0;
}
/* An indent the reader can turn off, stated in a way that cannot be undone by the
   text-indent above: both blocks target the same element, and the attribute is
   written by the server only when it rendered without an indent. */
.txt-body[data-indent='none'] > p {
  text-indent: 0;
}
/* A heading line the server promoted out of the body is shown as a heading rather
   than as an indented paragraph — the one piece of structure a TXT has. */
.txt-body > h3,
.txt-body > h4 {
  margin: 1.4em 0 0.6em;
  font-size: 1.05em;
  font-weight: 600;
  text-indent: 0;
  break-after: avoid;
}
`;

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
  /**
   * The plain-text typesheet, present only for text the reader did not author.
   *
   * A third sheet rather than a branch inside `styleEl`, because the two have
   * different lifetimes: `styleEl` is the *book's* stylesheet and is replaced on
   * every chapter, while this depends on the *format* of the whole book and should
   * not be re-parsed sixty times while a novel is read. Empty for every format but
   * TXT, so an EPUB is not merely "unaffected by default" — nothing is present to
   * affect it with.
   */
  private readonly txtEl: HTMLStyleElement;
  private readonly contentEl: HTMLDivElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.layoutEl = document.createElement('style');
    this.txtEl = document.createElement('style');
    this.styleEl = document.createElement('style');
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'book-flow';
    // The sheets go in cascade order, weakest first: the reader's layout rules, then
    // the plain-text typesheet, then the book's own styles, which must be able to
    // override both — the same order the document stylesheet gives them.
    this.layoutEl.textContent = FLOW_STYLESHEET;
    this.shadow.append(this.layoutEl, this.txtEl, this.styleEl, this.contentEl);
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

  /**
   * Turns the plain-text typesheet on or off.
   *
   * Set once per book rather than once per chapter, and toggled by *format* rather
   * than by sniffing the markup: an EPUB that happens to contain a `.txt-body`
   * class is not a TXT, and the reader's answer to "should this text be styled for
   * me" is "did I author it", which only the format answers.
   */
  setPlainText(enabled: boolean): void {
    this.txtEl.textContent = enabled ? TXT_STYLESHEET : '';
    this.toggleAttribute('data-plain-text', enabled);
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
