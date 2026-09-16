/**
 * Schema is intentionally kept in plain SQL so that upgrades are reviewable and
 * backward compatible (product design §8.3: self-hosted users do not upgrade
 * promptly, so the on-disk format must stay additive).
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- The stable book identity. NEVER key books by path: a rename or a move of the
-- file would otherwise wipe the reader's progress and highlights, which is the
-- single most common complaint about self-hosted libraries.
CREATE TABLE IF NOT EXISTS books (
  id             TEXT PRIMARY KEY,          -- stable identity: dc:identifier + content hash
  identifier     TEXT,                      -- EPUB dc:identifier, when present
  content_hash   TEXT NOT NULL,             -- sha256 of the file bytes
  format         TEXT NOT NULL,             -- epub | pdf | unknown
  title          TEXT NOT NULL DEFAULT '',
  author         TEXT NOT NULL DEFAULT '',
  publisher      TEXT NOT NULL DEFAULT '',
  language       TEXT NOT NULL DEFAULT '',
  isbn           TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  series         TEXT NOT NULL DEFAULT '',
  series_index   REAL,
  tags           TEXT NOT NULL DEFAULT '[]',-- JSON array
  pubdate        TEXT NOT NULL DEFAULT '',
  cover_path     TEXT,                      -- relative path inside DATA_DIR/covers
  file_size      INTEGER NOT NULL DEFAULT 0,
  page_count     INTEGER,
  meta_json      TEXT NOT NULL DEFAULT '{}',-- full raw metadata, round-trippable
  source         TEXT NOT NULL DEFAULT 'embedded', -- embedded | filename | manual | provider:* 
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_hash ON books(content_hash);
CREATE INDEX IF NOT EXISTS idx_books_identifier ON books(identifier);

-- One file on disk may contain exactly one book here; several rows may point at
-- the same book id when the library holds duplicate copies.
CREATE TABLE IF NOT EXISTS book_files (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rel_path   TEXT NOT NULL UNIQUE,
  size       INTEGER NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  inode      TEXT NOT NULL DEFAULT '',
  missing    INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_book ON book_files(book_id);

-- Per-user library state. Kept separate from books so that a rescan can never
-- clobber a user's own edits.
CREATE TABLE IF NOT EXISTS user_books (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  added_at   INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, book_id)
);

-- Reading progress: one row per (user, book), last-writer-wins on updated_at.
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  locator       TEXT NOT NULL DEFAULT '',   -- opaque to the server: CFI / page / scroll offset
  percentage    REAL NOT NULL DEFAULT 0,
  chapter_title TEXT NOT NULL DEFAULT '',
  device        TEXT NOT NULL DEFAULT '',
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_updated ON reading_progress(user_id, updated_at);

-- Notes, highlights and bookmarks. deleted is a tombstone rather than a hard
-- delete so that an offline client cannot resurrect a note it removed elsewhere.
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('note', 'highlight', 'bookmark')),
  locator    TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL DEFAULT '',
  comment    TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_user_book ON notes(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(user_id, updated_at);

-- Highest-priority override layer: user manual edits. Never auto overwritten.
CREATE TABLE IF NOT EXISTS metadata_overrides (
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, field)
);
`;
