import { Alert, Button, Group, Loader, Select, Stack } from '@mantine/core';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { MediaFolders } from '../components/folders.tsx';
import type { FolderLocation } from '../components/folders.tsx';
import type { Part } from '../api/media-api.ts';

export function MediaFoldersPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel = 'video', libraryId: routeLibraryId } = useParams();
  const [params, setParams] = useSearchParams();
  const query = useQuery(librariesQuery(runtime));
  const role = useAuthStore(state => state.verifiedUser?.role);
  const libraries = (query.data?.items ?? []).filter(item => item.kind === channel);
  const requestedLibraryId = routeLibraryId ?? params.get('library') ?? '';
  const libraryId = requestedLibraryId
    ? (libraries.some(item => item.id === requestedLibraryId) ? requestedLibraryId : '')
    : libraries[0]?.id ?? '';
  const location: FolderLocation = { path: params.get('path') ?? '', offset: Number(params.get('offset')) || 0, assetId: params.get('asset') || null, editions: {}, chapters: {} };
  const updateLocation = (next: FolderLocation) => { const values = new URLSearchParams(params); for (const [key, value] of [['path', next.path], ['offset', String(next.offset)], ['asset', next.assetId ?? '']]) value ? values.set(key, value) : values.delete(key); setParams(values, { replace: true }); };
  const play = async (parts: Part[], index: number, title: string) => { runtime.player.play(parts.map(part => ({ part, title: `${title} · ${part.title}`, video: channel === 'video' })), index); navigate(`/media/${channel}/player`); };
  return <MediaPageFrame title="文件夹浏览"><Stack><Group><Button variant="subtle" onClick={() => navigate(`/media/${channel}`)}>返回频道</Button><Select aria-label="媒体库" value={libraryId} data={libraries.map(item => ({ value: item.id, label: item.name }))} onChange={value => { if (value) navigate(`/media/${channel}/folders/${encodeURIComponent(value)}`); }} /></Group><QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />{query.isPending && <Loader />}{!query.isPending && !query.error && requestedLibraryId && !libraryId && <Alert color="red">该媒体库不存在，或不属于当前频道。</Alert>}{!query.isPending && !query.error && !requestedLibraryId && !libraryId && <Alert>当前频道没有可浏览的媒体库。</Alert>}{libraryId && <MediaFolders api={runtime.mediaApi} libraryId={libraryId} admin={role === 'admin'} video={channel === 'video'} initialLocation={location} onLocationChange={updateLocation} onPlay={play} onQueue={async ids => { await runtime.mediaApi.request('queue', 'POST', { partIds: ids }); }} onDetail={id => navigate(`/media/${channel}/items/${encodeURIComponent(id)}`)} />}</Stack></MediaPageFrame>;
}

