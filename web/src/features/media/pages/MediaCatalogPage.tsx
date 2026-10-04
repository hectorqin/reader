import { Button, Pagination, Select } from '@mantine/core';
import { FolderOpen, History, LibraryBig, ListVideo, MoreHorizontal, Search, Settings2, SlidersHorizontal, Star } from 'lucide-react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { catalogQuery, useMediaLibraries } from '../queries/media.queries.ts';
import { channelCategories, channelLabels, useMediaChannel } from '../hooks/use-media-channel.ts';
import { MediaItemGrid } from '../components/MediaItemGrid.tsx';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { ContinuePlaying } from '../components/continue-playing.tsx';
import { usePlaybackStore } from '../stores/playback.store.ts';
import { EmptyMediaLibrary } from '../components/empty-library.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';

export function MediaCatalogPage() {
  const runtime = useRuntime(), navigate = useNavigate(), channel = useMediaChannel(), { category } = useParams(), [params, setParams] = useSearchParams();
  const categories = channelCategories[channel], current = categories.find(item => item.path === category) ?? categories[0]!;
  const query = useQuery(catalogQuery(runtime, channel, current.kind, params)), libraries = useMediaLibraries();
  const playerActive = usePlaybackStore(state => state.active);
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const offset = Number(params.get('offset')) || 0;
  const patch = (values: Record<string, string>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); setParams(next); };
  const channelLibraries = libraries.data?.items.filter(item => item.kind === channel) ?? [];
  const selectedLibrary = params.get('library') ?? '';
  const emptyCatalog = !query.isPending && !query.error && query.data?.total === 0;
  // An empty channel without a configured library uses the focused legacy empty state;
  // there is no source selector or category toolbar to act on in that state.
  const hasLibraries = channelLibraries.length > 0;
  const emptyWithoutLibraries = emptyCatalog && !hasLibraries;
  const libraryOptions = [{ value: '', label: '全部媒体库' }, ...(channelLibraries.map(item => ({ value: item.id, label: item.name })) )];
  return <MediaPageFrame className="media-catalog-page" title={channelLabels[channel]} actions={<>
    <Button component={Link} to="/media/search" className="media-icon-button" aria-label="搜索" title="搜索"><Search size={19} aria-hidden="true" /></Button>
    <details className="media-actions media-catalog-actions">
      <summary aria-label="更多操作" title="更多操作"><MoreHorizontal size={20} aria-hidden="true" /></summary>
      <nav aria-label="更多操作">
        <Link to={`/media/${channel}/settings`}><Settings2 size={16} aria-hidden="true" />影音设置</Link>
        <Link to="/media/favorites"><Star size={16} aria-hidden="true" />收藏</Link>
        <Link to={`/media/${channel}/history`}><History size={16} aria-hidden="true" />历史</Link>
        <Link to={`/media/${channel}/queue`}><ListVideo size={16} aria-hidden="true" />队列</Link>
        <Link to={`/media/${channel}/settings/libraries`}><LibraryBig size={16} aria-hidden="true" />媒体库管理</Link>
      </nav>
    </details>
  </>}>
    {!emptyWithoutLibraries && <>
      <nav className="media-tabs" aria-label={`${channelLabels[channel]}分类`}>{categories.map(item => {
        const defaultCategory = categories[0]!;
        const isDefault = item.path === defaultCategory.path;
        return <NavLink key={item.path} className="media-tab-link" to={isDefault ? `/media/${channel}` : `/media/${channel}/${item.path}`} end={isDefault}>{item.label}</NavLink>;
      })}</nav>
      <div className="media-toolbar media-browse-tools">
        <div className="media-library-filter">
          <Select aria-label="来源库" data={libraryOptions} value={selectedLibrary} onChange={value => patch({ library: value ?? '', offset: '' })} />
          {query.data && <span className="media-catalog-count">{query.data.total}{channel === 'music' && current.kind === 'album' ? ' 张专辑' : ' 项'}</span>}
        </div>
        <div className="media-browse-actions">
          <Button component={Link} to={`/media/${channel}/folders${selectedLibrary ? `/${encodeURIComponent(selectedLibrary)}` : ''}`} className="media-icon-button" aria-label="打开文件夹" title="打开文件夹"><FolderOpen size={19} aria-hidden="true" /></Button>
          <label className="media-sort-control" aria-label="排序">
            <SlidersHorizontal size={19} aria-hidden="true" />
            <Select aria-label="排序" data={[{ value: 'default', label: '默认顺序' }, { value: 'title-asc', label: '名称升序' }, { value: 'title-desc', label: '名称降序' }]} value={params.get('sort') ?? 'default'} onChange={value => patch({ sort: value ?? 'default', offset: '' })} />
          </label>
        </div>
      </div>
    </>}
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {emptyCatalog && <EmptyMediaLibrary channel={channel} hasLibraries={hasLibraries} admin={admin} category={current.label} onCreate={() => navigate(`/media/${channel}/settings/libraries/new`)} onManage={() => navigate(`/media/${channel}/settings/libraries`)} />}
    {!emptyCatalog && !playerActive && offset === 0 && (current.kind === 'video' || current.kind === 'album' || current.kind === 'audiobook') && <ContinuePlaying
      api={runtime.mediaApi}
      libraryId={selectedLibrary}
      libraryIds={channelLibraries.map(item => item.id)}
      onPlay={async (parts, index, title) => { await runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index); }}
    />}
    {!emptyCatalog && query.data && <><MediaItemGrid items={query.data.items} channel={channel} /><div className="media-toolbar media-pagination"><Pagination total={Math.max(1, Math.ceil(query.data.total / 60))} value={Math.floor(offset / 60) + 1} onChange={page => patch({ offset: String((page - 1) * 60) })} /></div></>}
  </MediaPageFrame>;
}
