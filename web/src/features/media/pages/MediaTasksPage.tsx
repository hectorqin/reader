import { Alert, Button, Group, Loader, SegmentedControl, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { aiJobsQuery, jobsQuery, librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { ScanJobs } from '../../../media/scan-jobs.tsx';
import { AiScanJobs } from '../../../media/ai-scan-jobs.tsx';
import { ScrapeJobs } from '../../../media/scrape-jobs.tsx';
import type { MediaChannel } from '../api/media-api.ts';

export function MediaTasksPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { channel: routeChannel } = useParams();
  const channel = routeChannel === 'music' || routeChannel === 'audiobook' ? routeChannel : 'video';
  const [params, setParams] = useSearchParams();
  const role = useAuthStore(state => state.verifiedUser?.role);
  const queryClient = useQueryClient();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const tab = params.get('tab') === 'ai' || params.get('tab') === 'scrape' ? params.get('tab')! : 'scan';
  const requestedLibraryId = params.get('library') ?? '';
  const librariesQueryResult = useQuery(librariesQuery(runtime));
  const libraries = {
    ...librariesQueryResult,
    data: librariesQueryResult.data
      ? { items: librariesQueryResult.data.items.filter(item => item.kind === channel) }
      : undefined,
  };
  const libraryId = libraries.data?.items.some(item => item.id === requestedLibraryId)
    ? requestedLibraryId
    : '';
  const jobs = useQuery({ ...jobsQuery(runtime, libraryId), enabled: tab === 'scan' });
  const aiJobs = useQuery({ ...aiJobsQuery(runtime, libraryId), enabled: tab === 'ai' });
  if (role !== 'admin') return <MediaPageFrame title="扫描与刮削"><Alert color="red">需要管理员权限。</Alert></MediaPageFrame>;
  const setTab = (value: string) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next); };
  const runAction = async (action: () => Promise<void>, notice: string) => {
    if (actionBusy) return;
    setActionBusy(true); setActionError(''); setActionNotice('');
    try { await action(); setActionNotice(notice); await queryClient.invalidateQueries({ queryKey: ['media'] }); }
    catch (error) { setActionError(error instanceof Error ? error.message : '请求失败，请稍后重试。'); }
    finally { setActionBusy(false); }
  };
  const startScan = (id?: string) => runAction(
    async () => {
      if (id) {
        await runtime.mediaApi.request(`libraries/${encodeURIComponent(id)}/scan`, 'POST');
      } else {
        // Submit one request per library in the active channel. The legacy
        // bulk endpoint scans every channel and would violate this route's
        // boundary.
        await Promise.all((libraries.data?.items ?? []).map(library =>
          runtime.mediaApi.request(`libraries/${encodeURIComponent(library.id)}/scan`, 'POST')));
      }
      await jobs.refetch();
    },
    id ? '已提交当前媒体库扫描任务。' : '已提交批量媒体库扫描任务。',
  );
  const startAiScan = (id?: string) => runAction(
    async () => { await runtime.mediaApi.startAiScan(id); await aiJobs.refetch(); },
    id ? '已创建当前媒体库的 AI 扫描任务。' : '已创建全部媒体库的 AI 扫描任务。',
  );
  const channelLibraryIds = new Set((libraries.data?.items ?? []).map(library => library.id));
  const filteredJobs = (jobs.data?.items ?? []).filter(job =>
    libraryId ? (!job.libraryId || job.libraryId === libraryId) : (!job.libraryId || channelLibraryIds.has(job.libraryId)));
  return <MediaPageFrame title="扫描与刮削">
    <Stack>
      <SegmentedControl value={tab} onChange={setTab} data={[{ value: 'scan', label: '媒体库扫描' }, { value: 'ai', label: 'AI 扫描' }, { value: 'scrape', label: '刮削' }]} />
      {requestedLibraryId && !libraryId && !libraries.isPending && !libraries.error && <Alert color="yellow">所选媒体库不存在，或不属于当前频道；已切换为全部媒体库。</Alert>}
      {actionError && <Alert color="red" title="操作失败">{actionError}</Alert>}
      {actionNotice && <Alert color="green">{actionNotice}</Alert>}
      <QueryFeedback pending={libraries.isPending || (tab === 'scan' ? jobs.isPending : tab === 'ai' ? aiJobs.isPending : false)} error={libraries.error || (tab === 'scan' ? jobs.error : tab === 'ai' ? aiJobs.error : null)} retry={() => { void libraries.refetch(); void jobs.refetch(); void aiJobs.refetch(); }} />
      {(libraries.isPending || (tab === 'scan' ? jobs.isPending : tab === 'ai' ? aiJobs.isPending : false)) && <Loader />}
      {tab === 'scan' && !jobs.isPending && !jobs.error && <Stack>
        <Group justify="space-between"><div><Text fw={600}>媒体库扫描</Text><Text size="sm" c="dimmed">扫描目录并更新媒体索引。</Text></div><Button loading={actionBusy} disabled={!libraries.data?.items.length} onClick={() => { void startScan(libraryId || undefined); }}>扫描{libraryId ? '当前库' : '所有媒体库'}</Button></Group>
        <ScanJobs jobs={filteredJobs} libraries={libraries.data?.items ?? []} libraryName="媒体库" busy={jobs.isFetching || actionBusy} onRetry={id => { void startScan(id || libraryId || undefined); }} onCancel={id => { void runAction(async () => { await runtime.mediaApi.request(`jobs/${encodeURIComponent(id)}/cancel`, 'POST'); await jobs.refetch(); }, '扫描任务已取消。'); }} onDelete={id => { void runAction(async () => { await runtime.mediaApi.request(`scan-jobs/${encodeURIComponent(id)}`, 'DELETE'); await jobs.refetch(); }, '扫描历史已删除。'); }} />
      </Stack>}
      {tab === 'ai' && !aiJobs.isPending && !aiJobs.error && <Stack>
        <Group justify="space-between"><div><Text fw={600}>AI 扫描</Text><Text size="sm" c="dimmed">识别未归档文件并生成待处理结果。</Text></div><Group><Button loading={actionBusy} disabled={!libraryId} onClick={() => { void startAiScan(libraryId); }}>扫描当前库</Button><Button loading={actionBusy} variant="light" disabled={!libraries.data?.items.length} onClick={() => { void startAiScan(); }}>扫描所有媒体库</Button></Group></Group>
        <AiScanJobs api={runtime.mediaApi} jobs={(aiJobs.data?.items ?? []).filter(job => !libraryId || job.libraryId === libraryId)} libraries={libraries.data?.items ?? []} busy={aiJobs.isFetching || actionBusy} onRefresh={() => { void aiJobs.refetch(); }} onDelete={id => { void runAction(async () => { await runtime.mediaApi.deleteAiScanJob(id); await aiJobs.refetch(); }, 'AI 扫描历史已删除。'); }} />
      </Stack>}
      {tab === 'scrape' && !libraries.isPending && !libraries.error && <ScrapeJobs api={runtime.mediaApi} libraries={libraries.data?.items ?? []} navigate={(mediaChannel: MediaChannel, id: string) => { navigate(`/media/${mediaChannel}/items/${encodeURIComponent(id)}`); }} />}
    </Stack>
  </MediaPageFrame>;
}




