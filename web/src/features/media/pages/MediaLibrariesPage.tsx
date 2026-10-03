import { Alert, Button, Loader } from '@mantine/core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { MediaLibraryList } from '../components/library-list.tsx';
import { MediaLibraryCreate } from '../components/library-create.tsx';
import type { Library, MediaChannel } from '../api/media-api.ts';

const channels: MediaChannel[] = ['video', 'music', 'audiobook'];
function safeChannel(value: string | undefined): MediaChannel {
  return value && channels.includes(value as MediaChannel) ? value as MediaChannel : 'video';
}

export function MediaLibrariesPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel } = useParams();
  const channel = safeChannel(routeChannel);
  const role = useAuthStore(state => state.verifiedUser?.role);
  const queryClient = useQueryClient();
  const [position, setPosition] = useState({ query: '', page: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const query = useQuery(librariesQuery(runtime));
  if (role !== 'admin') return <MediaPageFrame title="媒体库管理"><Alert color="red">需要管理员权限。</Alert></MediaPageFrame>;
  // Management is scoped to the channel in the URL. Do not expose libraries
  // from another media channel in this page.
  const libraries = (query.data?.items ?? []).filter(item => item.kind === channel);
  const scan = async (id: string) => {
    if (busyId) return;
    setBusyId(id); setActionError('');
    try {
      await runtime.mediaApi.request(`libraries/${encodeURIComponent(id)}/scan`, 'POST');
      await queryClient.invalidateQueries({ queryKey: ['media'] });
      navigate(`/media/${channel}/settings/tasks?library=${encodeURIComponent(id)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '扫描请求失败，请稍后重试。');
    } finally { setBusyId(null); }
  };
  return <MediaPageFrame title="媒体库管理" actions={<Button component={Link} to={`/media/${channel}/settings/libraries/new`}>新建媒体库</Button>}>
    {actionError && <Alert color="red" title="操作失败">{actionError}</Alert>}
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {query.isPending && <Loader />}
    {!query.isPending && !query.error && <MediaLibraryList
      api={runtime.mediaApi}
      libraries={libraries}
      busy={busyId !== null}
      position={position}
      onPosition={setPosition}
      onEdit={(library: Library) => navigate(`/media/${channel}/settings/libraries/${encodeURIComponent(library.id)}/edit`)}
      onPermissions={(library: Library) => navigate(`/media/${channel}/settings/libraries/${encodeURIComponent(library.id)}/permissions`)}
      onScan={id => { void scan(id); }}
    />}
    {!query.isPending && !query.error && libraries.length === 0 && <Alert>还没有媒体库。请先创建一个媒体库并扫描目录。</Alert>}
  </MediaPageFrame>;
}

export function MediaLibraryCreatePage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel } = useParams();
  const channel = safeChannel(routeChannel);
  const queryClient = useQueryClient();
  const role = useAuthStore(state => state.verifiedUser?.role);
  if (role !== 'admin') return <MediaPageFrame title="新建媒体库"><Alert color="red">需要管理员权限。</Alert></MediaPageFrame>;
  const mediaChannel = channel;
  return <MediaPageFrame title="新建媒体库"><MediaLibraryCreate
    api={runtime.mediaApi}
    channel={mediaChannel}
    disabled={false}
    onCreated={library => {
      queryClient.setQueryData(librariesQuery(runtime).queryKey, (value: { items: Library[] } | undefined) => ({ items: [...(value?.items ?? []).filter(item => item.id !== library.id), library] }));
    }}
    onCancel={() => navigate(`/media/${channel}/settings/libraries`)}
    onJobs={async id => { navigate(`/media/${channel}/settings/tasks?library=${encodeURIComponent(id)}`); }}
  /></MediaPageFrame>;
}

