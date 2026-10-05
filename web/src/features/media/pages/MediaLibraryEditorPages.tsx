import { Alert } from '@mantine/core';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { MediaLibraryEditor } from '../components/library-editor.tsx';
import { MediaPermissions } from '../components/permissions.tsx';
import type { Library } from '../api/media-api.ts';

const channels = ['video', 'music', 'audiobook'] as const;
function channelOf(value: string | undefined): typeof channels[number] {
  return value && channels.includes(value as typeof channels[number])
    ? value as typeof channels[number]
    : 'video';
}

function AdminOnly({ children, title }: { children: ReactNode; title: string }) {
  const role = useAuthStore(state => state.verifiedUser?.role);
  return role === 'admin' ? <>{children}</> : <MediaPageFrame title={title}><Alert color="red">需要管理员权限。</Alert></MediaPageFrame>;
}

export function MediaLibraryEditPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { channel: routeChannel, libraryId = '' } = useParams();
  const channel = channelOf(routeChannel);
  const query = useQuery(librariesQuery(runtime));
  const library = query.data?.items.find(item => item.id === libraryId);
  const back = `/media/${channel}/settings/libraries`;
  return <AdminOnly title="编辑媒体库"><MediaPageFrame className="media-manager-workspace" title="编辑媒体库" backTo={back} backLabel="返回媒体库管理"><QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />{library && <MediaLibraryEditor api={runtime.mediaApi} library={library} onSaved={updated => { queryClient.setQueryData(librariesQuery(runtime).queryKey, (value: { items: Library[] } | undefined) => value ? { items: value.items.map(item => item.id === updated.id ? updated : item) } : value); navigate(back); }} onCancel={() => navigate(back)} />}{!query.isPending && !query.error && !library && <Alert color="red">媒体库不存在。</Alert>}</MediaPageFrame></AdminOnly>;
}

export function MediaLibraryPermissionsPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { channel: routeChannel, libraryId = '' } = useParams();
  const channel = channelOf(routeChannel);
  const query = useQuery(librariesQuery(runtime));
  const library = query.data?.items.find(item => item.id === libraryId);
  const back = `/media/${channel}/settings/libraries`;
  return <AdminOnly title="访问权限"><MediaPageFrame className="media-manager-workspace" title="访问权限" backTo={back} backLabel="返回媒体库管理"><QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />{library && <MediaPermissions api={runtime.mediaApi} library={library} onSaved={access => { queryClient.setQueryData(librariesQuery(runtime).queryKey, (value: { items: Library[] } | undefined) => value ? { items: value.items.map(item => item.id === library.id ? { ...item, access } : item) } : value); navigate(back); }} onCancel={() => navigate(back)} />}{!query.isPending && !query.error && !library && <Alert color="red">媒体库不存在。</Alert>}</MediaPageFrame></AdminOnly>;
}


