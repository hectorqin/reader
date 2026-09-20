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


import { BOOK_RESOURCE_MARKER } from '../formats/book-resource.ts';

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
 * Scoped to `.txt-body` on purpose. The reader wraps a TXT chapter in that element
 * when it typesets it (`formats/segments.ts`) and nothing else produces it, so an
 * EPUB chapter — which may well contain its own `p` rules and its own idea of an
 * indent — is untouched by any of this.
 *
 * Note what is *not* here: no rule reads an attribute the server wrote. The old
 * sheet branched on `data-indent='none'`, which meant the reader's own indent
 * setting could only take effect on a chapter the server had rendered with the
 * matching attribute — the setting was a property of a response. The indent is
 * now one custom property with one value, written by the settings panel and read
 * here, and "off" is the same property set to zero rather than a second code path
 * that has to be kept in agreement with the first.
 */
const TXT_STYLESHEET = `
.txt-body {
  /* Declared on the wrapper rather than on each paragraph so one property can be
     changed in one place, and so a paragraph that the file's own text already
     indented is not indented twice. */
  text-indent: 0;
}
.txt-body > p {
  margin: 0;
  /* The readable default for Chinese prose: two full-width characters of indent,
     and a gap between paragraphs small enough that the indent is the primary
     signal and large enough that a paragraph break is visible when the reader
     turns the indent off. Both are properties the settings panel can change, and
     the values are in 'em' rather than 'rem' on purpose — the indent is meant to
     be two *characters* wide, and a character's width scales with the reader's
     font size. */
  text-indent: var(--reader-txt-indent, 2em);
  margin-block-end: var(--reader-txt-para-gap, 0.55em);
  /* A paragraph that has been split correctly has no hard wraps left in it, so
     the browser's own line breaking is what the reader sees. Justification is
     deliberately *not* stated here: a Chinese line that is not justified is a
     line with a ragged right edge the reader notices immediately, but a Latin
     line that *is* justified is a line with rivers in it, and the reader's own
     alignment control is the honest place to decide which of the two they are
     looking at. */
  orphans: 2;
  widows: 2;
}
/* A heading the reader promoted out of the body is shown as a heading rather
   than as an indented paragraph — the one piece of structure a TXT has. */
.txt-body > h3,
.txt-body > h4 {
  margin: 1.4em 0 0.6em;
  font-size: 1.05em;
  font-weight: 600;
  text-indent: 0;
  break-after: avoid;
}
/* The last paragraph's gap is trailing space rather than separation, and at the
   end of a chapter it stacks with the column's own bottom padding. */
.txt-body > p:last-child {
  margin-block-end: 0;
}
`;

/*
 * The reader's own sheet for content *inside* a chapter, applied to every format.
 *
 * ## Why this exists at all
 *
 * The promise of this product is to preserve the author's design, so this sheet is
 * the one place where that promise has to give way — and it gives way only where
 * the alternative is a broken page rather than a plainer one:
 *
 *  - **An image wider than the column.** Publisher markup sizes images in the
 *    book's own units (an `img` with a pixel `width` of 1400), and a screenshot-heavy novel or a
 *    comic archive is full of them. Unclamped, the picture is wider than the page
 *    it is paginated into: it runs off both edges (the report is a screenshot of
 *    exactly that), and — worse than ugly — it changes the chapter's own geometry,
 *    so the column count the footer reports is measured against content that is
 *    off the screen.
 *  - **A width/height attribute is a request, not a law.** A max-inline-size with
 *    an `auto` height is what makes "fit the column" win over the author's pixel
 *    width while keeping the aspect ratio; clamping the width alone squashes the
 *    picture, which is the other way this defect is reported.
 *  - **Markup that was never HTML.** A fixed-layout archive read as reflowable (a
 *    photo folder, a comic whose pages the manifest does not label as fixed) hands
 *    this shadow root a body of characters. A `white-space: pre-wrap` is the one
 *    property that makes that body readable rather than a single squashed run —
 *    but it is scoped to `.book-flow[data-raw]`, so it cannot reach an authored
 *    document that must keep the author's own whitespace handling.
 *
 * Everything here is deliberately low priority in the cascade sense: it names only
 * properties a chapter that styles its own images will also name, it is emitted
 * *before* the book's stylesheet (see the constructor), and it declares no
 * `!important` — so an author who sets a width of their own still wins.
 */
const CHAPTER_CONTENT_STYLESHEET = `
.book-flow img,
.book-flow video,
.book-flow canvas {
  /* Stated on the inline axis so it follows the writing mode, and with an absolute
     ceiling as well: a max-width of 100% inside a box that is itself the full width
     of a wide screen is still 1200px, which is wider than any page this product
     draws. */
  max-inline-size: min(100%, var(--reader-image-max, 100%));
  max-width: min(100%, var(--reader-image-max, 100%));
  /* An automatic height rather than 100%: with a pixel width of 1400 and a clamped
     box of 342, auto keeps the author's aspect ratio and a percentage would not. */
  height: auto;
  /* Never taller than the page either, or a portrait plate pushes its own caption
     onto the next page and the two become unreadable together. */
  max-block-size: var(--reader-image-max-block, 100vh);
  object-fit: contain;
  /* A centred picture rather than one flush to the left margin, which is how a book
     presents a plate that is narrower than the column. Display block, so it can be
     centred at all: an inline image sits on a text baseline and comes with the
     descender's worth of leading under it. */
  display: block;
  margin-inline: auto;
  /* A picture cut in half by a column boundary is a picture the reader cannot
     read, and one that is taller than the page cannot be kept whole — so "avoid"
     applies to the ones that fit and is harmlessly ignored by the ones that do
     not. */
  break-inside: avoid;
}
/* An image the book gave no dimensions to. The box is given an intrinsic ratio so
   the chapter does not reflow under the reader when the picture finishes loading:
   without it, the paragraph they are reading is pushed down by the height of an
   image that had not arrived yet, and the reader loses their place. */
.book-flow img:not([width]):not([height]):not([style*='aspect-ratio']) {
  aspect-ratio: var(--reader-image-ratio, auto);
}
.book-flow figure,
.book-flow .pic,
.book-flow p:has(> img:only-child) {
  margin-inline: 0;
  text-align: center;
}
/* Characters, not markup: a body of plain text under a fixed-layout label.
   Scoped to the attribute, so an authored chapter is untouched by it. */
.book-flow[data-raw='true'] {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* The same wrapping for a chapter whose markup contains a single unbroken run: a
   URL, a base64 blob, a line of repeated equals signs. Horizontal overflow is a
   property of the whole screen, and one long token in one paragraph breaks it for
   the entire page. */
.book-flow :is(p, li, td, h1, h2, h3, h4, h5, h6) {
  overflow-wrap: break-word;
}
`;

const FLOW_STYLESHEET = `
/*
 * The box model, re-declared for the shadow tree.
 *
 * The document's own universal box-sizing rule (see styles/reader.css) does **not**
 * reach in here: a shadow root is a separate tree, and a document selector cannot
 * match a shadow tree's elements. So every element inside the book was laid out with
 * the initial content-box, while every element outside it was border-box — and the
 * one place that difference shows is the reading column, which is width 100% *plus*
 * the reader's page margin. On a 390px phone that is a 390px column with 24px of
 * padding on each side: a 438px box inside a 390px scroller, so the column is 48px
 * wider than the page it is paginated into and the next column bleeds into the page
 * margin. The reader sees the first characters of the next page down the right edge
 * of the current one, which is the reported "左右翻页的样式不对" as much as the
 * animation is.
 *
 * Declared on the host as well as on its descendants, because the book's own markup
 * is inside this tree too and has to agree with the app's box model about every box
 * the reader's own CSS sizes.
 */
:host {
  box-sizing: border-box;
}
:host *,
:host *::before,
:host *::after {
  box-sizing: border-box;
}
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
/*
 * Paged: the column *is* the page.
 *
 * The vertical padding goes, and only the vertical: the flow is now a container
 * whose height is the page, so a padding-block would be a band of empty paper
 * above and below every page. The inline padding stays, because that is the reader's
 * page margin and dropping it is how a chapter came to be typeset flush against the
 * edge of the screen — the *scroll* path keeps its margin and the *paged* path did
 * not, so the same book looked deliberate in one mode and unfinished in the other.
 *
 * A column width of 100% rather than 100vw. The two are the same number only while
 * the reading surface happens to span the whole viewport, and it does not: the two
 * floating bars inset it (see --reader-chrome-top in styles/reader.css) and the
 * reader's page margin is a property of the column, not of the screen. A column
 * sized to the *viewport* inside a narrower box is a column wider than the page it
 * is being paginated into — the stride arithmetic then walks positions that are not
 * page boundaries and the last column of every chapter is unreachable. A percentage
 * is the width of the box the column actually sits in, which is what "one page"
 * means.
 *
 * ## The gap is the page margin, and it is load-bearing
 *
 * The page margin is padding-inline on the flow, which means it is *inside* the
 * scrolling box: the first column's text starts M from the left edge, and the next
 * column's text starts column-width + gap further along. With a gap of zero that
 * distance is clientWidth - 2M, so the page the reader is looking at is
 * clientWidth wide while a page *step* is clientWidth - 2M — and the M px at the
 * right edge of every page are the first characters of the next one. That is the
 * bleed the reader photographed down the right edge ("左右翻页的样式不对"), and it is
 * a geometry bug rather than an animation one.
 *
 * Setting the gap to *both* margins makes the two agree: a step is
 * (clientWidth - 2M) + 2M = clientWidth, exactly one screen, and the M px between
 * two columns is the margin that belongs between them anyway — the page margin on
 * the *inside* edge of a two-page spread, which is the shape a paginated book has.
 * So one declaration makes the step equal the page and draws the gutter at the same
 * time, and the reader's own page-margin control moves both together.
 */
:host([data-paginated='true']) .book-flow {
  height: 100%;
  max-inline-size: none;
  padding-block: 0;
  column-gap: calc(var(--reader-page-margin, 1.5rem) * 2);
  columns: 1;
  column-width: 100%;
  column-fill: auto;
  overflow: hidden;
}
:host([data-paginated='true']) .book-flow > * {
  break-inside: auto;
}
/*
 * The page-turn animations.
 *
 * The attribute carries three things — style, direction and *axis* — because the
 * axis is not the animation's to guess. A page turn moves the reader along the axis
 * the page is defined on: paged mode's page is a column, so the move is horizontal;
 * scroll mode's page is a screenful, so the same turn is vertical. ReaderView puts
 * the mode in the attribute (see animatePage) and the selectors below are the whole
 * of the mapping, which keeps the arithmetic out of CSS and the keyframes free of
 * data-mode branching.
 */
:host([data-animating]) .book-flow {
  /* The animation is a *page* move, so it is clipped to the page: without this a
     column that slides in from the right is drawn outside the reading surface for
     the length of the animation, over the page margin and the rail. */
  overflow: clip;
}
:host([data-animating^='slide']) .book-flow {
  animation-duration: 200ms;
  animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
}
:host([data-animating='slide-next-x']) .book-flow { animation-name: slide-next-x; }
:host([data-animating='slide-previous-x']) .book-flow { animation-name: slide-previous-x; }
:host([data-animating='slide-next-y']) .book-flow { animation-name: slide-next-y; }
:host([data-animating='slide-previous-y']) .book-flow { animation-name: slide-previous-y; }
:host([data-animating^='fade']) .book-flow {
  animation-duration: 160ms;
  animation-timing-function: ease-out;
}
:host([data-animating='fade-next-x']) .book-flow,
:host([data-animating='fade-next-y']) .book-flow { animation-name: fade-next; }
:host([data-animating='fade-previous-x']) .book-flow,
:host([data-animating='fade-previous-y']) .book-flow { animation-name: fade-previous; }
/*
 * A page turn moves a page's worth of text, not a few pixels of wobble.
 *
 * The old keyframes translated by 8px and dropped the opacity to 0.4, and that is
 * what the report — "左右翻页的样式不对" — is looking at. Eight pixels on a 390px
 * screen is 2% of a page: it reads as the text twitching rather than as a page
 * being turned, and the 0.4 opacity makes the *whole* page flash grey on every
 * turn, which is worse in a night theme than no animation at all.
 *
 * The correction is a real slide of one page's extent, expressed as a percentage of
 * the flow rather than in pixels: in paged mode the flow *is* one column wide (see
 * the paged rule above), so a 100% translate is exactly one page and the incoming
 * page starts one page away. The animation is a transform on the already-
 * repositioned flow, which is why it composites and why it cannot disturb the
 * column layout the paginator measured — the scroll offset is set *first*, and the
 * animation only draws the result. The -y pair is the same statement about a
 * screenful in scroll mode.
 *
 * No opacity on the slide. A fade belongs to the fade-* pair, which is the setting's
 * own alternative for a reader who finds motion distracting; combining the two means
 * neither style is available on its own.
 */
@keyframes slide-next-x {
  from { transform: translateX(100%); }
  to { transform: none; }
}
@keyframes slide-previous-x {
  from { transform: translateX(-100%); }
  to { transform: none; }
}
@keyframes slide-next-y {
  from { transform: translateY(100%); }
  to { transform: none; }
}
@keyframes slide-previous-y {
  from { transform: translateY(-100%); }
  to { transform: none; }
}
/*
 * The fade stays subtle on purpose: it is the *no-motion* alternative, and a deep
 * fade on a settings choice called "淡入" is a second, louder animation. The pair
 * is asymmetric with the slide for that reason, not by oversight.
 */
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
  /**
   * The reader's rules for content *inside* a chapter, present for every format.
   *
   * A fourth sheet rather than more rules in `layoutEl`, because the two make
   * different claims. `layoutEl` is the *viewer* — the flow, the column, the
   * measure — and none of it is about the book's own bytes. This one is about the
   * bytes: how an image is clamped, how an unlabelled body of characters is
   * wrapped. Separating them means the sheet that has to yield to the author can be
   * placed *below* the author's own stylesheet on its own, without moving the
   * viewer's rules down with it.
   */
  private readonly chapterEl: HTMLStyleElement;
  private readonly contentEl: HTMLDivElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.layoutEl = document.createElement('style');
    this.txtEl = document.createElement('style');
    this.chapterEl = document.createElement('style');
    this.styleEl = document.createElement('style');
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'book-flow';
    // The sheets go in cascade order, weakest first: the reader's layout rules, then
    // the plain-text typesheet, then the reader's rules for content inside a
    // chapter, then the book's own styles — which must be able to override all
    // three, since preserving the author's design is the point of the product. The
    // order the *content* sheet sits in is load-bearing rather than tidy: an author
    // who writes `img { width: 60% }` has to win over the clamp, and the same
    // specificity means the later sheet wins.
    this.layoutEl.textContent = FLOW_STYLESHEET;
    this.chapterEl.textContent = CHAPTER_CONTENT_STYLESHEET;
    this.shadow.append(this.layoutEl, this.txtEl, this.chapterEl, this.styleEl, this.contentEl);
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

  /**
   * Marks the chapter's body as characters that were *not* typeset as a novel.
   *
   * The distinction is the one `plainText` does not make. A TXT chapter is
   * characters, and the reader typesets them into paragraphs — after which the body
   * is markup, and the browser's own whitespace collapsing is exactly right for it.
   * A body of characters that arrived under a *document* label (a fixed-layout
   * archive read as reflowable, a `text/plain` page the manifest called a chapter)
   * keeps its characters, and its line breaks are then the only structure it has:
   * collapsed, a log or an ASCII figure renders as one squashed run and the reader
   * is looking at a paragraph that was never in the file.
   *
   * Both "what is it" and "was it typeset" have to be asked, because the answers
   * combine: characters-not-typeset is the case this guards and
   * characters-typeset is the ordinary TXT.
   */
  setRawText(raw: boolean): void {
    this.contentEl.toggleAttribute('data-raw', raw);
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
export interface SanitiseOptions {
  /**
   * Makes an asset URL self-authenticating, or returns null to leave it alone.
   *
   * Called for every address the chapter wants the *browser* to fetch — an
   * `<img src>`, a `<link href>`, a `srcset` candidate — which is the set of
   * requests that cannot carry an `Authorization` header. The reader supplies a
   * function that appends the session token, and the chapter's pictures load; it
   * is absent in every context where there is no session (a test, a local file),
   * and then the URLs are passed through unchanged.
   *
   * This has to happen *here*, in the pass that walks the live DOM, rather than on
   * the raw markup: the server writes absolute URLs for the resources it rewrote,
   * and a document also contains absolute URLs the *book* wrote. Only the DOM walk
   * sees both, and only it can be the one place that decides "this is one of ours,
   * so it may be signed".
   */
  signAssetUrl?(url: string): string | null;
}

export function sanitiseInjectedContent(root: ParentNode, options: SanitiseOptions = {}): void {
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
      }
    }
  }

  // Every address an injected element can *fetch from* is rewritten to a resolved
  // blob URL, or dropped.
  //
  // Two things have to be true at once here, and the previous version had neither.
  //
  // **A book's own resources must be drawn.** An EPUB's chapter arrives with its
  // relative references already rewritten to *absolute* URLs, because the document
  // was fetched from the asset endpoint and `images/pic.png` resolves to nothing
  // from there. The old check kept an absolute URL only when it started with the
  // page's own `location.origin` — which is the API origin, not the page's, so
  // every image in every illustrated book lost its `src` and rendered as the
  // browser's broken-image placeholder. A check that has to guess "is this ours"
  // from a hostname, a port, a proxy header and a base path is wrong the first time
  // any of the four differs, and it is wrong *silently*: a removed attribute, not
  // an error. So the server marks the URLs it rewrote (`BOOK_RESOURCE_MARKER`) and
  // the test is a marker, not an origin.
  //
  // **Nothing else may be fetched.** A book is a file from an unknown source; a
  // remote URL in it would leak a reading session, or phone home on every page
  // turn. Those are dropped rather than rewritten, which is the security property
  // this function exists for — and it is now *stronger* than before, because what
  // is allowed is a set of three schemes instead of "anything on the origin the
  // app happens to be served from" (which included the API's other endpoints).
  //
  // The rewrite resolves through the element's own base, so a relative URL — from
  // a book loaded locally, which never went through the server's rewriter — is
  // resolved against the document rather than dropped. An absolute URL to another
  // host resolves to that host and is therefore dropped, which is the point.
  for (const element of root.querySelectorAll('[src], [poster], [srcset], [href]')) {
    for (const name of ['src', 'poster', 'href']) {
      const value = element.getAttribute(name);
      if (value === null) continue;
      const resolved = resolveBookResource(value);
      if (resolved === null) element.removeAttribute(name);
      else {
        const signed = sign(resolved, options);
        if (signed !== value) element.setAttribute(name, signed);
      }
    }
    const srcset = element.getAttribute('srcset');
    if (srcset !== null) {
      const rewritten = resolveSrcset(srcset, options);
      if (rewritten === null) element.removeAttribute('srcset');
      else if (rewritten !== srcset) element.setAttribute('srcset', rewritten);
    }
  }

  // `url(...)` inside the chapter's own CSS.
  //
  // A publisher ships a background image, a list bullet or a `@font-face` as a CSS
  // URL, and the browser fetches every one of them itself — the same constraint as
  // an `<img src>`, and refused in exactly the same way when unsigned. The element's
  // `style` attribute and its `<style>` blocks are the two places CSS text can live
  // in an injected chapter; the book's own `link`ed stylesheets arrive as *text* the
  // reader injects (see `ReaderView`), and are signed by the same call from there.
  if (options.signAssetUrl) {
    const sign = options.signAssetUrl;
    for (const element of root.querySelectorAll('[style]')) {
      const value = element.getAttribute('style');
      if (!value) continue;
      const rewritten = signCssUrls(value, sign);
      if (rewritten !== value) element.setAttribute('style', rewritten);
    }
    for (const style of root.querySelectorAll('style')) {
      const value = style.textContent;
      if (!value) continue;
      const rewritten = signCssUrls(value, sign);
      if (rewritten !== value) style.textContent = rewritten;
    }
  }
}

/**
 * Signs every `url(...)` in a CSS string that survived the allow-list.
 *
 * Per URL rather than over the whole string: a `url()` token is quoted or not, may
 * carry a fragment, and is the only place in CSS that names an address — so the one
 * function that knows what a URL is decides, and the decision is the signer's.
 */
function signCssUrls(css: string, sign: (url: string) => string | null): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full: string, quote: string, value: string) => {
    const resolved = resolveBookResource(value);
    if (resolved === null) return full;
    const signed = sign(resolved) ?? resolved;
    return `url(${quote}${signed}${quote})`;
  });
}

/**
 * Whether a URL is one of the book's own resources rather than a remote address.
 *
 * Three mechanisms, and each is a *mechanism* rather than a guess:
 *
 *  - `reader-res:` — the client's own internal scheme, which never touches the
 *    network (`formats/epub.ts`'s loader rewrites local references to it).
 *  - `blob:` / `data:` — bytes already in memory. A `blob:` URL is one this
 *    client minted from the archive, so it cannot reach a third party.
 *  - a **marked, same-origin** absolute URL — one the *server* rewrote
 *    (`BOOK_RESOURCE_MARKER`), which is the case the EPUB illustrations need.
 *
 * The marker alone is not enough, and that is the point of asking it together
 * with the origin: the marker is a string a *book* can also write, so on its own
 * it would be a book's own permission slip to reach a third party — which is the
 * property this function exists to deny. The pair is what a book cannot forge:
 * it can put the marker in a URL, and it cannot make that URL be served from the
 * reader's own origin.
 *
 * Deliberately *not* included: "anything on our origin". That test passed the
 * API's other endpoints and the app's own scripts, and it is the test that failed
 * the case it was written for.
 */
function isBookResource(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('reader-res:') || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return true;
  if (!trimmed.includes(`${BOOK_RESOURCE_MARKER}=`)) return false;
  // The marker is a *query parameter*, so it is looked for by name rather than by
  // position: `?a=1&__reader-book-resource__=1` and `?__reader-book-resource__=1`
  // are both the server's own rewrite.
  return isSameOrigin(trimmed);
}

/** Whether a URL is served by the origin this document came from. */
function isSameOrigin(value: string): boolean {
  try {
    const url = new URL(value, document.baseURI);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Resolves a URL found in a chapter to something the browser may fetch, or null.
 *
 * `null` means "drop it". A relative URL is resolved against the document, which
 * is what makes a locally-loaded book (whose references were never rewritten by
 * the server) work: its `images/pic.png` resolves to a same-origin URL, which is
 * the book's own file. An absolute URL to another host resolves to that host and
 * is not a book resource, so it is dropped.
 */
function resolveBookResource(value: string): string | null {
  if (isBookResource(value)) return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, document.baseURI);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // A relative reference is the book's own file, resolved against the document
    // that is displaying it — which is the same origin by construction. Stated as
    // the rule rather than as a special case so the two paths cannot disagree.
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The same decision, per candidate of a `srcset`. Drops the ones that are not ours.
 *
 * Each candidate is signed individually rather than the value as a whole: the
 * token goes in a *candidate's* own query, and a `srcset` is a comma-separated list
 * whose entries each carry their own URL and descriptor. Signing the joined string
 * would put one token at the end of the last candidate.
 */
function resolveSrcset(value: string, options: SanitiseOptions): string | null {
  const out: string[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [url, ...descriptor] = trimmed.split(/\s+/);
    const resolved = url === undefined ? null : resolveBookResource(url);
    if (resolved === null) continue;
    out.push([sign(resolved, options), ...descriptor].join(' '));
  }
  return out.length > 0 ? out.join(', ') : null;
}

/**
 * Lets the reader sign an address, for the requests it cannot sign itself.
 *
 * Applied only to addresses that survived `resolveBookResource`, which is the set
 * the reader has already agreed may be fetched. That ordering matters: the token is
 * a credential, and handing it to an arbitrary URL out of a book would be a way to
 * leak a reading session to a third party — the exact thing the allow-list above
 * exists to prevent.
 */
function sign(url: string, options: SanitiseOptions): string {
  return options.signAssetUrl?.(url) ?? url;
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
