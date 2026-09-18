/**
 * Format-neutral book model.
 *
 * The server hands the client an opaque file body (`GET /books/:id/content`)
 * and a format label. Everything past that point — unpacking, spine order,
 * resource resolution, pagination units — is the renderer's job, because those
 * are precisely the decisions the product wants to own (§5: 不自研渲染内核,
 * but also 不套 Readium).
 *
 * The one shape every format must reduce to is `BookDoc`, a flat list of
 * sections. That is what keeps a comic, a TXT novel and a reflowable EPUB on
 * the same navigation and progress code path.
 */

export type BookFormat = 'epub' | 'pdf' | 'txt' | 'cbz' | 'comic-dir' | 'image' | 'unknown';

export interface Resource {
  /** Path as referenced from a section's markup, already resolved. */
  path: string;
  mediaType: string;
  bytes(): Promise<Uint8Array>;
}

export interface Section {
  /** Stable within a book: used as the progress locator prefix. */
  id: string;
  /** Human label for the table of contents. */
  label: string;
  /** HTML to inject, for reflowable formats. */
  html?: string;
  /** Binary payload, for fixed-layout formats (comic page, PDF page raster). */
  image?: { mediaType: string; bytes: Uint8Array };
  /** Blob URL or data URL for the image, resolved lazily by the renderer. */
  imageUrl?: string;
  /** Depth in the navigation tree, 0 for top level. */
  depth: number;
  /**
   * How this section should be drawn, when the host can choose.
   *
   * Omitted means "let the host decide from the document as a whole": the value
   * is set per section only where sections within one book can differ, which
   * today means nowhere — the book-level default below covers it. It is per
   * section rather than per book because mixed-layout EPUBs (a fixed page of
   * plates inside a reflowable novel) are a real thing this model has to be able
   * to express later without changing the contract.
   */
  render?: RenderMode;
  /**
   * The section's body is plain characters to be typeset, not authored markup.
   *
   * Carried per section because the *manifest* is where the declaration lives (a
   * content item's `format: 'html'`), and because inferring it from the body is a
   * guess that fails in exactly the case this exists for: the server used to wrap a
   * TXT chapter in `<div class="txt-body">`, and now it sends bare characters, so a
   * marker-sniffing check answers "not plain text" for a chapter that is nothing
   * *but* plain text — and the reader then draws a novel with no paragraphs, no
   * indent and no stylesheet applied, which is a defect that looks like a typography
   * preference rather than a bug.
   */
  plainText?: boolean;
  /**
   * Path this section's bytes can be fetched from, when the section is one
   * addressable file. This is what lets a native host fetch a page itself
   * instead of being handed a buffer by the web layer.
   */
  path?: string;
}

export interface TocEntry {
  id: string;
  label: string;
  depth: number;
}

export type Layout = 'reflowable' | 'fixed';

/**
 * What a host is being asked to render for one section.
 *
 * This exists for exactly one host: the Android shell. The product decision is
 * that a WebView renders EPUB (faithful reflow is the differentiator, and it has
 * to be one implementation), while fixed-layout pages — comic images, PDF — are
 * better served by the platform's own decoders. Handing a 4K scan to a WebView
 * means a full browser layout pass and a bitmap in the renderer process for what
 * is, in the end, "show this image"; the native path skips both.
 *
 * Declared here rather than in the bridge so that both hosts agree on the shape,
 * and so a browser host can ignore it entirely.
 *
 *  - `reflowable` — a chapter of markup; only a WebView can lay it out.
 *  - `image` — a single page image. Native where available.
 *  - `document` — a whole document the platform can open itself (PDF).
 */
export type RenderMode = 'reflowable' | 'image' | 'document';

export interface BookDoc {
  format: BookFormat;
  /** Reflowable pages can be re-paginated; fixed ones are one screen per section. */
  layout: Layout;
  /**
   * Default render mode for this book's sections.
   *
   * `reflowable` for anything whose layout only a browser engine can produce —
   * EPUB, TXT. `image`/`document` for fixed-layout books, which is how the
   * Android shell knows it may render natively instead of paying for a WebView.
   */
  render: RenderMode;
  /** Reading direction, from the EPUB spine / comic metadata. */
  direction: 'ltr' | 'rtl';
  sections: Section[];
  toc: TocEntry[];
  /** CSS the format itself carries (EPUB stylesheets), in injection order. */
  styles: string[];
  resources: Map<string, Resource>;
  /** True when the reading order came from the book rather than the file order. */
  orderedByBook: boolean;
}

/**
 * A book whose section bodies are fetched on demand.
 *
 * The reader drives this rather than fetching the whole file, which is what keeps
 * opening a 1200-chapter book at one chapter of bytes. It lives in the format
 * layer because "which bytes are this chapter" is a format question — an EPUB
 * answers it with an archive path, a comic with a page index.
 */
export interface StagedBook {
  /** Load one section's body, filling in `html` or `image` in place. */
  loadSection(index: number): Promise<Section | null>;
  /**
   * Swap in a newly fetched window.
   *
   * Returns the local index of `spine` within the new window, or -1 when that
   * window does not contain it.
   */
  loadWindow(content: unknown, spine: number): number;
  /** Whole-book index of the loaded window's first section. */
  windowOffset?(): number;
}

export interface LoadContext {
  /** Raw book bytes. */
  bytes: Uint8Array;
  /** File name, when known: the last-resort metadata source for TXT. */
  fileName: string;
  /** Book id, used to namespace generated URLs. */
  bookId: string;
}
