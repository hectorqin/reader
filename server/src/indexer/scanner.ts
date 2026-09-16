import { createHash } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import { computeBookId, computeFileId } from './identity.ts';
import {
  comicDirectoryMetadata,
  parseBookFile,
  saveCover,
  type ExtractedMetadata,
  type ParsedBookFile,
} from './metadata.ts';
import { naturalCompare } from './natural-sort.ts';
import { toRelative } from '../lib/paths.ts';
import { collapseWhitespace, safeJsonParse } from '../lib/text.ts';

/**
 * Formats the scanner will index.
 *
 * Deliberately broader than "the formats the server can parse". For most of these
 * the server's job is only to record that a file exists and extract whatever
 * metadata is cheap to get; *rendering* is the client's business (see
 * docs/architecture.md §8). A TXT novel or a comic archive that the server
 * ignored would simply be invisible on the shelf, which is the one outcome a
 * self-hosted library must not have.
 */
export const SUPPORTED_EXTENSIONS = new Set([
  '.epub',
  '.pdf',
  '.txt',
  '.cbz',
  '.zip',
]);

/**
 * Image formats, used to recognise a comic stored as a folder of pages.
 *
 * Such a book is not a file at all — the group of images *is* the book — so it is
 * handled by a separate pass (see `collectComicDirectories`) rather than through
 * `indexFile`.
 */
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp']);

/** Files inside a comic folder that are not pages. */
const NON_PAGE_PATTERNS = [/^\._/, /\.ds_store$/i, /thumbs\.db$/i, /comicinfo\.xml$/i];

/** Below this many images, a folder is treated as loose images rather than a book. */
const MIN_COMIC_PAGES = 2;

const SKIP_DIRS = new Set(['.git', '@eaDir', '#recycle', '.DS_Store', 'lost+found', '__MACOSX']);

export interface ScanProgress {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  failed: number;
  lastError: string | null;
}

export interface ScanResult extends ScanProgress {
  durationMs: number;
}

interface FileEntry {
  relPath: string;
  size: number;
  mtimeMs: number;
}

/** A folder of images that is treated as one book. */
interface ComicDirectory {
  relDir: string;
  pages: Array<{ relPath: string; size: number; mtimeMs: number }>;
  totalBytes: number;
  /** Digest of the folder path plus its page set; used as the content hash. */
  /** Stable content hash derived from the folder path; see the note at its use. */
  identityHash: string;
  identifier: string;
}

interface StoredFile {
  id: string;
  book_id: string;
  rel_path: string;
  size: number;
  mtime_ms: number;
  missing: number;
  book_content_hash: string;
  book_identifier: string | null;
}

export class Scanner {
  private progress: ScanProgress = {
    running: false,
    startedAt: null,
    finishedAt: null,
    scanned: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    failed: 0,
    lastError: null,
  };

  private current: Promise<ScanResult> | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
  ) {}

  getProgress(): ScanProgress {
    return { ...this.progress };
  }

  /** Concurrent calls share one run instead of stampeding the disk. */
  async scan(): Promise<ScanResult> {
    if (this.current) return this.current;
    this.current = this.runScan().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async runScan(): Promise<ScanResult> {
    const startedAt = Date.now();
    this.progress = {
      running: true,
      startedAt,
      finishedAt: null,
      scanned: 0,
      added: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      failed: 0,
      lastError: null,
    };

    try {
      const found = await this.walk(this.config.booksDir);
      // Comic folders have no file to walk over, so they are collected in a
      // second pass. Their pages are registered as files of the folder's book.
      const comics = await this.collectComicDirectories(this.config.booksDir);
      for (const comic of comics) {
        for (const page of comic.pages) {
          found.push({ relPath: page.relPath, size: page.size, mtimeMs: page.mtimeMs });
        }
      }
      const stored = this.loadStoredFiles();
      const storedByPath = new Map(stored.map((row) => [row.rel_path, row]));
      const seen = new Set<string>();

      const pagesByDir = new Map(comics.map((comic) => [comic.relDir, comic]));

      for (const entry of found) {
        seen.add(entry.relPath);
        this.progress.scanned += 1;
        const previous = storedByPath.get(entry.relPath);
        try {
          const owner = comicOf(entry.relPath, pagesByDir);
          if (owner) {
            await this.indexComicDirectory(owner, entry, previous);
          } else {
            await this.indexFile(entry, previous);
          }
        } catch (err) {
          this.progress.failed += 1;
          this.progress.lastError = err instanceof Error ? err.message : String(err);
          this.log.warn({ err, relPath: entry.relPath }, 'failed to index file');
        }
      }

      for (const row of stored) {
        if (seen.has(row.rel_path)) {
          if (row.missing === 1) {
            this.db.run('UPDATE book_files SET missing = 0 WHERE id = ?', row.id);
          }
          continue;
        }
        if (row.missing === 0) {
          this.db.run('UPDATE book_files SET missing = 1 WHERE id = ?', row.id);
          this.progress.removed += 1;
        }
      }

      // A rename or a move leaves the old rel_path row behind. Once the book is
      // reachable through a live file, that stale row is pure noise: drop it so
      // the file table does not grow without bound across re-organisations.
      this.db.run(
        `DELETE FROM book_files
         WHERE missing = 1
           AND book_id IN (SELECT book_id FROM book_files WHERE missing = 0)`,
      );

      // Only drop books that no longer have any live file AND that a user has
      // not added to a shelf manually; deleting a shelf entry the reader curated
      // would be a worse failure than showing a temporarily unavailable book.
      this.db.run(
        `DELETE FROM books
         WHERE id NOT IN (SELECT DISTINCT book_id FROM book_files WHERE missing = 0)
           AND id NOT IN (SELECT DISTINCT book_id FROM user_books)`,
      );

      this.progress.running = false;
      this.progress.finishedAt = Date.now();
      this.log.info(
        {
          scanned: this.progress.scanned,
          added: this.progress.added,
          updated: this.progress.updated,
          unchanged: this.progress.unchanged,
          removed: this.progress.removed,
          failed: this.progress.failed,
          durationMs: this.progress.finishedAt - startedAt,
        },
        'library scan finished',
      );
      return { ...this.progress, durationMs: this.progress.finishedAt - startedAt };
    } catch (err) {
      this.progress.running = false;
      this.progress.finishedAt = Date.now();
      this.progress.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Recursive walk that never follows symlinks out of the library root. */
  private async walk(root: string): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        this.log.warn({ err, dir }, 'unreadable directory, skipping');
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(abs);
          continue;
        }
        // Symlinks are not followed: a link pointing outside the mount would
        // let the server read files the operator never shared with it.
        if (!entry.isFile()) continue;
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
        try {
          const info = await stat(abs);
          out.push({ relPath: toRelative(root, abs), size: info.size, mtimeMs: Math.floor(info.mtimeMs) });
        } catch (err) {
          this.log.warn({ err, abs }, 'stat failed, skipping');
        }
      }
    };
    await visit(root);
    return out;
  }

  private loadStoredFiles(): StoredFile[] {
    return this.db.all<StoredFile>(
      `SELECT f.id, f.book_id, f.rel_path, f.size, f.mtime_ms, f.missing,
              b.content_hash AS book_content_hash, b.identifier AS book_identifier
       FROM book_files f JOIN books b ON b.id = f.book_id`,
    );
  }

  /**
   * Indexes one page of a comic stored as a folder.
   *
   * Every page resolves to the *same* book id, so the folder appears as one book
   * with many files rather than as N separate entries. The id is deliberately
   * derived from the folder path rather than from page contents: adding a page to
   * a folder should not create a second book and orphan the reader's progress.
   */
  private async indexComicDirectory(owner: ComicDirectory, entry: FileEntry, previous: StoredFile | undefined): Promise<void> {
    if (previous && previous.size === entry.size && previous.mtime_ms === entry.mtimeMs && previous.book_identifier === owner.identifier) {
      this.progress.unchanged += 1;
      return;
    }

    const metadata = comicDirectoryMetadata(owner.relDir, owner.pages.map((page) => page.relPath), owner.totalBytes);
    const bookId = computeBookId(metadata.identifier, owner.identityHash);
    const existing = this.db.get<{ id: string }>('SELECT id FROM books WHERE id = ?', bookId);
    const now = Date.now();

    // Only the first page becomes the cover: it is what the reader would pick,
    // and extracting every page to look for a better one would mean inflating the
    // whole archive on every scan.
    const coverPath = entry.relPath === owner.pages[0]?.relPath
      ? await this.persistComicCover(bookId, join(this.config.booksDir, entry.relPath), entry.relPath)
      : undefined;

    const parsed = {
      format: 'comic-dir' as const,
      contentHash: owner.identityHash,
      size: owner.totalBytes,
      pageCount: owner.pages.length,
      metadata,
      ...(coverPath !== undefined ? { coverPath } : {}),
    };

    if (!existing) {
      this.insertBook(bookId, parsed, now);
      this.progress.added += 1;
      this.db.run(
        `INSERT OR IGNORE INTO user_books (user_id, book_id, added_at)
         SELECT id, ?, ? FROM users`,
        bookId, now,
      );
    } else {
      this.progress.updated += 1;
      this.updateBook(bookId, parsed, now);
    }

    const fileId = computeFileId(entry.relPath);
    if (previous) {
      this.db.run(
        'UPDATE book_files SET book_id = ?, size = ?, mtime_ms = ?, missing = 0, last_seen = ? WHERE id = ?',
        bookId, entry.size, entry.mtimeMs, now, previous.id,
      );
    } else {
      this.db.run(
        `INSERT INTO book_files (id, book_id, rel_path, size, mtime_ms, inode, missing, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, '', 0, ?, ?)
         ON CONFLICT(rel_path) DO UPDATE SET book_id = excluded.book_id, size = excluded.size,
           mtime_ms = excluded.mtime_ms, missing = 0, last_seen = excluded.last_seen`,
        fileId, bookId, entry.relPath, entry.size, entry.mtimeMs, now, now,
      );
    }
  }

  private async persistComicCover(bookId: string, absPage: string, relPath: string): Promise<string | undefined> {
    try {
      const data = await readFile(absPage);
      return await saveCover(this.config.dataDir, bookId, { data, contentType: contentTypeFor(relPath) });
    } catch (err) {
      this.log.warn({ err, relPath }, 'comic cover extraction failed');
      return undefined;
    }
  }

  /**
   * Finds folders that are comics.
   *
   * A folder counts when it holds at least two images and no archives or books of
   * its own: a `books/` directory full of EPUBs plus a stray `cover.jpg` is not a
   * comic, and treating it as one would hide every book inside it.
   */
  private async collectComicDirectories(root: string): Promise<ComicDirectory[]> {
    const out: ComicDirectory[] = [];

    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        this.log.warn({ err, dir }, 'unreadable directory, skipping');
        return;
      }

      const images: Array<{ relPath: string; size: number; mtimeMs: number }> = [];
      let hasBookFile = false;
      const subdirs: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        if (NON_PAGE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          subdirs.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          hasBookFile = true;
          continue;
        }
        if (!IMAGE_EXTENSIONS.has(ext)) continue;
        try {
          const info = await stat(abs);
          images.push({ relPath: toRelative(root, abs), size: info.size, mtimeMs: Math.floor(info.mtimeMs) });
        } catch {
          // A file that vanished mid-walk is not worth reporting.
        }
      }

      if (dir !== root && !hasBookFile && images.length >= MIN_COMIC_PAGES) {
        const sorted = [...images].sort((a, b) => naturalCompare(a.relPath, b.relPath));
        const relDir = toRelative(root, dir);
        const totalBytes = sorted.reduce((sum, page) => sum + page.size, 0);
        out.push({
          relDir,
          pages: sorted,
          totalBytes,
          // Identity is the *folder*, not its contents.
          //
          // The tempting alternative — hashing the page set — is wrong for the
          // same reason hashing a file's bytes is wrong for a single book: the
          // reader adds one page to a folder and their progress and bookmarks for
          // that comic are gone. A folder path is the stable anchor here, exactly
          // as `dc:identifier` is for an EPUB, and the page set is allowed to
          // change underneath it.
          //
          // The consequence is accepted deliberately: renaming the folder makes a
          // new book. That is visible and recoverable, whereas silently losing the
          // reading position is not.
          identityHash: createHash('sha256').update(`comic-dir\u0000${relDir}`).digest('hex'),
          identifier: `comic-dir:${relDir}`,
        });
      }

      // Subfolders are still walked even when this folder was claimed as a comic:
      // a comic folder containing a `bonus/` subfolder would otherwise hide it.
      for (const subdir of subdirs) await visit(subdir);
    };

    await visit(root);
    return out;
  }

  /**
   * Two stage change detection (§6, 增量扫描):
   *   1. mtime + size  -> cheap, skips the vast majority of files
   *   2. content hash  -> authoritative, confirms the bytes really changed
   */
  private async indexFile(entry: FileEntry, previous: StoredFile | undefined): Promise<void> {
    if (previous && previous.size === entry.size && previous.mtime_ms === entry.mtimeMs) {
      this.progress.unchanged += 1;
      return;
    }

    const abs = join(this.config.booksDir, entry.relPath);
    const buf = await readFile(abs);
    const parsed = await parseBookFile(buf, entry.relPath);

    // Stage 2: identical bytes with a touched mtime is not a real change.
    if (previous && previous.book_content_hash === parsed.contentHash) {
      this.db.run('UPDATE book_files SET size = ?, mtime_ms = ?, missing = 0 WHERE id = ?',
        entry.size, entry.mtimeMs, previous.id);
      this.progress.unchanged += 1;
      return;
    }

    const bookId = computeBookId(parsed.metadata.identifier, parsed.contentHash);
    const existing = this.db.get<{ id: string }>('SELECT id FROM books WHERE id = ?', bookId);
    const now = Date.now();

    // Write the cover into DATA_DIR before recording its path. Covers are
    // cached, never mirrored back into the read-only library mount.
    if (parsed.cover) {
      parsed.coverPath = await this.persistCover(bookId, parsed.cover);
    }

    if (!existing) {
      this.insertBook(bookId, parsed, now);
      this.progress.added += 1;
      // Every existing user gets the new book on their shelf, so the library
      // feels shared rather than something each member must curate by hand.
      this.db.run(
        `INSERT OR IGNORE INTO user_books (user_id, book_id, added_at)
         SELECT id, ?, ? FROM users`,
        bookId, now,
      );
    } else {
      this.progress.updated += 1;
      // Embedded metadata is never allowed to overwrite manual edits; the
      // override layer is applied on read, so refreshing base values is safe.
      this.updateBook(bookId, parsed, now);
    }

    const fileId = computeFileId(entry.relPath);
    if (previous) {
      this.db.run(
        'UPDATE book_files SET book_id = ?, size = ?, mtime_ms = ?, missing = 0, last_seen = ? WHERE id = ?',
        bookId, entry.size, entry.mtimeMs, now, previous.id,
      );
    } else {
      this.db.run(
        `INSERT INTO book_files (id, book_id, rel_path, size, mtime_ms, inode, missing, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, '', 0, ?, ?)
         ON CONFLICT(rel_path) DO UPDATE SET book_id = excluded.book_id, size = excluded.size,
           mtime_ms = excluded.mtime_ms, missing = 0, last_seen = excluded.last_seen`,
        fileId, bookId, entry.relPath, entry.size, entry.mtimeMs, now, now,
      );
    }
  }

  private insertBook(bookId: string, parsed: ParsedBookFile, now: number): void {
    const m = parsed.metadata;
    const coverPath = parsed.coverPath ?? null;
    this.db.run(
      `INSERT INTO books (id, identifier, content_hash, format, title, author, publisher, language, isbn,
        description, series, series_index, tags, pubdate, cover_path, file_size, page_count, meta_json,
        source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bookId,
      m.identifier,
      parsed.contentHash,
      parsed.format,
      collapseWhitespace(m.title) || fallbackTitle(parsed),
      m.author,
      m.publisher,
      m.language,
      m.isbn,
      m.description,
      m.series,
      m.seriesIndex,
      JSON.stringify(m.tags),
      m.pubdate,
      coverPath,
      parsed.size,
      parsed.pageCount,
      JSON.stringify(m.raw),
      m.source,
      now,
      now,
    );
  }

  private updateBook(bookId: string, parsed: ParsedBookFile, now: number): void {
    const m = parsed.metadata;
    this.db.run(
      `UPDATE books SET title = ?, author = ?, publisher = ?, language = ?, isbn = ?, description = ?,
        series = ?, series_index = ?, tags = ?, pubdate = ?, page_count = ?, file_size = ?, meta_json = ?,
        cover_path = COALESCE(?, cover_path), source = ?, updated_at = ? WHERE id = ?`,
      collapseWhitespace(m.title) || fallbackTitle(parsed),
      m.author, m.publisher, m.language, m.isbn, m.description,
      m.series, m.seriesIndex, JSON.stringify(m.tags), m.pubdate,
      parsed.pageCount, parsed.size, JSON.stringify(m.raw),
      parsed.coverPath ?? null, m.source, now, bookId,
    );
  }

  /** Persists an extracted cover. Must be called outside the DB transaction. */
  async persistCover(bookId: string, cover: { data: Buffer; contentType: string }): Promise<string> {
    return saveCover(this.config.dataDir, bookId, cover);
  }
}

function fallbackTitle(parsed: Awaited<ReturnType<typeof parseBookFile>>): string {
  return `未命名 (${parsed.contentHash.slice(0, 8)})`;
}

export function contentFingerprint(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function parseTags(value: string): string[] {
  return safeJsonParse<string[]>(value, []);
}

export type { ExtractedMetadata };

/** Which comic folder a path belongs to, if any. */
function comicOf(relPath: string, comics: Map<string, ComicDirectory>): ComicDirectory | undefined {
  for (const [relDir, comic] of comics) {
    if (relPath.startsWith(`${relDir}/`)) return comic;
  }
  return undefined;
}

/** MIME type for a cover image, derived from its extension. */
function contentTypeFor(relPath: string): string {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}
