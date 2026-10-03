import { Alert, Button, Card, Loader, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { detailQuery } from '../queries/media.queries.ts';
import { useMediaDetailUpdate } from '../mutations/media.mutations.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { MetadataEditor } from '../components/metadata-editor.tsx';
import { MetadataMatcher } from '../components/metadata-matcher.tsx';
import { AudiobookChapters } from '../components/audiobook-chapters.tsx';
import { EditionDetails, type ChapterPosition } from '../components/edition-details.tsx';
import { EditionTools } from '../components/edition-details.tsx';
import { ArtistInfo } from '../components/artist-info.tsx';
import { VideoHierarchyEditor } from '../components/video-hierarchy-editor.tsx';
import { MusicParentEditor } from '../components/parent-editor.tsx';
import type { Detail, MediaChannel, Part } from '../api/media-api.ts';

const channels = ['video', 'music', 'audiobook'] as const;
function safeChannel(value: string | undefined): MediaChannel {
  return value && channels.includes(value as MediaChannel) ? value as MediaChannel : 'video';
}

function useItemPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel, itemId = '', editionId = '' } = useParams();
  const channel = safeChannel(routeChannel);
  const query = useQuery(detailQuery(runtime, itemId));
  const updateDetail = useMediaDetailUpdate();
  return { runtime, navigate, channel, itemId, editionId, query, updateDetail };
}

function ItemPageFrame({ title, channel, itemId, children, admin = false }: {
  title: string; channel: MediaChannel; itemId: string; children: React.ReactNode; admin?: boolean;
}) {
  return <MediaPageFrame title={title} actions={<Button component={Link} to={`/media/${channel}/items/${encodeURIComponent(itemId)}`} variant="subtle">返回作品详情</Button>}>
    {admin && <Text size="sm" c="dimmed">管理员操作会保留文件、版本和播放进度；保存后可返回作品详情继续核对。</Text>}
    {children}
  </MediaPageFrame>;
}

function ItemQuery({ query, children }: { query: ReturnType<typeof useQuery<Detail>>; children: (detail: Detail) => React.ReactNode }) {
  return <><QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />{query.isPending && <Loader />}{query.data && children(query.data)}{!query.isPending && !query.error && !query.data && <Alert color="red">找不到这个作品。</Alert>}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  return admin ? <>{children}</> : <Alert color="red">需要管理员权限才能编辑媒体资料。</Alert>;
}

function playParts(runtime: ReturnType<typeof useRuntime>, channel: MediaChannel, title: string, parts: Part[], index = 0) {
  return runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index);
}

export function MediaMetadataEditPage() {
  const { runtime, navigate, channel, itemId, query, updateDetail } = useItemPage();
  return <ItemPageFrame title="编辑资料" channel={channel} itemId={itemId} admin><AdminOnly><ItemQuery query={query}>{detail => {
    const edition = detail.editions[0];
    return <Stack>
      <MetadataEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} />
      {edition && <Card withBorder><Title order={3}>版本与资源管理</Title><EditionTools api={runtime.mediaApi} item={detail} edition={edition} busy={false} onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={ids => { void runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onUpdated={updateDetail} onAssigned={target => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`)} onRename={() => { void query.refetch(); }} /></Card>}
      <ArtistInfo item={detail} />
      <VideoHierarchyEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} />
      <MusicParentEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} />
    </Stack>;
  }}</ItemQuery></AdminOnly></ItemPageFrame>;
}

export function MediaMatchPage() {
  const { runtime, channel, itemId, query, updateDetail } = useItemPage();
  return <ItemPageFrame title="匹配作品" channel={channel} itemId={itemId} admin><AdminOnly><ItemQuery query={query}>{detail => <MetadataMatcher api={runtime.mediaApi} item={detail} layout="page" onUpdated={updateDetail} />}</ItemQuery></AdminOnly></ItemPageFrame>;
}

export function MediaChaptersPage() {
  const { runtime, channel, itemId, query } = useItemPage();
  const [editionId, setEditionId] = useState('');
  const [position, setPosition] = useState<ChapterPosition>({ query: '', page: 0 });
  return <ItemPageFrame title="章节列表" channel={channel} itemId={itemId}><ItemQuery query={query}>{detail => {
    if (detail.kind !== 'audiobook') return <Alert color="yellow">只有有声书作品支持章节管理。</Alert>;
    const selected = editionId || detail.editions[0]?.id || '';
    return <AudiobookChapters api={runtime.mediaApi} item={detail} editionId={selected} currentPartId={runtime.player.currentPartId} busy={false} onEditionChange={id => { setEditionId(id); setPosition({ query: '', page: 0 }); }} onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={async ids => { await runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onRefresh={() => { void query.refetch(); }} position={position} onPositionChange={setPosition} />;
  }}</ItemQuery></ItemPageFrame>;
}

export function MediaEditionPage() {
  const { runtime, navigate, channel, itemId, editionId, query, updateDetail } = useItemPage();
  return <ItemPageFrame title="版本管理" channel={channel} itemId={itemId} admin><AdminOnly><ItemQuery query={query}>{detail => {
    const edition = detail.editions.find(value => value.id === editionId) ?? detail.editions[0];
    if (!edition) return <Alert color="yellow">这个作品没有可管理的版本。</Alert>;
    return <EditionDetails api={runtime.mediaApi} item={detail} edition={edition} busy={false} layout="detail" showTools onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={ids => { void runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onUpdated={updateDetail} onAssigned={target => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`)} onRename={() => { void query.refetch(); }} onRefresh={() => { void query.refetch(); }} />;
  }}</ItemQuery></AdminOnly></ItemPageFrame>;
}

export function MediaStructurePage() {
  const { runtime, navigate, channel, itemId, query, updateDetail } = useItemPage();
    return <ItemPageFrame title="结构整理" channel={channel} itemId={itemId} admin><AdminOnly><ItemQuery query={query}>{detail => <Stack><Card withBorder><Title order={3}>作品归属与结构</Title><Text size="sm" c="dimmed">调整所属专辑、歌手、剧集、季和集号。文件、版本与播放进度会保留。</Text><VideoHierarchyEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} /><MusicParentEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} /></Card>{detail.editions.map(edition => <Card withBorder key={edition.id}><Title order={4}>{edition.label}</Title><EditionTools api={runtime.mediaApi} item={detail} edition={edition} busy={false} onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={ids => { void runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onUpdated={updateDetail} onAssigned={target => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`)} /></Card>)}</Stack>}</ItemQuery></AdminOnly></ItemPageFrame>;
}

// Short route-facing names keep the route module readable while preserving
// the feature-prefixed names for imports from tests and other media pages.
export const MetadataEditPage = MediaMetadataEditPage;
export const MatchPage = MediaMatchPage;
export const ChaptersPage = MediaChaptersPage;
export const EditionManagementPage = MediaEditionPage;
export const StructureManagementPage = MediaStructurePage;
