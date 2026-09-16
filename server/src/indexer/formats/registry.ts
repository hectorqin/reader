import type { Readable } from 'node:stream';
import type { ExtractedMetadata } from '../metadata.ts';

/**
 * Format handler registry.
 *
 * The scanner and the HTTP layer must not know which formats exist. Adding one
 * means writing a handler and registering it in `./index.ts`; nothing else
 * changes. That boundary is the whole point of this module — before it, the
 * format list was hardcoded in three places (walk filter, parseBookFile, mime
 * map), and each new format meant touching all three and hoping nothing was
 * missed.
 *
 * Two kinds of handler, because the two are genuinely different shapes:
 *
 *  - Single-file handler: one file on disk is one book (.epub, .pdf, .cbz, .txt).
 *  - Directory handler: a directory is one book (.jpg collections, comic
 *    volumes). These are discovered by the scanner after the file walk, since
 *    they have no file of their own to match on.
 */

/** What a client needs to know to render this kind of content. */
export type BookKind =
  /** Reflowable text with a chapter spine (epub). */
  | 'reflowable'
  /** Fixed pages of images read in order (comic). */
  | 'paged'
  /** Continuous text, optionally split into chapters (txt). */
  | 'text'
  /** Opaque document the client renders itself (pdf). */
  | 'document'
  /** A single image read as one page. */
  | 'single-image';

/** Result of parsing a file or directory during a scan. */
export interface ParsedSource {
  format: string;
  kind: BookKind;
  contentHash: string;
  size: number;
  /**
   * Number of addressable items (pages / chapters). `null` when the format
   * cannot report it cheaply — the design's rule is never to guess: a wrong
   * page count makes the client's pagination wrong, which is worse than none.
   */
  pageCount: number | null;
  /** Bytes for the cover, written into DATA_DIR by the scanner. */
  cover?: { data: Buffer; contentType: string } | undefined;
  metadata: ExtractedMetadata;
}

/** One addressable unit of a book: a chapter, a page, a volume. */
export interface ContentItem {
  id: string;
  seq: number;
  title: string;
  kind: 'chapter' | 'page';
  mediaType: string;
  /** Where the bytes come from. Opaque to the HTTP layer. */
  href: string;
  /**
   * Byte length when the format knows it cheaply. Sent with the manifest so a
   * client can estimate a download or prefetch budget instead of discovering
   * the size one request at a time. Absent means unknown.
   */
  size?: number;
}

/** A named group of items; volumes for comics, or a single implicit one. */
export interface ContentGroup {
  id: string;
  seq: number;
  title: string;
  count: number;
  /**
   * Global `seq` of this group's first item. Lets a client splice a single
   * group fetched with `?group=N` back into the whole-book ordering without
   * re-reading every previous group's count.
   */
  offset: number;
}

/**
 * One file backing a book, as reported by `/books/:id/manifest`.
 *
 * For a single-file book this mirrors its row in the file table. A directory book
 * has no row of its own, so the handler supplies the list instead — and that list
 * is a contract, not a description: the manifest tells the client which paths
 * make up the book, and `/books/:id/file` will serve exactly those paths.
 */
export interface BookFileEntry {
  relPath: string;
  /** Position in the book, so a handler can serve the file from its own addressing. */
  index: number;
  size: number;
  missing: number;
}

export interface Manifest {
  kind: BookKind;
  total: number;
  groups: ContentGroup[];
  items: ContentItem[];
}

/**
 * A table of contents entry.
 *
 * Deliberately not a `ContentItem`: a TOC is a list of *names*, and a client
 * rendering one needs a title and somewhere to jump to. Shipping sizes, media
 * types and per-item ids for a 1200-chapter book would be several times the
 * payload for fields the TOC never reads.
 */
export interface TocEntry {
  /** Addressable reference; the same value `ContentItem.href` carries. */
  href: string;
  title: string;
  /** Depth for nested navigation, 0 for a flat list. */
  level: number;
  /** Whole-book index, when the format has one. */
  spine?: number;
}

export interface AssetRequest {
  /** Item id from the manifest, or a format specific reference. */
  ref: string;
}

export interface AssetPayload {
  /**
   * In-memory bytes. Right for anything small and already parsed (a chapter
   * document, a font, a single page of an archive that fits comfortably).
   */
  data?: Buffer;
  /**
   * Lazily produced bytes. Required for anything whose size is the user's, not
   * ours — a comic archive page, a PDF. Handing the HTTP layer a stream is what
   * keeps "read one page of a 300MB cbz" from costing 300MB of heap, and what
   * lets the client cancel a download without the server finishing it.
   */
  stream?: Readable;
  contentType: string;
  filename?: string;
  /**
   * Total byte length when known up front, so a client gets a real progress
   * bar. `undefined` means "unknown"; the response is then chunked.
   */
  size?: number;
  /** Supports HTTP Range requests. Only set this when the bytes are seekable. */
  seekable?: boolean;
  /** Trusted validator for the payload, e.g. the book's content hash. */
  etag?: string;
  /** Last-modified time in milliseconds, when the source has one. */
  lastModified?: number;
}

export type ProgressReporter = (scanned: number) => void;

/** Context handed to every handler. Absolute paths are already validated. */
export interface HandlerContext {
  /** Library-relative path, forward slashes. */
  relPath: string;
  /** Absolute path, guaranteed inside the read-only books root. */
  absPath: string;
  /**
   * Book id, available once the book exists. Handlers that emit links back into
   * the API (the EPUB chapter rewriter) need it to build absolute URLs.
   */
  bookId?: string;
}

export interface FileFormatHandler {
  readonly format: string;
  readonly kind: BookKind;
  /** Lowercase, no dot. Empty for directory handlers. */
  readonly extensions: readonly string[];
  /**
   * Extensions whose files are *pages* rather than books of their own.
   *
   * Only meaningful for a handler that also owns a directory format — the image
   * handler owns loose images, but inside a comic folder the same `.jpg` is a
   * page. Without this distinction "is this folder a book collection" could not
   * be answered: a folder of scans would look like a folder of books.
   */
  readonly pageExtensions?: readonly string[];
  /** Human readable, surfaced in /capabilities so clients can show support. */
  readonly label: string;
  /**
   * The book's own navigation, when it has one.
   *
   * Optional because not every format does: a single image has no chapters, and
   * a TXT file only has headings when its author wrote them. A handler that
   * omits this gets the default, which is one entry per manifest item — correct
   * for anything whose items already are the table of contents.
   */
  toc?(ctx: HandlerContext): Promise<TocEntry[]>;
  /**
   * Optional cheap check that the file really is this format. Used when the
   * extension is ambiguous (a .zip that may or may not be a comic).
   */
  matches?(ctx: HandlerContext, head: Buffer): Promise<boolean> | boolean;
  parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource>;
  manifest(ctx: HandlerContext): Promise<Manifest>;
  asset(ctx: HandlerContext, req: AssetRequest): Promise<AssetPayload>;
}

export interface DirectoryFormatHandler {
  readonly format: string;
  readonly kind: BookKind;
  readonly label: string;
  toc?(ctx: HandlerContext): Promise<TocEntry[]>;
  /** Decide whether this directory is one book of this format. */
  matches(ctx: HandlerContext, entries: DirectoryEntry[]): Promise<boolean> | boolean;
  parse(ctx: HandlerContext, entries: DirectoryEntry[]): Promise<ParsedSource>;
  manifest(ctx: HandlerContext): Promise<Manifest>;
  /**
   * The files this directory book is made of.
   *
   * Optional, because a directory handler may one day describe a book that is not
   * a list of files at all; when it is absent the API reports the folder itself and
   * offers no per-file access.
   */
  files?(ctx: HandlerContext): Promise<BookFileEntry[]>;
  asset(ctx: HandlerContext, req: AssetRequest): Promise<AssetPayload>;
}

/** A directory entry as seen by the scanner, before any format logic runs. */
export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

const handlers: FileFormatHandler[] = [];
const directoryHandlers: DirectoryFormatHandler[] = [];
const byExtension = new Map<string, FileFormatHandler>();
const pageExtensions = new Set<string>();

/**
 * Registration order is precedence: the first handler to claim an extension
 * wins. Comic archives register before the generic zip handler so `.zip` gets
 * the comic treatment only when its contents actually look like a comic.
 */
export function registerFileHandler(handler: FileFormatHandler): FileFormatHandler {
  handlers.push(handler);
  for (const ext of handler.extensions) {
    const key = ext.replace(/^\./, '').toLowerCase();
    if (!byExtension.has(key)) byExtension.set(key, handler);
  }
  for (const ext of handler.pageExtensions ?? []) {
    pageExtensions.add(ext.replace(/^\./, '').toLowerCase());
  }
  return handler;
}

export function registerDirectoryHandler(handler: DirectoryFormatHandler): DirectoryFormatHandler {
  directoryHandlers.push(handler);
  return handler;
}

export function fileHandlerForExtension(ext: string): FileFormatHandler | null {
  return byExtension.get(ext.replace(/^\./, '').toLowerCase()) ?? null;
}

export function fileHandlerForFormat(format: string): FileFormatHandler | null {
  return handlers.find((h) => h.format === format) ?? null;
}

export function directoryHandlerForFormat(format: string): DirectoryFormatHandler | null {
  return directoryHandlers.find((h) => h.format === format) ?? null;
}

export function allFileHandlers(): readonly FileFormatHandler[] {
  return handlers;
}

export function allDirectoryHandlers(): readonly DirectoryFormatHandler[] {
  return directoryHandlers;
}

/**
 * Every extension the scanner should bother walking. Built from the registry so
 * it can never drift out of sync with the handlers, which is exactly how the
 * old hardcoded `.epub`/`.pdf` set ended up rejecting half a real library.
 */
export function supportedExtensions(): Set<string> {
  return new Set([...byExtension.keys()].map((e) => `.${e}`));
}

/**
 * Whether an extension names a *page* inside a book rather than a book.
 *
 * Asked as a question about extensions, not as a lookup of the winning handler,
 * because the two are not the same: `.jpg` is registered as a single-image book
 * so a loose scan is still reachable, and is simultaneously a page inside a
 * comic folder.
 */
export function isPageExtension(ext: string): boolean {
  return pageExtensions.has(ext.replace(/^\./, '').toLowerCase());
}

export interface FormatCapability {
  format: string;
  kind: BookKind;
  label: string;
  extensions: string[];
  directory: boolean;
}

export function capabilities(): FormatCapability[] {
  return [
    ...handlers.map((h) => ({
      format: h.format,
      kind: h.kind,
      label: h.label,
      extensions: [...h.extensions],
      directory: false,
    })),
    ...directoryHandlers.map((h) => ({
      format: h.format,
      kind: h.kind,
      label: h.label,
      extensions: [] as string[],
      directory: true,
    })),
  ];
}
