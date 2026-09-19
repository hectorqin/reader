/**
 * Wire types mirroring `docs/api.md`.
 *
 * Hand-written rather than generated: the server only makes additive changes
 * (docs/architecture.md §7), so a client type that omits a newly added field
 * keeps working. Generating them would create churn on every server-side
 * addition without buying any safety.
 */

export interface Session {
  user: User;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  createdAt: number;
}

export interface InstanceInfo {
  name: string;
  apiVersion: number;
  registrationOpen: boolean;
  userCount: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  publisher: string;
  language: string;
  isbn: string;
  description: string;
  series: string;
  seriesIndex: number | null;
  tags: string[];
  pubdate: string;
  format: string;
  coverUrl: string | null;
  fileSize: number;
  pageCount: number | null;
  source: string;
  manualFields: string[];
  updatedAt: number;
  /**
   * When this account first saw the book.
   *
   * Carried to the client because the shelf sorts its *cached* list while offline
   * and must produce the same order the server would; without the key the two
   * would disagree exactly when the reader cannot check which is right.
   *
   * Optional so a client reading a server that predates the field keeps working —
   * the sort falls back to `updatedAt`.
   */
  addedAt?: number;
}

export interface BookListPage {
  items: Book[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BookFile {
  rel_path: string;
  size: number;
  missing: number;
}

/** One addressable unit of a book: a chapter, a page, a volume. */
export interface ContentItem {
  id: string;
  seq: number;
  title: string;
  kind: 'chapter' | 'page';
  mediaType: string;
  /** Opaque, format-specific reference. Pass it back unchanged. */
  href: string;
  /** Byte length when the format knows it cheaply. */
  size?: number;
}

/** A group of items: a comic volume, or a window of chapters. */
export interface ContentGroup {
  id: string;
  seq: number;
  title: string;
  count: number;
  /**
   * Global `seq` of this group's first item.
   *
   * Present so a client holding one window can place it in the whole-book
   * ordering without re-reading every previous group's count — which is exactly
   * how a jump lands on the wrong chapter.
   */
  offset: number;
}

/**
 * The addressable structure of a book.
 *
 * `kind` tells the client how to render it; `group` is present only when the
 * request narrowed the items to one window.
 */
export interface BookContent {
  kind: 'reflowable' | 'paged' | 'text' | 'document' | 'single-image';
  total: number;
  groups: ContentGroup[];
  items: ContentItem[];
  group?: number;
}

/**
 * One entry of a book's own navigation.
 *
 * `href` is the same opaque reference the manifest's items carry, so a jump from
 * the contents panel is addressed the same way a saved position is.
 */
export interface TocEntry {
  href: string;
  title: string;
  level: number;
  spine?: number;
}

export interface Manifest {
  book: Book;
  contentUrl: string;
  coverUrl: string | null;
  files: BookFile[];
  /**
   * The addressable structure, already narrowed to the first window.
   *
   * Present since the manifest took over `/items`, which is what makes opening a
   * book one round trip. Absent only for a format that exposes no structure at
   * all, in which case the client downloads the file.
   */
  content?: BookContent | null;
  kind?: BookContent['kind'];
  total?: number;
  groups?: ContentGroup[];
  items?: ContentItem[];
}

export interface Progress {
  bookId: string;
  locator: string;
  percentage: number;
  chapterTitle: string;
  device: string;
  updatedAt: number;
}

export type NoteType = 'note' | 'highlight' | 'bookmark';

export interface Note {
  id: string;
  bookId: string;
  type: NoteType;
  locator: string;
  text: string;
  comment: string;
  color: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface SyncPull {
  serverTime: number;
  progress: Progress[];
  notes: Note[];
}

export interface SyncPushResult extends SyncPull {
  accepted: number;
  rejected: number;
}

export interface Facets {
  authors: string[];
  series: string[];
  tags: string[];
  formats: string[];
}

/**
 * One row of the shelf's "继续阅读" strip.
 *
 * A whole `Book` with the progress flattened onto it — not a book-with-progress
 * *pair*, and not the progress record's own shape.
 *
 * That distinction is the bug this shape fixes. The server used to answer
 * `{ bookId, title, author, percentage, chapterTitle, updatedAt, coverUrl }`, i.e.
 * the *progress* row's naming, while this type asked for `Book`'s. Nothing failed
 * loudly: `title` and `coverUrl` are spelled the same in both, so the card drew,
 * and tapping it handed `openBook` an object with `id: undefined` — which routes to
 * `#/book/undefined`, 404s, and gets reported as "这本书不在书架上了". Two
 * hand-written types drifting on the two fields the tap path actually reads.
 *
 * Declaring it as an intersection is what makes the drift impossible to reintroduce
 * quietly: `id`, `addedAt` and `manualFields` are now *required* here, so a server
 * that answers the narrow shape fails this type instead of failing a tap.
 */
export interface ContinueReadingItem extends Book {
  percentage: number;
  chapterTitle: string;
  /** When the reader last turned a page here; `null` if progress was never pushed. */
  lastReadAt: number | null;
}

/**
 * One entry in the library tree, as the file-manager screen sees it.
 *
 * Carries the flags rather than the decisions: `hidden`, `hiddenByRule` and
 * `scanned` together let the UI explain *why* a book on disk is not on the shelf,
 * which is the one question no other screen can answer.
 */
export interface BrowseEntry {
  name: string;
  /** Library-relative path; the id every operation passes back. */
  path: string;
  type: 'dir' | 'file' | 'other';
  size: number;
  mtime: number;
  mode: number;
  hidden: boolean;
  hiddenByRule: boolean;
  /** The scanner indexes this path as a book of its own. */
  scanned: boolean;
  /**
   * Whether the caller's shelf holds the book at this path.
   *
   * `null` when the path is not an indexed book at all — a folder, a stray `.nfo`,
   * a page image inside an archive. The value is per-caller, because it describes
   * *their* shelf: the server resolves it against the authenticated user.
   */
  shelfState: 'on' | 'off' | null;
  ext: string;
  /** The index currently holds a row for this exact path. */
  indexed: boolean;
}

export interface BrowseListing {
  /** `''` is the library root. */
  path: string;
  crumbs: Array<{ name: string; path: string }>;
  parent: string | null;
  entries: BrowseEntry[];
  total: number;
  dirs: number;
  files: number;
  size: number;
  /** Whether the mount accepts writes; the UI hides its write controls when not. */
  writable: boolean;
  name: string;
}

/** One file that an upload put into the library. */
export interface UploadedItem {
  /** Library-relative path it now lives at. */
  path: string;
  /** The name the client sent, so a report can name what the user chose. */
  originalName: string;
  /** Name after the conflict policy ran; differs when a suffix was added. */
  name: string;
  size: number;
  /** `archive-entry` for a member of an uploaded zip. */
  kind: 'file' | 'archive-entry';
  /** Present once the incremental scan has indexed it. */
  bookId?: string;
  title?: string;
}

export interface UploadResult {
  uploaded: UploadedItem[];
  /** Files that were not stored, with the reason, rather than failing the batch. */
  skipped: Array<{ name: string; reason: string }>;
  /**
   * Files already on disk are kept rather than replaced.
   *
   * `rename` keeps both, `skip` keeps the one that was there, `overwrite`
   * replaces it — which is the only one of the four that can lose a book, so it
   * is not the default and the UI says so.
   */
  scan: {
    added: number;
    updated: number;
    removed: number;
    failed: number;
    startedAt: number | null;
    finishedAt: number | null;
  } | null;
}

/** Outcome of a batch operation. Mirrors the server's `BatchResult`. */
export interface BatchResult {
  /** Rows changed; a folder counts once per book inside it. */
  applied: number;
  books: string[];
  /** Paths that could not be acted on, with the reason. */
  failed: Array<{ path: string; reason: string }>;
}

export type ConflictPolicy = 'rename' | 'skip' | 'overwrite' | 'fail';

export type ShelfAction = 'add' | 'remove' | 'hide' | 'unhide';

export interface ApiErrorBody {
  error: { code: string; message: string };
}
