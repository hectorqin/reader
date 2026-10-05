import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { aiJobsQuery, jobsQuery, librariesQuery } from '../queries/media.queries.ts';
import { MediaPageFrame, QueryFeedback } from '../components/MediaPageFrame.tsx';
import { ScanJobs } from '../components/scan-jobs.tsx';
import { AiScanJobs } from '../components/ai-scan-jobs.tsx';
import { ScrapeJobs } from '../components/scrape-jobs.tsx';
import { MediaSelect } from '../components/select.tsx';
import { RefreshCw } from 'lucide-react';
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
  const libraries = useQuery(librariesQuery(runtime));
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
        // The legacy task workspace scans every media library, regardless of
        // which channel opened the settings route.
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
  const filteredJobs = (jobs.data?.items ?? []).filter(job =>
    libraryId ? (!job.libraryId || job.libraryId === libraryId) : true);
  return <MediaPageFrame className="media-manager-workspace" title="扫描与刮削" backTo={`/media/${channel}/settings`} backLabel="返回影音设置">
    <section className="media-manager">
      <nav className="media-task-tabs" aria-label="任务类型">{[['scan','媒体库扫描'],['ai','AI 扫描'],['scrape','刮削']].map(([value,label]) => <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}</nav>
      {requestedLibraryId && !libraryId && !libraries.isPending && !libraries.error && <Alert color="yellow">所选媒体库不存在，已切换为全部媒体库。</Alert>}
      {actionError && <Alert color="red" title="操作失败">{actionError}</Alert>}
      {actionNotice && <Alert color="green">{actionNotice}</Alert>}
      <QueryFeedback pending={libraries.isPending || (tab === 'scan' ? jobs.isPending : tab === 'ai' ? aiJobs.isPending : false)} error={libraries.error || (tab === 'scan' ? jobs.error : tab === 'ai' ? aiJobs.error : null)} retry={() => { void libraries.refetch(); void jobs.refetch(); void aiJobs.refetch(); }} />
      {tab === 'scan' && !jobs.isPending && !jobs.error && <Stack>
        <div className="media-task-intro"><div><Text component="h2">媒体库扫描</Text><Text component="p">扫描所有媒体库并建立索引</Text></div><Button className="media-primary" loading={actionBusy} disabled={!libraries.data?.items.length} onClick={() => { void startScan(libraryId || undefined); }}>扫描{libraryId ? '当前库' : '所有媒体库'}</Button></div>
        <div className="media-task-library"><label>媒体库<MediaSelect aria-label="扫描媒体库" value={libraryId} onChange={event => { const next = new URLSearchParams(params); const value = event.currentTarget.value; value ? next.set('library', value) : next.delete('library'); setParams(next); }}><option value="">全部媒体库 · 最新任务</option>{(libraries.data?.items ?? []).map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</MediaSelect></label><Button disabled={!libraryId || actionBusy} onClick={() => { void startScan(libraryId); }}><RefreshCw size={16} aria-hidden="true" />扫描当前库</Button><Button aria-label="刷新扫描任务" title="刷新扫描任务" variant="subtle" onClick={() => { void jobs.refetch(); }}><RefreshCw size={16} aria-hidden="true" /></Button></div>
        <h2 className="media-task-section-title">媒体库扫描历史</h2>
        <ScanJobs jobs={filteredJobs} libraries={libraries.data?.items ?? []} libraryName="媒体库" busy={jobs.isFetching || actionBusy} onRetry={id => { void startScan(id || libraryId || undefined); }} onCancel={id => { void runAction(async () => { await runtime.mediaApi.request(`jobs/${encodeURIComponent(id)}/cancel`, 'POST'); await jobs.refetch(); }, '扫描任务已取消。'); }} onDelete={id => { void runAction(async () => { await runtime.mediaApi.request(`scan-jobs/${encodeURIComponent(id)}`, 'DELETE'); await jobs.refetch(); }, '扫描历史已删除。'); }} />
      </Stack>}
      {tab === 'ai' && !aiJobs.isPending && !aiJobs.error && <Stack>
        <Group justify="space-between"><div><Text fw={600}>AI 扫描</Text><Text size="sm" c="dimmed">识别未归档文件并生成待处理结果。</Text></div><Group><Button loading={actionBusy} disabled={!libraryId} onClick={() => { void startAiScan(libraryId); }}>扫描当前库</Button><Button loading={actionBusy} variant="light" disabled={!libraries.data?.items.length} onClick={() => { void startAiScan(); }}>扫描所有媒体库</Button></Group></Group>
        <AiScanJobs api={runtime.mediaApi} jobs={(aiJobs.data?.items ?? []).filter(job => !libraryId || job.libraryId === libraryId)} libraries={libraries.data?.items ?? []} busy={aiJobs.isFetching || actionBusy} onRefresh={() => { void aiJobs.refetch(); }} onDelete={id => { void runAction(async () => { await runtime.mediaApi.deleteAiScanJob(id); await aiJobs.refetch(); }, 'AI 扫描历史已删除。'); }} />
      </Stack>}
      {tab === 'scrape' && !libraries.isPending && !libraries.error && <ScrapeJobs api={runtime.mediaApi} libraries={libraries.data?.items ?? []} navigate={(mediaChannel: MediaChannel, id: string) => { navigate(`/media/${mediaChannel}/items/${encodeURIComponent(id)}`); }} />}
    </section>
  </MediaPageFrame>;
}




