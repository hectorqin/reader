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

export interface Manifest {
  book: Book;
  contentUrl: string;
  coverUrl: string | null;
  files: BookFile[];
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
