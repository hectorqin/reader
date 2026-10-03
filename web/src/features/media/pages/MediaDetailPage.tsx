import { Alert, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { Heart, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { detailQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { useMediaChannel } from '../hooks/use-media-channel.ts';
import { MediaCover } from '../components/cover.tsx';
import { MediaDetailHeading } from '../components/detail-heading.tsx';
import { EditionDetails } from '../components/edition-details.tsx';
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

  return <MediaPageFrame title={detail?.title ?? '作品详情'}>
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {detail && <DetailContent detail={detail} channel={channel} favorite={favorite.data?.favorite ?? false} favoriteBusy={toggleFavorite.isPending} onToggleFavorite={() => toggleFavorite.mutate(!favorite.data?.favorite)} onPlay={(parts, index) => void playEdition(detail, parts, index)} onQueue={queueParts} onPlayEntries={play} runtime={runtime} navigate={navigate} />}
    {!query.isPending && !query.error && !detail && <Alert>找不到这个作品。</Alert>}
  </MediaPageFrame>;
}

function DetailContent({ detail, channel, favorite, favoriteBusy, onToggleFavorite, onPlay, onQueue, onPlayEntries, runtime, navigate }: {
  detail: Detail; channel: 'video' | 'music' | 'audiobook'; favorite: boolean; favoriteBusy: boolean; onToggleFavorite(): void;
  onPlay(parts: Part[], index?: number): void; onQueue(ids: string[]): Promise<void>; onPlayEntries(entries: QueueEntry[]): Promise<void>; runtime: ReturnType<typeof useRuntime>; navigate(path: string): void;
}) {
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const edition = detail.editions[0];
  const playable = edition?.parts.filter(part => part.available) ?? [];
  const plot = String(detail.overrides.plot ?? detail.metadata.plot ?? '').trim();
  const credit = String(detail.overrides.artist ?? detail.metadata.artist ?? detail.overrides.albumArtist ?? detail.metadata.albumArtist ?? '').trim();
  const assets = edition?.parts.map(part => ({ id: part.assetId, title: part.title })) ?? [];
  return <Stack>
    <Group align="start"><MediaCover api={runtime.mediaApi} item={detail} square={['album', 'artist', 'track'].includes(detail.kind)} /><Stack flex={1}><MediaDetailHeading item={detail} edition={edition} {...(detail.kind === 'album' ? { trackCount: detail.children.length } : {})} {...(detail.kind === 'series' ? { seasonCount: detail.children.length } : {})} /><Group><Button leftSection={<Play size={16} />} disabled={!playable.length} onClick={() => onPlay(playable)}>播放</Button>{detail.kind !== 'album' && <Button variant={favorite ? 'filled' : 'light'} {...(favorite ? { color: 'pink' as const } : {})} loading={favoriteBusy} leftSection={<Heart size={16} fill={favorite ? 'currentColor' : 'none'} />} onClick={onToggleFavorite}>{favorite ? '取消收藏' : '收藏'}</Button>}{admin && <Button component={Link} variant="light" to={`/media/${channel}/items/${encodeURIComponent(detail.id)}/metadata`}>编辑资料</Button>}</Group></Stack></Group>
    {plot && <Card withBorder><Title order={3}>简介</Title><Text>{plot}</Text></Card>}
    <ResourcePanel api={runtime.mediaApi} assets={assets} summary={edition ? `${new Set(edition.parts.map(part => part.assetId)).size} 个文件 · ${edition.label}` : '暂无资源'} sourceInfo={<MetadataSources item={detail} />} />
    {admin && <Card withBorder><Title order={3}>管理</Title><Group><Button component={Link} variant="light" to={`/media/${channel}/items/${encodeURIComponent(detail.id)}/match`}>匹配元数据</Button>{detail.kind === 'audiobook' && <Button component={Link} variant="light" to={`/media/${channel}/items/${encodeURIComponent(detail.id)}/chapters`}>章节列表</Button>}{edition && <Button component={Link} variant="light" to={`/media/${channel}/items/${encodeURIComponent(detail.id)}/editions/${encodeURIComponent(edition.id)}`}>版本管理</Button>}{['track', 'album', 'season', 'episode'].includes(detail.kind) && <Button component={Link} variant="light" to={`/media/${channel}/items/${encodeURIComponent(detail.id)}/structure`}>结构整理</Button>}</Group></Card>}
    {detail.kind === 'album' && <AlbumPlayback api={runtime.mediaApi} id={detail.id} credit={credit} onPlay={onPlayEntries} onQueue={onQueue} onDetail={id => navigate(`/media/music/items/${encodeURIComponent(id)}`)} />}
    {detail.kind === 'series' && <>
      <SeriesPlayback id={detail.id} api={runtime.mediaApi} currentPartId={runtime.player.currentPartId} onPlay={onPlayEntries} onDetail={id => navigate(`/media/video/items/${encodeURIComponent(id)}`)} />
      <SeriesSeasons api={runtime.mediaApi} seasons={detail.children} currentPartId={runtime.player.currentPartId} onPlay={onPlayEntries} onDetail={id => navigate(`/media/video/items/${encodeURIComponent(id)}`)} />
    </>}
    {detail.kind === 'season' && <SeasonPlayback api={runtime.mediaApi} id={detail.id} currentPartId={runtime.player.currentPartId} onPlay={onPlayEntries} onDetail={id => navigate(`/media/video/items/${encodeURIComponent(id)}`)} />}
    {detail.kind === 'audiobook' && edition && <EditionDetails item={detail} edition={edition} api={runtime.mediaApi} busy={false} showTools={false} onPlay={onPlay} onQueue={onQueue} />}
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
