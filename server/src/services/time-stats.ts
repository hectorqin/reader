import type { Db } from '../db/index.ts';
import { badRequest } from '../lib/errors.ts';
import type { ShelfService } from './shelf.ts';

/**
 * 时长统计, the reading half (schema: reading_time).
 *
 * The client counts *active* reading — the page visible, the reader turning or
 * scrolling within the last few minutes, or 朗读 speaking — and reports it as
 * seconds per book per 15-minute slot, each device under its own random id.
 *
 * A slot's report is the device's running total for it, so the write is
 * `MAX(stored, reported)`: a retry, a duplicate after a lost response or a report
 * replayed from an offline queue can never count the same minute twice. Fifteen
 * minutes because every timezone in use is a whole number of quarter hours from
 * UTC, so a day, month or year in the *viewer's* zone is an exact sum of slots.
 */
export const SLOT_MS = 15 * 60 * 1000;
const SLOT_SECONDS = SLOT_MS / 1000;
const MAX_ENTRIES = 2000;

export type StatsGroup = 'day' | 'month' | 'year';
const FORMATS: Record<StatsGroup, string> = { day: '%Y-%m-%d', month: '%Y-%m', year: '%Y' };

export interface ReadingTimeEntry {
  bookId: string;
  /** Start of the 15-minute UTC slot, epoch ms. */
  slot: number;
  seconds: number;
}

export interface StatsQuery {
  from: number;
  to: number;
  /** The viewer's offset from UTC in minutes east (UTC+8 → 480). */
  tz: number;
  group: StatsGroup;
}

export interface StatsSeriesPoint { key: string; seconds: number }
export interface StatsWork { id: string; title: string; author: string; coverUrl: string | null; seconds: number; lastAt: number }

export class TimeStatsService {
  constructor(private readonly db: Db, private readonly shelf: ShelfService) {}

  record(userId: string, clientId: string, entries: ReadingTimeEntry[]): { accepted: number; rejected: number } {
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) throw badRequest('invalid client id', 'BAD_PAYLOAD');
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw badRequest('invalid entries', 'BAD_PAYLOAD');
    let accepted = 0, rejected = 0;
    // A slot cannot be in the future; a little skew is allowed for a fast device clock.
    const latest = Date.now() + SLOT_MS;
    this.db.transaction(() => {
      for (const entry of entries) {
        const valid = entry && typeof entry.bookId === 'string' && entry.bookId.length > 0 && entry.bookId.length <= 200
          && Number.isSafeInteger(entry.slot) && entry.slot % SLOT_MS === 0 && entry.slot > 0 && entry.slot <= latest
          && Number.isFinite(entry.seconds) && entry.seconds > 0;
        if (!valid || !this.db.get('SELECT 1 FROM books WHERE id = ?', entry.bookId)) { rejected += 1; continue; }
        const seconds = Math.min(SLOT_SECONDS, Math.round(entry.seconds));
        this.db.run(
          `INSERT INTO reading_time (user_id, book_id, slot, client_id, seconds, updated_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(user_id, book_id, slot, client_id) DO UPDATE SET
             seconds = MAX(reading_time.seconds, excluded.seconds), updated_at = excluded.updated_at`,
          userId, entry.bookId, entry.slot, clientId, seconds, Date.now(),
        );
        accepted += 1;
      }
    });
    return { accepted, rejected };
  }

  /** Totals per day/month/year in the viewer's zone, and per book, for one user. */
  summary(userId: string, query: StatsQuery): { series: StatsSeriesPoint[]; works: StatsWork[]; total: number } {
    const { from, to, tz, group } = validQuery(query);
    const key = `strftime('${FORMATS[group]}', (slot + ${tz * 60000}) / 1000, 'unixepoch')`;
    const series = this.db.all<StatsSeriesPoint>(
      `SELECT ${key} AS key, SUM(seconds) AS seconds FROM reading_time
       WHERE user_id = ? AND slot >= ? AND slot < ? GROUP BY key ORDER BY key`,
      userId, from, to,
    ).map(point => ({ key: point.key, seconds: point.seconds }));
    const rows = this.db.all<{ book_id: string; seconds: number; last_at: number; title: string | null; author: string | null }>(
      `SELECT t.book_id, SUM(t.seconds) AS seconds, MAX(t.slot) AS last_at, b.title, b.author
       FROM reading_time t LEFT JOIN books b ON b.id = t.book_id
       WHERE t.user_id = ? AND t.slot >= ? AND t.slot < ?
       GROUP BY t.book_id ORDER BY seconds DESC LIMIT 200`,
      userId, from, to,
    );
    // The shelf's own view of each book (overrides, cover); one off the shelf keeps its stored title.
    const shelf = this.shelf.getMany(userId, rows.map(row => row.book_id));
    const works = rows.map((row) => {
      const book = shelf.get(row.book_id);
      return {
        id: row.book_id,
        title: book?.title || row.title || '未知书籍',
        author: book?.author ?? row.author ?? '',
        coverUrl: book?.coverUrl ?? null,
        seconds: row.seconds,
        lastAt: row.last_at,
      };
    });
    return { series, works, total: series.reduce((sum, point) => sum + point.seconds, 0) };
  }

  /** Administrators: every account's reading total in the range. */
  users(query: Pick<StatsQuery, 'from' | 'to'>): Array<{ userId: string; username: string; displayName: string; seconds: number }> {
    const { from, to } = validQuery({ ...query, tz: 0, group: 'day' });
    return this.db.all<{ userId: string; username: string; displayName: string; seconds: number }>(
      `SELECT u.id AS userId, u.username AS username, COALESCE(u.display_name, '') AS displayName,
              COALESCE((SELECT SUM(t.seconds) FROM reading_time t WHERE t.user_id = u.id AND t.slot >= ? AND t.slot < ?), 0) AS seconds
       FROM users u ORDER BY seconds DESC, u.username`,
      from, to,
    );
  }
}

/** Shared by the media side, which answers the same query from media.db. */
export function validQuery(query: Partial<StatsQuery>): StatsQuery {
  const from = Number(query.from), to = Number(query.to), tz = Number(query.tz ?? 0);
  const group = (query.group ?? 'day') as StatsGroup;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) throw badRequest('invalid range', 'BAD_RANGE');
  if (!Number.isInteger(tz) || Math.abs(tz) > 14 * 60) throw badRequest('invalid timezone offset', 'BAD_RANGE');
  if (!(group in FORMATS)) throw badRequest('invalid group', 'BAD_RANGE');
  return { from, to, tz, group };
}

export const STATS_FORMATS = FORMATS;
