import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { ListMusic } from 'lucide-react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { queueQuery, type Activity } from '../queries/media.queries.ts';
import { channelLabels } from '../hooks/use-media-channel.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { SavedQueue } from '../components/saved-queue.tsx';
import { FloatingConfirm } from '../../../ui/floating-confirm.tsx';

function queueChannel(kind: string): 'video' | 'music' | 'audiobook' {
  return kind === 'audiobook' ? 'audiobook' : ['album', 'artist', 'track'].includes(kind) ? 'music' : 'video';
}

export function MediaQueuePage() {
  const runtime = useRuntime(), navigate = useNavigate(), location = useLocation(), queryClient = useQueryClient();
  const { channel: routeChannel } = useParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' || routeChannel === 'video' ? routeChannel : null;
  const query = useQuery(queueQuery(runtime));
  const [confirming, setConfirming] = useState(false);
  const action = useMutation({
    mutationFn: async ({ type, row, index, direction }: { type: 'play' | 'move' | 'remove' | 'clear'; row?: Activity; index?: number; direction?: 'up' | 'down' }) => {
      const entries = query.data?.items ?? [];
      if (type === 'play' && row !== undefined && index !== undefined) {
        const channelEntries = entries.filter(entry => queueChannel(entry.kind) === queueChannel(row.kind));
        const playable = channelEntries.filter(entry => !!entry.available).map(entry => ({
          part: { id: entry.partId, assetId: entry.assetId, title: entry.partTitle, start: entry.start, end: entry.end, available: true },
          title: entry.title,
          video: queueChannel(entry.kind) === 'video',
        }));
        const playableIndex = channelEntries.slice(0, channelEntries.findIndex(entry => entry.id === row.id)).filter(entry => !!entry.available).length;
        await runtime.player.play(playable, playableIndex);
        return;
      }
      if (type === 'move' && row !== undefined && index !== undefined && direction) {
        const channelEntries = entries.filter(entry => queueChannel(entry.kind) === queueChannel(row.kind));
        const localIndex = channelEntries.findIndex(entry => entry.id === row.id);
        const neighbor = channelEntries[localIndex + (direction === 'up' ? -1 : 1)];
        if (!neighbor) return;
        await runtime.mediaApi.request(`queue/${encodeURIComponent(row.id)}/move`, 'POST', { direction, neighborId: neighbor.id });
        return;
      }
      if (type === 'remove' && row !== undefined) {
        await runtime.mediaApi.request(`queue/${encodeURIComponent(row.id)}`, 'DELETE');
        return;
      }
      if (type === 'clear') {
        if (channel) {
          await runtime.mediaApi.request('queue/clear', 'POST', { channel, entryIds: entries.map(entry => entry.id) });
        } else {
          const grouped = new Map<string, string[]>();
          for (const entry of entries) { const kind = queueChannel(entry.kind), ids = grouped.get(kind) ?? []; ids.push(entry.id); grouped.set(kind, ids); }
          for (const [kind, entryIds] of grouped) await runtime.mediaApi.request('queue/clear', 'POST', { channel: kind, entryIds });
        }
      }
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queueQuery(runtime).queryKey }); },
  });
  const entries = (query.data?.items ?? []).filter(entry => !channel || queueChannel(entry.kind) === channel);
  return <MediaPageFrame className="media-secondary-page" title="待播队列" subtitle={channel ? channelLabels[channel] : '影音'}><section className="media-queue-page">
    <QueryFeedback pending={query.isPending} error={query.error ?? action.error} retry={() => { void query.refetch(); }} />
    {!query.isPending && !query.error && entries.length > 0 && <SavedQueue
      entries={entries}
      busy={query.isFetching || action.isPending}
      onPlay={(index) => { const row = entries[index]; if (row) action.mutate({ type: 'play', row, index }); }}
      onDetail={id => { const row = entries.find(entry => entry.itemId === id); navigate(`/media/${row ? queueChannel(row.kind) : 'video'}/items/${encodeURIComponent(id)}`, { state: { returnTo: location.pathname + location.search } }); }}
      onMove={(index, direction) => { const row = entries[index]; if (row) action.mutate({ type: 'move', row, index, direction }); }}
      onRemove={id => { const row = entries.find(entry => entry.id === id); if (row) action.mutate({ type: 'remove', row }); }}
      onClear={() => setConfirming(true)}
    />}
    {!query.isPending && !query.error && entries.length === 0 && <div className="media-personal-empty"><ListMusic size={30} strokeWidth={1.4} aria-hidden="true" /><p>暂无记录。</p></div>}
    {confirming && <FloatingConfirm theme="media" title="清空队列" text={`移除${channel ? `当前${channel === 'video' ? '影视' : channel === 'music' ? '音乐' : '有声书'}` : '全部'}队列中的 ${entries.length} 条记录？不会删除文件或停止当前播放。`} confirmText="确认清空" cancelText="保留队列" onConfirm={() => { setConfirming(false); action.mutate({ type: 'clear' }); }} onCancel={() => setConfirming(false)} />}
  </section></MediaPageFrame>;
}
