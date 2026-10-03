import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { queueQuery, type Activity } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';

export function MediaQueuePage() {
  const runtime = useRuntime();
  const query = useQuery(queueQuery(runtime));
  const play = useMutation({ mutationFn: async (row: Activity) => {
    const detail = await runtime.queryClient.ensureQueryData({ queryKey: ['media', runtime.mediaApi.preferenceScope(), 'detail', row.itemId], queryFn: ({ signal }) => runtime.mediaApi.detail(row.itemId, signal) });
    const parts = detail.editions.flatMap(edition => edition.parts).filter(part => part.available);
    const index = Math.max(0, parts.findIndex(part => part.id === row.partId));
    await runtime.player.play(parts.map(part => ({ part, title: detail.title, video: detail.kind === 'movie' || detail.kind === 'series' })), index);
  } });
  return <MediaPageFrame title="待播队列"><QueryFeedback pending={query.isPending} error={query.error ?? play.error} retry={() => { void query.refetch(); }} /><Stack>{query.data?.items.map(row => <Card key={row.id || row.partId} withBorder><Group justify="space-between"><div><Text component={Link} to={`/media/video/items/${row.itemId}`} fw={600}>{row.title}</Text><Text size="sm" c="dimmed">{row.partTitle}</Text></div><Button loading={play.isPending} disabled={!row.available} onClick={() => play.mutate(row)}>播放</Button></Group></Card>)}</Stack></MediaPageFrame>;
}
