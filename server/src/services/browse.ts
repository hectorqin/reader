import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Db } from '../db/index.ts';
import type { AppConfig } from '../config/index.ts';
import { assertSafeRel, resolveInside } from '../lib/paths.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { isPageExtension, supportedExtensions } from '../indexer/formats/index.ts';

/**
 * The library as a *tree*, for the file-manager screen.
 *
 * The shelf answers "what can I read". This answers "what is on the disk" — the
 * question a reader has when a book did not show up after a rescan, and the
 * question no other part of the product can answer: a scanned book has no path
 * in its DTO, so a library that is silently missing a title is otherwise
 * unexplainable from inside the app.
 *
 * Two rules make that possible, and both are deliberate:
 *
 *  1. **Hidden entries are listed, not filtered out.** A book inside `.trash` or
 *     `@eaDir` is invisible to the scanner by design. It is also invisible here
 *     if this layer drops everything starting with a dot, which is exactly the
 *     case where the screen needs to say "it is here, and here is why the shelf
 *     cannot see it". The flags are reported instead (`hidden`, `hiddenByRule`,
 *     `scanned`), so the UI can explain rather than hide.
 *  2. **Writes go only where the mount allows them.** Every mutating call
 *     resolves the target through `resolveInside` and probes write permission
 *     before doing anything, so a read-only mount
 *     answers a clean 403 instead of an `EROFS` stack trace.
 *
 * The mount is the security boundary, and there is no second one: a user who can
 * move a file in their library can move any file in it. That is the same trust
 * level the admin scan endpoint already assumes, and inventing a per-path ACL on
 * top of it would be security theatre.
 */

/** Directories the scanner skips. Reported to the UI rather than filtered. */
export const SKIPPED_DIRS = new Set(['.git', '@eaDir', '#recycle', '.DS_Store', 'lost+found', '__MACOSX']);

/** Never offered for listing: they stay reachable by name, never by discovery. */
const VCS_DIRS = new Set(['.git', '.svn', '.hg']);

export interface BrowseEntry {
  name: string;
  /** Library-relative path; the id the UI passes back for every operation. */
  path: string;
  type: 'dir' | 'file' | 'other';
  size: number;
  mtime: number;
  /** Unix mode bits, so the UI can show `-r--r--r--` for a read-only mount. */
  mode: number;
  /** Leading dot: a convention, and the reason a book can be missing. */
  hidden: boolean;
  /** Inside a directory the scanner never descends into. */
  hiddenByRule: boolean;
  /** The scanner indexes this path as a book of its own. */
  scanned: boolean;
  /** Suffix after the last dot, lowercased, without the dot. */
  ext: string;
  /** True when this path is what the index actually holds for that book. */
  indexed: boolean;
  /**
   * Whether the *caller's* shelf holds the book at this path.
   *
   * `null` for a path that is not an indexed book at all (a folder, a stray
   * `.nfo`, an archive's page image), because "not on your shelf" would be a
   * category error for a row that is not a book.
   *
   * This exists because the library screen could describe what is on the *disk*
   * and not what is on the *shelf*, and the two are different sets the moment a
   * reader takes a book off their shelf. Without it the file manager offered only
   * "下架" — an action for a book that is on the shelf — with no way to see that a
   * book was off it, and no way to put one back: the reader's only route to
   * restoring a book was to guess, select it, and hope.
   *
   * It is per-caller rather than a property of the entry, so it is filled in by
   * `list` when the caller supplies a user id.
   */
  shelfState: 'on' | 'off' | null;
}

export interface BrowseListing {
  /** Library-relative path of the directory listed; `''` for the root. */
  path: string;
  /** Breadcrumb segments, each with the path that reaches it. */
  crumbs: Array<{ name: string; path: string }>;
  parent: string | null;
  /**
   * This page of the directory's entries.
   *
   * Paginated on the server rather than in the client, because a directory here is
   * a *filesystem* and can hold anything: a `漫画` folder with four thousand scans
   * is a real library, and sending four thousand rows so the browser can throw 3,940
   * of them away is the request that makes the screen feel broken. The `total`
   * below is what the pager is drawn from, so the two have to be one response.
   */
  entries: BrowseEntry[];
  /** Totals for the *directory*, not for this page of it. */
  total: number;
  dirs: number;
  files: number;
  size: number;
  /** Whether the process may create, rename and delete inside it. */
  writable: boolean;
  /** `''` for the root, otherwise the folder's own name. */
  name: string;
}

export interface BrowseMoveResult {
  moved: number;
  /** Rows rewritten because the target path was already indexed under another book. */
  merged: number;
  target: string;
}

export interface BatchResult {
  /** Rows changed; a folder counts once per book inside it. */
  applied: number;
  /** Distinct book ids touched, so the client can refresh exactly those. */
  books: string[];
  /** Paths that could not be acted on, with the reason. */
  failed: Array<{ path: string; reason: string }>;
}

function emptyBatch(): BatchResult {
  return { applied: 0, books: [], failed: [] };
}

/** What a batch operation needs from the shelf: the override layer. */
export interface MetadataWriter {
  setOverrides(bookId: string, patch: Record<string, unknown>, userId: string): void;
}

/**
 * Entries per page of a directory listing.
 *
 * 200 is a compromise between two failures. Too small and a folder of images is
 * thirty pages of nothing, which makes the pager the thing the reader fights
 * instead of the list. Too large and the first paint of a big folder waits on a
 * response that is mostly rows nobody will look at — and the reader who is
 * *lost* in a four-thousand-file folder is exactly the one who needs it to appear
 * at once.
 *
 * It is not a hard limit on the request: a client may ask for less (a test, a
 * future phone view) and the server honours it, up to a ceiling, so a caller
 * cannot turn one request into the four-thousand-row response this exists to
 * avoid.
 */
export const BROWSE_PAGE_SIZE = 200;
const BROWSE_PAGE_SIZE_MAX = 1000;

export class BrowseService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    /**
     * The manual-override layer, injected rather than imported.
     *
     * Batch metadata edits are the one thing here that is about *books* rather
     * than files, and the override rules (which fields are editable, that a
     * manual value is never auto-overwritten) live in the shelf service. Taking
     * it as a collaborator keeps one implementation of them; reaching into the
     * table directly would be a second.
     */
    private readonly metadata: MetadataWriter,
  ) {}

  // ---- reads ----

  list(relPathInput: string, page = 1, pageSize = BROWSE_PAGE_SIZE, userId?: string): Promise<BrowseListing> {
    return this.listSync(relPathInput, page, pageSize, userId);
  }

  private async listSync(relPathInput: string, page: number, pageSize: number, userId?: string): Promise<BrowseListing> {
    const relPath = relPathInput === '' ? '' : assertSafeRel(relPathInput);
    const abs = resolveInside(this.config.booksDir, relPath);
    const info = await stat(abs).catch(() => null);
    if (!info) throw notFound('no such directory', 'DIR_NOT_FOUND');
    if (!info.isDirectory()) throw badRequest('not a directory', 'NOT_A_DIRECTORY');

    const dirEntries = await readdir(abs, { withFileTypes: true });
    const entries: BrowseEntry[] = [];
    for (const entry of dirEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = relPath === '' ? entry.name : `${relPath}/${entry.name}`;
      if (VCS_DIRS.has(entry.name)) continue;
      const childAbs = resolveInside(this.config.booksDir, childRel);
      // `lstat`: a symlink is shown as a link, never followed. The scanner does
      // not follow them either, so following one here would describe a tree the
      // index does not have — and would let a link out of the mount be walked.
      const child = await lstat(childAbs).catch(() => null);
      if (!child) continue;
      entries.push({
        name: entry.name,
        path: childRel,
        type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other',
        size: child.isDirectory() ? 0 : child.size,
        mtime: Math.floor(child.mtimeMs),
        mode: child.mode & 0o777,
        hidden: entry.name.startsWith('.'),
        hiddenByRule: entry.isDirectory()
          ? SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')
          : SKIPPED_DIRS.has(entry.name),
        scanned: entry.isFile() && this.isBookFile(entry.name),
        ext: extensionOf(entry.name),
        indexed: Boolean(this.fileRow(childRel)),
        // Filled in by the pass below, which is the only place that knows the
        // caller: `listSync` does not take a user id when it is called from
        // `upload`'s own destination probe.
        shelfState: null,
      });
    }

    /*
     * The shelf flag, resolved in one query for the whole page.
     *
     * Asked per row it would be one query per file in a folder of four thousand
     * scans — on the read path of the screen that exists because reading the disk
     * is slow. The map is built from a single `IN`, and a path whose book has no
     * `user_books` row (or has `hidden = 1`) is `'off'`: the shelf's own predicate
     * is `hidden = 0`, and being off the shelf and being hidden are the same state
     * seen from opposite ends.
     */
    if (userId) {
      const bookIdsByPath = new Map<string, string>();
      const indexedPaths = entries.filter((entry) => entry.indexed).map((entry) => entry.path);
      if (indexedPaths.length > 0) {
        const fileRows = this.db.all<{ rel_path: string; book_id: string }>(
          `SELECT rel_path, book_id FROM book_files WHERE rel_path IN (${indexedPaths.map(() => '?').join(',')})`,
          ...indexedPaths,
        );
        for (const row of fileRows) bookIdsByPath.set(row.rel_path, row.book_id);
      }
      const onShelf = new Set<string>();
      const bookIds = [...new Set(bookIdsByPath.values())];
      if (bookIds.length > 0) {
        const rows = this.db.all<{ book_id: string }>(
          `SELECT book_id FROM user_books
           WHERE user_id = ? AND hidden = 0 AND book_id IN (${bookIds.map(() => '?').join(',')})`,
          userId, ...bookIds,
        );
        for (const row of rows) onShelf.add(row.book_id);
      }
      for (const entry of entries) {
        const bookId = bookIdsByPath.get(entry.path);
        if (bookId === undefined) continue;
        // A folder's own `shelfState` stays null: the flag describes the row the
        // reader can tap, and a folder is not a book even when the books inside it
        // are on the shelf. Selection acts on the path, and `batchShelf` already
        // fans a folder out to the books under it.
        if (entry.type !== 'dir') entry.shelfState = onShelf.has(bookId) ? 'on' : 'off';
      }
    }

    /*
     * The counts describe the whole directory; `entries` is one page of it.
     *
     * Both are computed from the same walk, which is the only way they can be
     * consistent: computing the total separately (a second `readdir`, or a cached
     * count) would let the summary and the pager disagree with the rows under them
     * after any change on disk, and the reader has no way to tell which of the three
     * is the stale one.
     */
    const stats = {
      total: entries.length,
      dirs: entries.filter((entry) => entry.type === 'dir').length,
      files: entries.filter((entry) => entry.type === 'file').length,
      size: entries.reduce((sum, entry) => sum + entry.size, 0),
    };
    const size = Math.min(BROWSE_PAGE_SIZE_MAX, Math.max(1, pageSize));
    const offset = (Math.max(1, page) - 1) * size;

    return {
      path: relPath,
      crumbs: crumbsFor(relPath),
      parent: relPath === '' ? null : dirname(relPath).replace(/^\.$/, ''),
      entries: entries.slice(offset, offset + size),
      ...stats,
      writable: await this.writable(abs),
      name: relPath === '' ? '' : basename(relPath),
    };
  }

  /**
   * Whether the mount can be written at all.
   *
   * Answered by actually creating a file rather than by looking at the mode
   * bits, because the two disagree in every deployment that matters: a
   * read-only bind mount shows `drwxr-xr-x` and still refuses `EPERM`. Probe on
   * demand rather than cache: a mount is remounted far more often than this is
   * called, and a stale "not writable" would disable the whole screen.
   */
  async writable(abs = this.config.booksDir): Promise<boolean> {
    const probe = join(abs, `.reader-write-probe-${randomUUID().slice(0, 8)}`);
    try {
      await mkdir(probe);
      await rm(probe, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  private isBookFile(name: string): boolean {
    const ext = extensionOf(name);
    if (!ext) return false;
    if (!supportedExtensions().has(`.${ext}`)) return false;
    return !isPageExtension(ext);
  }

  private fileRow(relPath: string): { id: string; book_id: string; missing: number } | undefined {
    return this.db.get<{ id: string; book_id: string; missing: number }>(
      'SELECT id, book_id, missing FROM book_files WHERE rel_path = ?',
      relPath,
    );
  }

  // ---- writes ----

  /**
   * Moves or renames a batch of paths into a directory.
   *
   * A rename inside the same mount keeps `mtime`, `inode` and — crucially —
   * the file's bytes unchanged, so the scanner sees an unchanged file and the
   * book keeps its identity, its progress and its notes. That is the whole
   * reason this is a `rename` rather than a copy-and-delete, and it is also why
   * a move onto an already-indexed path can be resolved as a merge: two rows,
   * one set of bytes.
   */
  async move(paths: string[], targetInput: string): Promise<BrowseMoveResult> {
    if (paths.length === 0) throw badRequest('no paths given', 'NO_PATHS');
    const target = targetInput === '' ? '' : assertSafeRel(targetInput);
    const targetAbs = resolveInside(this.config.booksDir, target);
    const targetInfo = await stat(targetAbs).catch(() => null);
    if (!targetInfo?.isDirectory()) throw badRequest('target is not a directory', 'NOT_A_DIRECTORY');

    // Refuse the whole batch rather than half of it: a partially applied move is
    // far harder to reason about than a refused one.
    for (const input of paths) {
      const source = assertSafeRel(input);
      // `target` inside `source` is the one arrangement a rename cannot express:
      // the destination is inside the thing being moved. Asked as "is the target
      // under the source", which is the opposite question from containment.
      if (source !== '' && this.isInside(source, target)) throw badRequest('cannot move a directory into itself', 'MOVE_INTO_SELF');
      const abs = resolveInside(this.config.booksDir, source);
      if (!(await stat(abs).catch(() => null))) throw notFound(`no such path: ${source}`, 'PATH_NOT_FOUND');
    }

    let moved = 0;
    let merged = 0;
    for (const input of paths) {
      const source = assertSafeRel(input);
      const destination = target === '' ? basename(source) : `${target}/${basename(source)}`;
      if (destination === source) continue;
      const destinationAbs = resolveInside(this.config.booksDir, destination);
      const existing = await stat(destinationAbs).catch(() => null);
      if (existing) {
        // Two outcomes are both correct here and only the caller knows which was
        // meant, so it is refused instead of guessed: a merge would be
        // indistinguishable from data loss if the reader expected an error.
        throw conflict(`target already has an entry named ${basename(source)}`, 'DESTINATION_EXISTS');
      }
      await this.guardWrite(resolveInside(this.config.booksDir, source));
      await mkdir(dirname(destinationAbs), { recursive: true });
      await rename(resolveInside(this.config.booksDir, source), destinationAbs);
      this.rewritePaths(source, destination);
      merged += 1;
      moved += 1;
    }
    return { moved, merged, target };
  }

  /** Renames one path in place. `newName` is a single segment, not a path. */
  async renamePath(pathInput: string, newName: string): Promise<{ path: string }> {
    const source = assertSafeRel(pathInput);
    const name = newName.trim();
    if (!name) throw badRequest('name is required', 'NAME_REQUIRED');
    if (name.includes('/') || name.includes('\\')) throw badRequest('name must not contain a slash', 'BAD_NAME');
    if (name === '.' || name === '..') throw badRequest('invalid name', 'BAD_NAME');
    const parent = dirname(source).replace(/^\.$/, '');
    const destination = parent === '' ? name : `${parent}/${name}`;
    if (destination === source) return { path: source };

    const sourceAbs = resolveInside(this.config.booksDir, source);
    const destinationAbs = resolveInside(this.config.booksDir, destination);
    if (!(await lstat(sourceAbs).catch(() => null))) throw notFound('no such path', 'PATH_NOT_FOUND');
    if (await lstat(destinationAbs).catch(() => null)) throw conflict('target name is taken', 'DESTINATION_EXISTS');
    await this.guardWrite(sourceAbs);
    await rename(sourceAbs, destinationAbs);
    this.rewritePaths(source, destination);
    return { path: destination };
  }

  async createDirectory(parentInput: string, name: string): Promise<{ path: string }> {
    const parent = parentInput === '' ? '' : assertSafeRel(parentInput);
    const trimmed = name.trim();
    if (!trimmed) throw badRequest('name is required', 'NAME_REQUIRED');
    if (trimmed.includes('/') || trimmed.includes('\\')) throw badRequest('name must not contain a slash', 'BAD_NAME');
    const relPath = parent === '' ? trimmed : `${parent}/${trimmed}`;
    const abs = resolveInside(this.config.booksDir, relPath);
    if (await lstat(abs).catch(() => null)) throw conflict('already exists', 'DESTINATION_EXISTS');
    await this.guardWrite(resolveInside(this.config.booksDir, parent));
    await mkdir(abs, { recursive: false });
    return { path: relPath };
  }

  /**
   * Deletes paths, recursively, without invoking the scanner.
   *
   * The index rows stay until the next scan. That is not laziness: the deletion
   * is already the risky half, and coupling it to a full rescan would make the
   * UI wait minutes to report success. A marked-missing row also keeps the count
   * honest — the same "file is gone but the book is remembered" state a book on
   * an unmounted share is in.
   */
  async remove(paths: string[]): Promise<{ removed: number }> {
    if (paths.length === 0) throw badRequest('no paths given', 'NO_PATHS');
    for (const input of paths) {
      const relPath = assertSafeRel(input);
      const abs = resolveInside(this.config.booksDir, relPath);
      if (!(await lstat(abs).catch(() => null))) throw notFound(`no such path: ${relPath}`, 'PATH_NOT_FOUND');
    }
    let removed = 0;
    for (const input of paths) {
      const relPath = assertSafeRel(input);
      const abs = resolveInside(this.config.booksDir, relPath);
      await this.guardWrite(abs);
      await rm(abs, { recursive: true, force: true });
      removed += 1;
    }
    return { removed };
  }

  /**
   * Validates a destination directory for an upload, without touching the disk.
   *
   * Split out from `list`/`move` because an upload's destination arrives as a
   * form *field* before any bytes do, and the answer has to be a refusal rather
   * than a per-file "skipped" note: a path that escapes the library is a bad
   * request, not a bad file.
   */
  assertDestination(input: string): string {
    if (input === '') return '';
    const rel = assertSafeRel(input);
    return rel;
  }

  // ---- batch management ----

  /**
   * Applies one metadata patch to many paths at once.
   *
   * Written as a batch because the manual-override layer is per *book*, and a
   * library is organised in batches: forty volumes that arrived as `佚名` want
   * one author between them, not forty dialogs. The loop lives here rather than
   * in the client for the reason every other write does — the mapping from path
   * to book id is the server's, and a client that guessed it would be a second
   * implementation of the index.
   *
   * A path that is not a book is reported, not refused: selecting a folder and a
   * stray `.nfo` alongside the books is ordinary, and the caller can say "已更新
   * 12 本，跳过 2 项" instead of failing the whole operation.
   */
  batchMetadata(paths: string[], fields: Record<string, unknown>, userId: string): BatchResult {
    if (paths.length === 0) throw badRequest('no paths given', 'NO_PATHS');
    const result = emptyBatch();
    for (const input of paths) {
      const relPath = assertSafeRel(input);
      const bookIds = this.booksUnder(relPath);
      if (bookIds.length === 0) {
        result.failed.push({ path: relPath, reason: 'NOT_A_BOOK' });
        continue;
      }
      for (const bookId of bookIds) {
        this.metadata.setOverrides(bookId, fields, userId);
        result.applied += 1;
        result.books.push(bookId);
      }
    }
    result.books = [...new Set(result.books)];
    return result;
  }

  /**
   * Adds or removes many paths on the caller's shelf.
   *
   * Distinct from the file manager's own operations in the way that matters: it
   * changes nothing on disk. "Hide these forty scans from my shelf" and "move
   * these forty scans into a folder" look similar in a list of rows and could not
   * be more different in consequence, so they are different endpoints.
   */
  batchShelf(paths: string[], action: 'add' | 'remove' | 'hide' | 'unhide', userId: string): BatchResult {
    if (paths.length === 0) throw badRequest('no paths given', 'NO_PATHS');
    const result = emptyBatch();
    const now = Date.now();
    for (const input of paths) {
      const relPath = assertSafeRel(input);
      const bookIds = this.booksUnder(relPath);
      if (bookIds.length === 0) {
        result.failed.push({ path: relPath, reason: 'NOT_A_BOOK' });
        continue;
      }
      for (const bookId of bookIds) {
        this.setShelfState(bookId, userId, action, now);
        result.applied += 1;
        result.books.push(bookId);
      }
    }
    result.books = [...new Set(result.books)];
    return result;
  }

  /**
   * The same two writes, addressed by *book id*.
   *
   * ## Why this exists, and why it is the fix for 「找不到「xxx」在磁盘上的路径」
   *
   * A shelf card holds a `Book`: an id, and whatever the scanner recorded about it.
   * The write endpoint takes *library paths*. The client used to bridge the gap by
   * listing the library root and matching the two by filename stem, which is a join
   * that only works when the book's title happens to be its filename:
   *
   *  - a book whose metadata title was renamed by hand (`半小时漫画宇宙大爆炸（半小时读完
   *    138亿年宇宙史，一口气搞懂大爆炸、奇点、黑洞、引力波、暗物质……混子哥陈磊新作！）`)
   *    carries a title nothing on disk is called, so the lookup finds nothing;
   *  - a book in a subfolder, or past page one of the root, is not in the listing the
   *    lookup ever read;
   *  - and when the lookup failed the reader was told the book could not be *found*,
   *    after having asked for it to be taken off their own shelf.
   *
   * The mapping the client was guessing at already exists here: `book_files` names
   * the path for every id. So the client sends the id it has, and the answer cannot
   * depend on what the file is called.
   *
   * A path is *not* accepted as a synonym: an id that names no book is reported as
   * the failure it is, rather than resolved to some path by luck.
   */
  batchShelfByBookIds(bookIds: string[], action: 'add' | 'remove' | 'hide' | 'unhide', userId: string): BatchResult {
    if (bookIds.length === 0) throw badRequest('no book ids given', 'NO_BOOK_IDS');
    const result = emptyBatch();
    const now = Date.now();
    for (const input of bookIds) {
      if (typeof input !== 'string' || input.length === 0) {
        throw badRequest('bookIds must contain strings', 'BAD_BOOK_ID');
      }
      /*
       * Local files belong to the shared library. Downloads require the caller's
       * acquisition record, and chapter publications require ownership.
       * None of these paths grants private content access from an id alone.
       */
      const file = this.db.get<{ book_id: string }>(
        `SELECT book_id FROM book_files WHERE book_id = ? AND missing = 0
         UNION SELECT f.book_id FROM acquired_files f
           JOIN source_acquisitions a ON a.book_id = f.book_id
           WHERE f.book_id = ? AND a.user_id = ?
         UNION SELECT book_id FROM chapter_publications WHERE book_id = ? AND user_id = ? LIMIT 1`,
        input, input, userId, input, userId,
      );
      if (!file) {
        result.failed.push({ path: input, reason: 'NO_LIVE_FILE' });
        continue;
      }
      this.setShelfState(file.book_id, userId, action, now);
      result.applied += 1;
      result.books.push(file.book_id);
    }
    result.books = [...new Set(result.books)];
    return result;
  }

  /**
   * The book ids a library path stands for.
   *
   * A file path is one book. A *folder* stands for everything the scanner
   * indexed inside it, which is what makes "fix the metadata of this series"
   * one action: the series folder holds forty volume files and no rows of its
   * own, so asking for the folder's own row would find nothing.
   */
  private booksUnder(relPath: string): string[] {
    const own = this.fileRow(relPath);
    if (own) return [own.book_id];
    const rows = this.db.all<{ book_id: string }>(
      'SELECT DISTINCT book_id FROM book_files WHERE rel_path LIKE ?',
      `${escapeLike(relPath)}/%`,
    );
    return rows.map((row) => row.book_id);
  }

  /**
   * The two directions, with the aliases folded in.
   *
   * `add`/`unhide` and `remove`/`hide` are the same two writes under two names.
   * The aliases date from when the API was going to distinguish "put it on my
   * shelf" from "stop hiding it"; there is only one flag, so there is only one
   * pair of operations, and a second name for each is kept because dropping a
   * documented value is a breaking change. They are normalised here, at the one
   * place that writes, so the rest of the method reasons about two cases.
   */
  private setShelfState(bookId: string, userId: string, action: 'add' | 'remove' | 'hide' | 'unhide', now: number): void {
    if (action === 'add' || action === 'unhide') {
      /*
       * `add` (and its synonym `hide`... see below) both *create* the row if it is
       * absent and *clear the flag* if it is present.
       *
       * The upsert is the whole fix for the reported "书库的书不再自动加入书架，
       * 需要手动加入". `add` used to be a bare `INSERT OR IGNORE`, which reads as
       * "add it if it is not already there" and behaves as "do nothing" in the one
       * case that matters: a book the reader had previously taken off the shelf
       * already *has* a `user_books` row — the row `remove` wrote with `hidden = 1`
       * precisely so the removal would be reversible — so `OR IGNORE` skipped it
       * and the book stayed hidden. Selecting a book, choosing "加入书架", and
       * watching it not appear is the exact shape of "需要手动加入，但加了也没用".
       *
       * `added_at` is refreshed only when the row is actually being re-added, so
       * "最近入库" keeps meaning "when I first got this book" for a book that never
       * left, and means "now" for one that did.
       */
      this.db.run(
        `INSERT INTO user_books (user_id, book_id, added_at, hidden) VALUES (?,?,?,0)
         ON CONFLICT(user_id, book_id) DO UPDATE SET hidden = 0,
           added_at = CASE WHEN user_books.hidden = 1 THEN excluded.added_at ELSE user_books.added_at END`,
        userId, bookId, now,
      );
      return;
    }
    // `remove` keeps the row: `hidden` rather than a delete, so the book stays in
    // the library and stays indexed and the reader can put it back. Deleting the
    // row would look identical on the shelf and be irreversible.
    this.db.run('UPDATE user_books SET hidden = 1 WHERE user_id = ? AND book_id = ?', userId, bookId);
    /*
     * And it *creates* the row when there is none.
     *
     * A book the reader never added, then took off a shelf it was never on, has no
     * row; without this insert the "off the shelf" state would have nowhere to live
     * and the book would come back on the next page load — the shelf's predicate is
     * `hidden = 0`, and a missing row is not hidden.
     */
    this.db.run(
      'INSERT OR IGNORE INTO user_books (user_id, book_id, added_at, hidden) VALUES (?,?,?,1)',
      userId, bookId, now,
    );
  }

  /**
   * Turns an `EPERM`/`EROFS`/`EACCES` from the filesystem into a clean 403.
   *
   * A probe is cheaper to reason about than inferring from the error alone: the
   * permission that matters is on the *parent* (unlink needs the directory), and
   * that is not the path the caller passed.
   */
  private async guardWrite(absPath: string): Promise<void> {
    const parent = dirname(absPath);
    const parentOk = await this.writable(parent === absPath ? absPath : parent);
    if (parentOk) return;
    throw forbidden(
      'the library mount is read-only; remount it without `:ro` to manage files here',
      'READ_ONLY_MOUNT',
    );
  }

  /** Whether `child` is `parent` itself or lives underneath it. */
  private isInside(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`);
  }

  /**
   * Repoints the index at a path that moved, in one transaction.
   *
   * Nothing else has to run: the book's identity is `identifier + content hash`,
   * so a renamed file *is* the same book — the row only has to stop pointing at
   * a path that no longer exists. Doing it here rather than waiting for a scan
   * is what keeps progress and notes attached while the file manager is open.
   *
   * The one case that needs care is a move onto a path the index already holds
   * under a *different* book — which happens whenever a library was reorganised
   * outside the app and scanned in between. The two rows then name one file, and
   * `rel_path` is UNIQUE, so the stale row is dropped and its user state is
   * carried over rather than left pointing at a book with no file.
   */
  private rewritePaths(from: string, to: string): void {
    const rows = this.db.all<{ id: string; book_id: string; rel_path: string }>(
      'SELECT id, book_id, rel_path FROM book_files WHERE rel_path = ? OR rel_path LIKE ?',
      from,
      `${escapeLike(from)}/%`,
    );
    for (const row of rows) {
      const next = row.rel_path === from ? to : `${to}${row.rel_path.slice(from.length)}`;
      const clash = this.db.get<{ id: string; book_id: string }>(
        'SELECT id, book_id FROM book_files WHERE rel_path = ? AND id <> ? AND missing = 0',
        next,
        row.id,
      );
      if (clash && clash.book_id !== row.book_id) {
        this.adoptUserState(clash.book_id, row.book_id);
        this.db.run('DELETE FROM book_files WHERE id = ?', clash.id);
      }
      this.db.run('UPDATE book_files SET rel_path = ?, missing = 0 WHERE id = ?', next, row.id);
    }
  }

  /** Moves per-user state from a duplicate book onto the one that survives. */
  private adoptUserState(fromBookId: string, toBookId: string): void {
    this.db.run(
      `INSERT OR IGNORE INTO user_books (user_id, book_id, added_at)
       SELECT user_id, ?, added_at FROM user_books WHERE book_id = ?`,
      toBookId,
      fromBookId,
    );
    // Newest progress wins, which is the same last-writer-wins rule sync applies.
    this.db.run(
      `INSERT INTO reading_progress (user_id, book_id, locator, percentage, chapter_title, device, updated_at)
       SELECT user_id, ?, locator, percentage, chapter_title, device, updated_at
       FROM reading_progress WHERE book_id = ?
       ON CONFLICT(user_id, book_id) DO UPDATE SET
         locator = excluded.locator, percentage = excluded.percentage,
         chapter_title = excluded.chapter_title, device = excluded.device,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > reading_progress.updated_at`,
      toBookId,
      fromBookId,
    );
    this.db.run('UPDATE notes SET book_id = ? WHERE book_id = ?', toBookId, fromBookId);
  }

}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function crumbsFor(relPath: string): Array<{ name: string; path: string }> {
  const crumbs: Array<{ name: string; path: string }> = [{ name: '书库', path: '' }];
  if (!relPath) return crumbs;
  const parts = relPath.split('/');
  let acc = '';
  for (const part of parts) {
    acc = acc === '' ? part : `${acc}/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

/** LIKE-escape, so a folder named `100%` cannot widen the prefix match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
