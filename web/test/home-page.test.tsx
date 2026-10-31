// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { HomePage, activityProgress, greeting } from '../src/features/home/pages/HomePage.tsx';

const root = document.createElement('div');
document.body.append(root);
const user = { id: 'u1', username: 'lin', displayName: '林间', role: 'member', createdAt: 0 };
const book = { id: 'b1', title: '夜航船', author: '示例', format: 'epub', coverUrl: null, percentage: 0.42, chapterTitle: '第十二章 夜雨', lastReadAt: 1 };
const activity = (over: object) => ({ id: 'a', itemId: 'i1', partId: 'p', assetId: 's', libraryId: 'l', kind: 'episode', title: '示例剧集', partTitle: '第 3 集', start: 0, end: 2480, available: 1, position: 1748, completed: false, ...over });

const series = { id: 's1', libraryId: 'l', kind: 'series', title: '示例剧集', parentId: null, metadata: {}, overrides: {}, children: [], editions: [] };
const episode = { ...series, id: 'i1', kind: 'episode', title: '第 3 集', parentId: 's1' };
const poster = (id: string, title: string) => ({ id, libraryId: 'l', kind: 'movie', title, parentId: null, metadata: {}, overrides: {}, channel: 'video', libraryName: '片库' });

function mount({ reading = [book], video = [activity({ title: '第 3 集', updatedAt: 5 })], audio = [] as object[], discover = { items: [] as object[], total: 0 } }: { reading?: object[]; video?: object[]; audio?: object[]; discover?: { items: object[]; total: number } } = {}) {
  const runtime = {
    api: {
      baseUrl: 'https://reader.example.com',
      currentSession: () => ({ user }),
      continueReading: vi.fn().mockResolvedValue(reading),
      listBooks: vi.fn().mockResolvedValue({ items: [book], total: 1 }),
      coverBytes: vi.fn().mockRejectedValue(new Error('none')),
    },
    mediaApi: {
      preferenceScope: () => 'home-test',
      request: vi.fn(async (path: string) => path.startsWith('browse?')
        ? (path.includes('channel=video&') ? discover : { items: [], total: 0 })
        : { items: path.includes('channel=video') ? video : audio, total: 0 }),
      detail: vi.fn(async (id: string) => id === 's1' ? series : episode),
      cover: vi.fn().mockRejectedValue(new Error('none')),
    },
  } as any;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(
    <RuntimeContext.Provider value={runtime}><QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<HomePage />} /></Routes></MemoryRouter>
    </QueryClientProvider></RuntimeContext.Provider>,
    root,
  ));
  return runtime;
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

afterEach(() => { act(() => render(null, root)); useAuthStore.setState({ session: null, verifiedUser: null }); });

describe('首页', () => {
  it('greets by time of day', () => {
    expect([2, 8, 14, 21].map(greeting)).toEqual(['夜深了', '早上好', '下午好', '晚上好']);
  });

  it('reads progress from position inside the activity span, and treats an unknown length as zero', () => {
    expect(activityProgress(activity({ start: 100, end: 300, position: 200 }) as any)).toBe(0.5);
    expect(activityProgress(activity({ end: null }) as any)).toBe(0);
    expect(activityProgress(activity({ position: 99999 }) as any)).toBe(1);
  });

  it('shows every continue entry as the same card, most recent first, with the series title', async () => {
    useAuthStore.setState({ verifiedUser: user as any });
    mount();
    await settle();
    expect(root.querySelector('h1')?.textContent).toContain('林间');
    const cards = [...root.querySelectorAll<HTMLAnchorElement>('.home-continue a.home-resume')];
    expect(cards.map(card => card.dataset.channel)).toEqual(['video', 'read']);
    const [video, read] = cards as [HTMLAnchorElement, HTMLAnchorElement];
    expect(video.getAttribute('href')).toBe('/media/video/items/i1');
    expect(video.querySelector('strong')?.textContent).toBe('示例剧集');
    expect(video.querySelector('small')?.textContent).toBe('第 3 集');
    expect(video.textContent).toContain('29:08 / 41:20');
    expect(read.getAttribute('href')).toBe('/book/b1');
    expect(read.textContent).toContain('第十二章 夜雨');
    expect(read.textContent).toContain('已读 42%');
    expect(root.querySelector('.home-empty')).toBeNull();
    expect(root.querySelectorAll('.home-shelf .book-card').length).toBe(1);
    expect(root.querySelector('.home-discover')).toBeNull();
  });

  it('shows recently added media by default, and a reshuffleable random batch on request', async () => {
    useAuthStore.setState({ verifiedUser: user as any });
    localStorage.clear();
    const runtime = mount({ discover: { items: [poster('m1', '远山'), poster('m2', '近水')], total: 9 } });
    const browses = () => runtime.mediaApi.request.mock.calls.map(([path]: [string]) => path).filter((path: string) => path.startsWith('browse?channel=video'));
    await settle();
    const section = () => root.querySelector<HTMLElement>('.home-discover[data-channel="video"]')!;
    expect(section().querySelector('h2')?.textContent).toBe('看点什么');
    expect([...section().querySelectorAll('a.home-tile')].map(tile => tile.getAttribute('href'))).toEqual(['/media/video/items/m1', '/media/video/items/m2']);
    expect(root.querySelector('.home-discover[data-channel="audiobook"]')).toBeNull();
    expect(root.querySelector('.home-discover[data-channel="music"]')).toBeNull();
    expect(browses()).toEqual([expect.stringContaining('sort=added')]);
    expect(section().querySelector('.home-shuffle')).toBeNull();

    const random = [...section().querySelectorAll<HTMLButtonElement>('.segmented button')].find(button => button.textContent === '随便看看')!;
    act(() => random.click());
    await settle();
    expect(random.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('home.discover.video')).toBe('random');
    expect(browses().at(-1)).toContain('sort=random');
    act(() => section().querySelector<HTMLButtonElement>('.home-shuffle')!.click());
    await settle();
    expect(browses().filter((path: string) => path.includes('sort=random')).length).toBe(2);
  });

  it('lists up to two books in progress among the media, by recency', async () => {
    useAuthStore.setState({ verifiedUser: user as any });
    mount({ reading: [{ ...book, id: 'b2', title: '新书', lastReadAt: 9 }, book] });
    await settle();
    expect([...root.querySelectorAll<HTMLAnchorElement>('a.home-resume')].map(card => card.getAttribute('href'))).toEqual(['/book/b2', '/media/video/items/i1', '/book/b1']);
  });

  it('skips finished media and invites the reader to the shelf when nothing is in progress', async () => {
    useAuthStore.setState({ verifiedUser: user as any });
    mount({ reading: [], video: [activity({ completed: true })] });
    await settle();
    expect(root.querySelector('a.home-resume')).toBeNull();
    expect(root.querySelector('.home-empty a')?.getAttribute('href')).toBe('/shelf');
  });
});
