import type { Db } from '../db/index.ts';
import type { ShelfService } from './shelf.ts';
import { badRequest } from '../lib/errors.ts';
import { decodeTags } from './sync.ts';

/**
 * 读书笔记, read across books (docs/notes-library.zh-CN.md).
 *
 * This service only reads. Notes are written through sync (`SyncService`), which is
 * what keeps the offline queue, the tombstones and last-writer-wins in one place;
 * reviews are written by `BookReviewService`.
 */

export type NoteType = 'note' | 'highlight' | 'bookmark';
const NOTE_TYPES: readonly NoteType[] = ['note', 'highlight', 'bookmark'];
export const NOTES_PAGE_SIZE = 50;
export const NOTES_PAGE_SIZE_MAX = 200;

/** The filter the list, the book facet and the export all take. */
export interface NotesFilter { q?: string; type?: string; bookId?: string; tag?: string }
export interface NotesListQuery extends NotesFilter { page?: string | number; pageSize?: string | number }
export interface NotesExportQuery extends NotesFilter { format?: string; tz?: string | number }

export interface LibraryNote {
  id: string; bookId: string; type: NoteType; locator: string; text: string; comment: string; color: string; updatedAt: number;
  chapterTitle: string; tags: string[]; bookTitle: string; bookAuthor: string;
}
export interface NotesTag { tag: string; count: number }
export interface NotesBook { bookId: string; title: string; author: string; count: number; lastAt: number; reviewed: boolean }
/** `count` is notes, `reviews` is 书评: a book may be exported for its review alone. */
export interface NotesExport { filename: string; mime: string; content: string; count: number; reviews: number }
interface ReviewRow { book_id: string; body: string; updated_at: number; title: string | null; author: string | null }

interface NoteRow {
  id: string; book_id: string; type: NoteType; locator: string; text: string; comment: string; color: string; updated_at: number;
  chapter_title: string; tags: string; title: string | null; author: string | null;
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

  /**
   * The books that have notes, most recently annotated first. Ignores `bookId`: it is
   * what that filter picks from. With no other filter, a book that has only a review
   * is listed too (with no notes): it is still a book the reader wrote about.
   */
  books(userId: string, filter: NotesFilter): NotesBook[] {
    const { where, args } = condition(userId, { ...filter, bookId: '' });
    const rows = this.db.all<{ book_id: string; count: number; last_at: number; title: string | null; author: string | null }>(
      `SELECT n.book_id, COUNT(*) AS count, MAX(n.updated_at) AS last_at, b.title, b.author
       FROM notes n LEFT JOIN books b ON b.id = n.book_id WHERE ${where}
       GROUP BY n.book_id ORDER BY last_at DESC, n.book_id`, ...args,
    );
    // Unnarrowed, writing a review counts as writing about the book: it moves the book up.
    const reviews = this.reviews(userId, ''), counted = narrowed(filter) ? [] : reviews;
    const reviewedAt = new Map(counted.map(row => [row.book_id, row.updated_at]));
    const seen = new Set(rows.map(row => row.book_id));
    const all = [
      ...rows.map(row => ({ ...row, last_at: Math.max(row.last_at, reviewedAt.get(row.book_id) ?? 0) })),
      ...counted.filter(row => !seen.has(row.book_id)).map(row => ({ book_id: row.book_id, count: 0, last_at: row.updated_at, title: row.title, author: row.author })),
    ].sort((a, b) => b.last_at - a.last_at || a.book_id.localeCompare(b.book_id));
    const reviewed = new Set(reviews.map(row => row.book_id));
    const shelf = this.shelf.getMany(userId, all.map(row => row.book_id));
    return all.map(row => ({
      bookId: row.book_id, count: row.count, lastAt: row.last_at, reviewed: reviewed.has(row.book_id),
      ...bookName(shelf.get(row.book_id), row),
    }));
  }

  private reviews(userId: string, bookId: string): ReviewRow[] {
    return this.db.all<ReviewRow>(
      `SELECT r.book_id, r.body, r.updated_at, b.title, b.author FROM book_reviews r LEFT JOIN books b ON b.id = r.book_id
       WHERE r.user_id = ? ${bookId ? 'AND r.book_id = ?' : ''}`, ...(bookId ? [userId, bookId] : [userId]),
    );
  }

  /** Every tag this account uses, most used first. Not narrowed by the filter: it is the vocabulary. */
  tags(userId: string): NotesTag[] {
    const counts = new Map<string, number>();
    // Tags live one-per-line in a column (see encodeTags); an account's notes are few enough to count here.
    for (const row of this.db.all<{ tags: string }>("SELECT tags FROM notes WHERE user_id = ? AND deleted = 0 AND tags <> ''", userId)) {
      for (const tag of decodeTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
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
    // A review goes with its book's notes. A book with a review and no matching notes is
    // exported for the review alone, unless the reader narrowed the notes by words, type or tag.
    const reviewRows = this.reviews(userId, query.bookId ?? '').filter(row => groups.has(row.book_id) || !narrowed(query));
    const reviewNames = this.shelf.getMany(userId, reviewRows.map(row => row.book_id));
    const reviews = new Map(reviewRows.map(row => [row.book_id, { body: row.body, updatedAt: row.updated_at, ...bookName(reviewNames.get(row.book_id), row) }]));
    const lastAt = (bookId: string) => Math.max(groups.get(bookId)?.at(-1)?.updatedAt ?? 0, reviews.get(bookId)?.updatedAt ?? 0);
    const books = [...new Set([...groups.keys(), ...reviews.keys()])].sort((a, b) => lastAt(b) - lastAt(a) || a.localeCompare(b)).map((bookId) => {
      const group = groups.get(bookId) ?? [], review = reviews.get(bookId);
      return { bookId, group, review, title: group[0]?.bookTitle ?? review!.title, author: group[0]?.bookAuthor ?? review!.author };
    });
    const stamp = day(now, tz);
    if (format === 'json') {
      return {
        filename: `reader-notes-${stamp}.json`, mime: 'application/json', count: notes.length, reviews: reviews.size,
        content: JSON.stringify({
          version: 1, exportedAt: now,
          books: books.map(({ bookId, group, review, title, author }) => ({
            id: bookId, title, author,
            ...(review ? { review: { body: review.body, updatedAt: review.updatedAt } } : {}),
            notes: group.map(({ id, type, locator, text, comment, color, chapterTitle, tags, updatedAt }) => ({ id, type, locator, chapterTitle, text, comment, color, tags, updatedAt })),
          })),
        }, null, 2),
      };
    }
    const lines = ['# 读书笔记', '', `> 导出于 ${stamp} · ${books.length} 本书 · ${notes.length} 条${reviews.size ? ` · ${reviews.size} 篇书评` : ''}`, ''];
    for (const { group, review, title, author } of books) {
      lines.push(`## ${inline(title)}`, '');
      if (author) lines.push(`作者：${inline(author)}`, '');
      if (review) lines.push(`**书评**（${day(review.updatedAt, tz)}）`, '', review.body, '');
      // Chapters in the order the reader first annotated them: the server does not know
      // the book's own order. Notes from before chapters were recorded come first, unheaded.
      const chapters = new Map<string, LibraryNote[]>([['', []]]);
      for (const note of group) chapters.set(note.chapterTitle.trim(), [...(chapters.get(note.chapterTitle.trim()) ?? []), note]);
      for (const [chapter, chapterNotes] of chapters) {
        if (chapter) lines.push(`### ${inline(chapter)}`, '');
        for (const note of chapterNotes) {
          if (note.text.trim()) lines.push(...note.text.trim().split(/\r?\n/).map(line => `> ${line}`.trimEnd()), '');
          if (note.comment.trim()) lines.push(note.comment.trim(), '');
          lines.push(['—', day(note.updatedAt, tz), note.type === 'note' ? '批注' : '高亮', ...note.tags.map(tag => `#${tag.replace(/\s+/g, '_')}`)].join(' '), '');
        }
      }
    }
    return { filename: `reader-notes-${stamp}.md`, mime: 'text/markdown', count: notes.length, reviews: reviews.size, content: lines.join('\n') };
  }

  private withBooks(userId: string, rows: NoteRow[]): LibraryNote[] {
    // The shelf's own view of each book (manual metadata); one off the shelf keeps its stored title.
    const shelf = this.shelf.getMany(userId, rows.map(row => row.book_id));
    return rows.map((row) => {
      const name = bookName(shelf.get(row.book_id), row);
      return {
        id: row.id, bookId: row.book_id, type: row.type, locator: row.locator, text: row.text, comment: row.comment,
        color: row.color, updatedAt: row.updated_at, chapterTitle: row.chapter_title, tags: decodeTags(row.tags),
        bookTitle: name.title, bookAuthor: name.author,
      };
    });
  }
}

const SELECT = `SELECT n.id, n.book_id, n.type, n.locator, n.text, n.comment, n.color, n.updated_at, n.chapter_title, n.tags, b.title, b.author
  FROM notes n LEFT JOIN books b ON b.id = n.book_id`;

function condition(userId: string, filter: NotesFilter): { where: string; args: Array<string | number> } {
  const parts = ['n.user_id = ?', 'n.deleted = 0'], args: Array<string | number> = [userId];
  const type = filter.type ?? '';
  if (type) {
    if (!NOTE_TYPES.includes(type as NoteType)) throw badRequest(`unsupported note type: ${type}`, 'BAD_NOTE_TYPE');
    parts.push('n.type = ?'); args.push(type);
  }
  if (filter.bookId) { parts.push('n.book_id = ?'); args.push(filter.bookId); }
  const tag = (filter.tag ?? '').trim();
  if (tag) { parts.push("instr(n.tags, char(10) || ? || char(10)) > 0"); args.push(tag); }
  const q = (filter.q ?? '').trim();
  if (q) {
    // A reader's words, not a pattern: % and _ in the query match themselves.
    const like = `%${q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    parts.push("(n.text LIKE ? ESCAPE '\\' OR n.comment LIKE ? ESCAPE '\\')"); args.push(like, like);
  }
  return { where: parts.join(' AND '), args };
}

/** Whether the reader narrowed the notes themselves (not merely picked a book). */
function narrowed(filter: NotesFilter): boolean {
  return !!((filter.q ?? '').trim() || filter.type || (filter.tag ?? '').trim());
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
