import { BookOpen, FileText, Folder, Plus, Search, Upload } from 'lucide-react';
import { coverTint } from '../../../ui/cover-tint.ts';
import { BookGridSkeleton } from '../../../ui/book-grid-skeleton.tsx';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import { Callout, Icon } from '../../../ui/toolkit.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import type { Book, BrowseEntry } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { DialogView, type Dialog } from '../../../ui/dialog.tsx';
import { formatBytes, formatDate } from '../../../lib/format.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { Pager } from '../../../ui/pager.tsx';
import { describeShelfAction, SHELF_ACTION_LABELS } from '../../../ui/shelf-membership.ts';

function Cover({ book }: { book: Book }) {
  const runtime = useRuntime();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    if (!book.coverUrl) { setSrc(null); return; }
    void runtime.api.coverBytes(book.coverUrl).then(bytes => {
      if (!live) return;
      objectUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/jpeg' }));
      setSrc(objectUrl);
    }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [runtime.api, book.coverUrl]);
  return <div className="cover">{src ? <img src={src} alt="" loading="lazy" /> : <div className="placeholder" style={coverTint(book.title || '')}>{book.title || '无封面'}</div>}<span className="format-badge">{book.format || '书籍'}</span></div>;
}

function CollectionHeader({ title, subtitle, backTo, actions, className, footer }: { title: string; subtitle: string; backTo?: string; actions?: React.ReactNode; className?: string; footer?: React.ReactNode }) {
  return <header className={'collection-header' + (className ? ` ${className}` : '')}><div className="collection-heading">{backTo && <Link to={backTo} className="icon-button" aria-label="返回" title="返回"><Icon name="chevron-left" /></Link>}<div className="collection-heading-text"><h1>{title}</h1><p className="muted">{subtitle}</p></div></div>{actions && <nav className="collection-links" aria-label="页面操作">{actions}</nav>}{footer}</header>;
}

export function LibraryPage() { return <LibraryBrowsePage />; }

export function LibraryBrowsePage() {
  const runtime = useRuntime(); const queryClient = useQueryClient(); const role = useAuthStore(state => state.verifiedUser?.role); const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? ''; const page = Math.max(1, Number(params.get('page')) || 1); const search = params.get('q') ?? ''; const [draft, setDraft] = useState(search); useEffect(() => { setDraft(search); }, [search]); const [busy, setBusy] = useState<string | null>(null);
  // Only the crumbs and writability are read from the listing; it pages folders (200 a page), not books, so it stays on its first page.
  const listing = useQuery({ queryKey: ['library-browse', runtime.api.baseUrl, path], queryFn: ({ signal }) => runtime.api.browse(path, 1, { signal }) });
  const books = useQuery({ queryKey: ['library-books', runtime.api.baseUrl, 'browse', path, page, search], queryFn: ({ signal }) => runtime.api.listBooks({ scope: 'library', path, page, pageSize: 60, search, sort: 'title', order: 'asc' }, { signal }) });
  const navigate = (nextPath: string, nextPage = 1, nextSearch = '', replace = false) => setParams({ ...(nextPath ? { path: nextPath } : {}), ...(nextSearch ? { q: nextSearch } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) }, { replace });
  const [uploading, setUploading] = useState(false); const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  // Members add books here; everything else that touches files is the admin-only file manager.
  const upload = async (files: File[]) => { setFeedback(null); setUploading(true); try { const result = await runtime.api.upload(files, path, 'rename'); await Promise.all([queryClient.invalidateQueries({ queryKey: ['library-books'] }), queryClient.invalidateQueries({ queryKey: ['library-browse'] }), queryClient.invalidateQueries({ queryKey: ['shelf'] })]); setFeedback(describeUpload(result)); } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : '上传失败，请重试', error: true }); } finally { setUploading(false); } };
  const uploadAccess = useQuery({ queryKey: ['library-upload', runtime.api.baseUrl], queryFn: ({ signal }) => runtime.api.uploadProbe({ signal }), enabled: !!role && role !== 'admin' });
  const writable = !!listing.data?.writable && !uploading;
  const uploadButton = uploadAccess.data?.allowed !== true ? undefined : <label className={'button collection-link' + (!writable ? ' is-disabled' : '')}><Upload size={18} /><span>{uploading ? '上传中…' : '上传书籍'}</span><input hidden type="file" multiple disabled={!writable} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); if (files.length) void upload(files); event.currentTarget.value = ''; }} /></label>;
  const toggle = async (book: Book) => { setBusy(book.id); setFeedback(null); try { const result = await runtime.api.browseBatchShelf({ bookIds: [book.id] }, 'add'); await queryClient.invalidateQueries({ queryKey: ['library-books'] }); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); setFeedback({ text: describeShelfAction('add', result), error: !result.applied }); } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : `${SHELF_ACTION_LABELS.add}失败，请重试`, error: true }); } finally { setBusy(null); } };
  const count = books.data?.total ?? 0; const pages = books.data ? Math.max(1, Math.ceil(count / books.data.pageSize)) : 1;
  const folders = (listing.data?.entries ?? []).filter(entry => entry.type === 'dir' && !entry.hiddenByRule);
  // Past the last page (a stale link, or the last book of the last page moved away) clamps instead of claiming the library is empty.
  useEffect(() => { if (books.data && page > pages) navigate(path, pages, search, true); });
  const empty = !books.isPending && !books.error && books.data?.items.length === 0 && page <= pages;
  return <div className="library-screen library-browse-screen">
    <CollectionHeader title="书库" subtitle="浏览本地书籍，发现下一本好书" backTo="/shelf" actions={role === 'admin' ? <Link className="button collection-link" to="/library/files"><Folder size={18} /><span>文件管理</span><Icon name="chevron-right" /></Link> : uploadButton} />
    {listing.data && listing.data.crumbs.length > 1 && <div className="manager-crumbs library-path" aria-label="当前文件夹">{listing.data.crumbs.map((crumb, index) => <span key={`${crumb.path}-${index}`}>{index > 0 && <span className="manager-crumb-sep">/</span>}<button type="button" className="manager-crumb" onClick={() => navigate(crumb.path)}>{crumb.name}</button></span>)}</div>}
    <main className="manager-body library-browse-body">
      <form className="shelf-search library-search" role="search" onSubmit={(event: FormEvent) => { event.preventDefault(); navigate(path, 1, draft.trim()); }}><Search className="search-glyph" size={18} aria-hidden="true" /><input type="search" aria-label="搜索书库" placeholder="在书库中搜索书名、作者" value={draft} onChange={event => setDraft(event.currentTarget.value)} />{draft && <button type="button" className="search-clear" aria-label="清除搜索" onClick={() => { setDraft(''); navigate(path); }}><Icon name="close" /></button>}</form>
      {/* The way into a folder: the books below are this folder's and everything under it,
          and each chip narrows the scope one level (the crumbs above widen it again). */}
      {folders.length > 0 && <nav className="library-folders" aria-label="子文件夹">{folders.map(folder => <button key={folder.path} type="button" className="chip" onClick={() => navigate(folder.path)}><Folder size={14} aria-hidden="true" />{folder.name}</button>)}</nav>}
      <FloatingNotice message={feedback?.text ?? ''} error={!!feedback?.error} kind="success" />
      {books.isPending && <><FloatingNotice message="正在加载书库…" busy /><BookGridSkeleton className="library-browse-grid" density="cozy" /></>}{books.error && <Callout tone="error" title="书库加载失败" action={{ label: '重试', onClick: () => void books.refetch() }}>{books.error.message}</Callout>}
      {empty && <div className="empty-state collection-empty"><BookOpen className="empty-glyph" aria-hidden="true" /><p>{search ? '没有匹配的书' : '书库还没有书'}</p><p className="muted">{search ? '换个关键词，或者检查一下作者名的写法。' : role === 'admin' ? '前往文件管理添加书籍，再回到这里浏览。' : uploadAccess.data?.allowed ? '使用上方的上传书籍添加书籍，再回到这里浏览。' : '书库的书由管理员添加。'}</p><div className="empty-actions">{search ? <button type="button" className="button" onClick={() => { setDraft(''); navigate(path); }}>清除搜索</button> : role === 'admin' ? <Link className="button primary" to="/library/files"><Folder size={16} />文件管理</Link> : null}</div></div>}
      {books.data && books.data.items.length > 0 && <div className="book-grid library-browse-grid" data-density="cozy" data-show-author="true">{books.data.items.map(book => <div className="book-card is-row" key={book.id}><Link className="book-open" to={`/book/${encodeURIComponent(book.id)}`} aria-label={`${book.title} ${book.author ?? ''}`}><Cover book={book} /><div className="title">{book.title || '未命名'}</div><div className="author">{book.author || '未知作者'}</div></Link>{book.shelfState === 'off' && <button type="button" className="book-shelve" aria-label={`把${book.title}加入书架`} disabled={busy === book.id} onClick={() => void toggle(book)}><Icon name="plus" />{SHELF_ACTION_LABELS.add}</button>}</div>)}</div>}
      {books.data && <div className="manager-status muted">{search ? `找到 ${count} 本` : `${count} 本 · 第 ${page} / ${pages} 页`}</div>}
      {pages > 1 && <Pager className="shelf-pager" page={Math.min(page, pages)} pageCount={pages} busy={books.isFetching} onGo={next => navigate(path, next, search)} />}
    </main>
  </div>;
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

/** One sentence for both upload buttons (member and admin), skips and their reason included (ui.md §3.4.4). */
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
  // checks every write regardless. A member following a shared link lands on the same
  // folder's browsing page (ui.md §3.4.4) instead of an error.
  const role = useAuthStore(state => (state.verifiedUser ?? state.session?.user)?.role); const [params] = useSearchParams(); const path = params.get('path') ?? '';
  if (!role) return <FloatingNotice message="正在确认权限…" busy />;
  if (role !== 'admin') return <Navigate to={path ? `/library?path=${encodeURIComponent(path)}` : '/library'} replace />;
  return <LibraryFilesAdminPage />;
}

function LibraryFilesAdminPage() {
  const runtime = useRuntime(); const queryClient = useQueryClient(); const [params, setParams] = useSearchParams(); const path = params.get('path') ?? ''; const page = Math.max(1, Number(params.get('page')) || 1); const [selected, setSelected] = useState<string[]>([]); const [dialog, setDialog] = useState<Dialog | null>(null); const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const query = useQuery({ queryKey: ['library-files', runtime.api.baseUrl, path, page], queryFn: ({ signal }) => runtime.api.browse(path, page, { signal }) });
  // A selection only means something on the listing it was made on: carried into another
  // folder, 删除 would act on files the admin can no longer see.
  useEffect(() => { setSelected([]); }, [path, page]);
  const go = (next: string, p = 1) => setParams({ ...(next ? { path: next } : {}), ...(p > 1 ? { page: String(p) } : {}) }); const refresh = () => queryClient.invalidateQueries({ queryKey: ['library-files'] });
  // Each action says what it did (ui.md §4), not a generic 操作已完成.
  const mutate = async <T,>(action: () => Promise<T>, describe: (result: T) => { text: string; error?: boolean }) => { setFeedback(null); try { const result = await action(); setSelected([]); await refresh(); setFeedback(describe(result)); } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : '操作失败，请重试', error: true }); } };
  const prompt = (title: string, value = '') => new Promise<string | null>(resolve => setDialog({ kind: 'prompt', title, value, resolve }));
  const confirm = (title: string, body: string) => new Promise<boolean>(resolve => setDialog({ kind: 'confirm', title, body, resolve }));
  const rename = async (entry: BrowseEntry) => { const name = (await prompt('重命名', entry.name))?.trim(); if (name && name !== entry.name) await mutate(() => runtime.api.browseRename(entry.path, name), () => ({ text: `已重命名为「${name}」` })); };
  const mkdir = async () => { const name = (await prompt('新建文件夹'))?.trim(); if (name) await mutate(() => runtime.api.browseMkdir(path, name), () => ({ text: `已新建文件夹「${name}」` })); };
  const move = async (paths = selected) => { const target = await prompt('移动到（书库相对路径）', path); if (target !== null && paths.length) await mutate(() => runtime.api.browseMove(paths, target.trim()), result => ({ text: `已移动 ${result.moved} 项到「${result.target || '书库'}」` })); };
  const remove = async (paths = selected) => { if (paths.length && await confirm(paths.length === 1 ? '删除' : `删除 ${paths.length} 项`, `${describePaths(paths)}将从磁盘上删除，无法撤销。`)) await mutate(() => runtime.api.browseDelete(paths), result => ({ text: `已删除 ${result.removed} 项` })); };
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / 200)) : 1;
  useEffect(() => { if (query.data && page > pages) setParams({ ...(path ? { path } : {}), ...(pages > 1 ? { page: String(pages) } : {}) }, { replace: true }); });
  const crumbs = <div className="manager-crumbs">{(query.data?.crumbs ?? [{ name: '书库', path: '' }]).map((crumb, index, all) => <span key={`${crumb.path}-${index}`}>{index > 0 && <span className="manager-crumb-sep">/</span>}<button type="button" className="manager-crumb" aria-current={index === all.length - 1 ? 'location' : undefined} onClick={() => go(crumb.path)}>{crumb.name}</button></span>)}</div>;
  return <div className="library-screen library-files-screen"><CollectionHeader className="file-manager-header" title="文件管理" subtitle="管理书库中的文件与文件夹" backTo="/library" actions={<><label className={'button collection-link' + (!query.data?.writable ? ' is-disabled' : '')}><Upload size={18} /><span>上传书籍</span><input hidden type="file" multiple disabled={!query.data?.writable} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); if (files.length) void mutate(() => runtime.api.upload(files, path, 'rename'), describeUpload); event.currentTarget.value = ''; }} /></label><button type="button" className="button collection-link" disabled={!query.data?.writable} onClick={mkdir}><Plus size={18} /><span>新建文件夹</span></button></>} footer={crumbs} />
    <main className="manager-body">
      {selected.length > 0 && <div className="manager-actions"><span className="manager-selected-count">已选 {selected.length} 项</span><button type="button" className="button" onClick={() => void move()}>移动</button><button type="button" className="button danger" onClick={() => void remove()}>删除</button><button type="button" className="button" onClick={() => setSelected([])}>清除</button></div>}
      <FloatingNotice message={feedback?.text ?? ''} error={!!feedback?.error} kind="success" />
      {query.isPending && <FloatingNotice message="正在读取文件列表…" busy />}{query.error && <Callout tone="error" title="文件列表加载失败" action={{ label: '重试', onClick: () => void query.refetch() }}>{query.error.message}</Callout>}
      {query.data && <div className={'manager-list' + (selected.length ? ' selection-mode' : '')}>{query.data.entries.length === 0 ? <div className="empty-state collection-empty"><Folder className="empty-glyph" aria-hidden="true" /><p>这个文件夹是空的</p><p className="muted">{query.data.writable ? '使用上方的上传或新建文件夹，整理你的书库。' : '当前目录只读，可以浏览已有文件。'}</p></div> : query.data.entries.map(entry => { const checked = selected.includes(entry.path); return <div className="manager-row" data-type={entry.type} data-selected={checked ? 'true' : undefined} key={entry.path}><button type="button" className="manager-check" role="checkbox" aria-label={`选择${entry.name}`} aria-checked={checked} onClick={event => { event.stopPropagation(); setSelected(items => items.includes(entry.path) ? items.filter(item => item !== entry.path) : [...items, entry.path]); }} /><div className="manager-name"><span className="manager-icon">{entry.type === 'dir' ? <Folder size={20} /> : <FileText size={20} />}</span><span className="manager-label">{entry.type === 'dir' ? <button type="button" className="manager-crumb" onClick={() => go(entry.path)}>{entry.name}</button> : entry.name}</span></div><div className="manager-meta muted">{entryMeta(entry)}</div><ActionMenu className="manager-more" label={`${entry.name} 的操作`} title={entry.name} items={[{ label: '重命名', disabled: !query.data.writable, onSelect: () => void rename(entry) }, { label: '选择', onSelect: () => setSelected([entry.path]) }, { label: '移动…', disabled: !query.data.writable, onSelect: () => void move([entry.path]) }, { label: '删除', danger: true, disabled: !query.data.writable, onSelect: () => void remove([entry.path]) }]} /></div>; })}</div>}
      {query.data && <div className="manager-status muted">{query.data.dirs} 个文件夹 · {query.data.files} 个文件 · {formatBytes(query.data.size)}</div>}
      {pages > 1 && <Pager className="manager-pager" page={Math.min(page, pages)} pageCount={pages} busy={query.isFetching} onGo={next => go(path, next)} />}
    </main>{dialog && <DialogView dialog={dialog} destructive="删除" onClose={answer => { const current = dialog; setDialog(null); current.resolve(answer as never); }} />}</div>;
}
