import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { useMediaEnabled } from '../../../shared/stores/features.ts';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import { IconButton, Segmented } from '../../../ui/toolkit.tsx';
import { Icon } from '../../../ui/icon.tsx';
import type { TimeStatsGroup, TimeStatsQuery } from '../../../api/client.ts';
import { HEAT_STEPS, STAT_KINDS, buildPeriods, formatDuration, heatSummary, heatWeeks, heatmapRange, mergeSeries, mergeWorks, periodRange, shiftAnchor, statsTz, type StatKind } from '../stats-model.ts';
import '../styles/stats.css';

const GROUPS: Array<{ value: TimeStatsGroup; label: string }> = [
  { value: 'day', label: '按天' },
  { value: 'month', label: '按月' },
  { value: 'year', label: '按年' },
];

/**
 * 时长统计: reading, watching and listening time per day, month or year, and per work.
 *
 * Everything the reader chooses lives in the URL (group, the period shown, the bar
 * picked, the kind filter), so back from a work returns to the same view. The two
 * halves are fetched separately: reading time from reader.db, media time from the
 * media service, which may still be starting — then the page says so and shows the
 * reading half rather than nothing.
 */
export function StatsPage() {
  const runtime = useRuntime();
  const enabled=useMediaEnabled();
  const kinds=STAT_KINDS.filter(item=>enabled||item.kind==='reading');
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const [params, setParams] = useSearchParams();
  const group = (['day', 'month', 'year'].includes(params.get('g') ?? '') ? params.get('g') : 'day') as TimeStatsGroup;
  const anchor = params.get('at') ?? '';
  const selected = params.get('sel') ?? '';
  const kind = (kinds.some(item => item.kind === params.get('kind')) ? params.get('kind') : '') as StatKind | '';
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace: true });
  };

  const tz = statsTz();
  const range = periodRange(group, anchor);
  const chartQuery: TimeStatsQuery = { from: range.from, to: range.to, tz, group };
  const periods = useMemo(() => buildPeriods(group, range), [group, range.from, range.to]);
  const pick = periods.find(period => period.key === selected);
  // The works list answers for the bar picked, or for the whole range shown.
  const worksQuery: TimeStatsQuery = pick ? { from: pick.from, to: pick.to, tz, group } : chartQuery;

  const reading = useQuery({ queryKey: ['stats', 'reading', chartQuery], queryFn: ({ signal }) => runtime.api.readingStats(chartQuery, { signal }) });
  const media = useQuery({ queryKey: ['stats', 'media', chartQuery], queryFn: ({ signal }) => runtime.mediaApi.timeStats(chartQuery, signal), enabled, retry: false });
  const readingWorks = useQuery({ queryKey: ['stats', 'reading', worksQuery], queryFn: ({ signal }) => runtime.api.readingStats(worksQuery, { signal }), enabled: !!pick });
  const mediaWorks = useQuery({ queryKey: ['stats', 'media', worksQuery], queryFn: ({ signal }) => runtime.mediaApi.timeStats(worksQuery, signal), enabled: enabled&&!!pick, retry: false });

  const series = mergeSeries(periods, reading.data, enabled?media.data:undefined);
  const works = mergeWorks(pick ? readingWorks.data : reading.data, enabled?(pick ? mediaWorks.data : media.data):undefined).filter(work => !kind || work.kind === kind);
  const totals = Object.fromEntries(STAT_KINDS.map(item => [item.kind, series.reduce((sum, point) => sum + point.byKind[item.kind], 0)])) as Record<StatKind, number>;
  const shown = (point: { byKind: Record<StatKind, number> }) => kind ? point.byKind[kind] : STAT_KINDS.reduce((sum, item) => sum + point.byKind[item.kind], 0);
  const max = Math.max(1, ...series.map(shown));
  const grand = kind ? totals[kind] : STAT_KINDS.reduce((sum, item) => sum + totals[item.kind], 0);
  const [hover, setHover] = useState('');
  const focus = series.find(point => point.key === (hover || selected));

  return <MediaPageFrame className="media-secondary-page stats-page" title="时长统计" backTo="/me" backLabel="返回我的">
    <div className="stats-controls">
      <Segmented label="统计方式" options={GROUPS} value={group} onChange={value => set({ g: value === 'day' ? '' : value, at: '', sel: '' })} />
      {group !== 'year' && <div className="stats-nav">
        <IconButton icon="chevron-left" label="上一段" onClick={() => set({ at: shiftAnchor(group, range.anchor, -1), sel: '' })} />
        <strong>{range.label}</strong>
        <IconButton icon="chevron-right" label="下一段" disabled={range.to > Date.now()} onClick={() => set({ at: shiftAnchor(group, range.anchor, 1), sel: '' })} />
      </div>}
    </div>
    <div className="stats-kinds" role="group" aria-label="类型">
      <button type="button" aria-pressed={!kind} onClick={() => set({ kind: '' })}><span>全部</span><strong>{formatDuration(STAT_KINDS.reduce((sum, item) => sum + totals[item.kind], 0))}</strong></button>
      {kinds.map(item => <button type="button" key={item.kind} aria-pressed={kind === item.kind} onClick={() => set({ kind: kind === item.kind ? '' : item.kind })}>
        <span><i className="stats-swatch" data-kind={item.kind} aria-hidden="true" />{item.label}</span><strong>{formatDuration(totals[item.kind])}</strong>
      </button>)}
    </div>
    {enabled&&media.error && <p className="stats-note" role="status">影音时长暂时无法读取{isStarting(media.error) ? '（影音服务正在启动）' : ''}，下面只包含阅读时长。</p>}
    {reading.error && <p className="stats-note" role="alert">阅读时长读取失败。<button type="button" className="button" onClick={() => void reading.refetch()}>重试</button></p>}

    <section className="stats-chart" aria-label={`${range.label}时长`}>
      <div className="stats-readout" aria-live="polite">
        {focus ? <><small>{focus.label}</small><strong>{formatDuration(shown(focus))}</strong>
          {!kind && <span>{STAT_KINDS.filter(item => focus.byKind[item.kind] > 0).map(item => `${item.label} ${formatDuration(focus.byKind[item.kind])}`).join(' · ') || '无记录'}</span>}</>
          : <><small>{range.label}合计</small><strong>{formatDuration(grand)}</strong><span>{reading.isPending ? '正在读取…' : '点柱子查看当期作品'}</span></>}
      </div>
      <div className="stats-bars" data-group={group} onPointerLeave={() => setHover('')}>
        {series.map(point => {
          const value = shown(point);
          return <button type="button" key={point.key} className="stats-bar" aria-pressed={point.key === selected}
            aria-label={`${point.label} ${formatDuration(value)}`}
            onPointerEnter={event => { if (event.pointerType === 'mouse') setHover(point.key); }}
            onClick={() => set({ sel: point.key === selected ? '' : point.key })}>
            <span className="stats-stack" style={{ height: `${(value / max) * 100}%` }}>
              {(kind ? [kind] : STAT_KINDS.map(item => item.kind)).filter(id => point.byKind[id] > 0).map(id =>
                <span key={id} className="stats-segment" data-kind={id} style={{ flexGrow: point.byKind[id] }} />)}
            </span>
            <small>{point.tick}</small>
          </button>;
        })}
      </div>
      <details className="stats-table">
        <summary>表格</summary>
        <table>
          <thead><tr><th scope="col">{group === 'day' ? '日期' : group === 'month' ? '月份' : '年份'}</th>{kinds.map(item => <th scope="col" key={item.kind}>{item.label}</th>)}</tr></thead>
          <tbody>{series.filter(point => shown(point) > 0).map(point => <tr key={point.key}><th scope="row">{point.label}</th>{kinds.map(item => <td key={item.kind}>{point.byKind[item.kind] ? formatDuration(point.byKind[item.kind]) : '—'}</td>)}</tr>)}</tbody>
        </table>
      </details>
    </section>

    <ReadingCalendar kind={kind} onPick={key => set({ g: '', at: key.slice(0, 7), sel: key })} />

    <section className="stats-works" aria-label="作品">
      <h2>{pick ? `${pick.label}的作品` : `${range.label}的作品`}{pick && <button type="button" className="stats-clear" onClick={() => set({ sel: '' })}>看整段</button>}</h2>
      {works.length === 0 && !reading.isPending && <p className="stats-empty">这段时间还没有记录。时长从这个版本起开始统计。</p>}
      <ol>{works.map(work => {
        const meta = STAT_KINDS.find(item => item.kind === work.kind)!;
        const to = work.kind === 'reading' ? `/book/${encodeURIComponent(work.id)}` : `/media/${work.kind}/items/${encodeURIComponent(work.id)}`;
        return <li key={`${work.kind}:${work.id}`}>
          <Link to={to} state={{ returnTo: `/me/stats?${params.toString()}` }}>
            <span className="stats-work-icon" data-kind={work.kind} aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
            <span className="stats-work-text"><strong>{work.title}</strong><small>{meta.label}{work.subtitle ? ` · ${work.subtitle}` : ''}</small></span>
            <span className="stats-work-time">{formatDuration(work.seconds)}</span>
          </Link>
        </li>;
      })}</ol>
    </section>
    {user?.role === 'admin' && <AdminOverview query={chartQuery} label={range.label} />}
  </MediaPageFrame>;
}

/**
 * 阅读日历: the last 53 weeks, one square per day, darker for more time. It follows
 * the kind filter above it (阅读 alone, or everything), and a day opens the chart on
 * that day's month with the day picked, so its works are listed below.
 */
function ReadingCalendar({ kind, onPick }: { kind: StatKind | ''; onPick(key: string): void }) {
  const runtime = useRuntime();
  const enabled = useMediaEnabled();
  const now = new Date();
  const range = heatmapRange(now);
  const query: TimeStatsQuery = { from: range.from, to: range.to, tz: statsTz(), group: 'day' };
  const reading = useQuery({ queryKey: ['stats', 'reading', query], queryFn: ({ signal }) => runtime.api.readingStats(query, { signal }) });
  const media = useQuery({ queryKey: ['stats', 'media', query], queryFn: ({ signal }) => runtime.mediaApi.timeStats(query, signal), enabled, retry: false });
  const periods = useMemo(() => buildPeriods('day', range), [range.from, range.to]);
  const points = mergeSeries(periods, reading.data, enabled ? media.data : undefined)
    .map(point => ({ ...point, seconds: kind ? point.byKind[kind] : STAT_KINDS.reduce((sum, item) => sum + point.byKind[item.kind], 0) }));
  const weeks = heatWeeks(points, now);
  const summary = heatSummary(points, now);
  const what = kind ? STAT_KINDS.find(item => item.kind === kind)!.label : '阅读与影音';
  const scroller = useRef<HTMLDivElement>(null);
  // The weeks that matter are the recent ones: on a narrow screen, start at the right.
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [reading.isPending]);
  return <section className="stats-calendar" aria-label="阅读日历" data-kind={kind || 'all'}>
    <h2>{kind && kind !== 'reading' ? `${what}日历` : '阅读日历'}<small>近一年</small></h2>
    <p className="stats-calendar-summary" aria-live="polite">{reading.isPending ? '正在读取…'
      : summary.days ? `${summary.days} 天有记录 · 合计 ${formatDuration(summary.total)} · 当前连续 ${summary.current} 天 · 最长连续 ${summary.longest} 天`
        : '近一年还没有记录。'}</p>
    <div className="stats-calendar-scroll" ref={scroller}>
      <div className="stats-calendar-grid" role="grid" aria-label={`${what}，近一年每天的时长`}>
        <div className="stats-calendar-days" aria-hidden="true"><span /><span>一</span><span /><span>三</span><span /><span>五</span><span /></div>
        {weeks.map((week, index) => <div key={index} className="stats-calendar-week" role="row">
          <span className="stats-calendar-month" aria-hidden="true">{week.month}</span>
          {week.cells.map(cell => <button type="button" role="gridcell" key={cell.key} className="stats-calendar-day" data-level={cell.level}
            disabled={cell.future} aria-label={`${cell.label} ${cell.seconds ? formatDuration(cell.seconds) : '无记录'}`} title={`${cell.label} ${cell.seconds ? formatDuration(cell.seconds) : '无记录'}`}
            onClick={() => onPick(cell.key)} />)}
        </div>)}
      </div>
    </div>
    <div className="stats-calendar-legend" aria-label="图例">
      <span>少</span>
      <i className="stats-calendar-day" data-level={0} title="无记录" />
      {HEAT_STEPS.map((step, index) => <i key={step.min} className="stats-calendar-day" data-level={index + 1} title={step.label} />)}
      <span>多（深色为 2 小时以上）</span>
    </div>
    {enabled && !kind && media.error && <p className="stats-note">影音时长暂时无法读取，日历只包含阅读。</p>}
  </section>;
}

/** Administrators: each account's time in the range shown, by kind. */
function AdminOverview({ query, label }: { query: TimeStatsQuery; label: string }) {
  const runtime = useRuntime();
  const enabled=useMediaEnabled();
  const kinds=STAT_KINDS.filter(item=>enabled||item.kind==='reading');
  const reading = useQuery({ queryKey: ['stats', 'users', 'reading', query], queryFn: ({ signal }) => runtime.api.readingStatsUsers(query, { signal }) });
  const media = useQuery({ queryKey: ['stats', 'users', 'media', query], queryFn: ({ signal }) => runtime.mediaApi.statsUsers(query, signal), enabled, retry: false });
  const rows = (reading.data ?? []).map(user => {
    const byKind: Record<StatKind, number> = { reading: user.seconds, video: 0, audiobook: 0, music: 0 };
    for (const row of (enabled?media.data:undefined) ?? []) if (row.userId === user.userId) byKind[row.channel] += row.seconds;
    return { ...user, byKind, total: STAT_KINDS.reduce((sum, item) => sum + byKind[item.kind], 0) };
  }).sort((a, b) => b.total - a.total);
  return <section className="stats-admin" aria-label="全部用户">
    <h2>全部用户 · {label}</h2>
    {reading.isPending ? <p className="stats-empty">正在读取…</p> : <div className="stats-admin-scroll"><table>
      <thead><tr><th scope="col">用户</th><th scope="col">合计</th>{kinds.map(item => <th scope="col" key={item.kind}>{item.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.userId}><th scope="row">{row.displayName || row.username}</th><td>{formatDuration(row.total)}</td>
        {kinds.map(item => <td key={item.kind}>{row.byKind[item.kind] ? formatDuration(row.byKind[item.kind]) : '—'}</td>)}</tr>)}</tbody>
    </table></div>}
    {enabled&&media.error && <p className="stats-note">影音时长暂时无法读取，表中只有阅读时长。</p>}
  </section>;
}

function isStarting(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 503;
}
