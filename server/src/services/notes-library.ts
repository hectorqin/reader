import type { Db } from '../db/index.ts';
import type { ShelfService } from './shelf.ts';
import { badRequest } from '../lib/errors.ts';

/**
 * 读书笔记, read across books (docs/notes-library.zh-CN.md).
 *
 * This service only reads. Notes are written through sync (`SyncService`), which is
 * what keeps the offline queue, the tombstones and last-writer-wins in one place.
 */

export type NoteType = 'note' | 'highlight' | 'bookmark';
const NOTE_TYPES: readonly NoteType[] = ['note', 'highlight', 'bookmark'];
export const NOTES_PAGE_SIZE = 50;
export const NOTES_PAGE_SIZE_MAX = 200;

/** The filter the list, the book facet and the export all take. */
export interface NotesFilter { q?: string; type?: string; bookId?: string }
export interface NotesListQuery extends NotesFilter { page?: string | number; pageSize?: string | number }
export interface NotesExportQuery extends NotesFilter { format?: string; tz?: string | number }

export interface LibraryNote {
  id: string; bookId: string; type: NoteType; locator: string; text: string; comment: string; color: string; updatedAt: number;
  bookTitle: string; bookAuthor: string;
}
export interface NotesBook { bookId: string; title: string; author: string; count: number; lastAt: number }
export interface NotesExport { filename: string; mime: string; content: string; count: number }

interface NoteRow {
  id: string; book_id: string; type: NoteType; locator: string; text: string; comment: string; color: string; updated_at: number;
  title: string | null; author: string | null;
}

export class NotesLibraryService {
  constructor(private readonly db: Pick<Db, 'all' | 'get'>, private readonly shelf: Pick<ShelfService, 'getMany'>) {}

  /** One page, newest first. A page past the end is an empty list with the real total. */
  list(userId: string, query: NotesListQuery): { items: LibraryNote[]; total: number; page: number; pageSize: number } {
    const page = positive(query.page, 1, Number.MAX_SAFE_INTEGER, 'page');
    const pageSize = positive(query.pageSize, NOTES_PAGE_SIZE, NOTES_PAGE_SIZE_MAX, 'pageSize');
    const { where, args } = condition(userId, query);
    const total = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notes n WHERE ${where}`, ...args)?.n ?? 0;
    const offset = (page - 1) * pageSize;
    const rows = offset >= total ? [] : this.db.all<NoteRow>(
      `${SELECT} WHERE ${where} ORDER BY n.updated_at DESC, n.id LIMIT ? OFFSET ?`, ...args, pageSize, offset,
    );
    return { items: this.withBooks(userId, rows), total, page, pageSize };
  }

  /** The books that have notes, most recently annotated first. Ignores `bookId`: it is what that filter picks from. */
  books(userId: string, filter: NotesFilter): NotesBook[] {
    const { where, args } = condition(userId, { ...filter, bookId: '' });
    const rows = this.db.all<{ book_id: string; count: number; last_at: number; title: string | null; author: string | null }>(
      `SELECT n.book_id, COUNT(*) AS count, MAX(n.updated_at) AS last_at, b.title, b.author
       FROM notes n LEFT JOIN books b ON b.id = n.book_id WHERE ${where}
       GROUP BY n.book_id ORDER BY last_at DESC, n.book_id`, ...args,
    );
    const shelf = this.shelf.getMany(userId, rows.map(row => row.book_id));
    return rows.map(row => ({
      bookId: row.book_id, count: row.count, lastAt: row.last_at,
      ...bookName(shelf.get(row.book_id), row),
    }));
  }

  /** Everything the filter matches, as one document. */
  export(userId: string, query: NotesExportQuery, now = Date.now()): NotesExport {
    const format = query.format ?? 'markdown';
    if (format !== 'markdown' && format !== 'json') throw badRequest('format must be markdown or json', 'BAD_FORMAT');
    const tz = Number(query.tz ?? 0);
    if (!Number.isInteger(tz) || Math.abs(tz) > 14 * 60) throw badRequest('invalid timezone offset', 'BAD_RANGE');
    const { where, args } = condition(userId, query);
    // Bookmarks have no words; in a notes app they are noise. JSON keeps them: it is the backup.
    const kinds = format === 'markdown' ? " AND n.type <> 'bookmark'" : '';
    const notes = this.withBooks(userId, this.db.all<NoteRow>(`${SELECT} WHERE ${where}${kinds} ORDER BY n.updated_at, n.id`, ...args));
    // Books by their latest note, newest first; notes inside a book oldest first.
    const groups = new Map<string, LibraryNote[]>();
    for (const note of notes) groups.set(note.bookId, [...(groups.get(note.bookId) ?? []), note]);
    const books = [...groups.values()].sort((a, b) => b.at(-1)!.updatedAt - a.at(-1)!.updatedAt);
    const stamp = day(now, tz);
    if (format === 'json') {
      return {
        filename: `reader-notes-${stamp}.json`, mime: 'application/json', count: notes.length,
        content: JSON.stringify({
          version: 1, exportedAt: now,
          books: books.map(group => ({
            id: group[0]!.bookId, title: group[0]!.bookTitle, author: group[0]!.bookAuthor,
            notes: group.map(({ id, type, locator, text, comment, color, updatedAt }) => ({ id, type, locator, text, comment, color, updatedAt })),
          })),
        }, null, 2),
      };
    }
    const lines = ['# 读书笔记', '', `> 导出于 ${stamp} · ${books.length} 本书 · ${notes.length} 条`, ''];
    for (const group of books) {
      const first = group[0]!;
      lines.push(`## ${inline(first.bookTitle)}`, '');
      if (first.bookAuthor) lines.push(`作者：${inline(first.bookAuthor)}`, '');
      for (const note of group) {
        lines.push(`### ${day(note.updatedAt, tz)} · ${note.type === 'note' ? '批注' : '高亮'}`, '');
        if (note.text.trim()) lines.push(...note.text.trim().split(/\r?\n/).map(line => `> ${line}`.trimEnd()), '');
        if (note.comment.trim()) lines.push(note.comment.trim(), '');
      }
    }
    return { filename: `reader-notes-${stamp}.md`, mime: 'text/markdown', count: notes.length, content: lines.join('\n') };
  }

  private withBooks(userId: string, rows: NoteRow[]): LibraryNote[] {
    // The shelf's own view of each book (manual metadata); one off the shelf keeps its stored title.
    const shelf = this.shelf.getMany(userId, rows.map(row => row.book_id));
    return rows.map((row) => {
      const name = bookName(shelf.get(row.book_id), row);
      return {
        id: row.id, bookId: row.book_id, type: row.type, locator: row.locator, text: row.text, comment: row.comment,
        color: row.color, updatedAt: row.updated_at, bookTitle: name.title, bookAuthor: name.author,
      };
    });
  }
}

const SELECT = `SELECT n.id, n.book_id, n.type, n.locator, n.text, n.comment, n.color, n.updated_at, b.title, b.author
  FROM notes n LEFT JOIN books b ON b.id = n.book_id`;

function condition(userId: string, filter: NotesFilter): { where: string; args: Array<string | number> } {
  const parts = ['n.user_id = ?', 'n.deleted = 0'], args: Array<string | number> = [userId];
  const type = filter.type ?? '';
  if (type) {
    if (!NOTE_TYPES.includes(type as NoteType)) throw badRequest(`unsupported note type: ${type}`, 'BAD_NOTE_TYPE');
    parts.push('n.type = ?'); args.push(type);
  }
  if (filter.bookId) { parts.push('n.book_id = ?'); args.push(filter.bookId); }
  const q = (filter.q ?? '').trim();
  if (q) {
    // A reader's words, not a pattern: % and _ in the query match themselves.
    const like = `%${q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    parts.push("(n.text LIKE ? ESCAPE '\\' OR n.comment LIKE ? ESCAPE '\\')"); args.push(like, like);
  }
  return { where: parts.join(' AND '), args };
}

function bookName(book: { title: string; author: string } | undefined, row: { title: string | null; author: string | null }): { title: string; author: string } {
  return { title: book?.title || row.title || '未知书籍', author: book?.author ?? row.author ?? '' };
}

function positive(value: string | number | undefined, fallback: number, max: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw badRequest(`${name} must be a positive integer`, 'BAD_PAGE');
  return Math.min(number, max);
}

/** The calendar day in the viewer's zone (`tz` is minutes east of UTC, as in 时长统计). */
function day(at: number, tz: number): string {
  return new Date(at + tz * 60000).toISOString().slice(0, 10);
}

/** A title on one heading line: no line breaks, and no leading # to change its level. */
function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
}
