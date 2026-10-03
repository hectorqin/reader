import { Button, Group, Pagination, Select } from '@mantine/core';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { catalogQuery, useMediaLibraries } from '../queries/media.queries.ts';
import { channelCategories, channelLabels, useMediaChannel } from '../hooks/use-media-channel.ts';
import { MediaItemGrid } from '../components/MediaItemGrid.tsx';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { ContinuePlaying } from '../components/continue-playing.tsx';
import { usePlaybackStore } from '../stores/playback.store.ts';

export function MediaCatalogPage() {
  const runtime = useRuntime(), channel = useMediaChannel(), { category } = useParams(), [params, setParams] = useSearchParams();
  const categories = channelCategories[channel], current = categories.find(item => item.path === category) ?? categories[0]!;
  const query = useQuery(catalogQuery(runtime, channel, current.kind, params)), libraries = useMediaLibraries();
  const playerActive = usePlaybackStore(state => state.active);
  const offset = Number(params.get('offset')) || 0;
  const patch = (values: Record<string, string>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); setParams(next); };
  const channelLibraries = libraries.data?.items.filter(item => item.kind === channel) ?? [];
  const selectedLibrary = params.get('library') ?? '';
  return <MediaPageFrame className="media-catalog-page" title={channelLabels[channel]} actions={<Group gap="xs"><Button component={Link} to={`/media/${channel}/folders${selectedLibrary ? `/${encodeURIComponent(selectedLibrary)}` : ''}`} variant="subtle">文件夹</Button><Button component={Link} to="settings" variant="subtle">设置</Button></Group>}>
    <nav className="media-tabs" aria-label={`${channelLabels[channel]}分类`}>{categories.map(item => <Button key={item.path} component={NavLink} to={`/media/${channel}/${item.path}`} variant={item.path === current.path ? 'filled' : 'subtle'} aria-current={item.path === current.path ? 'page' : undefined}>{item.label}</Button>)}</nav>
    <div className="media-toolbar media-browse-tools"><Select aria-label="来源库" data={[{ value: '', label: '全部媒体库' }, ...(libraries.data?.items.filter(item => item.kind === channel).map(item => ({ value: item.id, label: item.name })) ?? [])]} value={params.get('library') ?? ''} onChange={value => patch({ library: value ?? '', offset: '' })} />
      <Select aria-label="排序" data={[{ value: 'default', label: '默认顺序' }, { value: 'title-asc', label: '名称升序' }, { value: 'title-desc', label: '名称降序' }]} value={params.get('sort') ?? 'default'} onChange={value => patch({ sort: value ?? 'default', offset: '' })} />
    </div>
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {!playerActive && offset === 0 && (current.kind === 'video' || current.kind === 'album' || current.kind === 'audiobook') && <ContinuePlaying
      api={runtime.mediaApi}
      libraryId={selectedLibrary}
      libraryIds={channelLibraries.map(item => item.id)}
      onPlay={async (parts, index, title) => { await runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index); }}
    />}
    {query.data && <><MediaItemGrid items={query.data.items} channel={channel} /><div className="media-toolbar media-pagination"><Pagination total={Math.max(1, Math.ceil(query.data.total / 60))} value={Math.floor(offset / 60) + 1} onChange={page => patch({ offset: String((page - 1) * 60) })} /></div></>}
  </MediaPageFrame>;
}
