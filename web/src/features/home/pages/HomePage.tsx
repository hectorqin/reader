import { useState, type ReactNode } from 'react';
import { Icon } from '../../../ui/icon.tsx';
import { Segmented } from '../../../ui/toolkit.tsx';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../../shared/stores/auth.store.ts';
import { coverTint } from '../../../ui/cover-tint.ts';
import { BookCard, useCover } from '../../shelf/pages/ShelfPage.tsx';
import { useShelf } from '../../shelf/queries/shelf.queries.ts';
import { historyQuery, mediaKeys, type Activity } from '../../media/queries/media.queries.ts';
import { MediaCover } from '../../media/components/cover.tsx';
import { resolveWork } from '../../media/services/work.ts';
import type { SearchItem } from '../../media/api/media-api.ts';
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

type Channel = 'read' | 'video' | 'audiobook';
const CHANNEL_LABEL: Record<Channel, string> = { read: '阅读', video: '影视', audiobook: '有声书' };

/** One shape for every kind of "continue": cover, work title, where you are, how far. */
function ResumeCard({ channel, to, cover, title, detail, progress, meter }: {
  channel: Channel; to: string; cover: ReactNode; title: string; detail: string; progress: number; meter: string;
}) {
  return <Link className="home-resume" data-channel={channel} to={to}>
    <span className="home-resume-cover" aria-hidden="true">{cover}</span>
    <span className="home-resume-text">
      <span className="home-resume-label">{CHANNEL_LABEL[channel]}</span>
      <strong title={title}>{title}</strong>
      {detail && <small title={detail}>{detail}</small>}
      <span className="home-resume-meter">
        <span className="home-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>
        <span className="home-resume-figure">{meter}</span>
      </span>
    </span>
    <span className="home-resume-play" aria-hidden="true"><Icon name="play" size={16} filled /></span>
  </Link>;
}

function ResumeBook({ book }: { book: ContinueReadingItem }) {
  const runtime = useRuntime();
  const src = useCover(runtime.api, book.coverUrl);
  const progress = Math.max(0, Math.min(1, book.percentage));
  const title = book.title || '未命名';
  return <ResumeCard channel="read" to={`/book/${encodeURIComponent(book.id)}`} title={title} detail={book.chapterTitle ?? ''}
    progress={progress} meter={`已读 ${Math.round(progress * 100)}%`}
    cover={src ? <img src={src} alt="" /> : <span className="home-resume-placeholder" style={coverTint(title)}>{title}</span>} />;
}

function ResumeMedia({ channel, activity }: { channel: 'video' | 'audiobook'; activity: Activity }) {
  const runtime = useRuntime(), { mediaApi } = runtime;
  // An episode's own title is "第 1 集"; the card is about the series it belongs to.
  const work = useQuery({
    queryKey: [...mediaKeys.root(runtime), 'home', 'work', activity.itemId],
    queryFn: ({ signal }) => resolveWork(mediaApi, activity.itemId, signal),
    staleTime: 5 * 60_000,
  });
  const resolved = work.data?.work;
  const title = resolved?.title ?? activity.title;
  const detail = [resolved && resolved.id !== activity.itemId ? activity.title : '', activity.partTitle !== activity.title ? activity.partTitle : '']
    .filter(Boolean).join(' · ');
  const known = activity.end !== null && activity.position !== undefined;
  const meter = known ? `${clock(activity.position! - activity.start)} / ${clock(activity.end! - activity.start)}` : `继续${channel === 'video' ? '观看' : '收听'}`;
  const coverItem = work.data?.artwork ?? resolved ?? { id: activity.itemId, libraryId: activity.libraryId, kind: activity.kind, title: activity.title, parentId: null, metadata: {}, overrides: {} };
  return <ResumeCard channel={channel} to={`/media/${channel}/items/${encodeURIComponent(activity.itemId)}`} title={title} detail={detail}
    progress={activityProgress(activity)} meter={meter}
    cover={<MediaCover api={mediaApi} item={coverItem} square={channel === 'audiobook'} />} />;
}

type DiscoverMode = 'added' | 'random';
const DISCOVER_MODES: Array<{ value: DiscoverMode; label: string }> = [{ value: 'added', label: '最近添加' }, { value: 'random', label: '随便看看' }];
// Which view a row shows is a per-viewer convenience: storage may be missing or throw.
function readMode(channel: string): DiscoverMode {
  try { return localStorage.getItem(`home.discover.${channel}`) === 'random' ? 'random' : 'added'; } catch { return 'added'; }
}
function saveMode(channel: string, mode: DiscoverMode) {
  try { localStorage.setItem(`home.discover.${channel}`, mode); } catch { /* optional */ }
}

/** One media channel: what just arrived, or a random handful so a rarely opened library still turns up. */
function Discover({ channel, kind, heading, to }: { channel: 'video' | 'audiobook' | 'music'; kind: string; heading: string; to: string }) {
  const runtime = useRuntime();
  const [mode, setMode] = useState<DiscoverMode>(() => readMode(channel));
  const [round, setRound] = useState(0);
  const sample = useQuery({
    queryKey: [...mediaKeys.root(runtime), 'home', 'discover', channel, mode, mode === 'random' ? round : 0],
    queryFn: ({ signal }) => runtime.mediaApi.request<{ items: SearchItem[]; total: number }>(
      `browse?${new URLSearchParams({ channel, kind, offset: '0', limit: '12', sort: mode })}`, 'GET', undefined, signal),
    // Same picks until asked for another batch; refocusing the tab must not reshuffle under the reader.
    staleTime: mode === 'random' ? Infinity : 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const items = sample.data?.items ?? [];
  // Optional: an older server, a starting media worker or an empty channel simply shows nothing.
  if (!items.length) return null;
  const square = channel !== 'video';
  return <section className="home-discover" data-channel={channel} aria-label={heading}>
    <div className="home-section">
      <h2>{heading}</h2>
      {mode === 'random' && sample.data!.total > items.length && <button type="button" className="home-shuffle" disabled={sample.isFetching} onClick={() => setRound(value => value + 1)}>
        <Icon name="refresh" size={14} />换一批
      </button>}
      <Segmented label={`${heading}显示`} options={DISCOVER_MODES} value={mode} onChange={next => { setMode(next); saveMode(channel, next); }} />
      <Link to={to} aria-label={`全部${heading}`}>全部<Icon name="chevron-right" size={16} /></Link>
    </div>
    <div className="home-shelf-row" data-square={square ? 'true' : undefined}>{items.map(item => <Link key={item.id} className="home-tile" to={`/media/${channel}/items/${encodeURIComponent(item.id)}`}>
      <MediaCover api={runtime.mediaApi} item={item} square={square} />
      <strong title={item.title}>{item.title}</strong>
      {channel === 'music' && typeof item.metadata.artist === 'string' && <small title={item.metadata.artist}>{item.metadata.artist}</small>}
    </Link>)}</div>
  </section>;
}

/** 首页: where you left off across reading and media, the shelf, then something to pick up. */
export function HomePage() {
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const reading = useQuery({
    queryKey: ['home', 'reading', runtime.api.baseUrl, user?.id],
    queryFn: ({ signal }) => runtime.api.continueReading(2, { signal }),
  });
  const shelf = useShelf(1, 'recent');
  const video = useQuery(historyQuery(runtime, 'video', new URLSearchParams()));
  const audio = useQuery(historyQuery(runtime, 'audiobook', new URLSearchParams()));
  const unfinished = (items?: Activity[]) => items?.find(item => !item.completed);
  const readingBooks = reading.data ?? [], book = readingBooks[0];
  const videoActivity = unfinished(video.data?.items), audioActivity = unfinished(audio.data?.items);
  const books = (shelf.data?.items ?? []).slice(0, 8);
  const name = user?.displayName || user?.username || '';

  // Most recent first, whatever kind it is.
  const resumes: Array<{ at: number; node: ReactNode }> = [];
  for (const item of readingBooks.slice(0, 2)) resumes.push({ at: item.lastReadAt ?? 0, node: <ResumeBook key={`read:${item.id}`} book={item} /> });
  if (videoActivity) resumes.push({ at: videoActivity.updatedAt ?? 0, node: <ResumeMedia key="video" channel="video" activity={videoActivity} /> });
  if (audioActivity) resumes.push({ at: audioActivity.updatedAt ?? 0, node: <ResumeMedia key="audiobook" channel="audiobook" activity={audioActivity} /> });
  resumes.sort((a, b) => b.at - a.at);

  return <div className="media-screen media-page home-page">
    <header className="home-header"><h1>{greeting(new Date().getHours())}{name ? `，${name}` : ''}</h1><p>从上次停下的地方继续</p></header>
    <div className="home-continue">
      {resumes.map(entry => entry.node)}
      {/* Only a successful answer can say "nothing in progress": while loading the slot keeps
          its shape, and a failure says so instead of telling a reader with books that they have none.
          Media in progress is enough to fill the row, so the "no book" invitation is only for an empty row. */}
      {!book && (reading.isPending
        ? <section className="home-empty home-empty-pending" aria-label="继续阅读" aria-busy="true"><strong>正在读取在读的书…</strong></section>
        : reading.error
          ? <section className="home-empty" aria-label="继续阅读" role="alert"><strong>在读的书读取失败</strong><button type="button" className="home-retry" onClick={() => void reading.refetch()}>重试<Icon name="chevron-right" size={16} /></button></section>
          : !resumes.length && <section className="home-empty" aria-label="继续阅读"><strong>还没有在读的书</strong><Link to="/shelf">去书架挑一本<Icon name="chevron-right" size={16} /></Link></section>)}
    </div>
    {books.length > 0 && <section className="home-shelf" aria-label="我的书架">
      <div className="home-section"><h2>我的书架</h2><Link to="/shelf">全部<Icon name="chevron-right" size={16} /></Link></div>
      <div className="home-shelf-row">{books.map(item => <BookCard key={item.id} book={item} showAuthor={false} showProgress />)}</div>
    </section>}
    <Discover channel="video" kind="video" heading="看点什么" to="/media/video" />
    <Discover channel="audiobook" kind="audiobook" heading="听本书" to="/media/audiobook" />
    <Discover channel="music" kind="album" heading="听张专辑" to="/media/music/albums" />
  </div>;
}
