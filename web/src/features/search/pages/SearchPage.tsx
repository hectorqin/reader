import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { BookCard } from '../../shelf/pages/ShelfPage.tsx';
import { MediaCover } from '../../media/components/cover.tsx';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import type { MediaChannel } from '../../media/api/media-api.ts';
import '../../home/styles/home.css';
import '../styles/search.css';

const channelLabels: Record<MediaChannel, string> = { video: '影视', music: '音乐', audiobook: '有声书' };
const BOOK_LIMIT = 12, MEDIA_LIMIT = 8;

/**
 * 搜索 (desktop shell, prototype 15/19/20): one query across the book library and
 * every media library the account can see. Each half shows its first results and
 * links to the page that owns the full list (书库 search, 影音 search).
 */
export function SearchPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const settings = useSettingsStore(state => state.settings);
  const user = runtime.api.currentSession()?.user.id;
  const books = useQuery({
    queryKey: ['search', 'books', runtime.api.baseUrl, user, query],
    queryFn: ({ signal }) => runtime.api.listBooks({ scope: 'library', search: query, page: 1, pageSize: BOOK_LIMIT }, { signal }),
    enabled: query.length > 0,
  });
  const media = useQuery({
    queryKey: ['search', 'media', runtime.api.baseUrl, user, query],
    queryFn: ({ signal }) => runtime.mediaApi.search(query, 'all', 0, signal),
    enabled: query.length > 0,
  });
  const submit = (event: FormEvent) => { event.preventDefault(); const q = input.trim(); setParams(q ? { q } : {}); };
  const mediaItems = (media.data?.items ?? []).slice(0, MEDIA_LIMIT);
  return <MediaPageFrame className="media-secondary-page search-page" title="搜索" backTo="/" backLabel="返回首页">
    <form className="search-page-form" role="search" onSubmit={submit}>
      <Search size={18} aria-hidden="true" />
      <input type="search" name="q" aria-label="搜索全部内容" placeholder="搜索书名、片名、歌曲、有声书" value={input} maxLength={200} onInput={event => setInput(event.currentTarget.value)} />
      <button type="submit" className="media-primary" disabled={!input.trim()}>搜索</button>
    </form>
    {!query ? <p className="search-page-hint">输入名称，同时搜索书库和有权访问的影音库。</p> : <>
      <section className="search-page-section" aria-label="书籍搜索结果">
        <header><h2>书籍{books.data ? <small>{books.data.total}</small> : null}</h2>
          {books.data && books.data.total > BOOK_LIMIT && <Link to={`/library?q=${encodeURIComponent(query)}`}>在书库查看全部<ChevronRight size={16} aria-hidden="true" /></Link>}</header>
        {books.isPending ? <p role="status">正在搜索书籍…</p>
          : books.error ? <p className="media-error" role="alert">书籍搜索失败：{books.error.message} <button type="button" onClick={() => void books.refetch()}>重试</button></p>
          : books.data.items.length === 0 ? <p className="search-page-empty">没有找到书籍</p>
          : <div className="book-grid" data-density={settings.shelfDensity} data-show-author={String(settings.shelfShowAuthor)}>
            {books.data.items.map(book => <BookCard key={book.id} book={book} showAuthor={settings.shelfShowAuthor} showProgress={false} />)}
          </div>}
      </section>
      <section className="search-page-section" aria-label="影音搜索结果">
        <header><h2>影音{media.data ? <small>{media.data.total}</small> : null}</h2>
          {media.data && media.data.total > MEDIA_LIMIT && <Link to={`/media/search?q=${encodeURIComponent(query)}&scope=all`}>查看全部影音结果<ChevronRight size={16} aria-hidden="true" /></Link>}</header>
        {media.isPending ? <p role="status">正在搜索影音…</p>
          : media.error ? <p className="media-error" role="alert">影音搜索失败：{media.error.message} <button type="button" onClick={() => void media.refetch()}>重试</button></p>
          : mediaItems.length === 0 ? <p className="search-page-empty">没有找到影音</p>
          : <div className="search-page-media">{mediaItems.map(item =>
            <button type="button" key={item.id} className="media-search-result" onClick={() => navigate(`/media/${item.channel}/items/${encodeURIComponent(item.id)}`)}>
              <MediaCover api={runtime.mediaApi} item={item} square={item.channel === 'music'} />
              <span className="media-search-copy"><strong title={item.title}>{item.title}</strong><small>{channelLabels[item.channel]} · {item.libraryName}</small></span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>)}</div>}
      </section>
    </>}
  </MediaPageFrame>;
}
