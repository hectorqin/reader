import { describe, expect, it } from 'vitest';
import { buildPeriods, formatDuration, mergeSeries, mergeWorks, periodRange, shiftAnchor } from '../src/features/stats/stats-model.ts';

describe('时长统计 model', () => {
  const now = new Date(2026, 9, 31, 12);

  it('shows a month by day, a year by month and six years by year, in the local calendar', () => {
    const month = periodRange('day', '', now);
    expect([month.label, month.anchor]).toEqual(['2026年10月', '2026-10']);
    const days = buildPeriods('day', month);
    expect(days).toHaveLength(31);
    expect(days[0]).toMatchObject({ key: '2026-10-01', label: '10月1日', tick: '1' });
    expect(days[0]!.from).toBe(new Date(2026, 9, 1).getTime());
    expect(buildPeriods('month', periodRange('month', '2025', now)).map(p => p.key)).toEqual(
      ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']);
    expect(buildPeriods('year', periodRange('year', '', now)).map(p => p.key)).toEqual(['2021', '2022', '2023', '2024', '2025', '2026']);
    expect(periodRange('day', 'junk', now).anchor).toBe('2026-10');
  });

  it('steps across year boundaries', () => {
    expect(shiftAnchor('day', '2026-01', -1)).toBe('2025-12');
    expect(shiftAnchor('day', '2026-12', 1)).toBe('2027-01');
    expect(shiftAnchor('month', '2026', -1)).toBe('2025');
  });

  it('merges both halves into one series and one ranking', () => {
    const periods = buildPeriods('month', periodRange('month', '2026', now));
    const series = mergeSeries(periods,
      { series: [{ key: '2026-10', seconds: 600 }], works: [{ id: 'b', title: '书', author: '作者', coverUrl: null, seconds: 600, lastAt: 0 }], total: 600 },
      { series: [{ key: '2026-10', channel: 'video', seconds: 3600 }, { key: '2027-01', channel: 'music', seconds: 5 }],
        works: [{ id: 'm', channel: 'video', kind: 'movie', title: '电影', seconds: 3600, lastAt: 0 }] });
    expect(series.find(p => p.key === '2026-10')!.byKind).toEqual({ reading: 600, video: 3600, audiobook: 0, music: 0 });
    expect(mergeWorks(
      { series: [], works: [{ id: 'b', title: '书', author: '作者', coverUrl: null, seconds: 600, lastAt: 0 }], total: 600 },
      { series: [], works: [{ id: 'm', channel: 'video', kind: 'movie', title: '电影', seconds: 3600, lastAt: 0 }] },
    ).map(w => [w.kind, w.title])).toEqual([['video', '电影'], ['reading', '书']]);
  });

  it('formats in minutes', () => {
    expect([0, 30, 60, 3600, 3720, 7260].map(formatDuration)).toEqual(['0分', '不足1分', '1分', '1小时', '1小时2分', '2小时1分']);
  });
});
