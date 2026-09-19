import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';

/**
 * Sync payload is deliberately small and append-only where possible (§4): the
 * server is the single source of truth and the client only renders and caches.
 *
 * Every record carries `updatedAt` and is stored per user, so a client that was
 * offline for a week can push its local changes and receive only what changed
 * on the server since `since`.
 */
export interface ProgressRecord {
  bookId: string;
  /** Opaque locator: EPUB CFI, pagination index or PDF page. Client-defined. */
  locator: string;
  percentage: number;
  chapterTitle: string;
  device: string;
  updatedAt: number;
}

export interface NoteRecord {
  id: string;
  bookId: string;
  type: 'note' | 'highlight' | 'bookmark';
  locator: string;
  /** Selected text for highlights, empty for bookmarks. */
  text: string;
  /** Reader's own comment; left empty for highlights without a note. */
  comment: string;
  color: string;
  updatedAt: number;
  deleted: boolean;
}

export interface SyncPushRequest {
  progress?: ProgressRecord[];
  notes?: NoteRecord[];
}

export class SyncService {
  constructor(private readonly db: Db) {}

  /**
   * Merges a client batch. Conflicts resolve by last-writer-wins on updatedAt,
   * which is correct here because each device belongs to one reader: there is no
   * editorial conflict to arbitrate, only a stale device to catch up.
   */
  push(userId: string, payload: SyncPushRequest): { accepted: number; rejected: number } {
    let accepted = 0;
    let rejected = 0;

    this.db.transaction(() => {
      for (const item of payload.progress ?? []) {
        if (!item.bookId || typeof item.updatedAt !== 'number') {
          rejected += 1;
          continue;
        }
        this.upsertProgress(userId, item);
        accepted += 1;
      }
      for (const item of payload.notes ?? []) {
        if (!item.bookId || !item.id) {
          rejected += 1;
          continue;
        }
        this.upsertNote(userId, item);
        accepted += 1;
      }
    });

    return { accepted, rejected };
  }

  private upsertProgress(userId: string, record: ProgressRecord): void {
    const percentage = clampPercentage(record.percentage);
    this.db.run(
      `INSERT INTO reading_progress (user_id, book_id, locator, percentage, chapter_title, device, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET
         locator = CASE WHEN excluded.updated_at >= reading_progress.updated_at THEN excluded.locator ELSE reading_progress.locator END,
         percentage = CASE WHEN excluded.updated_at >= reading_progress.updated_at THEN excluded.percentage ELSE reading_progress.percentage END,
         chapter_title = CASE WHEN excluded.updated_at >= reading_progress.updated_at THEN excluded.chapter_title ELSE reading_progress.chapter_title END,
         device = CASE WHEN excluded.updated_at >= reading_progress.updated_at THEN excluded.device ELSE reading_progress.device END,
         updated_at = MAX(excluded.updated_at, reading_progress.updated_at)`,
      userId, record.bookId, record.locator ?? '', percentage,
      record.chapterTitle ?? '', record.device ?? '', record.updatedAt,
    );
  }

  private upsertNote(userId: string, record: NoteRecord): void {
    if (record.type && !['note', 'highlight', 'bookmark'].includes(record.type)) {
      throw badRequest(`unsupported note type: ${record.type}`, 'BAD_NOTE_TYPE');
    }
    this.db.run(
      `INSERT INTO notes (id, user_id, book_id, type, locator, text, comment, color, updated_at, deleted)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         locator = CASE WHEN excluded.updated_at >= notes.updated_at THEN excluded.locator ELSE notes.locator END,
         text = CASE WHEN excluded.updated_at >= notes.updated_at THEN excluded.text ELSE notes.text END,
         comment = CASE WHEN excluded.updated_at >= notes.updated_at THEN excluded.comment ELSE notes.comment END,
         color = CASE WHEN excluded.updated_at >= notes.updated_at THEN excluded.color ELSE notes.color END,
         deleted = CASE WHEN excluded.updated_at >= notes.updated_at THEN excluded.deleted ELSE notes.deleted END,
         updated_at = MAX(excluded.updated_at, notes.updated_at)`,
      record.id, userId, record.bookId, record.type ?? 'note', record.locator ?? '',
      record.text ?? '', record.comment ?? '', record.color ?? '',
      record.updatedAt ?? Date.now(), record.deleted ? 1 : 0,
    );
  }

  /** Everything changed strictly after `since`, for the client's catch-up. */
  pull(userId: string, since: number, bookId?: string): {
    serverTime: number;
    progress: ProgressRecord[];
    notes: NoteRecord[];
  } {
    const progressRows = this.db.all<{
      book_id: string; locator: string; percentage: number; chapter_title: string;
      device: string; updated_at: number;
    }>(
      `SELECT book_id, locator, percentage, chapter_title, device, updated_at
       FROM reading_progress WHERE user_id = ? AND updated_at > ? ${bookId ? 'AND book_id = ?' : ''}
       ORDER BY updated_at ASC LIMIT 5000`,
      ...(bookId ? [userId, since, bookId] : [userId, since]),
    );

    const noteRows = this.db.all<{
      id: string; book_id: string; type: string; locator: string; text: string;
      comment: string; color: string; updated_at: number; deleted: number;
    }>(
      `SELECT id, book_id, type, locator, text, comment, color, updated_at, deleted
       FROM notes WHERE user_id = ? AND updated_at > ? ${bookId ? 'AND book_id = ?' : ''}
       ORDER BY updated_at ASC LIMIT 5000`,
      ...(bookId ? [userId, since, bookId] : [userId, since]),
    );

    return {
      serverTime: Date.now(),
      progress: progressRows.map((row) => ({
        bookId: row.book_id,
        locator: row.locator,
        percentage: row.percentage,
        chapterTitle: row.chapter_title,
        device: row.device,
        updatedAt: row.updated_at,
      })),
      notes: noteRows.map((row) => ({
        id: row.id,
        bookId: row.book_id,
        type: row.type as NoteRecord['type'],
        locator: row.locator,
        text: row.text,
        comment: row.comment,
        color: row.color,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
      })),
    };
  }

  progressFor(userId: string, bookId: string): ProgressRecord | null {
    const row = this.db.get<{
      book_id: string; locator: string; percentage: number; chapter_title: string;
      device: string; updated_at: number;
    }>(
      `SELECT book_id, locator, percentage, chapter_title, device, updated_at
       FROM reading_progress WHERE user_id = ? AND book_id = ?`,
      userId, bookId,
    );
    if (!row) return null;
    return {
      bookId: row.book_id,
      locator: row.locator,
      percentage: row.percentage,
      chapterTitle: row.chapter_title,
      device: row.device,
      updatedAt: row.updated_at,
    };
  }

  /** Continue-reading list: newest progress first, joined with book titles. */
  recentlyRead(userId: string, limit = 20): Array<{
    bookId: string; title: string; author: string; percentage: number;
    chapterTitle: string; updatedAt: number; coverUrl: string | null;
  }> {
    /*
     * The visibility rule is `ShelfService.list`'s rule, character for character.
     *
     * This query used to say `ub.hidden = 0` and stop there, while the shelf said
     * `ub.hidden = 0 AND EXISTS (a live file)`. So a book whose file had been
     * deleted — or whose only copy was on a drive that was not plugged in — was
     * still *offered* here, and opening the card made `ShelfService.get` throw
     * `book not found`, which the shell reports as "这本书不在书架上了".
     *
     * That message is a lie in the one case it fires: the card was drawn by this
     * endpoint, two lines above the shelf's own grid. The two queries have to
     * select the same set, and the fix is to make them the same predicate rather
     * than to teach the client to pre-check — a pre-check would fix the message and
     * leave a card the reader cannot read.
     *
     * `hidden = 0` is still checked here as well as by the `JOIN`: `user_books` is
     * per user and `p.user_id` is the same user, so this is belt and braces, and it
     * keeps the predicate readable as "what the shelf would show".
     */
    const rows = this.db.all<{
      book_id: string; title: string; author: string; percentage: number;
      chapter_title: string; updated_at: number; cover_path: string | null;
    }>(
      `SELECT p.book_id, b.title, b.author, p.percentage, p.chapter_title, p.updated_at, b.cover_path
       FROM reading_progress p
       JOIN books b ON b.id = p.book_id
       JOIN user_books ub ON ub.book_id = b.id AND ub.user_id = p.user_id
       WHERE p.user_id = ? AND ub.hidden = 0
         AND EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.missing = 0)
       ORDER BY p.updated_at DESC LIMIT ?`,
      userId, limit,
    );
    return rows.map((row) => ({
      bookId: row.book_id,
      title: row.title,
      author: row.author,
      percentage: row.percentage,
      chapterTitle: row.chapter_title,
      updatedAt: row.updated_at,
      coverUrl: row.cover_path ? `/api/v1/books/${row.book_id}/cover` : null,
    }));
  }

  /** Client-generated note ids are accepted, but this keeps the API ergonomic. */
  static newNoteId(): string {
    return randomUUID();
  }
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
