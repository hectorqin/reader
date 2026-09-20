import type { Db } from '../db/index.ts';
import { applyOverrides, type BaseMetadata } from './merge.ts';
import { safeJsonParse } from '../lib/text.ts';
import { notFound } from '../lib/errors.ts';

export interface BookDto {
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
  /** Which fields the user overrode by hand; lets the UI offer an undo. */
  manualFields: string[];
  /**
   * When the file last changed on disk.
   *
   * Distinct from `addedAt`, and the shelf offers both: "最近更新" answers "which
   * book did I just replace with a better scan", "最近入库" answers "which book did
   * I just acquire". Collapsing them would answer neither.
   */
  updatedAt: number;
  /**
   * When this account first saw the book.
   *
   * Exposed because the client sorts its own cached shelf while offline, and a
   * sort key it does not have is a sort it cannot reproduce — which would make the
   * order change the moment a phone lost its connection.
   */
  addedAt: number;
  /**
   * Whether *this account's* shelf holds the book.
   *
   * Only answered when the caller asked for the **library** rather than the shelf
   * (`scope: 'library'`, which is what the library's browsing page asks for): on the
   * shelf the answer is "on" for every row by construction, and a field that is
   * always true is a field a client will eventually draw.
   *
   * It exists because the browsing page could describe a *folder* and not the
   * reader's relationship to it, so the one screen whose job is "here is what is in
   * the library, add it to your shelf" could not say which of the two a card was.
   */
  shelfState?: 'on' | 'off';
}

interface BookRow {
  id: string;
  /** `user_books.added_at`; selected alongside the book's own columns. */
  added_at?: number;
  /** `user_books.hidden`, or `null` when there is no row at all. */
  shelf_hidden?: number | null;
  identifier: string | null;
  content_hash: string;
  format: string;
  title: string;
  author: string;
  publisher: string;
  language: string;
  isbn: string;
  description: string;
  series: string;
  series_index: number | null;
  tags: string;
  pubdate: string;
  cover_path: string | null;
  file_size: number;
  page_count: number | null;
  source: string;
  updated_at: number;
}

const BOOK_COLUMNS = `id, identifier, content_hash, format, title, author, publisher, language, isbn,
  description, series, series_index, tags, pubdate, cover_path, file_size, page_count, source, updated_at`;

export interface ListOptions {
  search?: string;
  author?: string;
  series?: string;
  tag?: string;
  format?: string;
  sort?: 'title' | 'author' | 'added' | 'updated';
  order?: 'asc' | 'desc';
  /**
   * Restrict the list to books that have a file inside this folder.
   *
   * Library-relative and recursive: `''` is the whole library, `'科幻'` is that
   * folder and everything under it. Prefix matching on `rel_path` rather than a
   * join against a folder table, because the folder tree is the filesystem's and
   * the scanner does not keep a second copy of it.
   *
   * This is what makes the library screen's *preview* page possible without a new
   * endpoint: the page is a grid of books, and "books" is the one shape this DTO
   * has. A client that asked `/library/browse` for a folder and rendered its file
   * rows as covers would be showing filenames where titles go, and would be missing
   * every book whose cover lives inside its own archive.
   */
  path?: string;
  /**
   * Which set to list: the reader's shelf, or the library's index.
   *
   * The shelf is the default and the only thing the shelf screen ever wants. The
   * library is what the browsing page asks for — every indexed book inside a folder,
   * with `BookDto.shelfState` saying whether this account has it — which is the only
   * way a page whose purpose is 「把这本书加入书架」 can be shown a book that is not
   * on the shelf yet.
   */
  scope?: 'shelf' | 'library';
  page?: number;
  pageSize?: number;
}

/**
 * Escapes the two characters `LIKE` treats specially.
 *
 * `%` and `_` are legal in a filename and both are wildcards; a folder called
 * `100%` would otherwise match `1000 books` as well. The escape character itself
 * has to be escaped first, or escaping `%` would produce `\\%` which then means a
 * literal backslash followed by any run.
 */
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export class ShelfService {
  constructor(private readonly db: Db) {}

  /**
   * Books visible to a user. Only rows that still have a live file are
   * returned, so a book whose file was deleted disappears from the shelf even
   * if its progress row survives for a later restore.
   */
  list(userId: string, options: ListOptions = {}): { items: BookDto[]; total: number; page: number; pageSize: number } {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));
    /*
     * Two scopes, and the difference is *which set* the reader is asking about.
     *
     *  - **`shelf`** (the default) is "what can I read": a `user_books` row that is
     *    not hidden, and a live file behind it.
     *  - **`library`** is "what is in the folder": every indexed book with a live
     *    file, whether or not this account has it on their shelf, each row carrying
     *    `shelfState`.
     *
     * `library` exists because the browsing page could only ever list books that
     * were *already* on the shelf — it read this same endpoint — so its 「加入书架」
     * control was drawn from a set that could not contain an off-shelf book, i.e.
     * the one action the page exists for could never appear. Reading the index
     * instead is what makes "这个文件夹里的书" true of the folder rather than of the
     * reader's shelf.
     *
     * The `user_books` join is a `LEFT JOIN` in that scope rather than no join at
     * all: `added_at` is the 最近入库 sort key and `hidden` is the flag behind
     * `shelfState`, and a *missing* row and a `hidden = 1` row are the same answer
     * to the reader ("not on my shelf") arriving by two different routes.
     */
    const scope = options.scope ?? 'shelf';
    const library = scope === 'library';
    const where: string[] = library
      ? ['EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)']
      : ['ub.user_id = ?', 'ub.hidden = 0', 'EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)'];
    const params: Array<string | number> = library ? [] : [userId];

    if (options.search) {
      where.push('(b.title LIKE ? OR b.author LIKE ? OR b.series LIKE ? OR b.isbn = ?)');
      const like = `%${options.search}%`;
      params.push(like, like, like, options.search);
    }
    if (options.author) {
      where.push('b.author = ?');
      params.push(options.author);
    }
    if (options.series) {
      where.push('b.series = ?');
      params.push(options.series);
    }
    if (options.format) {
      where.push('b.format = ?');
      params.push(options.format);
    }
    if (options.tag) {
      // Tags are stored as a JSON array; substring matching is sufficient here
      // and avoids a join table that would complicate the sync payload.
      where.push('b.tags LIKE ?');
      params.push(`%"${options.tag}"%`);
    }
    if (options.path) {
      /*
       * A folder filter, and the only place `rel_path` is matched by prefix.
       *
       * `LIKE 'dir/%'` rather than `LIKE '%dir%'`: the segment boundary matters, so
       * that a folder named 科学 does not drag in 科幻科学 and a file called
       * `dir.txt` is not inside the folder `dir`. `escapeLike` handles the two
       * characters that are wildcards in SQL and legal in a filename, and the
       * backslash escape is stated explicitly rather than left to whatever the
       * engine's default happens to be.
       *
       * The path is normalised to have no trailing slash first, so `'科幻/'` and
       * `'科幻'` are one filter and not two.
       */
      const prefix = options.path.replace(/\/+$/, '');
      where.push(`EXISTS (
        SELECT 1 FROM book_files f
        WHERE f.book_id = b.id AND f.missing = 0 AND f.rel_path LIKE ? ESCAPE '\\'
      )`);
      params.push(`${escapeLike(prefix)}/%`);
    }

    const sortColumn = {
      title: 'b.title',
      author: 'b.author',
      added: 'ub.added_at',
      updated: 'b.updated_at',
    }[options.sort ?? 'added'];
    const order = options.order === 'asc' ? 'ASC' : 'DESC';
    const whereSql = where.join(' AND ');
    /*
     * Sorting by `added` in library scope sorts on `ub.added_at`, which is `NULL` for a
     * book the reader has no `user_books` row for — and that is the right order:
     * `NULL` is the smallest value, so `DESC` puts the never-shelved books *last*,
     * which is the honest place for a book that has never been 「入库」 for this reader.
     * `BookDto.addedAt` still falls back to the book's own timestamp so the field is
     * never zero, but the *order* is the shelf's, not the file's.
     */
    const orderColumn = sortColumn;
    const join = library
      ? 'LEFT JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = ?'
      : 'JOIN user_books ub ON ub.book_id = b.id';
    const joinParams: Array<string | number> = library ? [userId] : [];
    /*
     * `hidden` is selected only in library scope: on the shelf every row is
     * `hidden = 0` by construction, and a selected constant would become a field the
     * client reads as if it could say something.
     */
    const shelfColumn = library ? ', ub.hidden AS shelf_hidden' : '';

    const totalRow = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM books b ${join} WHERE ${whereSql}`,
      ...joinParams, ...params,
    );

    const rows = this.db.all<BookRow>(
      `SELECT ${BOOK_COLUMNS.split(',').map((c) => `b.${c.trim()}`).join(', ')}, ub.added_at${shelfColumn}
       FROM books b ${join}
       WHERE ${whereSql}
       ORDER BY ${orderColumn} ${order}, b.title ASC
       LIMIT ? OFFSET ?`,
      ...joinParams, ...params, pageSize, (page - 1) * pageSize,
    );

    return { items: rows.map((row) => this.toDto(row)), total: totalRow?.n ?? 0, page, pageSize };
  }

  get(userId: string, bookId: string): BookDto {
    const row = this.db.get<BookRow>(
      `SELECT ${BOOK_COLUMNS} FROM books WHERE id = ?`,
      bookId,
    );
    if (!row) throw notFound('book not found');
    const visible = this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM user_books WHERE user_id = ? AND book_id = ? AND hidden = 0',
      userId, bookId,
    );
    if (!visible?.n) throw notFound('book not found');
    return this.toDto(row);
  }

  /**
   * Several books by id, in one round trip, as a map.
   *
   * The `user_books` join is applied for the same reason `get` applies it: an id
   * the caller holds is not proof that *this* user may see the book, and a helper
   * that skipped the check would be the one place in the service where an id alone
   * was enough.
   *
   * Missing or invisible ids are simply absent from the map rather than an error:
   * the callers are all "join this list of ids onto their books", and a book that
   * vanished between the two queries is one fewer row to draw, not a failed
   * request. `get` still throws, because a *single* book that cannot be found is
   * exactly the case where the caller needs to know.
   *
   * `addedAt` is read from the join, so the DTOs here are identical to the ones
   * `list` produces — which is what lets the continue-reading strip and the shelf
   * grid be the same `Book` on the client.
   */
  getMany(userId: string, bookIds: string[]): Map<string, BookDto> {
    const unique = [...new Set(bookIds)].filter((id) => id !== '');
    if (unique.length === 0) return new Map();
    const rows = this.db.all<BookRow>(
      `SELECT ${BOOK_COLUMNS.split(',').map((c) => `b.${c.trim()}`).join(', ')}, ub.added_at
       FROM books b JOIN user_books ub ON ub.book_id = b.id
       WHERE ub.user_id = ? AND ub.hidden = 0 AND b.id IN (${unique.map(() => '?').join(',')})`,
      userId, ...unique,
    );
    return new Map(rows.map((row) => [row.id, this.toDto(row)]));
  }

  /**
   * Applies the manual override layer, which sits above embedded metadata and
   * above anything a provider filled in.
   */
  toDto(row: BookRow): BookDto {
    const overrides = this.loadOverrides(row.id);
    const base: BaseMetadata = {
      title: row.title,
      author: row.author,
      publisher: row.publisher,
      language: row.language,
      isbn: row.isbn,
      description: row.description,
      series: row.series,
      seriesIndex: row.series_index,
      tags: safeJsonParse<string[]>(row.tags, []),
      pubdate: row.pubdate,
      source: row.source,
    };
    const { effective, appliedFields } = applyOverrides(base, overrides);
    return {
      id: row.id,
      title: effective.title,
      author: effective.author,
      publisher: effective.publisher,
      language: effective.language,
      isbn: effective.isbn,
      description: effective.description,
      series: effective.series,
      seriesIndex: effective.seriesIndex,
      tags: effective.tags,
      pubdate: effective.pubdate,
      format: row.format,
      coverUrl: row.cover_path ? `/api/v1/books/${row.id}/cover` : null,
      fileSize: row.file_size,
      pageCount: row.page_count,
      source: effective.source,
      manualFields: appliedFields,
      updatedAt: row.updated_at,
      // A row read outside `list` (a single-book lookup) has no `user_books`
      // join, so the fallback is the book's own timestamp rather than 0 — a zero
      // would sort every such book to the bottom of "最近入库".
      addedAt: row.added_at ?? row.updated_at,
      // Present only when a projection actually selected `shelf_hidden`: a `null`
      // flag (no row) and a `1` (a row written by `remove`) are both "off", and
      // *omitting* the field on the shelf's own list is what keeps "always on"
      // from being drawn.
      ...(row.shelf_hidden === undefined
        ? {}
        : { shelfState: row.shelf_hidden === 0 ? ('on' as const) : ('off' as const) }),
    };
  }

  loadOverrides(bookId: string): Record<string, string> {
    const rows = this.db.all<{ field: string; value: string }>(
      'SELECT field, value FROM metadata_overrides WHERE book_id = ?',
      bookId,
    );
    return Object.fromEntries(rows.map((r) => [r.field, r.value]));
  }

  /** Records manual edits. These are never overwritten by a rescan. */
  setOverrides(bookId: string, patch: Record<string, unknown>, userId: string): void {
    const now = Date.now();
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const text = Array.isArray(value) ? value.join(',') : String(value);
      this.db.run(
        `INSERT INTO metadata_overrides (book_id, field, value, updated_by, updated_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(book_id, field) DO UPDATE SET value = excluded.value,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        bookId, field, text, userId, now,
      );
    }
    // Bump the book row so clients syncing by `updatedAt` notice the edit.
    this.db.run('UPDATE books SET updated_at = ? WHERE id = ?', now, bookId);
  }

  clearOverride(bookId: string, field: string): void {
    this.db.run('DELETE FROM metadata_overrides WHERE book_id = ? AND field = ?', bookId, field);
    this.db.run('UPDATE books SET updated_at = ? WHERE id = ?', Date.now(), bookId);
  }

  /** Library-wide facets, used to build the client's filter UI. */
  facets(userId: string): { authors: string[]; series: string[]; tags: string[]; formats: string[] } {
    const rows = this.db.all<{ author: string; series: string; tags: string; format: string }>(
      `SELECT b.author, b.series, b.tags, b.format
       FROM books b JOIN user_books ub ON ub.book_id = b.id
       WHERE ub.user_id = ? AND ub.hidden = 0`, userId,
    );
    const authors = new Set<string>();
    const series = new Set<string>();
    const tags = new Set<string>();
    const formats = new Set<string>();
    for (const row of rows) {
      if (row.author) authors.add(row.author);
      if (row.series) series.add(row.series);
      if (row.format) formats.add(row.format);
      for (const tag of safeJsonParse<string[]>(row.tags, [])) tags.add(tag);
    }
    return {
      authors: [...authors].sort(),
      series: [...series].sort(),
      tags: [...tags].sort(),
      formats: [...formats].sort(),
    };
  }
}
