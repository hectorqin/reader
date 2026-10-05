import { Alert, Badge, Button, ActionIcon, Menu } from '@mantine/core';
import { ArrowLeft, BookOpen, FileText, Folder, MoreHorizontal, Plus, Search, Upload } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type FormEvent } from 'react';
import type { Book, BrowseEntry } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { DialogView, type Dialog } from '../../../ui/dialog.tsx';
import { formatBytes, formatDate } from '../../../ui/dom.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

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
  return <div className="cover">{src ? <img src={src} alt="" loading="lazy" /> : <div className="placeholder">{book.title || '无封面'}</div>}<span className="format-badge">{book.format || '书籍'}</span></div>;
}

function CollectionHeader({ title, subtitle, backTo, actions, className, footer }: { title: string; subtitle: string; backTo?: string; actions?: React.ReactNode; className?: string; footer?: React.ReactNode }) {
  return <header className={'collection-header' + (className ? ` ${className}` : '')}><div className="collection-heading">{backTo && <Button component={Link} to={backTo} className="icon-button" variant="subtle" aria-label="返回"><ArrowLeft size={20} /></Button>}<div className="collection-heading-text"><h1>{title}</h1><p className="muted">{subtitle}</p></div></div>{actions && <nav className="collection-links" aria-label="页面操作">{actions}</nav>}{footer}</header>;
}

export function LibraryPage() { return <LibraryBrowsePage />; }

export function LibraryBrowsePage() {
  const runtime = useRuntime(); const queryClient = useQueryClient(); const role = useAuthStore(state => state.verifiedUser?.role); const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? ''; const page = Math.max(1, Number(params.get('page')) || 1); const search = params.get('q') ?? ''; const [draft, setDraft] = useState(search); const [busy, setBusy] = useState<string | null>(null);
  const listing = useQuery({ queryKey: ['library-browse', runtime.api.baseUrl, path, page], queryFn: ({ signal }) => runtime.api.browse(path, page, { signal }) });
  const books = useQuery({ queryKey: ['library-books', runtime.api.baseUrl, 'browse', path, page, search], queryFn: ({ signal }) => runtime.api.listBooks({ scope: 'library', path, page, pageSize: 60, search, sort: 'title', order: 'asc' }, { signal }) });
  const navigate = (nextPath: string, nextPage = 1, nextSearch = '') => setParams({ ...(nextPath ? { path: nextPath } : {}), ...(nextSearch ? { q: nextSearch } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) });
  const toggle = async (book: Book) => { setBusy(book.id); try { await runtime.api.browseBatchShelf({ bookIds: [book.id] }, 'add'); await queryClient.invalidateQueries({ queryKey: ['library-books'] }); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); } finally { setBusy(null); } };
  const count = books.data?.total ?? 0; const pages = books.data ? Math.max(1, Math.ceil(count / books.data.pageSize)) : 1;
  const empty = !books.isPending && !books.error && books.data?.items.length === 0;
  return <div className="library-screen library-browse-screen">
    <CollectionHeader title="书库" subtitle="浏览本地书籍，发现下一本好书" backTo="/shelf" actions={role === 'admin' ? <Link className="button collection-link" to="/library/files"><Folder size={18} /><span>文件管理</span><span aria-hidden="true">›</span></Link> : undefined} />
    {listing.data && listing.data.crumbs.length > 1 && <div className="manager-crumbs library-path" aria-label="当前文件夹">{listing.data.crumbs.map((crumb, index) => <span key={`${crumb.path}-${index}`}>{index > 0 && <span className="manager-crumb-sep">/</span>}<button type="button" className="manager-crumb" onClick={() => navigate(crumb.path)}>{crumb.name}</button></span>)}</div>}
    <main className="manager-body library-browse-body">
      <form className="shelf-search library-search" role="search" onSubmit={(event: FormEvent) => { event.preventDefault(); navigate(path, 1, draft.trim()); }}><Search className="search-glyph" size={18} aria-hidden="true" /><input type="search" aria-label="搜索书库" placeholder="搜索书名、作者" value={draft} onChange={event => setDraft(event.currentTarget.value)} />{draft && <button type="button" className="search-clear" aria-label="清除搜索" onClick={() => { setDraft(''); navigate(path); }}>×</button>}</form>
      {books.isPending && <FloatingNotice message="正在加载书库…" busy />}{books.error && <Alert color="red" title="书库加载失败">{books.error.message}</Alert>}
      {empty && <div className="empty-state collection-empty"><BookOpen className="empty-glyph" aria-hidden="true" /><p>{search ? '没有匹配的书' : '书库还没有书'}</p><p className="muted">{search ? '换个关键词，或者检查一下作者名的写法。' : '前往文件管理添加书籍，再回到这里浏览。'}</p><div className="empty-actions">{search ? <button type="button" className="button" onClick={() => { setDraft(''); navigate(path); }}>清除搜索</button> : role === 'admin' ? <Link className="button primary" to="/library/files"><Folder size={16} />文件管理</Link> : null}</div></div>}
      {books.data && books.data.items.length > 0 && <div className="book-grid library-browse-grid" data-density="cozy" data-show-author="true">{books.data.items.map(book => <div className="book-card is-row" key={book.id}><Link className="book-open" to={`/book/${encodeURIComponent(book.id)}`} aria-label={`${book.title} ${book.author ?? ''}`}><Cover book={book} /><div className="title">{book.title || '未命名'}</div><div className="author">{book.author || '未知作者'}</div></Link>{book.shelfState === 'off' && <button type="button" className="book-shelve" aria-label={`把${book.title}加入书架`} disabled={busy === book.id} onClick={() => void toggle(book)}>+ 加入书架</button>}</div>)}</div>}
      {books.data && <div className="manager-status muted">{search ? `找到 ${count} 本` : `${count} 本 · 第 ${page} / ${pages} 页`}</div>}
      {pages > 1 && <nav className="shelf-pager" aria-label="翻页"><button className="pager-step" type="button" disabled={page <= 1} onClick={() => navigate(path, page - 1, search)}>上一页</button><span>{page} / {pages}</span><button className="pager-step" type="button" disabled={page >= pages} onClick={() => navigate(path, page + 1, search)}>下一页</button></nav>}
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

export function LibraryFilesPage() {
  const role = useAuthStore(state => state.verifiedUser?.role); if (role !== 'admin') return <div className="library-screen"><div className="empty-state collection-empty"><p>无权访问</p><p className="muted">文件管理需要管理员权限。</p><Link className="button" to="/library">返回书库</Link></div></div>; return <LibraryFilesAdminPage />;
}

function LibraryFilesAdminPage() {
  const runtime = useRuntime(); const queryClient = useQueryClient(); const [params, setParams] = useSearchParams(); const path = params.get('path') ?? ''; const page = Math.max(1, Number(params.get('page')) || 1); const [selected, setSelected] = useState<string[]>([]); const [dialog, setDialog] = useState<Dialog | null>(null); const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const query = useQuery({ queryKey: ['library-files', runtime.api.baseUrl, path, page], queryFn: ({ signal }) => runtime.api.browse(path, page, { signal }) });
  const go = (next: string, p = 1) => setParams({ ...(next ? { path: next } : {}), ...(p > 1 ? { page: String(p) } : {}) }); const refresh = () => queryClient.invalidateQueries({ queryKey: ['library-files'] });
  const mutate = async (action: () => Promise<unknown>) => { setFeedback(null); try { await action(); setSelected([]); await refresh(); setFeedback({ text: '操作已完成' }); } catch (reason) { setFeedback({ text: reason instanceof Error ? reason.message : '操作失败，请重试', error: true }); } };
  const prompt = (title: string, value = '') => new Promise<string | null>(resolve => setDialog({ kind: 'prompt', title, value, resolve }));
  const confirm = (title: string, body: string) => new Promise<boolean>(resolve => setDialog({ kind: 'confirm', title, body, resolve }));
  const rename = async (entry: BrowseEntry) => { const name = (await prompt('重命名', entry.name))?.trim(); if (name && name !== entry.name) await mutate(() => runtime.api.browseRename(entry.path, name)); };
  const mkdir = async () => { const name = (await prompt('新建文件夹'))?.trim(); if (name) await mutate(() => runtime.api.browseMkdir(path, name)); };
  const move = async (paths = selected) => { const target = await prompt('移动到（书库相对路径）', path); if (target !== null && paths.length) await mutate(() => runtime.api.browseMove(paths, target.trim())); };
  const remove = async (paths = selected) => { if (paths.length && await confirm('删除所选内容', `确定要删除 ${paths.length} 项吗？`)) await mutate(() => runtime.api.browseDelete(paths)); };
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / 200)) : 1;
  const crumbs = <div className="manager-crumbs">{(query.data?.crumbs ?? [{ name: '书库', path: '' }]).map((crumb, index, all) => <span key={`${crumb.path}-${index}`}>{index > 0 && <span className="manager-crumb-sep">/</span>}<button type="button" className="manager-crumb" aria-current={index === all.length - 1 ? 'true' : undefined} onClick={() => go(crumb.path)}>{crumb.name}</button></span>)}</div>;
  return <div className="library-screen library-files-screen"><CollectionHeader className="file-manager-header" title="文件管理" subtitle="管理书库中的文件与文件夹" backTo="/library" actions={<><label className={'button collection-link' + (!query.data?.writable ? ' is-disabled' : '')}><Upload size={18} /><span>上传书籍</span><input hidden type="file" multiple disabled={!query.data?.writable} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); if (files.length) void mutate(() => runtime.api.upload(files, path, 'rename')); event.currentTarget.value = ''; }} /></label><button type="button" className="button collection-link" disabled={!query.data?.writable} onClick={mkdir}><Plus size={18} /><span>新建文件夹</span></button></>} footer={crumbs} />
    <main className="manager-body">
      {selected.length > 0 && <div className="manager-actions"><Badge>已选 {selected.length} 项</Badge><button type="button" className="button" onClick={() => void move()}>移动</button><button type="button" className="button danger" onClick={() => void remove()}>删除</button><button type="button" className="button" onClick={() => setSelected([])}>清除</button></div>}
      {feedback && <Alert color={feedback.error ? 'red' : 'green'} withCloseButton onClose={() => setFeedback(null)}>{feedback.text}</Alert>}
      {query.isPending && <FloatingNotice message="正在读取文件列表…" busy />}{query.error && <Alert color="red">{query.error.message}</Alert>}
      {query.data && <div className={'manager-list' + (selected.length ? ' selection-mode' : '')}>{query.data.entries.length === 0 ? <div className="empty-state collection-empty"><Folder className="empty-glyph" aria-hidden="true" /><p>这个文件夹是空的</p><p className="muted">{query.data.writable ? '使用上方的上传或新建文件夹，整理你的书库。' : '当前目录只读，可以浏览已有文件。'}</p></div> : query.data.entries.map(entry => { const checked = selected.includes(entry.path); return <div className="manager-row" data-type={entry.type} data-selected={checked ? 'true' : undefined} key={entry.path} tabIndex={0}><button type="button" className="manager-check" role="checkbox" aria-label={`选择${entry.name}`} aria-checked={checked} onClick={event => { event.stopPropagation(); setSelected(items => items.includes(entry.path) ? items.filter(item => item !== entry.path) : [...items, entry.path]); }} /><div className="manager-name"><span className="manager-icon">{entry.type === 'dir' ? <Folder size={20} /> : <FileText size={20} />}</span><span className="manager-label">{entry.type === 'dir' ? <button type="button" className="manager-crumb" onClick={() => go(entry.path)}>{entry.name}</button> : entry.name}</span></div><div className="manager-meta muted">{entryMeta(entry)}</div><Menu><Menu.Target><ActionIcon className="manager-more" variant="subtle" aria-label={`${entry.name} 的操作`}><MoreHorizontal size={19} /></ActionIcon></Menu.Target><Menu.Dropdown className="library-file-menu"><Menu.Item disabled={!query.data.writable} onClick={() => void rename(entry)}>重命名</Menu.Item><Menu.Item onClick={() => setSelected([entry.path])}>选择</Menu.Item><Menu.Item disabled={!query.data.writable} onClick={() => void move([entry.path])}>移动…</Menu.Item><Menu.Item disabled={!query.data.writable} color="red" onClick={() => void remove([entry.path])}>删除</Menu.Item></Menu.Dropdown></Menu></div>; })}</div>}
      {query.data && <div className="manager-status muted">{query.data.dirs} 个文件夹 · {query.data.files} 个文件 · {formatBytes(query.data.size)}</div>}
      {pages > 1 && <nav className="manager-pager shelf-pager"><button className="pager-step" type="button" disabled={page <= 1} onClick={() => go(path, page - 1)}>上一页</button><span>{page} / {pages}</span><button className="pager-step" type="button" disabled={page >= pages} onClick={() => go(path, page + 1)}>下一页</button></nav>}
    </main>{dialog && <DialogView dialog={dialog} destructive="删除" onClose={answer => { const current = dialog; setDialog(null); current.resolve(answer as never); }} />}</div>;
}
