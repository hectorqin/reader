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

export interface ContinueReadingItem extends Book {
  percentage: number;
  chapterTitle: string;
  lastReadAt: number | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
