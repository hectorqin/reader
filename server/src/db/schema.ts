/**
 * Schema is intentionally kept in plain SQL so that upgrades are reviewable and
 * backward compatible (product design §8.3: self-hosted users do not upgrade
 * promptly, so the on-disk format must stay additive).
 */
/**
 * Additive migrations applied after `SCHEMA_SQL`.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a
 * column added to the schema is invisible to an existing instance — and
 * self-hosted users do not upgrade on a schedule, so "recreate the database" is
 * not an option. Each statement is applied only when the column is missing.
 *
 * Every migration here is additive: a column with a default, never a rewrite, so
 * that an instance running an older build against a newer database still works.
 */
export const MIGRATIONS_SQL = `
ALTER TABLE source_instances ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS source_single_default ON source_instances(is_default) WHERE is_default = 1;
ALTER TABLE book_files ADD COLUMN parse_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN content_hash_kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE chapter_resources ADD COLUMN media_type TEXT NOT NULL DEFAULT 'text/plain';
`;

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
  id             TEXT PRIMARY KEY,          -- stable file identity, or source + user + publication ref for chapters
  identifier     TEXT,                      -- EPUB dc:identifier, when present
  content_hash   TEXT NOT NULL,             -- sha256 of bytes or the canonical manifest, according to content_hash_kind
  content_hash_kind TEXT NOT NULL DEFAULT 'file', -- file | manifest
  -- Format id (epub | pdf | cbz | txt | image | comic-dir | chapters).
  -- Open set on purpose: adding a format must not require a schema migration.
  format         TEXT NOT NULL,
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
  -- Addressable item count (chapters for epub/txt, pages for comics).
  -- NULL means the format cannot report it cheaply; never a guessed number,
  -- because a wrong denominator corrupts the reader's progress bar.
  page_count     INTEGER,
  meta_json      TEXT NOT NULL DEFAULT '{}',-- full raw metadata, round-trippable
  source         TEXT NOT NULL DEFAULT 'embedded', -- embedded | filename | manual | provider:* 
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_hash ON books(content_hash);
CREATE INDEX IF NOT EXISTS idx_books_identifier ON books(identifier);

-- One file OR directory on disk is one book here; several rows may point at the
-- same book id when the library holds duplicate copies. Directory books (image
-- folders) have no size/mtime of their own, so those columns carry a derived
-- value and change detection falls back to comparing content hashes.
CREATE TABLE IF NOT EXISTS book_files (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rel_path   TEXT NOT NULL UNIQUE,
  size       INTEGER NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  inode      TEXT NOT NULL DEFAULT '',
  missing    INTEGER NOT NULL DEFAULT 0,
  -- Which version of the format parsers produced this row. Change detection is
  -- content-based, so a parser fix cannot invalidate anything on its own: the
  -- bytes are identical, the scan skips the file, and a book indexed with a
  -- broken parser keeps the bad result forever. Bumping this forces one reparse.
  parse_version INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_book ON book_files(book_id);

-- Configurations contain no credentials. Built-in and installed source types
-- share this table; disabling a source never removes acquired content.
CREATE TABLE IF NOT EXISTS source_instances (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS source_credentials (
  source_id TEXT NOT NULL REFERENCES source_instances(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  PRIMARY KEY (source_id, user_id, key)
);
-- Host-managed files are deliberately separate from the scanned books mount.
CREATE TABLE IF NOT EXISTS acquired_files (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS source_acquisitions (
  source_id TEXT NOT NULL REFERENCES source_instances(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_ref TEXT NOT NULL,
  option_id TEXT NOT NULL DEFAULT '',
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, user_id, entry_ref, option_id)
);
-- Chapter publications belong to one account: the same provider reference may
-- resolve differently with another account's credentials. Their identity is
-- independent of both the current directory and the location of its chapters.
CREATE TABLE IF NOT EXISTS chapter_publications (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES source_instances(id),
  publication_ref TEXT NOT NULL,
  revision TEXT NOT NULL,
  version TEXT,
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source_id, user_id, publication_ref)
);
-- Keep prior snapshots and their already fetched bytes so an open reader can
-- finish its old directory after another device refreshes it.
CREATE TABLE IF NOT EXISTS chapter_snapshots (
  book_id TEXT NOT NULL REFERENCES chapter_publications(book_id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, revision)
);
CREATE TABLE IF NOT EXISTS chapter_resources (
  book_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'text/plain; charset=utf-8',
  body TEXT,
  content_hash TEXT,
  PRIMARY KEY (book_id, revision, chapter_id),
  FOREIGN KEY (book_id, revision) REFERENCES chapter_snapshots(book_id, revision) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plugin_storage (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chapter_subscriptions (
  book_id TEXT PRIMARY KEY REFERENCES chapter_publications(book_id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  last_check_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  new_chapters INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chapter_due ON chapter_subscriptions(enabled, next_check_at);
CREATE TABLE IF NOT EXISTS installed_plugins (
  plugin_id TEXT PRIMARY KEY,
  folder TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

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
