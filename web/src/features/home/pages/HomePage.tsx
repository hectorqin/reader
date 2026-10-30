import { Icon, type IconName } from '../../../ui/icon.tsx';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
  return <Link className="home-hero" to={`/book/${encodeURIComponent(book.id)}`}>
    <span className="home-hero-cover" aria-hidden="true">{src ? <img src={src} alt="" /> : <b>{book.title}</b>}</span>
    <span className="home-hero-text">
      <strong>{book.title || '未命名'}</strong>
      {book.chapterTitle && <small>{book.chapterTitle}</small>}
      <span className="home-hero-foot">
        <span className="home-hero-action"><Icon name="play" size={14} filled />继续阅读</span>
        <span className="home-hero-meter">
          <span className="home-progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
          <span className="home-hero-percent">已读 {percent}%</span>
        </span>
      </span>
    </span>
  </Link>;
}

function ResumeMedia({ channel, label, icon, activity }: { channel: 'video' | 'audiobook'; label: string; icon: IconName; activity: Activity }) {
  const progress = activityProgress(activity);
  const title = `${activity.title}${activity.partTitle && activity.partTitle !== activity.title ? ` · ${activity.partTitle}` : ''}`;
  const verb = channel === 'video' ? '观看' : '收听';
  // Without a known length there is no time to show; say what tapping does instead of
  // repeating the part title that the heading already carries.
  const meta = activity.end !== null && activity.position !== undefined
    ? `${channel === 'video' ? '已看' : '已听'} ${clock(activity.position - activity.start)} / ${clock(activity.end - activity.start)}`
    : `继续${verb}`;
  return <Link className="home-card" data-channel={channel} to={`/media/${channel}/items/${encodeURIComponent(activity.itemId)}`}>
    <span className="home-card-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
    <span className="home-card-text">
      <span className="home-card-label">{label}</span>
      <strong>{title}</strong>
      <small>{meta}</small>
      <span className="home-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
    </span>
    <Icon name="chevron-right" size={16} className="home-card-chevron" />
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
    <div className="home-continue" data-media={videoActivity || audioActivity ? 'true' : undefined}>
      {/* Only a successful answer can say "nothing in progress": while loading the slot keeps
          its shape, and a failure says so instead of telling a reader with books that they have none. */}
      {book
        ? <Resume book={book} />
        : reading.isPending
          ? <section className="home-empty home-empty-pending" aria-label="继续阅读" aria-busy="true"><strong>正在读取在读的书…</strong></section>
          : reading.error
            ? <section className="home-empty" aria-label="继续阅读" role="alert"><strong>在读的书读取失败</strong><button type="button" className="home-retry" onClick={() => void reading.refetch()}>重试<Icon name="chevron-right" size={16} /></button></section>
            : <section className="home-empty" aria-label="继续阅读"><strong>还没有在读的书</strong><Link to="/shelf">去书架挑一本<Icon name="chevron-right" size={16} /></Link></section>}
      {(videoActivity || audioActivity) && <div className="home-cards">
        {videoActivity && <ResumeMedia channel="video" label="影视" icon="video" activity={videoActivity} />}
        {audioActivity && <ResumeMedia channel="audiobook" label="听书" icon="audiobook" activity={audioActivity} />}
      </div>}
    </div>
    {books.length > 0 && <section className="home-shelf" aria-label="我的书架">
      <div className="home-section"><h2>我的书架</h2><Link to="/shelf">全部<Icon name="chevron-right" size={16} /></Link></div>
      <div className="home-shelf-row">{books.map(item => <BookCard key={item.id} book={item} showAuthor={false} showProgress />)}</div>
    </section>}
  </div>;
}
