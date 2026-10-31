import type { MediaDatabase } from './read-database.ts';
import type { MediaActor, MediaLibraries } from './libraries.ts';
import { SLOT_MS, STATS_FORMATS, validQuery, type StatsQuery } from '../services/time-stats.ts';

/**
 * 时长统计, the media half (table media_watch_time, written by MediaPlayback).
 *
 * Nothing on the client reports watch time. The web player and the Android Media3
 * service both already save progress every few seconds while playing, so the time
 * is derived on the server from consecutive saves of one session: the wall-clock
 * gap or the position advance, whichever is smaller. The smaller one is the time
 * actually spent: at 2× speed the position runs ahead of the clock; a seek runs
 * ahead of both; a pause stops the position. A gap over `MAX_GAP_MS` is a pause, a
 * dropped connection or a resumed session, and starts counting afresh instead.
 */
const MAX_GAP_MS = 30_000;

export function ensureWatchTimeTable(db: MediaDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS media_watch_time (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,part_id TEXT NOT NULL,
    slot INTEGER NOT NULL,seconds REAL NOT NULL,PRIMARY KEY(user_id,part_id,slot))`);
  db.run('CREATE INDEX IF NOT EXISTS media_watch_time_user ON media_watch_time(user_id,slot)');
}

/** Called inside the progress update's transaction with the row as it was before it. */
export function recordWatchTime(db: MediaDatabase, userId: string, partId: string,
  previous: { position: number; updated_at: number }, position: number, now: number): void {
  const gap = now - previous.updated_at, advance = position - previous.position;
  if (gap <= 0 || gap > MAX_GAP_MS || advance <= 0) return;
  const seconds = Math.min(gap / 1000, advance);
  const slot = now - (now % SLOT_MS);
  db.run(`INSERT INTO media_watch_time(user_id,part_id,slot,seconds) VALUES(?,?,?,?)
    ON CONFLICT(user_id,part_id,slot) DO UPDATE SET seconds=MIN(?,media_watch_time.seconds+excluded.seconds)`,
  userId, partId, slot, seconds, SLOT_MS / 1000);
}

export type MediaChannel = 'video' | 'music' | 'audiobook';

export class MediaTimeStats {
  constructor(private readonly db: MediaDatabase, private readonly libraries: MediaLibraries) {}

  /**
   * One user's time per period and channel, and per work. A work is the top of the
   * part's item tree: the series for an episode, the album for a track, the book for
   * an audiobook chapter, the film itself. Only libraries the user can still see
   * are counted, as everywhere else in media.
   */
  summary(actor: MediaActor, query: Partial<StatsQuery>) {
    const { from, to, tz, group } = validQuery(query);
    const visible = this.libraries.list(actor).map(lib => lib.id);
    if (!visible.length) return { series: [], works: [] };
    const marks = visible.map(() => '?').join(',');
    const rows = `WITH RECURSIVE t AS (
        SELECT w.slot,w.seconds,i.id item_id,i.parent_id,l.kind channel FROM media_watch_time w
        JOIN media_parts p ON p.id=w.part_id JOIN media_editions e ON e.id=p.edition_id JOIN media_items i ON i.id=e.item_id
        JOIN media_libraries l ON l.id=i.library_id
        WHERE w.user_id=? AND w.slot>=? AND w.slot<? AND i.library_id IN (${marks})),
      up(slot,seconds,channel,item_id,parent_id,depth) AS (
        SELECT slot,seconds,channel,item_id,parent_id,0 FROM t
        UNION ALL SELECT up.slot,up.seconds,up.channel,i.id,i.parent_id,up.depth+1 FROM up JOIN media_items i ON i.id=up.parent_id WHERE up.depth<4),
      roots AS (SELECT slot,seconds,channel,item_id FROM up WHERE parent_id IS NULL OR depth=4)`;
    const args = [actor.id, from, to, ...visible];
    const series = this.db.all<{ key: string; channel: MediaChannel; seconds: number }>(
      `${rows} SELECT strftime('${STATS_FORMATS[group]}',(slot+${tz * 60000})/1000,'unixepoch') key,channel,SUM(seconds) seconds
       FROM roots GROUP BY key,channel ORDER BY key,channel`, ...args);
    const works = this.db.all<{ id: string; channel: MediaChannel; kind: string; title: string; seconds: number; lastAt: number }>(
      `${rows}, totals AS (SELECT item_id,channel,SUM(seconds) seconds,MAX(slot) lastAt FROM roots GROUP BY item_id,channel)
       SELECT i.id,t.channel,i.kind,COALESCE(json_extract(o.value_json,'$'),json_extract(m.fields_json,'$.title'),i.title) title,
         t.seconds,t.lastAt FROM totals t JOIN media_items i ON i.id=t.item_id
         LEFT JOIN media_metadata_overrides o ON o.item_id=i.id AND o.field='title' LEFT JOIN media_online_metadata m ON m.item_id=i.id
       ORDER BY t.seconds DESC LIMIT 200`, ...args);
    return { series: series.map(row => ({ ...row, seconds: Math.round(row.seconds) })), works: works.map(row => ({ ...row, seconds: Math.round(row.seconds) })) };
  }

  /** Administrators: every account's time per channel in the range. */
  users(query: Partial<StatsQuery>) {
    const { from, to } = validQuery({ ...query, tz: 0, group: 'day' });
    return this.db.all<{ userId: string; channel: MediaChannel; seconds: number }>(
      `SELECT w.user_id userId,l.kind channel,ROUND(SUM(w.seconds)) seconds FROM media_watch_time w
       JOIN media_parts p ON p.id=w.part_id JOIN media_editions e ON e.id=p.edition_id JOIN media_items i ON i.id=e.item_id
       JOIN media_libraries l ON l.id=i.library_id WHERE w.slot>=? AND w.slot<? GROUP BY w.user_id,l.kind`, from, to);
  }
}
