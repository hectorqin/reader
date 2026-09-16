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
}

interface BookRow {
  id: string;
  /** `user_books.added_at`; selected alongside the book's own columns. */
  added_at?: number;
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
  page?: number;
  pageSize?: number;
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
    const where: string[] = ['ub.user_id = ?', 'ub.hidden = 0', 'EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)'];
    const params: Array<string | number> = [userId];

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

    const sortColumn = {
      title: 'b.title',
      author: 'b.author',
      added: 'ub.added_at',
      updated: 'b.updated_at',
    }[options.sort ?? 'added'];
    const order = options.order === 'asc' ? 'ASC' : 'DESC';
    const whereSql = where.join(' AND ');

    const totalRow = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM books b JOIN user_books ub ON ub.book_id = b.id WHERE ${whereSql}`,
      ...params,
    );

    const rows = this.db.all<BookRow>(
      `SELECT ${BOOK_COLUMNS.split(',').map((c) => `b.${c.trim()}`).join(', ')}, ub.added_at
       FROM books b JOIN user_books ub ON ub.book_id = b.id
       WHERE ${whereSql}
       ORDER BY ${sortColumn} ${order}, b.title ASC
       LIMIT ? OFFSET ?`,
      ...params, pageSize, (page - 1) * pageSize,
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
