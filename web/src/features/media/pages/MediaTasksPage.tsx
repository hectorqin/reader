import { Callout } from '../../../ui/toolkit.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const role = useAuthStore(state => state.verifiedUser?.role);
  const queryClient = useQueryClient();
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const tab = params.get('tab') === 'ai' || params.get('tab') === 'scrape' ? params.get('tab')! : 'scan';
  const requestedLibraryId = params.get('library') ?? '';
  const stateReturn = location.state?.returnTo;
  const returnTo = typeof stateReturn === 'string' && (stateReturn.startsWith('/media/') || stateReturn === '/me')
    ? stateReturn
    : '/me';
  const returnLabel = returnTo === '/me' ? '返回我的' : returnTo.includes('/settings/libraries') ? '返回媒体库管理' : '返回上一页';
  const libraries = useQuery(librariesQuery(runtime));
  const libraryId = libraries.data?.items.some(item => item.id === requestedLibraryId)
    ? requestedLibraryId
    : '';
  const jobs = useQuery({ ...jobsQuery(runtime, libraryId), enabled: tab === 'scan' });
  const aiJobs = useQuery({ ...aiJobsQuery(runtime, libraryId), enabled: tab === 'ai' });
  if (role !== 'admin') return <MediaPageFrame title="扫描与刮削"><Callout tone="error">需要管理员权限。</Callout></MediaPageFrame>;
  const setTab = (value: string) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { state: location.state }); };
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
  const libraryItems = libraries.data?.items ?? [];
  const libraryName = libraryItems.find(item => item.id === libraryId)?.name;
  const setLibrary = (value: string) => { const next = new URLSearchParams(params); value ? next.set('library', value) : next.delete('library'); setParams(next, { state: location.state }); };
  const filteredJobs = (jobs.data?.items ?? []).filter(job =>
    libraryId ? (!job.libraryId || job.libraryId === libraryId) : true);
  const filteredAiJobs = (aiJobs.data?.items ?? []).filter(job => !libraryId || job.libraryId === libraryId);
  // 媒体库扫描 and AI 扫描 share one library choice (kept in the URL), one primary action and a refresh.
  const toolbar = (scope: string, start: () => void, refresh: () => void, refreshing: boolean) => <div className="media-task-toolbar">
    <label className="media-task-library-select"><span>媒体库</span><MediaSelect aria-label={`${scope}媒体库`} value={libraryId} onChange={event => setLibrary(event.currentTarget.value)}><option value="">全部媒体库</option>{libraryItems.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</MediaSelect></label>
    <button type="button" className="media-task-icon" aria-label={`刷新${scope}任务`} title={`刷新${scope}任务`} disabled={refreshing} onClick={refresh}><RefreshCw size={17} aria-hidden="true" /></button>
    <button type="button" className="media-primary" disabled={!libraryItems.length || actionBusy} onClick={start}>{scope === 'AI 扫描' ? 'AI 扫描' : '扫描'}{libraryId ? '此媒体库' : '全部媒体库'}</button>
  </div>;
  return <MediaPageFrame className="media-manager-workspace" title="扫描与刮削" backTo={returnTo} backLabel={returnLabel}>
    <section className="media-manager">
      <nav className="media-task-tabs" aria-label="任务类型">{[['scan','媒体库扫描'],['ai','AI 扫描'],['scrape','刮削']].map(([value,label]) => <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}</nav>
      {requestedLibraryId && !libraryId && !libraries.isPending && !libraries.error && <Callout tone="warning">所选媒体库不存在，已切换为全部媒体库。</Callout>}
      <FloatingNotice message={actionError} error />
      <FloatingNotice message={actionNotice} kind="success" />
      <QueryFeedback pending={libraries.isPending || (tab === 'scan' ? jobs.isPending : tab === 'ai' ? aiJobs.isPending : false)} error={libraries.error || (tab === 'scan' ? jobs.error : tab === 'ai' ? aiJobs.error : null)} retry={() => { void libraries.refetch(); void jobs.refetch(); void aiJobs.refetch(); }} />
      {tab === 'scan' && !jobs.isPending && !jobs.error && <div className="media-task-panel">
        <p className="media-task-lead">{libraryName ? `重新读取「${libraryName}」的目录并更新索引。` : '读取每个媒体库的目录并更新索引；目录读取失败时保留原有资料。'}</p>
        {toolbar('扫描', () => { void startScan(libraryId || undefined); }, () => { void jobs.refetch(); }, jobs.isFetching)}
        <h2 className="media-task-section-title">扫描记录{filteredJobs.length ? <small>{filteredJobs.length}</small> : null}</h2>
        <ScanJobs jobs={filteredJobs} libraries={libraryItems} libraryName="媒体库" busy={jobs.isFetching || actionBusy} onRetry={id => { void startScan(id || libraryId || undefined); }} onCancel={id => { void runAction(async () => { await runtime.mediaApi.request(`jobs/${encodeURIComponent(id)}/cancel`, 'POST'); await jobs.refetch(); }, '扫描任务已取消。'); }} onDelete={id => { void runAction(async () => { await runtime.mediaApi.request(`scan-jobs/${encodeURIComponent(id)}`, 'DELETE'); await jobs.refetch(); }, '扫描记录已删除。'); }} />
      </div>}
      {tab === 'ai' && !aiJobs.isPending && !aiJobs.error && <div className="media-task-panel">
        <p className="media-task-lead">用 AI 识别{libraryName ? `「${libraryName}」中` : '各媒体库中'}未归档的文件，结果需要核对后再处理。</p>
        {toolbar('AI 扫描', () => { void startAiScan(libraryId || undefined); }, () => { void aiJobs.refetch(); }, aiJobs.isFetching)}
        <h2 className="media-task-section-title">扫描记录{filteredAiJobs.length ? <small>{filteredAiJobs.length}</small> : null}</h2>
        <AiScanJobs api={runtime.mediaApi} jobs={filteredAiJobs} libraries={libraryItems} busy={aiJobs.isFetching || actionBusy} onRefresh={() => { void aiJobs.refetch(); }} onDelete={id => { void runAction(async () => { await runtime.mediaApi.deleteAiScanJob(id); await aiJobs.refetch(); }, 'AI 扫描记录已删除。'); }} />
      </div>}
      {tab === 'scrape' && !libraries.isPending && !libraries.error && <ScrapeJobs api={runtime.mediaApi} libraries={libraryItems} initialLibraryId={libraryId} navigate={(mediaChannel: MediaChannel, id: string) => { navigate(`/media/${mediaChannel}/items/${encodeURIComponent(id)}`); }} />}
    </section>
  </MediaPageFrame>;
}
