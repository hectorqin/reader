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
}

/** A named group of items; volumes for comics, or a single implicit one. */
export interface ContentGroup {
  id: string;
  seq: number;
  title: string;
  count: number;
}

export interface Manifest {
  kind: BookKind;
  total: number;
  groups: ContentGroup[];
  items: ContentItem[];
}

export interface AssetRequest {
  /** Item id from the manifest, or a format specific reference. */
  ref: string;
}

export interface AssetPayload {
  data: Buffer;
  contentType: string;
  filename?: string;
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
  /** Human readable, surfaced in /capabilities so clients can show support. */
  readonly label: string;
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
  /** Decide whether this directory is one book of this format. */
  matches(ctx: HandlerContext, entries: DirectoryEntry[]): Promise<boolean> | boolean;
  parse(ctx: HandlerContext, entries: DirectoryEntry[]): Promise<ParsedSource>;
  manifest(ctx: HandlerContext): Promise<Manifest>;
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
