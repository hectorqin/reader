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
}

export interface TocEntry {
  id: string;
  label: string;
  depth: number;
}

export type Layout = 'reflowable' | 'fixed';

export interface BookDoc {
  format: BookFormat;
  /** Reflowable pages can be re-paginated; fixed ones are one screen per section. */
  layout: Layout;
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

export interface LoadContext {
  /** Raw book bytes. */
  bytes: Uint8Array;
  /** File name, when known: the last-resort metadata source for TXT. */
  fileName: string;
  /** Book id, used to namespace generated URLs. */
  bookId: string;
}
