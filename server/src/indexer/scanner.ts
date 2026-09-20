import { createHash } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import { computeFileId, resolveBookId } from './identity.ts';
import { saveCover, type ExtractedMetadata } from './metadata.ts';
import { toRelative } from '../lib/paths.ts';
import { collapseWhitespace, safeJsonParse } from '../lib/text.ts';
import { naturalCompare } from './formats/index.ts';
import {
  allDirectoryHandlers,
  fileHandlerForExtension,
  isPageExtension,
  supportedExtensions,
  type BookKind,
  type DirectoryEntry,
  type ParsedSource,
} from './formats/index.ts';

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

/** A directory that a format handler claims as one book. */
interface DirectoryCandidate {
  relPath: string;
  absPath: string;
  /** Coarse change key: child count plus the newest child mtime. */
  signature: string;
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
  parse_version: number;
}

/**
 * Version of the format parsers.
 *
 * Bump this whenever a parser starts producing a *different* result for the same
 * bytes — a fix, a new extracted field, a corrected count. It is the only
 * mechanism by which such a change can reach books that were already indexed,
 * because change detection is content-based and a parser fix does not touch the
 * content. Raising it costs one full reparse of the library, so it is for real
 * changes rather than for every commit.
 *
 * 1: initial version. Everything indexed before this carries version 0 and is
 *    reparsed once, which repairs libraries whose EPUB page counts were lost to
 *    the memory-backed archive reader.
 */
const PARSE_VERSION = 1;

/** Directories that never contain books, or contain only tooling noise. */
const SKIP_DIRS = new Set(['.git', '@eaDir', '#recycle', '.DS_Store', 'lost+found', '__MACOSX']);

/**
 * Library scanner.
 *
 * Responsibilities:
 *  - walk the read-only mount and decide which format owns each path
 *  - detect changes cheaply (size + mtime) before hashing anything
 *  - write the index into DATA_DIR, never into the library
 *
 * All format knowledge lives behind `./formats`. This file only knows that a
 * handler can parse something and how to record the result.
 */
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
      const stored = this.loadStoredFiles();
      const storedByPath = new Map(stored.map((row) => [row.rel_path, row]));
      const seen = new Set<string>();

      // Directory books are discovered BEFORE the file walk so their contents
      // can be excluded from it. Doing it the other way round means indexing
      // every page image first and then deleting them, which shows up as a
      // visible add-then-remove churn in the scan counters.
      const directoryBooks = await this.discoverDirectoryBooks(storedByPath);
      // A folder that holds a real book is a shelf. The book inside it is what
      // the reader is looking for; the loose scans and cover art sitting next to
      // it are not separate books, and listing them as such buries the actual
      // book in a shelf full of covers.
      const shelfDirectories = await this.directoriesHoldingBooks();

      const claimed = new Set<string>();
      for (const candidate of directoryBooks) {
        seen.add(candidate.relPath);
        this.progress.scanned += 1;
        const previous = storedByPath.get(candidate.relPath);
        try {
          await this.indexDirectory(candidate, previous);
        } catch (err) {
          this.progress.failed += 1;
          this.progress.lastError = err instanceof Error ? err.message : String(err);
          this.log.warn({ err, relPath: candidate.relPath }, 'failed to index directory');
        }
        // Every page inside a claimed directory belongs to that book, so it must
        // not be indexed a second time as a standalone book of its own. Files the
        // library would index as books are deliberately left out: a shelf nested
        // inside a comic folder is still a shelf, and its books are what the
        // reader is looking for.
        for (const owned of await this.listFilesUnder(candidate.absPath)) {
          const rel = toRelative(this.config.booksDir, owned);
          // A book of another format nested inside a comic folder is still a book
          // (`藏书目录/` holds real books). An archive is not: it is this book's own
          // page source, and indexing it separately would put the same volume on
          // the shelf twice — once inside the series and once on its own.
          if (isBookFileExtension(rel, true)) continue;
          claimed.add(rel);
        }
      }

      const found = await this.walk(this.config.booksDir);
      for (const entry of found) {
        // A page of a claimed directory book, or a stray page sitting in a shelf
        // that already has a real book in it.
        const insideShelf = isInsideAny(entry.relPath, shelfDirectories);
        if (claimed.has(entry.relPath) || (insideShelf && !isBookFileExtension(entry.relPath))) {
          seen.add(entry.relPath);
          continue;
        }
        seen.add(entry.relPath);
        this.progress.scanned += 1;
        const previous = storedByPath.get(entry.relPath);
        try {
          await this.indexFile(entry, previous);
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
           AND id NOT IN (SELECT book_id FROM acquired_files)
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

  /**
   * Recursive walk that never follows symlinks out of the library root, and
   * only descends into directories that can yield a book.
   *
   * The extension set comes from the format registry rather than a hardcoded
   * list, so registering a handler is all it takes for its files to be walked.
   */
  private async walk(root: string): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    const extensions = supportedExtensions();

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
        const dot = entry.name.lastIndexOf('.');
        if (dot <= 0) continue;
        if (!extensions.has(entry.name.slice(dot).toLowerCase())) continue;

        // Dirent carries no size or mtime, so a stat is unavoidable. Getting
        // this wrong (reading `entry.size`) makes every file look unchanged and
        // silently freezes the index — see the regression test.
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

  /**
   * Find directories that are themselves books (comic series, image folders).
   *
   * Shallowest first, and a claimed directory absorbs its descendants. Both
   * directions were tried against real libraries:
   *
   *  - Deepest first turns `进击的巨人/第01卷/` into its own book, so the series
   *    shows up as N separate volumes instead of one book with N volumes, and
   *    the reader has to hunt for the next volume in a different shelf entry.
   *  - Shallowest first matches how the books were filed by hand: the outer
   *    folder is the series, its subfolders are the volumes.
   *
   * The cost is that a genuinely nested pair (a series folder inside a folder of
   * unrelated scans) collapses into the outer one. That is visible and fixable
   * by the user moving files; N near-duplicate shelf entries is not.
   */
  private async discoverDirectoryBooks(storedByPath: Map<string, StoredFile>): Promise<DirectoryCandidate[]> {
    const handlers = allDirectoryHandlers();
    if (handlers.length === 0) return [];

    const directories = await this.listDirectories(this.config.booksDir);
    const shallowestFirst = [...directories].sort((a, b) => {
      const depth = a.split('/').length - b.split('/').length;
      return depth !== 0 ? depth : naturalCompare(a, b);
    });

    const claimed: string[] = [];
    const out: DirectoryCandidate[] = [];

    for (const relPath of shallowestFirst) {
      // A volume folder inside a claimed series belongs to the series — unless
      // that folder is itself a shelf of books, which the walk already refused to
      // enter. Absorbing it here would undo that decision one layer up.
      if (
        claimed.some((owner) => relPath.startsWith(`${owner}/`)) &&
        !(await this.holdsBookFile(join(this.config.booksDir, relPath)))
      ) {
        continue;
      }

      const absPath = join(this.config.booksDir, relPath);
      const entries = await this.listDirectoryEntries(absPath);

      // A directory holding book files is a shelf, never a book: one `cover.jpg`
      // next to an EPUB must not turn the folder into a comic and hide the book
      // inside it. Asked in the same pass as the handler, from the very entries
      // the handler sees, so the two can never disagree about the same directory.
      //
      // An archive is judged with `insideDirectoryBook`, because this pass only
      // runs over folders that could become a directory book: `第01卷.cbz` beside
      // `第02卷/` is a volume, not a book on a shelf.
      const holdsBookFile = entries.some(
        (entry) => !entry.isDirectory && isBookFileExtension(entry.name, true),
      );
      if (holdsBookFile) continue;

      for (const handler of handlers) {
        let matched = false;
        try {
          matched = await handler.matches({ relPath, absPath }, entries);
        } catch {
          matched = false;
        }
        if (!matched) continue;

        claimed.push(relPath);
        out.push({ relPath, absPath, signature: directorySignature(entries, storedByPath, relPath) });
        break;
      }
    }

    return out;
  }

  private async listDirectories(root: string): Promise<string[]> {
    const out: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        const relPath = toRelative(root, abs);
        out.push(relPath);
        // A directory that holds a book is a shelf, and the scanner's own rule
        // says its contents are indexed as they are. Looking inside it for a
        // directory book would let an enclosing comic folder swallow the books
        // nested within, so the walk stops here just like discovery does.
        if (await this.holdsBookFile(abs)) continue;
        await visit(abs);
      }
    };
    await visit(root);
    return out;
  }

  /** Whether a directory directly holds a file the server indexes as a book. */
  private async holdsBookFile(absDir: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some(
      (entry) => entry.isFile() && !entry.name.startsWith('.') && isBookFileExtension(entry.name),
    );
  }

  /**
   * Directories that hold a real book file, directly.
   *
   * Used to absorb the page images sitting next to it: a `cover.jpg` beside an
   * EPUB is cover art, not a one-page book. Deliberately only images are
   * absorbed — a second EPUB next to the first is a second book.
   */
  private async directoriesHoldingBooks(): Promise<string[]> {
    const directories = await this.listDirectories(this.config.booksDir);
    const out: string[] = [];
    for (const relDir of directories) {
      let entries;
      try {
        entries = await readdir(join(this.config.booksDir, relDir), { withFileTypes: true });
      } catch {
        continue;
      }
      const hasBook = entries.some(
        (entry) => entry.isFile() && !entry.name.startsWith('.') && isBookFileExtension(entry.name),
      );
      if (hasBook) out.push(relDir);
    }
    return out;
  }

  /**
   * Every file under a claimed directory, recursively.
   *
   * Used to exclude a directory book's own contents from the file walk: a page
   * image is part of its book, not a book of its own.
   */
  private async listFilesUnder(absDir: string): Promise<string[]> {
    const out: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(abs);
          continue;
        }
        if (entry.isFile()) out.push(abs);
      }
    };
    await visit(absDir);
    return out;
  }

  /**
   * The entries of a directory, with sizes.
   *
   * Sizes are stat'd rather than left at 0 because the decision "is this folder a
   * book of this format" belongs to the handler, and the handler compares the
   * size of the files it can read against the size of the ones it cannot. Without
   * a size, a folder of EPUBs next to two loose scans looks like a folder of two
   * images, and a real book inside it disappears from the shelf.
   */
  private async listDirectoryEntries(absDir: string): Promise<DirectoryEntry[]> {
    try {
      const dirents = await readdir(absDir, { withFileTypes: true });
      const out: DirectoryEntry[] = [];
      for (const dirent of dirents) {
        if (dirent.name.startsWith('.')) continue;
        // Symlinks are not followed here either: a link out of the mount would
        // let the size probe read a file the operator never shared.
        if (dirent.isFile()) {
          let size = 0;
          try {
            size = (await stat(join(absDir, dirent.name))).size;
          } catch {
            size = 0;
          }
          out.push({ name: dirent.name, isDirectory: false, size });
          continue;
        }
        if (dirent.isDirectory()) out.push({ name: dirent.name, isDirectory: true, size: 0 });
      }
      return out;
    } catch {
      return [];
    }
  }

  private loadStoredFiles(): StoredFile[] {
    return this.db.all<StoredFile>(
      `SELECT f.id, f.book_id, f.rel_path, f.size, f.mtime_ms, f.missing, f.parse_version,
              b.content_hash AS book_content_hash, b.identifier AS book_identifier
       FROM book_files f JOIN books b ON b.id = f.book_id`,
    );
  }

  /**
   * Two stage change detection (§6, 增量扫描):
   *   1. mtime + size  -> cheap, skips the vast majority of files
   *   2. content hash  -> authoritative, confirms the bytes really changed
   */
  private async indexFile(entry: FileEntry, previous: StoredFile | undefined): Promise<void> {
    if (previous && previous.size === entry.size && previous.mtime_ms === entry.mtimeMs && !this.needsReparse(previous)) {
      this.progress.unchanged += 1;
      return;
    }

    const dot = entry.relPath.lastIndexOf('.');
    const handler = fileHandlerForExtension(entry.relPath.slice(dot));
    if (!handler) {
      // The walk only visits registered extensions, so this is a registry/index
      // mismatch rather than user data. Skip quietly instead of failing the scan.
      this.progress.unchanged += 1;
      return;
    }

    const abs = join(this.config.booksDir, entry.relPath);
    const buf = await readFile(abs);
    // A supported extension is not proof of format: a `.zip` may hold documents.
    if (handler.matches && !(await handler.matches({ relPath: entry.relPath, absPath: abs }, buf.subarray(0, 4096)))) {
      this.progress.unchanged += 1;
      return;
    }

    const parsed = await handler.parse({ relPath: entry.relPath, absPath: abs }, buf);

    // Stage 2: identical bytes with a touched mtime is not a real change.
    if (previous && previous.book_content_hash === parsed.contentHash && !this.needsReparse(previous)) {
      this.db.run('UPDATE book_files SET size = ?, mtime_ms = ?, missing = 0, parse_version = ? WHERE id = ?',
        entry.size, entry.mtimeMs, PARSE_VERSION, previous.id);
      this.progress.unchanged += 1;
      return;
    }

    await this.record(entry.relPath, parsed, previous, {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
    });
  }

  /** Index a directory book. Its change key is derived from its contents. */
  private async indexDirectory(candidate: DirectoryCandidate, previous: StoredFile | undefined): Promise<void> {
    const handler = allDirectoryHandlers().find((h) =>
      h.matches({ relPath: candidate.relPath, absPath: candidate.absPath }, []),
    );

    // `matches` is async and was already evaluated during discovery; re-resolve
    // the handler that claimed this path by asking each one again.
    const owner = handler ?? (await this.resolveDirectoryHandler(candidate));
    if (!owner) {
      this.progress.unchanged += 1;
      return;
    }

    const parsed = await owner.parse({ relPath: candidate.relPath, absPath: candidate.absPath }, []);

    if (
      previous &&
      previous.size === parsed.size &&
      previous.book_content_hash === parsed.contentHash &&
      !this.needsReparse(previous)
    ) {
      this.db.run('UPDATE book_files SET size = ?, mtime_ms = ?, missing = 0, parse_version = ? WHERE id = ?',
        parsed.size, Date.now(), PARSE_VERSION, previous.id);
      this.progress.unchanged += 1;
      return;
    }

    await this.record(candidate.relPath, parsed, previous, {
      size: parsed.size,
      mtimeMs: Date.now(),
    });
  }

  private async resolveDirectoryHandler(candidate: DirectoryCandidate) {
    const entries = await this.listDirectoryEntries(candidate.absPath);
    for (const handler of allDirectoryHandlers()) {
      try {
        if (await handler.matches({ relPath: candidate.relPath, absPath: candidate.absPath }, entries)) {
          return handler;
        }
      } catch {
        // A handler that cannot inspect this directory simply does not claim it.
      }
    }
    return null;
  }

  /** Shared book/file bookkeeping for both file and directory books. */
  private async record(
    relPath: string,
    parsed: ParsedSource,
    previous: StoredFile | undefined,
    stat: { size: number; mtimeMs: number },
  ): Promise<void> {
    // Reuse the identity this path already had, so an in-place edit updates the
    // book instead of creating a second one and orphaning the reader's progress.
    // A source that carries an identifier of its own (epub) keeps the
    // content-anchored rule, because there the identifier is authoritative.
    const storedIdentifier = previous
      ? this.db.get<{ identifier: string | null }>('SELECT identifier FROM books WHERE id = ?', previous.book_id)
          ?.identifier ?? null
      : undefined;
    const bookId = resolveBookId({
      identifier: parsed.metadata.identifier,
      contentHash: parsed.contentHash,
      previousId: previous?.book_id,
      previousIdentifier: storedIdentifier,
    });
    const existing = this.db.get<{ id: string }>('SELECT id FROM books WHERE id = ?', bookId);
    const now = Date.now();

    let coverPath: string | undefined;
    if (parsed.cover) {
      // Covers are cached in DATA_DIR, never mirrored into the read-only mount.
      coverPath = await this.persistCover(bookId, parsed.cover);
    }

    if (!existing) {
      this.insertBook(bookId, parsed, coverPath, now);
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
      this.updateBook(bookId, parsed, coverPath, now);
    }

    const fileId = computeFileId(relPath);
    if (previous) {
      this.db.run(
        'UPDATE book_files SET book_id = ?, size = ?, mtime_ms = ?, missing = 0, last_seen = ?, parse_version = ? WHERE id = ?',
        bookId, stat.size, stat.mtimeMs, now, PARSE_VERSION, previous.id,
      );
    } else {
      this.db.run(
        `INSERT INTO book_files (id, book_id, rel_path, size, mtime_ms, inode, missing, first_seen, last_seen, parse_version)
         VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?)
         ON CONFLICT(rel_path) DO UPDATE SET book_id = excluded.book_id, size = excluded.size,
           mtime_ms = excluded.mtime_ms, missing = 0, last_seen = excluded.last_seen,
           parse_version = excluded.parse_version`,
        fileId, bookId, relPath, stat.size, stat.mtimeMs, now, now, PARSE_VERSION,
      );
    }
  }

  private insertBook(bookId: string, parsed: ParsedSource, coverPath: string | undefined, now: number): void {
    const m = parsed.metadata;
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
      coverPath ?? null,
      parsed.size,
      parsed.pageCount,
      JSON.stringify({ ...m.raw, kind: parsed.kind }),
      m.source,
      now,
      now,
    );
  }

  private updateBook(bookId: string, parsed: ParsedSource, coverPath: string | undefined, now: number): void {
    const m = parsed.metadata;
    this.db.run(
      `UPDATE books SET title = ?, author = ?, publisher = ?, language = ?, isbn = ?, description = ?,
        series = ?, series_index = ?, tags = ?, pubdate = ?, page_count = ?, file_size = ?, meta_json = ?,
        cover_path = COALESCE(?, cover_path), source = ?, updated_at = ? WHERE id = ?`,
      collapseWhitespace(m.title) || fallbackTitle(parsed),
      m.author, m.publisher, m.language, m.isbn, m.description,
      m.series, m.seriesIndex, JSON.stringify(m.tags), m.pubdate,
      parsed.pageCount, parsed.size, JSON.stringify({ ...m.raw, kind: parsed.kind }),
      coverPath ?? null, m.source, now, bookId,
    );
  }

  /**
   * Whether a stored book was written by a version of the parser that is now
   * known to have been wrong.
   *
   * Without this, a parser fix cannot reach the books it was written for. The
   * change detection is content-based, and a fix changes nothing about the bytes
   * — so the scan skips exactly the files that need re-reading, and a book
   * indexed with a null page count keeps it forever. That is not hypothetical:
   * it is what the broken EPUB spine reader did to every book in a library.
   *
   * Bumping `PARSE_VERSION` invalidates the shortcut once, for every book, at the
   * cost of one full reparse. Self-hosted users do not upgrade on a schedule, so
   * the version has to travel with the row rather than with the process.
   */
  private needsReparse(previous: StoredFile): boolean {
    return previous.parse_version !== PARSE_VERSION;
  }

  /** Persists an extracted cover. Must be called outside the DB transaction. */
  async persistCover(bookId: string, cover: { data: Buffer; contentType: string }): Promise<string> {
    return saveCover(this.config.dataDir, bookId, cover);
  }
}

/** Whether a library-relative path is inside any of the given directories. */
function isInsideAny(relPath: string, directories: string[]): boolean {
  return directories.some((dir) => relPath.startsWith(`${dir}/`));
}

/**
 * Whether a file name is one the server would index as a book of its own.
 *
 * Two registry questions, not one, because a single extension can be both: a
 * loose `.jpg` is a one-page book, while the same `.jpg` inside a comic folder
 * is a page. Answering this from `supportedExtensions()` alone classified every
 * folder of scans as a shelf of books and made comic directories unreachable.
 *
 * `insideDirectoryBook` is the third case, and it is the one that made a whole
 * volume layout disappear. `.cbz` is registered as a book of its own, and it
 * genuinely is one when it sits alone in a folder — but `第01卷.cbz` next to
 * `第02卷/` is a volume of a larger series, not a book beside a shelf. Treating
 * it as a shelf told the scanner the folder held books, so the folder was never
 * offered to the comic-directory handler: not a comic by that rule, not a book by
 * any other format's, and the series vanished from the shelf with no trace.
 *
 * The caller knows the context, so the decision is passed in rather than guessed
 * here. A shelf is a folder that holds books *of another kind*; an archive whose
 * pages this format can read is page material.
 */
function isBookFileExtension(name: string, insideDirectoryBook = false): boolean {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = name.slice(dot).toLowerCase();
  if (!supportedExtensions().has(ext)) return false;
  if (isPageExtension(ext)) return false;
  if (insideDirectoryBook && isArchiveExtension(ext)) return false;
  return true;
}

/** Archive extensions a directory book reads its pages out of. */
function isArchiveExtension(ext: string): boolean {
  return ext === '.cbz' || ext === '.zip';
}

/**
 * Coarse change key for a directory book.
 *
 * mtime of a directory does not change when a file deep inside is replaced, so
 * we combine the child count with the newest child mtime. It is a heuristic, and
 * `parse()` still compares the content hash before declaring a real change.
 */
function directorySignature(
  entries: DirectoryEntry[],
  storedByPath: Map<string, StoredFile>,
  relPath: string,
): string {
  let newest = 0;
  for (const entry of entries) {
    const child = storedByPath.get(`${relPath}/${entry.name}`);
    if (child) newest = Math.max(newest, child.mtime_ms);
  }
  return `${entries.length}:${newest}`;
}

function fallbackTitle(parsed: { contentHash: string }): string {
  return `未命名 (${parsed.contentHash.slice(0, 8)})`;
}

export function contentFingerprint(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function parseTags(value: string): string[] {
  return safeJsonParse<string[]>(value, []);
}

export type { ExtractedMetadata };
