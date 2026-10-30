import { Icon } from '../../../ui/icon.tsx';
import { Callout } from '../../../ui/toolkit.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { jobsQuery, librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { MediaLibraryList } from '../components/library-list.tsx';
import { MediaLibraryCreate } from '../components/library-create.tsx';
import { MediaScanSettings } from '../components/scan-settings.tsx';
import type { Library, MediaChannel, ScanJob } from '../api/media-api.ts';

const channels: MediaChannel[] = ['video', 'music', 'audiobook'];
function safeChannel(value: string | undefined): MediaChannel {
  return value && channels.includes(value as MediaChannel) ? value as MediaChannel : 'video';
}

export function MediaLibrariesPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  // Opened from 我的, back returns there; otherwise to the channel's 影音设置.
  const fromMine = useLocation().state?.returnTo === '/me';
  const { channel: routeChannel } = useParams();
  const channel = safeChannel(routeChannel);
  const role = useAuthStore(state => state.verifiedUser?.role);
  const queryClient = useQueryClient();
  const [position, setPosition] = useState({ query: '', page: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const query = useQuery(librariesQuery(runtime));
  // The latest scan of every library, polled so a running scan's progress moves on its card.
  const jobs = useQuery({ ...jobsQuery(runtime), enabled: role === 'admin' });
  if (role !== 'admin') return <MediaPageFrame title="媒体库管理"><Callout tone="error">需要管理员权限。</Callout></MediaPageFrame>;
  // The legacy manager is a shared workspace: opening it from any channel
  // shows every media library, while the channel only controls the return path
  // and the default type when creating a new library.
  const libraries = query.data?.items ?? [];
  const tasks = (id: string) => navigate(`/media/${channel}/settings/tasks?library=${encodeURIComponent(id)}`, { state: { returnTo: `/media/${channel}/settings/libraries` } });
  // Progress is shown on the library's own card, so starting or cancelling stays on this page.
  const act = async (id: string, action: () => Promise<unknown>, fallback: string) => {
    if (busyId) return;
    setBusyId(id); setActionError('');
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['media'] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : fallback);
    } finally { setBusyId(null); }
  };
  const scan = (id: string) => act(id, () => runtime.mediaApi.request(`libraries/${encodeURIComponent(id)}/scan`, 'POST'), '扫描请求失败，请稍后重试。');
  const cancel = (job: ScanJob) => act(job.libraryId ?? job.id, () => runtime.mediaApi.request(`jobs/${encodeURIComponent(job.id)}/cancel`, 'POST'), '取消扫描失败，请稍后重试。');
  const create = () => navigate(`/media/${channel}/settings/libraries/new`);
  const ready = !query.isPending && !query.error;
  return <MediaPageFrame className="media-manager-workspace" title="媒体库管理" backTo={fromMine ? '/me' : `/media/${channel}`} backLabel={fromMine ? '返回我的' : '返回频道'}>
    <FloatingNotice message={actionError} error />
    <QueryFeedback pending={query.isPending} error={query.error} retry={() => { void query.refetch(); }} />
    {ready && libraries.length > 0 && <div className="media-manager-bar">
      <span>{libraries.length} 个媒体库</span>
      <button type="button" onClick={() => navigate(`/media/${channel}/settings/tasks`, { state: { returnTo: `/media/${channel}/settings/libraries` } })}><Icon name="refresh" size={16} />扫描与刮削</button>
      <button type="button" className="media-primary" onClick={create}><Icon name="plus" size={16} />新建媒体库</button>
    </div>}
    <div className="media-libraries-layout"><div>
    {ready && libraries.length > 0 && <MediaLibraryList
      api={runtime.mediaApi}
      libraries={libraries}
      busy={busyId !== null}
      position={position}
      onPosition={setPosition}
      onEdit={(library: Library) => navigate(`/media/${channel}/settings/libraries/${encodeURIComponent(library.id)}/edit`)}
      onPermissions={(library: Library) => navigate(`/media/${channel}/settings/libraries/${encodeURIComponent(library.id)}/permissions`)}
      onScan={id => { void scan(id); }}
      jobs={jobs.data?.items ?? []}
      onCancel={job => { void cancel(job); }}
      onDetails={library => tasks(library.id)}
    />}
    {ready && libraries.length === 0 && <section className="media-library-empty" aria-label="媒体库空状态">
      <span className="media-empty-emblem"><Icon name="folder-browse" size={32} /></span>
      <h2>还没有媒体库</h2>
      <p>添加服务端能读取的影视、音乐或有声书目录，创建后会自动扫描。</p>
      <button type="button" className="media-primary" onClick={create}><Icon name="plus" size={16} />新建媒体库</button>
    </section>}
    </div><MediaScanSettings api={runtime.mediaApi} /></div>
  </MediaPageFrame>;
}

export function MediaLibraryCreatePage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel } = useParams();
  const channel = safeChannel(routeChannel);
  const queryClient = useQueryClient();
  const role = useAuthStore(state => state.verifiedUser?.role);
  if (role !== 'admin') return <MediaPageFrame title="新建媒体库"><Callout tone="error">需要管理员权限。</Callout></MediaPageFrame>;
  const mediaChannel = channel;
  return <MediaPageFrame className="media-manager-workspace" title="新建媒体库" backTo={`/media/${channel}/settings/libraries`} backLabel="返回媒体库管理"><MediaLibraryCreate
    api={runtime.mediaApi}
    channel={mediaChannel}
    disabled={false}
    hideHeader
    onCreated={library => {
      queryClient.setQueryData(librariesQuery(runtime).queryKey, (value: { items: Library[] } | undefined) => ({ items: [...(value?.items ?? []).filter(item => item.id !== library.id), library] }));
    }}
    onCancel={() => navigate(`/media/${channel}/settings/libraries`)}
    onJobs={async id => { navigate(`/media/${channel}/settings/tasks?library=${encodeURIComponent(id)}`, { state: { returnTo: `/media/${channel}/settings/libraries` } }); }}
  /></MediaPageFrame>;
}

