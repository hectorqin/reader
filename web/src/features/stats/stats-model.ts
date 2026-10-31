import type { IconName } from '../../ui/icon.tsx';
import type { ReadingStats, TimeStatsGroup } from '../../api/client.ts';
import type { MediaTimeStats } from '../media/api/media-api.ts';

/**
 * 时长统计's view model: periods in the viewer's own calendar, and the two halves
 * (reading from the server, media from the media service) merged into one shape.
 * Pure, so the arithmetic the page depends on is tested without a DOM.
 */
export type StatKind = 'reading' | 'video' | 'audiobook' | 'music';

/** Fixed order: a kind keeps its colour (--color-chart-N) whatever is filtered. */
export const STAT_KINDS: ReadonlyArray<{ kind: StatKind; label: string; icon: IconName }> = [
  { kind: 'reading', label: '阅读', icon: 'book' },
  { kind: 'video', label: '观影', icon: 'video' },
  { kind: 'audiobook', label: '有声书', icon: 'audiobook' },
  { kind: 'music', label: '音乐', icon: 'music' },
];

export interface Period { key: string; label: string; tick: string; from: number; to: number }
export interface StatsRange { from: number; to: number; label: string; anchor: string }

/** The viewer's offset from UTC in minutes east, as the server expects it. */
export function statsTz(at = new Date()): number {
  return -at.getTimezoneOffset();
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The span the chart shows. 按天 shows a month (anchor `YYYY-MM`), 按月 a year
 * (anchor `YYYY`), 按年 the last six years. A missing or malformed anchor is now.
 */
export function periodRange(group: TimeStatsGroup, anchor: string, now = new Date()): StatsRange {
  if (group === 'day') {
    const match = /^(\d{4})-(\d{2})$/.exec(anchor);
    const year = match ? Number(match[1]) : now.getFullYear(), month = match ? Number(match[2]) - 1 : now.getMonth();
    return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime(), label: `${year}年${month + 1}月`, anchor: `${year}-${pad(month + 1)}` };
  }
  if (group === 'month') {
    const year = /^\d{4}$/.test(anchor) ? Number(anchor) : now.getFullYear();
    return { from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime(), label: `${year}年`, anchor: String(year) };
  }
  const year = now.getFullYear();
  return { from: new Date(year - 5, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime(), label: '近六年', anchor: '' };
}

/** The anchor one span earlier (-1) or later (+1). */
export function shiftAnchor(group: TimeStatsGroup, anchor: string, step: -1 | 1): string {
  if (group === 'day') {
    const [year, month] = anchor.split('-').map(Number) as [number, number];
    const date = new Date(year, month - 1 + step, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }
  return group === 'month' ? String(Number(anchor) + step) : '';
}

/** Every bar in the range, in the keys the server groups by. */
export function buildPeriods(group: TimeStatsGroup, range: Pick<StatsRange, 'from' | 'to'>): Period[] {
  const periods: Period[] = [];
  const start = new Date(range.from);
  for (let index = 0; ; index += 1) {
    const from = group === 'day' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
      : group === 'month' ? new Date(start.getFullYear(), start.getMonth() + index, 1)
        : new Date(start.getFullYear() + index, 0, 1);
    if (from.getTime() >= range.to) break;
    const to = group === 'day' ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
      : group === 'month' ? new Date(from.getFullYear(), from.getMonth() + 1, 1)
        : new Date(from.getFullYear() + 1, 0, 1);
    const y = from.getFullYear(), m = from.getMonth() + 1, d = from.getDate();
    periods.push(group === 'day'
      ? { key: `${y}-${pad(m)}-${pad(d)}`, label: `${m}月${d}日`, tick: d === 1 || d % 5 === 0 ? String(d) : '', from: from.getTime(), to: to.getTime() }
      : group === 'month'
        ? { key: `${y}-${pad(m)}`, label: `${y}年${m}月`, tick: String(m), from: from.getTime(), to: to.getTime() }
        : { key: String(y), label: `${y}年`, tick: String(y), from: from.getTime(), to: to.getTime() });
  }
  return periods;
}

export function periodLabel(periods: Period[], key: string): string {
  return periods.find(period => period.key === key)?.label ?? key;
}

export type SeriesPoint = Period & { byKind: Record<StatKind, number> };

export function mergeSeries(periods: Period[], reading?: ReadingStats, media?: MediaTimeStats): SeriesPoint[] {
  const byKey = new Map(periods.map(period => [period.key, { ...period, byKind: { reading: 0, video: 0, audiobook: 0, music: 0 } }]));
  for (const point of reading?.series ?? []) { const row = byKey.get(point.key); if (row) row.byKind.reading += point.seconds; }
  for (const point of media?.series ?? []) { const row = byKey.get(point.key); if (row) row.byKind[point.channel] += point.seconds; }
  return [...byKey.values()];
}

export interface StatWork { kind: StatKind; id: string; title: string; subtitle: string; seconds: number }

export function mergeWorks(reading?: ReadingStats, media?: MediaTimeStats): StatWork[] {
  return [
    ...(reading?.works ?? []).map(work => ({ kind: 'reading' as const, id: work.id, title: work.title, subtitle: work.author, seconds: work.seconds })),
    ...(media?.works ?? []).map(work => ({ kind: work.channel, id: work.id, title: work.title, subtitle: '', seconds: work.seconds })),
  ].filter(work => work.seconds > 0).sort((a, b) => b.seconds - a.seconds);
}

/** 2小时5分 · 12分 · 不足1分 — minutes are the unit; seconds would be noise. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (seconds <= 0) return '0分';
  if (minutes < 1) return '不足1分';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? (rest ? `${hours}小时${rest}分` : `${hours}小时`) : `${rest}分`;
}
