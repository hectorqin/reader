import type { Db } from '../db/index.ts';
import type { ChapterPublications } from '../publications/chapters.ts';
import { AppError, badRequest } from '../lib/errors.ts';
import type { Manifest } from '../indexer/formats/registry.ts';

interface Subscription {
  bookId: string; userId: string; enabled: number; intervalMinutes: number;
  nextCheckAt: number; lastCheckAt: number | null; lastSuccessAt: number | null;
  lastError: string | null; failures: number; newChapters: number; generation: number;
}
const FIELDS = `p.book_id AS bookId, p.user_id AS userId, COALESCE(s.enabled,0) AS enabled,
  COALESCE(s.interval_minutes,60) AS intervalMinutes, COALESCE(s.next_check_at,0) AS nextCheckAt,
  s.last_check_at AS lastCheckAt, s.last_success_at AS lastSuccessAt, s.last_error AS lastError,
  COALESCE(s.failures,0) AS failures, COALESCE(s.new_chapters,0) AS newChapters, COALESCE(s.generation,0) AS generation`;

/** Durable opt-in subscriptions. One bounded sequential worker shares SourceHost's call budget. */
export class ChapterUpdates {
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private controller = new AbortController();
  private readonly checks = new Map<string, Promise<Manifest>>();
  constructor(private readonly db: Db, private readonly chapters: ChapterPublications, private readonly now = Date.now) {}

  list(userId: string) {
    return this.db.all<Subscription & { title: string }>(`SELECT ${FIELDS}, b.title FROM chapter_publications p
      JOIN books b ON b.id = p.book_id JOIN user_books u ON u.book_id = p.book_id AND u.user_id = p.user_id AND u.hidden = 0
      LEFT JOIN chapter_subscriptions s ON s.book_id = p.book_id WHERE p.user_id = ? ORDER BY b.title`, userId)
      .map(({ userId: _user, generation: _generation, ...row }) => ({ ...row, enabled: row.enabled === 1 }));
  }

  configure(userId: string, bookId: string, input: { enabled?: unknown; intervalMinutes?: unknown; acknowledge?: unknown }) {
    this.chapters.manifest(userId, bookId);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw badRequest('enabled must be boolean');
    if (input.acknowledge !== undefined && typeof input.acknowledge !== 'boolean') throw badRequest('acknowledge must be boolean');
    if (input.intervalMinutes !== undefined && (!Number.isSafeInteger(input.intervalMinutes) || Number(input.intervalMinutes) < 15 || Number(input.intervalMinutes) > 10080)) {
      throw badRequest('intervalMinutes must be an integer between 15 and 10080');
    }
    this.db.transaction(() => {
      this.db.run('INSERT OR IGNORE INTO chapter_subscriptions (book_id) VALUES (?)', bookId);
      if (input.enabled !== undefined || input.intervalMinutes !== undefined) {
        this.db.run(`UPDATE chapter_subscriptions SET enabled = COALESCE(?,enabled), interval_minutes = COALESCE(?,interval_minutes),
          next_check_at = ?, failures = 0, last_error = NULL, generation = generation + 1 WHERE book_id = ?`,
        input.enabled === undefined ? null : Number(input.enabled), input.intervalMinutes === undefined ? null : Number(input.intervalMinutes), this.now(), bookId);
      }
      if (input.acknowledge === true) this.db.run('UPDATE chapter_subscriptions SET new_chapters = 0 WHERE book_id = ?', bookId);
    });
    return this.list(userId).find((row) => row.bookId === bookId);
  }

  start(): void {
    if (this.timer) return;
    this.controller = new AbortController();
    this.timer = setInterval(() => { void this.runDue().catch(() => undefined); }, 60_000);
    this.timer.unref();
    void this.runDue().catch(() => undefined);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer); this.timer = undefined;
    this.controller.abort();
    await this.active;
  }

  runDue(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.run().finally(() => { this.active = undefined; });
    return this.active;
  }

  check(userId: string, bookId: string, signal?: AbortSignal): Promise<Manifest> {
    this.chapters.manifest(userId, bookId);
    const pending = this.checks.get(bookId);
    if (pending) return pending;
    const action = this.performCheck(userId, bookId, signal);
    this.checks.set(bookId, action);
    void action.finally(() => { if (this.checks.get(bookId) === action) this.checks.delete(bookId); }).catch(() => undefined);
    return action;
  }

  private async performCheck(userId: string, bookId: string, signal?: AbortSignal): Promise<Manifest> {
    this.db.run('INSERT OR IGNORE INTO chapter_subscriptions (book_id) VALUES (?)', bookId);
    const item = this.db.get<Subscription>(`SELECT ${FIELDS} FROM chapter_publications p
      JOIN chapter_subscriptions s ON s.book_id = p.book_id WHERE p.book_id = ?`, bookId)!;
    this.db.run('UPDATE chapter_subscriptions SET next_check_at = ?, last_check_at = ? WHERE book_id = ?', this.now() + 300_000, this.now(), bookId);
    try {
      const old = new Set(this.chapters.manifest(userId, bookId).items.map((entry) => entry.href));
      const fresh = await this.chapters.refresh(userId, bookId, signal);
      const added = fresh.items.filter((entry) => !old.has(entry.href)).length;
      this.db.run(`UPDATE chapter_subscriptions SET last_success_at = ?, next_check_at = ?, last_error = NULL,
        failures = 0, new_chapters = new_chapters + ? WHERE book_id = ? AND generation = ?`,
      this.now(), this.now() + item.intervalMinutes * 60_000, added, bookId, item.generation);
      return fresh;
    } catch (error) {
      const delay = Math.min(10080, Math.max(item.intervalMinutes, Math.min(1440, 15 * 2 ** Math.min(item.failures, 7))));
      const code = error instanceof AppError && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'UPDATE_FAILED';
      this.db.run('UPDATE chapter_subscriptions SET next_check_at = ?, last_error = ?, failures = failures + 1 WHERE book_id = ? AND generation = ?',
        this.now() + delay * 60_000, code, bookId, item.generation);
      throw error;
    }
  }

  private async run(): Promise<void> {
    const due = this.db.all<Subscription>(`SELECT ${FIELDS} FROM chapter_publications p
      JOIN chapter_subscriptions s ON s.book_id = p.book_id
      JOIN source_instances i ON i.id = p.source_id AND i.enabled = 1
      JOIN users a ON a.id = p.user_id AND a.disabled = 0
      JOIN user_books u ON u.book_id = p.book_id AND u.user_id = p.user_id AND u.hidden = 0
      WHERE s.enabled = 1 AND s.next_check_at <= ? ORDER BY s.next_check_at LIMIT 20`, this.now());
    for (const item of due) {
      if (this.controller.signal.aborted) return;
      const eligible = this.db.get('SELECT book_id FROM chapter_subscriptions WHERE book_id = ? AND enabled = 1 AND generation = ? AND next_check_at <= ?', item.bookId, item.generation, this.now());
      if (!eligible) continue;
      try {
        await this.check(item.userId, item.bookId, this.controller.signal);
      } catch {
        if (this.controller.signal.aborted) return;
        // Failure is recorded per book; other subscriptions still get a turn.
      }
    }
  }
}
