import { Button, Card, Group, Pagination, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { historyQuery, type Activity } from '../queries/media.queries.ts';
import { useMediaChannel } from '../hooks/use-media-channel.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';

export function MediaHistoryPage() {
  const runtime = useRuntime(), channel = useMediaChannel(), [params, setParams] = useSearchParams();
  const query = useQuery(historyQuery(runtime, channel, params));
  const play = useMutation({ mutationFn: async (row: Activity) => {
    const detail = await runtime.queryClient.ensureQueryData({ queryKey: ['media', runtime.mediaApi.preferenceScope(), 'detail', row.itemId], queryFn: ({ signal }) => runtime.mediaApi.detail(row.itemId, signal) });
    const parts = detail.editions.find(edition => edition.parts.some(part => part.id === row.partId))?.parts.filter(part => part.available) ?? [];
    const index = parts.findIndex(part => part.id === row.partId);
    if (index < 0) throw new Error('资源已不可用，请在作品详情中选择其他版本。');
    await runtime.player.play(parts.map(part => ({ part, title: detail.title, video: channel === 'video' })), index);
  } });
  return <MediaPageFrame title="播放历史"><QueryFeedback pending={query.isPending} error={query.error ?? play.error} retry={() => { void query.refetch(); }} />
    {query.data?.items.map(row => <Card key={row.id || row.partId} withBorder><Group justify="space-between"><div><Text component={Link} to={`/media/${channel}/items/${row.itemId}`} fw={600}>{row.title}</Text><Text size="sm" c="dimmed">{row.partTitle}{row.completed ? ' · 已完成' : ''}</Text></div><Button disabled={!row.available} loading={play.isPending} onClick={() => play.mutate(row)}>播放</Button></Group></Card>)}
    {query.data && <Pagination total={Math.max(1, Math.ceil(query.data.total / 60))} value={Math.floor(Number(params.get('offset') ?? 0) / 60) + 1} onChange={page => setParams({ offset: String((page - 1) * 60) })} />}
  </MediaPageFrame>;
}
