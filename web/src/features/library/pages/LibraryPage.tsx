import { FolderPicker, loadFolderChoices } from '../components/FolderPicker.tsx';
import { describeError } from '../../../api/errors.ts';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import { Callout, Icon } from '../../../ui/toolkit.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { LIBRARY_PATH } from '../../../shared/library-link.ts';
import { useCallback, useEffect, useState } from 'react';
import type { BrowseEntry } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { DialogView, type Dialog } from '../../../ui/dialog.tsx';
import { formatBytes, formatDate } from '../../../lib/format.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { Pager } from '../../../ui/pager.tsx';

function CollectionHeader({ title, subtitle, backTo, actions, className, footer }: { title: string; subtitle: string; backTo?: string; actions?: React.ReactNode; className?: string; footer?: React.ReactNode }) {
  return <header className={'collection-header' + (className ? ` ${className}` : '')}><div className="collection-heading">{backTo && <Link to={backTo} className="icon-button" aria-label="返回" title="返回"><Icon name="chevron-left" /></Link>}<div className="collection-heading-text"><h1>{title}</h1><p className="muted">{subtitle}</p></div></div>{actions && <nav className="collection-links" aria-label="页面操作">{actions}</nav>}{footer}</header>;
}

function entryMeta(entry: BrowseEntry): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  if (entry.type === 'file') {
    if (entry.size > 0) result.push(<span key="size">{formatBytes(entry.size)}</span>);
    if (entry.mtime > 0) result.push(<span key="mtime">{formatDate(entry.mtime)}</span>);
  }
  if (entry.scanned) result.push(<span className="manager-badge" key="book">书籍</span>);
  if (entry.hiddenByRule) result.push(<span className="manager-badge warn" key="hidden">扫描忽略</span>);
  if (entry.shelfState === 'off') result.push(<span className="manager-badge off" key="shelf">不在书架</span>);
  if (entry.type === 'file' && entry.ext && !entry.scanned) result.push(<span key="ext">{entry.ext}</span>);
  return result;
}

/** What an upload did, skips and their reason included (ui.md §3.4.4). */
const describeUpload = (result: { uploaded: unknown[]; skipped: Array<{ reason: string }> }) => ({
  text: `已上传 ${result.uploaded.length} 本` + (result.skipped.length ? `，跳过 ${result.skipped.length} 个（${result.skipped[0]!.reason}）` : ''),
  error: result.uploaded.length === 0,
});

const describePaths = (paths: string[]) => {
  const names = paths.map(item => `「${item.split('/').pop() || item}」`);
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')}等 ${names.length} 项`;
};

export function LibraryFilesPage() {
  // The verified role once /auth/me answers, the stored session's until then (or while
  // offline), so an admin reloading the page is not shown a refusal first. The server
  // checks every write regardless. A member following a shared link lands on the library
  // in 发现 (ui.md §3.4.4) instead of an error.
  const role = useAuthStore(state => (state.verifiedUser ?? state.session?.user)?.role);
  if (!role) return <FloatingNotice message="正在确认权限…" busy />;
  if (role !== 'admin') return <Navigate to={LIBRARY_PATH} replace />;
  return <LibraryFilesAdminPage />;
}

function LibraryFilesAdminPage() {
  const runtime = useRuntime(); const queryClient = useQueryClient(); const [params, setParams] = useSearchParams(); const path = params.get('path') ?? ''; const page = Math.max(1, Number(params.get('page')) || 1); const [selected, setSelected] = useState<string[]>([]); const [dialog, setDialog] = useState<Dialog | null>(null); const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const query = useQuery({ queryKey: ['library-files', runtime.api.baseUrl, path, page], queryFn: ({ signal }) => runtime.api.browse(path, page, { signal }) });
  // A selection only means something on the listing it was made on: carried into another
  // folder, 删除 would act on files the admin can no longer see.
  useEffect(() => { setSelected([]); }, [path, page]);
  const go = (next: string, p = 1) => setParams({ ...(next ? { path: next } : {}), ...(p > 1 ? { page: String(p) } : {}) }); // A file change is a change to the library and to every shelf that held the book, so the
  // browsing page and the shelf must not keep showing what they cached before it.
  const refresh = () => Promise.all(['library-files', 'search', 'shelf'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  // Each action says what it did (ui.md §4), not a generic 操作已完成.
  const mutate = async <T,>(action: () => Promise<T>, describe: (result: T) => { text: string; error?: boolean }) => { setFeedback(null); try { const result = await action(); setSelected([]); await refresh(); setFeedback(describe(result)); } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : '操作失败，请重试', error: true }); } };
  const prompt = (title: string, value = '') => new Promise<string | null>(resolve => setDialog({ kind: 'prompt', title, value, resolve }));
  const confirm = (title: string, body: string) => new Promise<boolean>(resolve => setDialog({ kind: 'confirm', title, body, resolve }));
  const rename = async (entry: BrowseEntry) => { const name = (await prompt('重命名', entry.name))?.trim(); if (name && name !== entry.name) await mutate(() => runtime.api.browseRename(entry.path, name), () => ({ text: `已重命名为「${name}」` })); };
  const mkdir = async () => { const name = (await prompt('新建文件夹'))?.trim(); if (name) await mutate(() => runtime.api.browseMkdir(path, name), () => ({ text: `已新建文件夹「${name}」` })); };
  // The destination is picked by walking the library (FolderPicker), not typed as a path.
  const [moving, setMoving] = useState<string[] | null>(null);
  const move = (paths = selected) => { if (paths.length) setMoving(paths); };
  const moveTo = (paths: string[], target: string) => { setMoving(null); void mutate(() => runtime.api.browseMove(paths, target), result => ({ text: `已移动 ${result.moved} 项到「${result.target || '书库'}」` })); };
  const loadFolders = useCallback((folder: string, signal: AbortSignal) => loadFolderChoices((p, n, options) => runtime.api.browse(p, n, options), folder, signal), [runtime]);
  const remove = async (paths = selected) => { if (paths.length && await confirm(paths.length === 1 ? '删除' : `删除 ${paths.length} 项`, `${describePaths(paths)}将从磁盘上删除，无法撤销。`)) await mutate(() => runtime.api.browseDelete(paths), result => ({ text: `已删除 ${result.removed} 项` })); };
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / 200)) : 1;
  useEffect(() => { if (query.data && page > pages) setParams({ ...(path ? { path } : {}), ...(pages > 1 ? { page: String(pages) } : {}) }, { replace: true }); });
  const crumbs = <div className="manager-crumbs">{(query.data?.crumbs ?? [{ name: '书库', path: '' }]).map((crumb, index, all) => <span key={`${crumb.path}-${index}`}>{index > 0 && <span className="manager-crumb-sep">/</span>}<button type="button" className="manager-crumb" aria-current={index === all.length - 1 ? 'location' : undefined} onClick={() => go(crumb.path)}>{crumb.name}</button></span>)}</div>;
  return <div className="library-screen library-files-screen"><CollectionHeader className="file-manager-header" title="文件管理" subtitle="管理书库中的文件与文件夹" backTo={LIBRARY_PATH} actions={<><label className={'button collection-link' + (!query.data?.writable ? ' is-disabled' : '')}><Icon name="upload" size={18} /><span>上传书籍</span><input hidden type="file" multiple disabled={!query.data?.writable} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); if (files.length) void mutate(() => runtime.api.upload(files, path, 'rename'), describeUpload); event.currentTarget.value = ''; }} /></label><button type="button" className="button collection-link" disabled={!query.data?.writable} onClick={mkdir}><Icon name="plus" size={18} /><span>新建文件夹</span></button></>} footer={crumbs} />
    <main className="manager-body">
      {selected.length > 0 && <div className="manager-actions"><span className="manager-selected-count">已选 {selected.length} 项</span><button type="button" className="button" onClick={() => void move()}>移动</button><button type="button" className="button danger" onClick={() => void remove()}>删除</button><button type="button" className="button" onClick={() => setSelected([])}>清除</button></div>}
      <FloatingNotice message={feedback?.text ?? ''} error={!!feedback?.error} kind="success" />
      {query.isPending && <FloatingNotice message="正在读取文件列表…" busy />}{query.error && <Callout tone="error" title="文件列表加载失败" action={{ label: '重试', onClick: () => void query.refetch() }}>{describeError(query.error)}</Callout>}
      {query.data && <div className={'manager-list' + (selected.length ? ' selection-mode' : '')}>{query.data.entries.length === 0 ? <div className="empty-state collection-empty"><Icon name="folder" className="empty-glyph" /><p>这个文件夹是空的</p><p className="muted">{query.data.writable ? '使用上方的上传或新建文件夹，整理你的书库。' : '当前目录只读，可以浏览已有文件。'}</p></div> : query.data.entries.map(entry => { const checked = selected.includes(entry.path); return <div className="manager-row" data-type={entry.type} data-selected={checked ? 'true' : undefined} key={entry.path}><button type="button" className="manager-check" role="checkbox" aria-label={`选择${entry.name}`} aria-checked={checked} onClick={event => { event.stopPropagation(); setSelected(items => items.includes(entry.path) ? items.filter(item => item !== entry.path) : [...items, entry.path]); }} /><div className="manager-name"><span className="manager-icon">{entry.type === 'dir' ? <Icon name="folder" size={20} /> : <Icon name="file-text" size={20} />}</span><span className="manager-label">{entry.type === 'dir' ? <button type="button" className="manager-crumb" onClick={() => go(entry.path)}>{entry.name}</button> : entry.name}</span></div><div className="manager-meta muted">{entryMeta(entry)}</div><ActionMenu className="manager-more" label={`${entry.name} 的操作`} title={entry.name} items={[{ label: '重命名', disabled: !query.data.writable, onSelect: () => void rename(entry) }, { label: '选择', onSelect: () => setSelected([entry.path]) }, { label: '移动…', disabled: !query.data.writable, onSelect: () => void move([entry.path]) }, { label: '删除', danger: true, disabled: !query.data.writable, onSelect: () => void remove([entry.path]) }]} /></div>; })}</div>}
      {query.data && <div className="manager-status muted">{query.data.dirs} 个文件夹 · {query.data.files} 个文件 · {formatBytes(query.data.size)}</div>}
      {pages > 1 && <Pager className="manager-pager" page={Math.min(page, pages)} pageCount={pages} busy={query.isFetching} onGo={next => go(path, next)} />}
    </main>{moving && <FolderPicker moving={moving} from={path} load={loadFolders} onPick={target => moveTo(moving, target)} onClose={() => setMoving(null)} />}{dialog && <DialogView dialog={dialog} destructive="删除" onClose={answer => { const current = dialog; setDialog(null); current.resolve(answer as never); }} />}</div>;
}
