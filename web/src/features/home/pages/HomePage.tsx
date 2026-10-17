import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clapperboard, Headphones, Play, type LucideIcon } from 'lucide-react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { BookCard, useCover } from '../../shelf/pages/ShelfPage.tsx';
import { useShelf } from '../../shelf/queries/shelf.queries.ts';
import { historyQuery, type Activity } from '../../media/queries/media.queries.ts';
import type { ContinueReadingItem } from '../../../api/types.ts';
import '../styles/home.css';

export function greeting(hour: number): string {
  return hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + `:${String(s).padStart(2, '0')}`;
}

/** Progress through the unfinished activity, 0..1; unknown length reads as 0 rather than a guess. */
export function activityProgress(activity: Activity): number {
  const length = activity.end === null ? 0 : activity.end - activity.start;
  return length > 0 && activity.position !== undefined ? Math.max(0, Math.min(1, (activity.position - activity.start) / length)) : 0;
}

function Resume({ book }: { book: ContinueReadingItem }) {
  const runtime = useRuntime();
  const src = useCover(runtime.api, book.coverUrl);
  const percent = Math.round(Math.max(0, Math.min(1, book.percentage)) * 100);
  return <Link className="home-hero" to={`/book/${encodeURIComponent(book.id)}`} aria-label={`继续阅读 ${book.title}`}>
    <span className="home-hero-cover" aria-hidden="true">{src ? <img src={src} alt="" /> : <b>{book.title}</b>}</span>
    <span className="home-hero-text">
      <span className="home-pill">继续阅读</span>
      <strong>{book.title || '未命名'}</strong>
      <small>{book.chapterTitle}</small>
      <span className="home-progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
      <span className="home-hero-action"><Play size={14} fill="currentColor" aria-hidden="true" />继续 · {percent}%</span>
    </span>
  </Link>;
}

function ResumeMedia({ channel, label, icon: Icon, activity }: { channel: 'video' | 'audiobook'; label: string; icon: LucideIcon; activity: Activity }) {
  const progress = activityProgress(activity);
  const meta = activity.end !== null && activity.position !== undefined
    ? `${channel === 'video' ? '已看' : '已听'} ${clock(activity.position - activity.start)} / ${clock(activity.end - activity.start)}`
    : activity.partTitle;
  return <Link className="home-card" data-channel={channel} to={`/media/${channel}/items/${encodeURIComponent(activity.itemId)}`}>
    <span className="home-card-label"><Icon size={16} aria-hidden="true" />{label}</span>
    <strong>{activity.title}{activity.partTitle && activity.partTitle !== activity.title ? ` · ${activity.partTitle}` : ''}</strong>
    <small>{meta}</small>
    <span className="home-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
  </Link>;
}

/** 首页: where you left off, across reading and media, then the shelf. */
export function HomePage() {
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const reading = useQuery({
    queryKey: ['home', 'reading', runtime.api.baseUrl, user?.id],
    queryFn: ({ signal }) => runtime.api.continueReading(1, { signal }),
  });
  const shelf = useShelf(1, 'recent');
  const video = useQuery(historyQuery(runtime, 'video', new URLSearchParams()));
  const audio = useQuery(historyQuery(runtime, 'audiobook', new URLSearchParams()));
  const unfinished = (items?: Activity[]) => items?.find(item => !item.completed);
  const book = reading.data?.[0];
  const videoActivity = unfinished(video.data?.items), audioActivity = unfinished(audio.data?.items);
  const books = (shelf.data?.items ?? []).slice(0, 8);
  const name = user?.displayName || user?.username || '';
  return <div className="media-screen media-page home-page">
    <header className="home-header"><h1>{greeting(new Date().getHours())}{name ? `，${name}` : ''}</h1><p>从上次停下的地方继续</p></header>
    {book
      ? <Resume book={book} />
      : <section className="home-empty" aria-label="继续阅读"><strong>还没有在读的书</strong><Link to="/shelf">去书架挑一本</Link></section>}
    {(videoActivity || audioActivity) && <div className="home-cards">
      {videoActivity && <ResumeMedia channel="video" label="影视" icon={Clapperboard} activity={videoActivity} />}
      {audioActivity && <ResumeMedia channel="audiobook" label="听书" icon={Headphones} activity={audioActivity} />}
    </div>}
    {books.length > 0 && <section className="home-shelf" aria-label="我的书架">
      <div className="home-section"><h2>我的书架</h2><Link to="/shelf">全部<ChevronRight size={16} aria-hidden="true" /></Link></div>
      <div className="home-shelf-row">{books.map(item => <BookCard key={item.id} book={item} showAuthor={false} showProgress />)}</div>
    </section>}
  </div>;
}
