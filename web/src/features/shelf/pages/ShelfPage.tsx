import { Alert } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Headphones, LibraryBig, MoreHorizontal, Search, Settings, SlidersVertical } from 'lucide-react';
import type { Book, ContinueReadingItem } from '../../../api/types.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { useShelf } from '../queries/shelf.queries.ts';
import { SHELF_SORTS, ShelfSettingsPanel } from '../../../ui/shelf-settings.tsx';
import { OpdsAccess } from '../../../ui/opds-access.tsx';
import { SystemSettings } from '../../../ui/system-settings.tsx';
import { DialogView, type Dialog } from '../../../ui/dialog.tsx';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

const coverCache = new WeakMap<object, Map<string, string>>();
function useCover(api: ReturnType<typeof useRuntime>['api'], coverUrl: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!coverUrl) { setSrc(null); return; }
    let cache = coverCache.get(api) as Map<string, string> | undefined;
    if (!cache) { cache = new Map(); coverCache.set(api, cache); }
    const cached = cache.get(coverUrl);
    if (cached) { setSrc(cached); return; }
    let live = true;
    void api.coverBytes(coverUrl).then(bytes => {
      const objectUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'image/jpeg' }));
      cache!.set(coverUrl, objectUrl); if (live) setSrc(objectUrl);
    }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [api, coverUrl]);
  return src;
}

function BookCard({ book, showAuthor, showProgress, onRemove }: { book: Book | ContinueReadingItem; showAuthor: boolean; showProgress: boolean; onRemove?: () => void }) {
  const runtime = useRuntime();
  const src = useCover(runtime.api, book.coverUrl);
  const progress = 'percentage' in book ? book.percentage : runtime.offline?.progressFor(book.id)?.percentage;
  return <div className="book-card">
    <Link className="book-open" aria-label={`${book.title} ${book.author ?? ''}`.trim()} to={`/book/${encodeURIComponent(book.id)}`}>
      <div className="cover">
        {src ? <img src={src} alt="" loading="lazy" /> : <div className="placeholder">{book.title || '无封面'}</div>}
        <span className="format-badge">{book.format || '书籍'}</span>
        {showProgress && progress !== undefined && progress > 0 && <div className="cover-progress"><span style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} /></div>}
      </div>
      <div className="title">{book.title || '未命名'}</div>
      {showAuthor && <div className="author">{book.author || '未知作者'}</div>}
    </Link>
    {onRemove && <button type="button" className="book-more" aria-label={`${book.title} 的操作`} title="从书架拿掉" onClick={onRemove}><MoreHorizontal size={17} aria-hidden="true" /></button>}
  </div>;
}

export function ShelfPage() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const settings = useSettingsStore(state => state.settings);
  const user = useAuthStore(state => state.verifiedUser);
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [sort, setSort] = useState<typeof settings.shelfSort>((params.get('sort') as typeof settings.shelfSort) || settings.shelfSort);
  const [search, setSearch] = useState(params.get('q') || '');
  const [queryText, setQueryText] = useState(params.get('q') || '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opdsOpen, setOpdsOpen] = useState(false);
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Book | ContinueReadingItem | null>(null);
  const query = useShelf(page, sort, queryText);
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1;
  const cards = useMemo(() => query.data?.items ?? [], [query.data]);
  useEffect(() => { void runtime.updateSettings({ shelfSort: sort }); }, [runtime, sort]);
  const onSort = (value: string) => { const next = value as typeof sort; setSort(next); setParams({ ...(queryText ? { q: queryText } : {}), sort: next, page: '1' }); };
  const onSearch = (event: FormEvent) => { event.preventDefault(); setQueryText(search.trim()); setParams({ ...(search.trim() ? { q: search.trim() } : {}), sort, page: '1' }); };
  const clearSearch = () => { setSearch(''); setQueryText(''); setParams({ sort, page: '1' }); };
  const remove = async (book: Book | ContinueReadingItem) => { await runtime.api.browseBatchShelf({ bookIds: [book.id] }, 'remove'); await queryClient.invalidateQueries({ queryKey: ['shelf'] }); };
  const subtitle = queryText ? (query.data?.total ? `「${queryText}」匹配 ${query.data.total} 本` : `没有匹配「${queryText}」的书`) : query.data?.total ? (sort === 'recent' ? `最近阅读 · 共 ${query.data.total} 本` : `按${SHELF_SORTS.find(item => item.value === sort)?.label ?? ''}排列 · ${query.data.total} 本`) : '收藏好书，随时接着读';
  const densityLabel = settings.shelfDensity === 'compact' ? '紧凑' : settings.shelfDensity === 'comfortable' ? '宽松' : '适中';
  return <div id="shelf-scroll" className="shelf shelf-screen">
    <header className="shelf-head">
      <div className="shelf-head-text"><h1 className="shelf-title">{queryText ? '搜索结果' : '我的书架'}</h1><p className="shelf-subtitle muted">{subtitle}</p></div>
      <div className="shelf-head-actions">
        <Link className="icon-button" aria-label="影音" title="影音" to="/media/video"><Headphones className="icon" size="1em" strokeWidth={1.8} /></Link>
        {user?.role === 'admin' && <button className="icon-button" aria-label="系统设置" title="系统设置" onClick={() => setSystemSettingsOpen(true)}><Settings className="icon" size="1em" strokeWidth={1.8} /><span className="media-visually-hidden">系统设置</span></button>}
        <button className="icon-button" aria-label={`书架设置 · ${densityLabel}`} title={`书架设置 · ${densityLabel}`} onClick={() => setSettingsOpen(true)}><SlidersVertical className="icon" size="1em" strokeWidth={1.8} /><span className="media-visually-hidden">设置</span></button>
      </div>
    </header>
    <div className="shelf-discovery">
      <nav className="collection-links shelf-links" aria-label="发现书籍">
        <Link className="button collection-link" to="/library"><LibraryBig size={18} /><span>书库</span><span aria-hidden="true">›</span></Link>
        <Link className="button collection-link" to="/sources"><Search size={18} /><span>书源</span><span aria-hidden="true">›</span></Link>
      </nav>
      <form className="shelf-search" role="search" onSubmit={onSearch}>
        <Search className="search-glyph" size={18} aria-hidden="true" />
        <input type="search" aria-label="搜索书库" placeholder="搜索书名、作者、系列" value={search} onChange={event => setSearch(event.currentTarget.value)} />
        {search && <button type="button" className="search-clear" aria-label="清除搜索" onClick={clearSearch}>×</button>}
      </form>
    </div>
    <section className="shelf-section" aria-label={queryText ? '搜索结果' : '全部书籍'}>
      {(!query.isPending && (cards.length > 0 || queryText)) && <div className="shelf-toolbar"><span className="shelf-count muted">{queryText ? `找到 ${query.data?.total ?? 0} 本` : `共 ${query.data?.total ?? 0} 本`}</span><div className="shelf-sort" role="group" aria-label="排序方式">{SHELF_SORTS.map(option => <button key={option.value} type="button" className="chip" aria-pressed={option.value === sort} onClick={() => onSort(option.value)}>{option.label}</button>)}</div></div>}
      {query.isPending && <FloatingNotice message="正在加载书架…" busy />}
      {query.error && <Alert color="red" title="书架加载失败">{query.error.message}</Alert>}
      {query.data && cards.length === 0 && <div className="empty-state collection-empty"><BookOpen className="empty-glyph" aria-hidden="true" /><p>{queryText ? '没有匹配的书' : '书架还没有书'}</p><p className="muted">{queryText ? '换个关键词，或者检查一下作者名的写法' : '从书库挑选喜欢的书，或通过书源搜索，加入书架后就能开始阅读。'}</p><div className="empty-actions">{queryText ? <button type="button" className="button" onClick={clearSearch}>清除搜索</button> : <><Link className="button primary" to="/sources"><Search size={16} />去搜书</Link><Link className="button" to="/library"><LibraryBig size={16} />打开书库</Link></>}</div></div>}
      {cards.length > 0 && <div className="book-grid" data-density={settings.shelfDensity} data-show-author={String(settings.shelfShowAuthor)} data-show-progress={String(settings.shelfShowProgress)}>{cards.map(book => <BookCard key={book.id} book={book} showAuthor={settings.shelfShowAuthor} showProgress={settings.shelfShowProgress} onRemove={() => setRemoveTarget(book)} />)}</div>}
      {query.data && pages > 1 && <nav className="shelf-pager" aria-label="翻页"><button type="button" disabled={page <= 1} onClick={() => setParams({ ...(queryText ? { q: queryText } : {}), sort, page: String(page - 1) })}>上一页</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setParams({ ...(queryText ? { q: queryText } : {}), sort, page: String(page + 1) })}>下一页</button></nav>}
    </section>
    <ShelfSettingsPanel open={settingsOpen} settings={settings} onPatch={patch => { void runtime.updateSettings(patch); }} onClose={() => setSettingsOpen(false)} onOpenExternalReader={() => { setSettingsOpen(false); setOpdsOpen(true); }} />
    {opdsOpen && <OpdsAccess api={runtime.api} onSignedOut={() => { void runtime.api.signOut(); }} onClose={() => { setOpdsOpen(false); setSettingsOpen(true); }} />}
    {systemSettingsOpen && <SystemSettings api={runtime.api} onClose={() => setSystemSettingsOpen(false)} />}
    {removeTarget && <DialogView dialog={{ kind: 'confirm', title: '移出书架', body: `确定要将《${removeTarget.title}》移出书架吗？`, resolve: (_answer: boolean) => undefined } satisfies Dialog} destructive="移出书架" onClose={answer => { const target = removeTarget; setRemoveTarget(null); if (answer === true) void remove(target); }} />}
  </div>;
}
