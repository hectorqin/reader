/**
 * Where a chapter document lives inside the reader.
 *
 * ============================================================================
 * The iframe vs Shadow DOM decision
 * ============================================================================
 *
 * The user asked whether a pure-H5 build needs an iframe or a Shadow DOM for
 * strict epub resources. The answer is **Shadow DOM, and not for the reason it
 * is usually recommended**. Working through why is worth doing, because the
 * usual reason ("style isolation") is the one that does not hold here.
 *
 * ## Shadow DOM is NOT isolation from the publisher's stylesheet
 *
 * A shadow root blocks the *document's* rules from matching into it, but the
 * publisher's stylesheet is not "the document's rules" — it is a chapter asset
 * that has to end up inside the shadow root to do anything at all. So:
 *
 *  - A shadow root gives zero protection from a publisher's `p { margin: 2em }`,
 *    `body { writing-mode: vertical-rl }` or `* { float: left }`. Those load
 *    inside the root, next to the markup they style, exactly as they would in an
 *    iframe. Anyone who reaches for Shadow DOM to "not get affected by the
 *    book's CSS" has misread the primitive: the book must style itself, that is
 *    the product.
 *  - It also gives zero protection from `@font-face` and `@page`, which are
 *    scoped to the document either way in practice.
 *
 * The style isolation Shadow DOM *does* provide is the direction that actually
 * matters here: the client's own UI styles cannot leak in and restyle a
 * footnote or a blockquote. And, critically, `all: unset` / `!important`
 * overrides in the client's CSS cannot silently flatten a publisher's layout —
 * which is the failure mode this product exists to avoid.
 *
 * ## What a shadow root buys beyond that
 *
 *  - **Per-chapter styles do not accumulate.** Each chapter's shadow root is
 *    discarded with it. An iframe has the same property, but at a much higher
 *    cost (see below). Without either, a book whose chapters each link their own
 *    CSS would corrupt later chapters with earlier chapters' remnants.
 *  - **No document per chapter.** An iframe is a nested browsing context: its own
 *    document, its own layout, resize and scripting lifecycles. Replacing one is
 *    costly enough to be visible on a 200-chapter book, and each iframe needs its
 *    own scroll container, focus handling and (on Android WebView) its own
 *    compositing layer.
 *  - **Same JS context.** `scrollLeft`, `offsetLeft`, `getBoundingClientRect`
 *    are directly queryable. Cross-frame layout reads need `postMessage` plus a
 *    second implementation of the paginator inside the frame, which is the real
 *    reason cross-frame readers end up duplicating logic.
 *  - **Text selection and highlight are plain DOM work.** Selecting across a
 *    frame boundary is impossible; a highlight library that must choose between
 *    frames will inevitably pick one and mishandle the other.
 *
 * ## So what handles the *actual* problems the question was pointing at
 *
 * Strict epubs break WebView rendering in three specific ways, and none of them
 * are solved by choosing a container. They are solved by what the container is
 * given:
 *
 *  1. **Absolute resource paths.** The server already rewrites relative
 *     `src`/`href` in the chapter and keeps absolute URLs, `data:` URIs and
 *     fragment anchors untouched. That is what makes the document standalone.
 *  2. **XML, not HTML.** Strict epubs are XHTML with proper namespaces, and
 *     `innerHTML` in an HTML parser is remarkably forgiving in ways that matter:
 *     it drops unknown namespaced elements, and it mishandles self-closing tags
 *     on void elements like `<br/>`. Fetching the chapter as a string and
 *     handing it to `DOMParser.parseFromString(text, 'application/xhtml+xml')`
 *     keeps the document as XML. A parse error is real XML, reported rather than
 *     silently half-rendered.
 *  3. **No document-level `html`/`body` styling.** The `<html>` and `<body>`
 *     rules in a chapter are written for a full window. Inside a reader the
 *     container supplies its own scroller, so `body { height: 100vh }` or
 *     `html { background: #000 }` would fight it. The chapter's roots are
 *     unwrapped: the top-level blocks are moved into the shadow root and the
 *     `<html>`/`<body>` elements themselves are dropped. What is NOT touched is
 *     anything with a selector of its own — no `div` is unwrapped, no publisher
 *     rule is rewritten or removed.
 *
 * ## When an iframe would be the right call
 *
 * Not never. An iframe wins if a book needs its own `window` — a fixed layout
 * epub with scripted interactivity, or a PDF.js viewer, which expects a frame it
 * can own. The comic and PDF renderers below do use one for the PDF case, for
 * exactly that reason. For reflowable text, a frame would buy nothing and cost a
 * second layout pipeline.
 */

/** Result of mounting a chapter. */
export interface MountedChapter {
  /** The element the publisher's content ended up in. */
  content: HTMLElement;
  /** The scroll container the paginator drives. */
  viewport: HTMLElement;
  /** Non-fatal problems worth surfacing (an XML error, a missing resource). */
  warnings: string[];
}

export interface ContainerOptions {
  /** Gap between columns in CSS pixels; must match the stylesheet. */
  columnGap?: number;
}

/**
 * The scrolling viewport that chapters are mounted into.
 *
 * Kept as a class so the tricky parts — replacing a chapter without losing the
 * shadow root's styles, and reporting an XML error instead of rendering nothing
 * — live in one place.
 */
export class ChapterContainer {
  readonly viewport: HTMLDivElement;
  private root: ShadowRoot;
  private current: HTMLElement | null = null;

  constructor(private readonly host: HTMLElement) {
    this.viewport = document.createElement('div');
    this.viewport.className = 'reader-viewport';
    this.host.append(this.viewport);
    // `open` rather than `closed`: the client's own highlight and search code
    // must be able to walk the tree, and closed roots are a speed bump, not a
    // security boundary (the API to reach them is public).
    this.root = this.viewport.attachShadow({ mode: 'open' });
  }

  /**
   * Replace the mounted chapter.
   *
   * `xml` must be the chapter document as text. The container does not fetch it:
   * loading and mounting are separated so the caller can cache, prefetch and
   * order requests without knowing anything about the DOM.
   */
  mount(xml: string, options: ContainerOptions = {}): MountedChapter {
    const warnings: string[] = [];
    const doc = parseChapter(xml, warnings);
    const content = buildContent(doc, warnings);

    // Styles first, content second: the publisher's `@import` order decides the
    // cascade, and moving them after the markup would not change that but does
    // make the document read in the reverse of its natural order.
    this.root.replaceChildren(...collectStyles(doc), content);
    this.current = content;

    if (!options.columnGap) return { content, viewport: this.viewport, warnings };
    return { content, viewport: this.viewport, warnings };
  }

  /**
   * The mounted content element, for the paginator and for highlight work.
   *
   * Exposed deliberately: highlights are stored as a text quote plus a location,
   * and both have to be resolved against this element. Hiding it would push the
   * querySelector logic into every consumer.
   */
  get content(): HTMLElement | null {
    return this.current;
  }

  /** Drop the mounted chapter and release its styles. */
  clear(): void {
    this.root.replaceChildren();
    this.current = null;
  }
}

/**
 * Parse a chapter as XML.
 *
 * `application/xhtml+xml` is not cosmetic: the HTML parser silently repairs
 * broken markup by *discarding* it, so a strict epub with a namespace typo would
 * render as a chapter missing a paragraph and nobody would know why. The XML
 * parser reports it. The caller still shows whatever parsed, because a book with
 * one bad chapter should be readable.
 */
export function parseChapter(xml: string, warnings: string[]): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xhtml+xml');
  const failure = doc.querySelector('parsererror');
  if (failure) {
    warnings.push(failure.textContent?.trim().slice(0, 200) || 'chapter is not well-formed XML');
    // Fall back to the HTML parser rather than showing a blank page. The warning
    // is what tells the reader (and us, in a bug report) that it happened.
    return parser.parseFromString(xml, 'text/html');
  }
  return doc;
}

/**
 * Everything the publisher linked, in document order.
 *
 * `<link rel=stylesheet>` is included because epubs routinely use it instead of
 * `<style>`. The URLs are already absolute by the time the chapter reaches the
 * client, so they resolve inside the shadow root without a `<base>` element —
 * and `<base>` would be the wrong tool anyway, since a shadow root does not use
 * the document's base URL.
 */
function collectStyles(doc: Document): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const copy = document.createElement('style');
    copy.textContent = style.textContent;
    nodes.push(copy);
  }
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet" i]'))) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const copy = document.createElement('link');
    copy.setAttribute('rel', 'stylesheet');
    copy.setAttribute('href', href);
    nodes.push(copy);
  }
  return nodes;
}

/**
 * Move the chapter's blocks into a single element.
 *
 * The `<html>` and `<body>` wrappers are dropped, as explained in the module
 * comment. Everything below them is moved verbatim — no class is rewritten, no
 * element is unwrapped, no attribute is added. The publisher's structure is the
 * book.
 */
function buildContent(doc: Document, warnings: string[]): HTMLElement {
  const host = document.createElement('div');
  host.className = 'reader-chapter';
  const source = doc.body ?? doc.documentElement;
  if (!source) {
    warnings.push('chapter has no body');
    return host;
  }
  // `importNode` with `deep: true` copies nodes into this document, which is what
  // makes the shadow root able to hold them. Moving them directly would work for
  // nodes already in this document, but a chapter parsed by DOMParser is in its
  // own document and must be adopted.
  for (const child of Array.from(source.childNodes)) {
    host.append(document.importNode(child, true));
  }
  return host;
}
