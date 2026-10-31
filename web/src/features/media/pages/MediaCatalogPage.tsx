import { Icon } from '../../../ui/icon.tsx';
import { ChannelMenu } from '../components/channel-menu.tsx';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { CatalogTabs } from '../components/channel-navigation.tsx';
import { useMediaPreferences } from '../hooks/use-media-preferences.ts';

/** Catalog page size: the server's browse/items limit. */
const PAGE = 60;

const countLabels: Record<string, string> = {
  video: '项', movie: '部电影', series: '部剧集', album: '张专辑', artist: '位歌手', track: '首曲目', audiobook: '部有声书', narrator: '位演播者',
};

export function MediaCatalogPage() {
  const runtime = useRuntime(), navigate = useNavigate(), channel = useMediaChannel(), { category } = useParams(), [params, setParams] = useSearchParams();
  const categories = channelCategories[channel], current = categories.find(item => item.path === category) ?? categories[0]!;
  const preferences = useMediaPreferences();
  // 默认排序 (偏好设置 › 影音浏览) applies when the URL names no sort; an explicit one, even "default", wins.
  const sort = params.get('sort') ?? preferences.sort ?? 'default';
  const effective = new URLSearchParams(params);
  if (!params.has('sort') && sort !== 'default') effective.set('sort', sort);
  const query = useQuery(catalogQuery(runtime, channel, current.kind, effective)), libraries = useMediaLibraries();
  const playerActive = usePlaybackStore(state => state.active);
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const patch = (values: Record<string, string>) => { const next = new URLSearchParams(params); for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); setParams(next); };
  const channelLibraries = libraries.data?.items.filter(item => item.kind === channel) ?? [];
  const selectedFromUrl = params.get('library');
  const selectedLibrary = selectedFromUrl ?? (channelLibraries.length === 1 ? channelLibraries[0]!.id : '');
  const total = query.data?.total ?? 0;
  // Past the last page (a stale link, or the last items of the last page went away) clamps
  // to the last page instead of showing an empty grid.
  const pastEnd = !!query.data && offset > 0 && offset >= total;
  const emptyCatalog = !query.isPending && !query.error && total === 0 && !pastEnd;
  // An empty channel without a configured library uses the focused legacy empty state;
  // there is no source selector or category toolbar to act on in that state.
  const hasLibraries = channelLibraries.length > 0;
  const emptyWithoutLibraries = emptyCatalog && !hasLibraries;
  // 列表工具栏显示来源库: off hides the source selector — except while a deep link has narrowed
  // the catalog to one of several libraries, which the reader must be able to see and clear.
  const showLibrary = preferences.showLibraryName || (channelLibraries.length > 1 && !!selectedFromUrl);
  const libraryOptions = [{ value: '', label: '全部媒体库' }, ...(channelLibraries.map(item => ({ value: item.id, label: item.name })) )];
  useEffect(() => {
    if (selectedFromUrl === null && channelLibraries.length === 1) {
      const next = new URLSearchParams(params);
      next.set('library', channelLibraries[0]!.id);
      setParams(next, { replace: true });
    }
  }, [channelLibraries, params, selectedFromUrl, setParams]);
  useEffect(() => {
    if (!pastEnd) return;
    const next = new URLSearchParams(params);
    const last = total > 0 ? Math.floor((total - 1) / PAGE) * PAGE : 0;
    if (last) next.set('offset', String(last)); else next.delete('offset');
    setParams(next, { replace: true });
  }, [pastEnd, params, setParams, total]);
  return <MediaPageFrame className="media-catalog-page" title={channelLabels[channel]} emptyChannel={emptyWithoutLibraries} actions={<>
    <Link to="/media/search" className="media-icon-button" aria-label="搜索" title="搜索"><Icon name="search" size={18} /></Link>
    <ChannelMenu channel={channel} />
  </>}>
    {!emptyWithoutLibraries && <>
      <CatalogTabs channel={channel} />
    </>}
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {preferences.showContinue && !emptyCatalog && !playerActive && offset === 0 && (current.kind === 'video' || current.kind === 'album' || current.kind === 'audiobook') && <ContinuePlaying
      api={runtime.mediaApi}
      libraryId={selectedLibrary}
      libraryIds={channelLibraries.map(item => item.id)}
      onPlay={async (parts, index, title) => { await runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index); }}
    />}
    {!emptyWithoutLibraries && <div className="media-toolbar media-browse-tools">
      <div className="media-library-filter">
        {showLibrary && <MediaSelect variant="plain" aria-label="来源库" value={selectedLibrary} onChange={event => patch({ library: event.currentTarget.value, offset: '' })}>
          {libraryOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
        </MediaSelect>}
        {query.data && <span className="media-catalog-count">{query.data.total} {countLabels[current.kind] ?? '项'}</span>}
      </div>
      <div className="media-browse-actions">
        <Link to={`/media/${channel}/folders${selectedLibrary ? `/${encodeURIComponent(selectedLibrary)}` : ''}`} className="media-icon-button" aria-label="打开文件夹" title="打开文件夹"><Icon name="folder-browse" size={18} /></Link>
        <details className="media-browse-filters">
          <summary aria-label="筛选与排序" title="筛选与排序"><Icon name="sliders" size={18} />{sort !== (preferences.sort ?? 'default') && <i aria-label="已应用筛选" />}</summary>
          <div className="media-browse-filter-panel">
            <label>排序<MediaSelect aria-label="排序" value={sort} onChange={event => patch({ sort: event.currentTarget.value, offset: '' })}>
              <option value="default">默认顺序</option><option value="title-asc">名称升序</option><option value="title-desc">名称降序</option>
            </MediaSelect></label>
          </div>
        </details>
      </div>
    </div>}
    {/* After the toolbar: the empty state answers "this library/category has nothing", so the selector it refers to sits above it. */}
    {emptyCatalog && <EmptyMediaLibrary channel={channel} hasLibraries={hasLibraries} admin={admin} category={current.label} onCreate={() => navigate(`/media/${channel}/settings/libraries/new`)} onManage={() => navigate(`/media/${channel}/settings/libraries`)} />}
    {!emptyCatalog && !pastEnd && query.data && <><MediaItemGrid items={query.data.items} channel={channel} density={preferences.density} />{total > PAGE && <nav className="media-toolbar media-pagination" aria-label="分页">
      <button type="button" disabled={offset === 0 || query.isFetching} onClick={() => patch({ offset: offset >= PAGE ? String(offset - PAGE) : '' })}>上一页</button>
      <span>{Math.floor(offset / PAGE) + 1} / {Math.ceil(total / PAGE)}</span>
      <button type="button" disabled={offset + PAGE >= total || query.isFetching} onClick={() => patch({ offset: String(offset + PAGE) })}>下一页</button>
    </nav>}</>}
  </MediaPageFrame>;
}
