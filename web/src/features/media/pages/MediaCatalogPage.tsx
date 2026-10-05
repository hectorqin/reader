import { Button } from '@mantine/core';
import { FolderOpen, History, LibraryBig, ListVideo, MoreHorizontal, Search, Settings2, SlidersHorizontal, Star } from 'lucide-react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
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
import { MediaSelect } from '../components/select.tsx';

const countLabels: Record<string, string> = {
  video: '项', movie: '部电影', series: '部剧集', album: '张专辑', artist: '位歌手', track: '首曲目', audiobook: '部有声书', narrator: '位演播者',
};

export function MediaCatalogPage() {
  const runtime = useRuntime(), navigate = useNavigate(), channel = useMediaChannel(), { category } = useParams(), [params, setParams] = useSearchParams();
  const categories = channelCategories[channel], current = categories.find(item => item.path === category) ?? categories[0]!;
  const query = useQuery(catalogQuery(runtime, channel, current.kind, params)), libraries = useMediaLibraries();
  const playerActive = usePlaybackStore(state => state.active);
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const offset = Number(params.get('offset')) || 0;
  const patch = (values: Record<string, string>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); setParams(next); };
  const channelLibraries = libraries.data?.items.filter(item => item.kind === channel) ?? [];
  const selectedFromUrl = params.get('library');
  const selectedLibrary = selectedFromUrl ?? (channelLibraries.length === 1 ? channelLibraries[0]!.id : '');
  const emptyCatalog = !query.isPending && !query.error && query.data?.total === 0;
  // An empty channel without a configured library uses the focused legacy empty state;
  // there is no source selector or category toolbar to act on in that state.
  const hasLibraries = channelLibraries.length > 0;
  const emptyWithoutLibraries = emptyCatalog && !hasLibraries;
  const libraryOptions = [{ value: '', label: '全部媒体库' }, ...(channelLibraries.map(item => ({ value: item.id, label: item.name })) )];
  useEffect(() => {
    if (selectedFromUrl === null && channelLibraries.length === 1) {
      const next = new URLSearchParams(params);
      next.set('library', channelLibraries[0]!.id);
      setParams(next, { replace: true });
    }
  }, [channelLibraries, params, selectedFromUrl, setParams]);
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
    </>}
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {emptyCatalog && <EmptyMediaLibrary channel={channel} hasLibraries={hasLibraries} admin={admin} category={current.label} onCreate={() => navigate(`/media/${channel}/settings/libraries/new`)} onManage={() => navigate(`/media/${channel}/settings/libraries`)} />}
    {!emptyCatalog && !playerActive && offset === 0 && (current.kind === 'video' || current.kind === 'album' || current.kind === 'audiobook') && <ContinuePlaying
      api={runtime.mediaApi}
      libraryId={selectedLibrary}
      libraryIds={channelLibraries.map(item => item.id)}
      onPlay={async (parts, index, title) => { await runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index); }}
    />}
    {!emptyWithoutLibraries && <div className="media-toolbar media-browse-tools">
      <div className="media-library-filter">
        <MediaSelect variant="plain" aria-label="来源库" value={selectedLibrary} onChange={event => patch({ library: event.currentTarget.value, offset: '' })}>
          {libraryOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </MediaSelect>
        {query.data && <span className="media-catalog-count">{query.data.total} {countLabels[current.kind] ?? '项'}</span>}
      </div>
      <div className="media-browse-actions">
        <Button component={Link} to={`/media/${channel}/folders${selectedLibrary ? `/${encodeURIComponent(selectedLibrary)}` : ''}`} className="media-icon-button" aria-label="打开文件夹" title="打开文件夹"><FolderOpen size={19} aria-hidden="true" /></Button>
        <details className="media-browse-filters">
          <summary aria-label="筛选与排序" title="筛选与排序"><SlidersHorizontal size={19} aria-hidden="true" />{params.get('sort') && params.get('sort') !== 'default' && <i aria-label="已应用筛选" />}</summary>
          <div className="media-browse-filter-panel">
            <label>排序<MediaSelect aria-label="排序" value={params.get('sort') ?? 'default'} onChange={event => patch({ sort: event.currentTarget.value, offset: '' })}>
              <option value="default">默认顺序</option><option value="title-asc">名称升序</option><option value="title-desc">名称降序</option>
            </MediaSelect></label>
          </div>
        </details>
      </div>
    </div>}
    {!emptyCatalog && query.data && <><MediaItemGrid items={query.data.items} channel={channel} />{query.data.total > 60 && <nav className="media-toolbar media-pagination" aria-label="分页">
      <Button disabled={offset === 0 || query.isFetching} onClick={() => patch({ offset: offset >= 60 ? String(offset - 60) : '' })}>上一页</Button>
      <span>{Math.floor(offset / 60) + 1} / {Math.ceil(query.data.total / 60)}</span>
      <Button disabled={offset + 60 >= query.data.total || query.isFetching} onClick={() => patch({ offset: String(offset + 60) })}>下一页</Button>
    </nav>}</>}
  </MediaPageFrame>;
}
