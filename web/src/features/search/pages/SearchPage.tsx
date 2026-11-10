import { describeError } from '../../../api/errors.ts';
import { Icon } from '../../../ui/icon.tsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { clearRecentSearches, readRecentSearches, rememberSearch } from '../recent.ts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useSettingsStore } from '../../../shared/stores/settings.store.ts';
import { BookCard } from '../../shelf/pages/ShelfPage.tsx';
import { MediaCover } from '../../media/components/cover.tsx';
import { MediaPageFrame } from '../../media/components/MediaPageFrame.tsx';
import type { MediaChannel } from '../../media/api/media-api.ts';
import '../../home/styles/home.css';
import '../styles/search.css';
import { useMediaEnabled } from '../../../shared/stores/features.ts';

const channelLabels: Record<MediaChannel, string> = { video: '影视', music: '音乐', audiobook: '有声书' };
const BOOK_LIMIT = 12, MEDIA_LIMIT = 8;
/** Long enough to fold a word being typed into one request, short enough to feel live. */
const SEARCH_DELAY_MS = 350;

/**
 * 搜索 (desktop shell, prototype 15/19/20): one query across the book library and
 * every media library the account can see. Each half shows its first results and
 * links to the page that owns the full list (书库 search, 影音 search).
 */
export function SearchPage() {
  const runtime = useRuntime();
  const mediaEnabled=useMediaEnabled();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const [input, setInput] = useState(query);
  // The URL is the query; the field follows it (Back, a sidebar search, a recent one),
  // except while it is only ahead of the URL by whitespace the reader is still typing.
  useEffect(() => { setInput(current => current.trim() === query ? current : query); }, [query]);
  // Typing searches by itself after a pause. `replace`, so a word typed letter by
  // letter is one history entry and Back leaves the page instead of un-typing it.
  useEffect(() => {
    const q = input.trim();
    if (q === query) return;
    const timer = window.setTimeout(() => setParams(q ? { q } : {}, { replace: true }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input, query, setParams]);
  const scope = runtime.mediaApi.preferenceScope();
  const [recent, setRecent] = useState(() => readRecentSearches(scope));
  // A query is worth remembering once the reader committed to it: pressed Enter, or
  // opened one of its results. Remembering every pause would fill the list with prefixes.
  const remember = () => { if (query) setRecent(rememberSearch(scope, query)); };
  const field = useRef<HTMLInputElement>(null);
  // Arriving with nothing to search for means the next thing to do is type.
  useEffect(() => { if (!query) field.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    enabled: mediaEnabled&&query.length > 0,
  });
  const submit = (event: FormEvent) => { event.preventDefault(); const q = input.trim(); setParams(q ? { q } : {}, { replace: true }); if (q) setRecent(rememberSearch(scope, q)); };
  const mediaItems = (media.data?.items ?? []).slice(0, MEDIA_LIMIT);
  return <MediaPageFrame className="media-secondary-page search-page" title="搜索" backTo="/" backLabel="返回首页">
    <form className="search-page-form" role="search" onSubmit={submit}>
      <Icon name="search" size={18} />
      <input ref={field} type="search" name="q" aria-label="搜索全部内容" placeholder={mediaEnabled?'搜索书名、片名、歌曲、有声书':'搜索书名、作者'} value={input} maxLength={200} onInput={event => setInput(event.currentTarget.value)} />
      <button type="submit" className="media-primary" disabled={!input.trim()}>搜索</button>
    </form>
    {!query ? <>
      <p className="search-page-hint">{mediaEnabled?'输入名称，同时搜索书库和有权访问的影音库。':'输入名称搜索书库。'}</p>
      {recent.length > 0 && <section className="search-page-recent" aria-label="最近搜索">
        <header><h2>最近搜索</h2><button type="button" onClick={() => { clearRecentSearches(scope); setRecent([]); }}>清除</button></header>
        <ul>{recent.map(item => <li key={item}><button type="button" className="chip" onClick={() => setParams({ q: item })}>{item}</button></li>)}</ul>
      </section>}
    </> : <div className="search-page-results" onClickCapture={event => { if ((event.target as Element).closest('a, .media-search-result, .book-card')) remember(); }}>
      <section className="search-page-section" aria-label="书籍搜索结果">
        <header><h2>书籍{books.data ? <small>{books.data.total}</small> : null}</h2>
          {books.data && books.data.total > BOOK_LIMIT && <Link to={`/library?q=${encodeURIComponent(query)}`}>在书库查看全部<Icon name="chevron-right" size={16} /></Link>}</header>
        {books.isPending ? <p role="status">正在搜索书籍…</p>
          : books.error ? <p className="media-error" role="alert">书籍搜索失败：{describeError(books.error)} <button type="button" onClick={() => void books.refetch()}>重试</button></p>
          : books.data.items.length === 0 ? <p className="search-page-empty">没有找到书籍</p>
          : <div className="book-grid" data-density={settings.shelfDensity} data-show-author={String(settings.shelfShowAuthor)}>
            {books.data.items.map(book => <BookCard key={book.id} book={book} showAuthor={settings.shelfShowAuthor} showProgress={false} />)}
          </div>}
      </section>
      {mediaEnabled&&<section className="search-page-section" aria-label="影音搜索结果">
        <header><h2>影音{media.data ? <small>{media.data.total}</small> : null}</h2>
          {media.data && media.data.total > MEDIA_LIMIT && <Link to={`/media/search?q=${encodeURIComponent(query)}&scope=all`}>查看全部影音结果<Icon name="chevron-right" size={16} /></Link>}</header>
        {media.isPending ? <p role="status">正在搜索影音…</p>
          : media.error ? <p className="media-error" role="alert">影音搜索失败：{describeError(media.error)} <button type="button" onClick={() => void media.refetch()}>重试</button></p>
          : mediaItems.length === 0 ? <p className="search-page-empty">没有找到影音</p>
          : <div className="search-page-media">{mediaItems.map(item =>
            <button type="button" key={item.id} className="media-search-result" onClick={() => navigate(`/media/${item.channel}/items/${encodeURIComponent(item.id)}`)}>
              <MediaCover api={runtime.mediaApi} item={item} square={item.channel === 'music'} />
              <span className="media-search-copy"><strong title={item.title}>{item.title}</strong><small>{channelLabels[item.channel]} · {item.libraryName}</small></span>
              <Icon name="chevron-right" size={18} />
            </button>)}</div>}
      </section>}
    </div>}
  </MediaPageFrame>;
}
