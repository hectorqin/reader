import { Alert, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { Ellipsis, Heart, Play } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { detailQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { useMediaChannel } from '../hooks/use-media-channel.ts';
import { MediaCover } from '../components/cover.tsx';
import { MediaDetailHeading, mediaDetailLabel } from '../components/detail-heading.tsx';
import { EditionDetails } from '../components/edition-details.tsx';
import { MediaSelect } from '../components/select.tsx';
import { MissingEdition } from '../components/missing-edition.tsx';
import { AlbumPlayback } from '../components/album-playback.tsx';
import { SeriesPlayback, SeriesSeasons, SeasonPlayback } from '../components/season-playback.tsx';
import { MediaChildList } from '../components/child-list.tsx';
import { ResourcePanel } from '../components/resource-panel.tsx';
import { MetadataSources } from '../components/metadata-sources.tsx';
import { ArtistInfo } from '../components/artist-info.tsx';
import { ArtistTracks } from '../components/artist-tracks.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import type { Detail, Part } from '../api/media-api.ts';

type QueueEntry = { part: Part; title: string; video: boolean; credit?: string };

export function MediaDetailPage() {
  const runtime = useRuntime();
  const channel = useMediaChannel();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { itemId = '' } = useParams();
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const [resourcePanel, setResourcePanel] = useState<'files' | 'versions' | 'source' | null>(null);
  const detailMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setResourcePanel(null); detailMenu.current?.removeAttribute('open'); }, [itemId]);
  const query = useQuery(detailQuery(runtime, itemId));
  const favorite = useQuery({
    queryKey: ['media', runtime.mediaApi.preferenceScope(), 'favorite', itemId],
    queryFn: ({ signal }) => runtime.mediaApi.request<{ favorite: boolean }>(`items/${encodeURIComponent(itemId)}/favorite`, 'GET', undefined, signal),
    enabled: !!itemId,
  });
  const toggleFavorite = useMutation({
    mutationFn: (value: boolean) => runtime.mediaApi.request<{ favorite: boolean }>(`items/${encodeURIComponent(itemId)}/favorite`, 'PUT', { favorite: value }),
    onSuccess: value => { queryClient.setQueryData(['media', runtime.mediaApi.preferenceScope(), 'favorite', itemId], value); void queryClient.invalidateQueries({ queryKey: ['media', runtime.mediaApi.preferenceScope(), 'favorites'] }); },
  });
  const detail = query.data;
  const play = (entries: QueueEntry[], index = 0) => runtime.player.play(entries, index);
  const playEdition = (current: Detail, parts: Part[], index = 0) => play(parts.map(part => ({ part, title: current.title + ' · ' + part.title, video: channel === 'video' })), index);
  const queueParts = async (ids: string[]) => { await runtime.mediaApi.request('queue', 'POST', { partIds: ids }); };

  const openResourcePanel = (panel: 'files' | 'versions' | 'source') => {
    detailMenu.current?.removeAttribute('open');
    setResourcePanel(panel);
  };
  const detailActions = detail ? <details className="media-actions media-item-actions" ref={detailMenu}>
    <summary aria-label={detail.kind === 'artist' ? '歌手操作' : '作品操作'} title="作品操作"><Ellipsis size={20} aria-hidden="true" /></summary>
    <nav aria-label={detail.kind === 'artist' ? '歌手操作' : '作品操作'}>
      {detail.kind !== 'artist' && <>
        <button type="button" disabled={toggleFavorite.isPending} onClick={() => { detailMenu.current?.removeAttribute('open'); toggleFavorite.mutate(!favorite.data?.favorite); }}>{favorite.data?.favorite ? '取消收藏作品' : '收藏作品'}</button>
        {detail.editions.some(edition => edition.parts.length > 0) && <button type="button" onClick={() => openResourcePanel('files')}>资源信息</button>}
        {(detail.editions.length > 1 || (admin && detail.editions.length > 0)) && <button type="button" onClick={() => openResourcePanel('versions')}>{admin ? '版本管理' : '播放版本'}</button>}
        <button type="button" onClick={() => openResourcePanel('source')}>资料来源</button>
      </>}
      {admin && <>
        <button type="button" onClick={() => navigate(`/media/${channel}/items/${encodeURIComponent(detail.id)}/metadata`)}>编辑资料</button>
        <button type="button" onClick={() => navigate(`/media/${channel}/items/${encodeURIComponent(detail.id)}/match`)}>匹配元数据</button>
        {detail.kind === 'audiobook' && <button type="button" onClick={() => navigate(`/media/${channel}/items/${encodeURIComponent(detail.id)}/chapters`)}>章节列表</button>}
        {['track', 'album', 'season', 'episode'].includes(detail.kind) && <button type="button" onClick={() => navigate(`/media/${channel}/items/${encodeURIComponent(detail.id)}/structure`)}>结构整理</button>}
      </>}
    </nav>
  </details> : undefined;
  return <MediaPageFrame className="media-detail-shell" title={detail ? mediaDetailLabel(detail.kind) : '作品详情'} actions={detailActions}>
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {detail && <DetailContent detail={detail} channel={channel} favorite={favorite.data?.favorite ?? false} favoriteBusy={toggleFavorite.isPending} onToggleFavorite={() => toggleFavorite.mutate(!favorite.data?.favorite)} onPlay={(parts, index) => void playEdition(detail, parts, index)} onQueue={queueParts} onPlayEntries={play} onRefresh={() => { void query.refetch(); }} onUpdated={updated => { queryClient.setQueryData(detailQuery(runtime, itemId).queryKey, updated); }} runtime={runtime} navigate={navigate} resourcePanel={resourcePanel} onResourcePanelChange={setResourcePanel} />}
    {!query.isPending && !query.error && !detail && <Alert>找不到这个作品。</Alert>}
  </MediaPageFrame>;
}

function DetailContent({ detail, channel, favorite, favoriteBusy, onToggleFavorite, onPlay, onQueue, onPlayEntries, onRefresh, onUpdated, runtime, navigate, resourcePanel, onResourcePanelChange }: {
  detail: Detail; channel: 'video' | 'music' | 'audiobook'; favorite: boolean; favoriteBusy: boolean; onToggleFavorite(): void;
  onPlay(parts: Part[], index?: number): void; onQueue(ids: string[]): Promise<void>; onPlayEntries(entries: QueueEntry[]): Promise<void>; onRefresh(): void; onUpdated(detail: Detail): void; runtime: ReturnType<typeof useRuntime>; navigate(path: string): void;
  resourcePanel: 'files' | 'versions' | 'source' | null; onResourcePanelChange: (panel: 'files' | 'versions' | 'source' | null) => void;
}) {
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const [params, setParams] = useSearchParams();
  const [albumAssets, setAlbumAssets] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => { setAlbumAssets([]); }, [detail.id]);
  const requestedEditionId = params.get('edition') ?? '';
  const selectedEditionId = detail.editions.some(value => value.id === requestedEditionId) ? requestedEditionId : detail.editions[0]?.id ?? '';
  const edition = detail.editions.find(value => value.id === selectedEditionId) ?? detail.editions[0];
  const playable = edition?.parts.filter(part => part.available) ?? [];
  const plot = String(detail.overrides.plot ?? detail.metadata.plot ?? '').trim();
  const credit = String(detail.overrides.artist ?? detail.metadata.artist ?? detail.overrides.albumArtist ?? detail.metadata.albumArtist ?? '').trim();
  const assets = edition?.parts.map(part => ({ id: part.assetId, title: part.title })) ?? (detail.kind === 'album' ? albumAssets : []);
  const editionOptions = edition ? {
    api: runtime.mediaApi,
    item: detail,
    edition,
    busy: false,
    onPlay,
    onQueue,
    onRefresh,
    ...(detail.editions.length > 1 ? { onChooseVersion: () => onResourcePanelChange('versions') } : {}),
    ...(admin ? { onUpdated, onAssigned: (target: Detail) => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`), onRename: () => onRefresh() } : {}),
  } : undefined;
  const resourceSummary = edition
    ? `${new Set(edition.parts.map(part => part.assetId)).size} 个文件 · ${edition.label}`
    : detail.children.length + (detail.kind === 'album' ? ' 首曲目' : detail.kind === 'series' ? ' 季 · 资源见单集详情' : ' 项内容');
  return <Stack className="media-detail-page">
    <Group className="media-hero" align="start"><MediaCover api={runtime.mediaApi} item={detail} square={['album', 'artist', 'track'].includes(detail.kind)} /><Stack className="media-detail-hero-copy" flex={1}><MediaDetailHeading item={detail} edition={edition} {...(detail.kind === 'album' ? { trackCount: detail.children.length } : {})} {...(detail.kind === 'series' ? { seasonCount: detail.children.length } : {})} /></Stack></Group>
    <Group className="media-detail-actions"><Button className="media-primary" leftSection={<Play size={16} />} disabled={!playable.length} onClick={() => onPlay(playable)}>{detail.kind === 'movie' ? '播放电影' : detail.kind === 'series' ? '播放剧集' : detail.kind === 'audiobook' ? '播放有声书' : detail.kind === 'album' ? '播放专辑' : '播放'}</Button>{detail.kind !== 'album' && <Button className="media-detail-favorite" variant={favorite ? 'filled' : 'light'} {...(favorite ? { color: 'pink' as const } : {})} loading={favoriteBusy} aria-label={favorite ? '取消收藏' : '收藏'} title={favorite ? '取消收藏' : '收藏'} onClick={onToggleFavorite}><Heart size={18} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" /></Button>}</Group>
    {plot && <Card className="media-detail-description" withBorder><Title order={3}>{['movie', 'series', 'season', 'episode'].includes(detail.kind) ? '剧情简介' : detail.kind === 'audiobook' ? '内容简介' : '简介'}</Title><Text>{plot}</Text></Card>}
    {edition && edition.parts.length > 0 && !playable.length && <MissingEdition title={detail.title} label={edition.label} busy={false} onRefresh={onRefresh} onChooseVersion={detail.editions.length > 1 ? () => onResourcePanelChange('versions') : undefined} />}
    {detail.kind !== 'artist' && <ResourcePanel api={runtime.mediaApi} assets={assets} summary={resourceSummary} versionPicker={detail.editions.length > 1 && <label className="media-edition-picker">版本<MediaSelect aria-label="播放版本" value={edition?.id ?? ''} onChange={event => { const next = new URLSearchParams(params); next.set('edition', event.currentTarget.value); setParams(next, { replace: true }); }}>{detail.editions.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</MediaSelect></label>} editionOptions={editionOptions} sourceInfo={<MetadataSources item={detail} />} openPanel={resourcePanel} onPanelChange={onResourcePanelChange} showTrigger={false} />}
    {detail.kind === 'album' && <AlbumPlayback api={runtime.mediaApi} id={detail.id} credit={credit} onPlay={onPlayEntries} onQueue={onQueue} onDetail={id => navigate(`/media/music/items/${encodeURIComponent(id)}`)} onTracksRead={tracks => setAlbumAssets([...new Map(tracks.flatMap(track => track.editions.flatMap(value => value.parts.map(part => ({ id: part.assetId, title: part.title })))).map(asset => [asset.id, asset])).values()])} />}
    {detail.kind === 'series' && <>
      <SeriesPlayback id={detail.id} api={runtime.mediaApi} currentPartId={runtime.player.currentPartId} onPlay={onPlayEntries} onDetail={id => navigate(`/media/video/items/${encodeURIComponent(id)}`)} />
      <SeriesSeasons api={runtime.mediaApi} seasons={detail.children} currentPartId={runtime.player.currentPartId} onPlay={onPlayEntries} onDetail={id => navigate(`/media/video/items/${encodeURIComponent(id)}`)} />
    </>}
    {detail.kind === 'season' && <SeasonPlayback api={runtime.mediaApi} id={detail.id} currentPartId={runtime.player.currentPartId} onPlay={onPlayEntries} onDetail={id => navigate(`/media/video/items/${encodeURIComponent(id)}`)} />}
    {edition && (playable.length > 0 || !edition.parts.length) && !['album', 'series'].includes(detail.kind) && !(detail.kind === 'movie' && edition.parts.length === 1 && playable.length > 0) && <EditionDetails item={detail} edition={edition} api={runtime.mediaApi} busy={false} showTools={false} onPlay={onPlay} onQueue={onQueue} onRefresh={onRefresh} onChooseVersion={detail.editions.length > 1 ? () => onResourcePanelChange('versions') : undefined} />}
    {detail.kind === 'artist' && <ArtistInfo item={detail} />}
    {detail.kind === 'artist' && <ArtistTracks
      api={runtime.mediaApi}
      artist={detail}
      onPlay={async id => {
        const track = await runtime.mediaApi.detail(id);
        const parts = track.editions.flatMap(value => value.parts).filter(part => part.available);
        if (parts.length) await onPlayEntries(parts.map(part => ({ part, title: `${track.title} · ${part.title}`, video: false })));
      }}
      onDetail={id => navigate(`/media/music/items/${encodeURIComponent(id)}`)}
    />}
    {!['album', 'series', 'season', 'audiobook'].includes(detail.kind) && detail.children.length > 0 && <Card withBorder><Title order={3}>相关内容</Title><MediaChildList items={detail.children} label="内容" renderItems={items => <Stack>{items.map(item => <Button key={item.id} component={Link} variant="subtle" justify="start" to={`/media/${channel}/items/${encodeURIComponent(item.id)}`}>{item.title}</Button>)}</Stack>} /></Card>}
  </Stack>;
}
