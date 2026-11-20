import type { Db } from '../db/index.ts';
import { badRequest, notFound } from '../lib/errors.ts';

/**
 * 书评: one reader's words about a whole book (docs/notes-library.zh-CN.md §5).
 *
 * Written online, one request per save, the last one wins. It is deliberately not
 * part of sync: a review is written sitting down, not while turning pages on a
 * train, and a second kind of sync record would need its own queue and tombstones
 * on every client.
 */
export const REVIEW_MAX_LENGTH = 20_000;

export interface BookReview {
  bookId: string;
  body: string;
  updatedAt: number;
}

export class BookReviewService {
  constructor(private readonly db: Pick<Db, 'get' | 'run'>) {}

  get(userId: string, bookId: string): BookReview | null {
    const row = this.db.get<{ body: string; updated_at: number }>(
      'SELECT body, updated_at FROM book_reviews WHERE user_id = ? AND book_id = ?',
      userId,
      bookId,
    );
    return row ? { bookId, body: row.body, updatedAt: row.updated_at } : null;
  }

  /** Saves the review; saving nothing but whitespace removes it. */
  save(userId: string, bookId: string, body: unknown, now = Date.now()): BookReview | null {
    if (typeof body !== 'string') throw badRequest('body must be a string', 'BAD_REVIEW');
    const text = body.trim();
    if (text.length > REVIEW_MAX_LENGTH) throw badRequest(`书评最长 ${REVIEW_MAX_LENGTH} 字`, 'REVIEW_TOO_LONG');
    if (!text) {
      this.db.run('DELETE FROM book_reviews WHERE user_id = ? AND book_id = ?', userId, bookId);
      return null;
    }
    if (!this.db.get('SELECT 1 AS ok FROM books WHERE id = ?', bookId)) throw notFound('book not found');
    this.db.run(
      `INSERT INTO book_reviews (user_id, book_id, body, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      userId,
      bookId,
      text,
      now,
    );
    return { bookId, body: text, updatedAt: now };
  }
}
