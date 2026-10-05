import { Button } from '@mantine/core';
import { Clock3, Play } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { historyQuery, type Activity } from '../queries/media.queries.ts';
import { channelLabels, useMediaChannel } from '../hooks/use-media-channel.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { historyDay, historyPosition } from '../components/history-labels.ts';

export function MediaHistoryPage() {
  const runtime = useRuntime(), channel = useMediaChannel(), location = useLocation(), [params, setParams] = useSearchParams();
  const query = useQuery(historyQuery(runtime, channel, params));
  const play = useMutation({ mutationFn: async (row: Activity) => {
    const detail = await runtime.queryClient.ensureQueryData({ queryKey: ['media', runtime.mediaApi.preferenceScope(), 'detail', row.itemId], queryFn: ({ signal }) => runtime.mediaApi.detail(row.itemId, signal) });
    const parts = detail.editions.find(edition => edition.parts.some(part => part.id === row.partId))?.parts.filter(part => part.available) ?? [];
    const index = parts.findIndex(part => part.id === row.partId);
    if (index < 0) throw new Error('资源已不可用，请在作品详情中选择其他版本。');
    await runtime.player.play(parts.map(part => ({ part, title: detail.title, video: channel === 'video' })), index);
  } });
  return <MediaPageFrame className="media-secondary-page" title="播放历史" subtitle={channelLabels[channel]}><section className="media-history-page"><QueryFeedback pending={query.isPending} error={query.error ?? play.error} retry={() => { void query.refetch(); }} />
    <div className="media-history-list">{query.data?.items.map((row, index, rows) => <div key={row.id || row.partId}>
      {(index === 0 || historyDay(row.updatedAt) !== historyDay(rows[index - 1]?.updatedAt)) && <h2 className="media-history-date">{historyDay(row.updatedAt)}</h2>}
      <article className="media-row media-history-row"><div><Link className="media-personal-title" to={`/media/${channel}/items/${row.itemId}`} state={{ returnTo: location.pathname + location.search }}>{row.title}</Link><small>{[row.partTitle, row.editionLabel].filter(Boolean).join(' · ')}{row.completed ? ' · 已完成' : row.position !== undefined ? ` · ${historyPosition(row.position, row.start)}` : ''}</small>{!row.available && <small className="media-history-unavailable">资源不可用</small>}</div><button className="media-history-play" aria-label="播放" title={row.available ? '播放' : '资源不可用'} disabled={!row.available || play.isPending} onClick={() => play.mutate(row)}><Play size={18} aria-hidden="true" /></button></article>
    </div>)}</div>
    {query.data && query.data.items.length === 0 && <div className="media-personal-empty"><Clock3 size={32} strokeWidth={1.4} aria-hidden="true" /><p>暂无记录。</p></div>}
    {query.data && query.data.total > 60 && <nav className="media-toolbar media-pagination" aria-label="分页">
      <Button disabled={Number(params.get('offset') ?? 0) <= 0 || query.isFetching} onClick={() => setParams({ offset: Math.max(0, Number(params.get('offset') ?? 0) - 60) ? String(Math.max(0, Number(params.get('offset') ?? 0) - 60)) : '' })}>上一页</Button>
      <span>{Math.floor(Number(params.get('offset') ?? 0) / 60) + 1} / {Math.ceil(query.data.total / 60)}</span>
      <Button disabled={Number(params.get('offset') ?? 0) + 60 >= query.data.total || query.isFetching} onClick={() => setParams({ offset: String(Number(params.get('offset') ?? 0) + 60) })}>下一页</Button>
    </nav>}
  </section>
  </MediaPageFrame>;
}
