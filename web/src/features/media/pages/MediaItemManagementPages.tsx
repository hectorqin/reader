import { Callout } from '../../../ui/toolkit.tsx';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { detailQuery } from '../queries/media.queries.ts';
import { useMediaDetailUpdate } from '../mutations/media.mutations.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { AudiobookChapters } from '../components/audiobook-chapters.tsx';
import { EditionDetails, type ChapterPosition } from '../components/edition-details.tsx';
import { EditionTools } from '../components/edition-details.tsx';
import { ArtistInfo } from '../components/artist-info.tsx';
import { VideoHierarchyEditor } from '../components/video-hierarchy-editor.tsx';
import { MusicParentEditor } from '../components/parent-editor.tsx';
import { MediaMetadataPage } from '../components/metadata-page.tsx';
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

function ItemPageFrame({ title, channel, itemId, children, admin = false, className }: {
  title: string; channel: MediaChannel; itemId: string; children: React.ReactNode; admin?: boolean; className?: string;
}) {
  return <MediaPageFrame {...(className ? { className } : {})} title={title} hideHeader={className === 'media-metadata-workspace'} actions={className === 'media-metadata-workspace' ? undefined : <Link className="media-text-link" to={`/media/${channel}/items/${encodeURIComponent(itemId)}`}>返回作品详情</Link>}>
    {admin && className !== 'media-metadata-workspace' && <p className="media-manager-note">管理员操作会保留文件、版本和播放进度；保存后可返回作品详情继续核对</p>}
    {children}
  </MediaPageFrame>;
}

function ItemQuery({ query, children }: { query: ReturnType<typeof useQuery<Detail>>; children: (detail: Detail) => React.ReactNode }) {
  return <><QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />{query.data && children(query.data)}{!query.isPending && !query.error && !query.data && <Callout tone="error">找不到这个作品。</Callout>}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  return admin ? <>{children}</> : <Callout tone="error">需要管理员权限才能编辑媒体资料。</Callout>;
}

function playParts(runtime: ReturnType<typeof useRuntime>, channel: MediaChannel, title: string, parts: Part[], index = 0) {
  return runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index);
}

export function MediaMetadataEditPage() {
  const { runtime, navigate, channel, itemId, query, updateDetail } = useItemPage();
  return <ItemPageFrame title="编辑资料" channel={channel} itemId={itemId} admin className="media-metadata-workspace"><AdminOnly><ItemQuery query={query}>{detail => {
    const edition = detail.editions[0];
    return <div className="media-metadata-host">
      <MediaMetadataPage api={runtime.mediaApi} item={detail} initialView="edit" onViewChange={view => navigate(`/media/${channel}/items/${encodeURIComponent(itemId)}/${view === 'edit' ? 'metadata' : 'match'}`)} onUpdated={updateDetail} onBack={() => navigate(`/media/${channel}/items/${encodeURIComponent(itemId)}`)} />
      {edition && <section className="media-manager-card"><h3>版本与资源管理</h3><EditionTools api={runtime.mediaApi} item={detail} edition={edition} busy={false} onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={ids => { void runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onUpdated={updateDetail} onAssigned={target => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`)} onRename={() => { void query.refetch(); }} /></section>}
      <ArtistInfo item={detail} />
      <VideoHierarchyEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} />
      <MusicParentEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} />
    </div>;
  }}</ItemQuery></AdminOnly></ItemPageFrame>;
}

export function MediaMatchPage() {
  const { runtime, navigate, channel, itemId, query, updateDetail } = useItemPage();
  return <ItemPageFrame title="匹配作品" channel={channel} itemId={itemId} admin className="media-metadata-workspace"><AdminOnly><ItemQuery query={query}>{detail => <div className="media-metadata-host"><MediaMetadataPage api={runtime.mediaApi} item={detail} initialView="match" onViewChange={view => navigate(`/media/${channel}/items/${encodeURIComponent(itemId)}/${view === 'edit' ? 'metadata' : 'match'}`)} onUpdated={updateDetail} onBack={() => navigate(`/media/${channel}/items/${encodeURIComponent(itemId)}`)} /></div>}</ItemQuery></AdminOnly></ItemPageFrame>;
}

export function MediaChaptersPage() {
  const { runtime, channel, itemId, query } = useItemPage();
  const [editionId, setEditionId] = useState('');
  const [position, setPosition] = useState<ChapterPosition>({ query: '', page: 0 });
  return <ItemPageFrame title="章节列表" channel={channel} itemId={itemId}><ItemQuery query={query}>{detail => {
    if (detail.kind !== 'audiobook') return <Callout tone="warning">只有有声书作品支持章节管理。</Callout>;
    const selected = editionId || detail.editions[0]?.id || '';
    return <AudiobookChapters api={runtime.mediaApi} item={detail} editionId={selected} currentPartId={runtime.player.currentPartId} busy={false} onEditionChange={id => { setEditionId(id); setPosition({ query: '', page: 0 }); }} onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={async ids => { await runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onRefresh={() => { void query.refetch(); }} position={position} onPositionChange={setPosition} />;
  }}</ItemQuery></ItemPageFrame>;
}

export function MediaEditionPage() {
  const { runtime, navigate, channel, itemId, editionId, query, updateDetail } = useItemPage();
  return <ItemPageFrame title="版本管理" channel={channel} itemId={itemId} admin><AdminOnly><ItemQuery query={query}>{detail => {
    const edition = detail.editions.find(value => value.id === editionId) ?? detail.editions[0];
    if (!edition) return <Callout tone="warning">这个作品没有可管理的版本。</Callout>;
    return <EditionDetails api={runtime.mediaApi} item={detail} edition={edition} busy={false} layout="detail" showTools onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={ids => { void runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onUpdated={updateDetail} onAssigned={target => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`)} onRename={() => { void query.refetch(); }} onRefresh={() => { void query.refetch(); }} />;
  }}</ItemQuery></AdminOnly></ItemPageFrame>;
}

export function MediaStructurePage() {
  const { runtime, navigate, channel, itemId, query, updateDetail } = useItemPage();
    return <ItemPageFrame title="结构整理" channel={channel} itemId={itemId} admin><AdminOnly><ItemQuery query={query}>{detail => <div className="media-task-panel"><section className="media-manager-card"><h3>作品归属与结构</h3><p className="media-manager-note">调整所属专辑、歌手、剧集、季和集号。文件、版本与播放进度会保留</p><VideoHierarchyEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} /><MusicParentEditor api={runtime.mediaApi} item={detail} onUpdated={updateDetail} /></section>{detail.editions.map(edition => <section className="media-manager-card" key={edition.id}><h4>{edition.label}</h4><EditionTools api={runtime.mediaApi} item={detail} edition={edition} busy={false} onPlay={(parts, index) => { void playParts(runtime, channel, detail.title, parts, index); }} onQueue={ids => { void runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onUpdated={updateDetail} onAssigned={target => navigate(`/media/${channel}/items/${encodeURIComponent(target.id)}`)} /></section>)}</div>}</ItemQuery></AdminOnly></ItemPageFrame>;
}

