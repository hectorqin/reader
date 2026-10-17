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

function mount({ reading = [book], video = [activity({})], audio = [] as object[] }: { reading?: object[]; video?: object[]; audio?: object[] } = {}) {
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
      request: vi.fn(async (path: string) => ({ items: path.includes('channel=video') ? video : audio, total: 0 })),
    },
  } as any;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(
    <RuntimeContext.Provider value={runtime}><QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<HomePage />} /></Routes></MemoryRouter>
    </QueryClientProvider></RuntimeContext.Provider>,
    root,
  ));
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

  it('resumes the book first, then the unfinished media, then the shelf', async () => {
    useAuthStore.setState({ verifiedUser: user as any });
    mount();
    await settle();
    expect(root.querySelector('h1')?.textContent).toContain('林间');
    const hero = root.querySelector<HTMLAnchorElement>('a.home-hero')!;
    expect(hero.getAttribute('href')).toBe('/book/b1');
    expect(hero.textContent).toContain('第十二章 夜雨');
    expect(hero.textContent).toContain('42%');
    const card = root.querySelector<HTMLAnchorElement>('a.home-card[data-channel="video"]')!;
    expect(card.getAttribute('href')).toBe('/media/video/items/i1');
    expect(card.textContent).toContain('示例剧集 · 第 3 集');
    expect(card.textContent).toContain('已看 29:08 / 41:20');
    expect(root.querySelector('a.home-card[data-channel="audiobook"]')).toBeNull();
    expect(root.querySelectorAll('.home-shelf .book-card').length).toBe(1);
  });

  it('skips finished media and invites the reader to the shelf when nothing is in progress', async () => {
    useAuthStore.setState({ verifiedUser: user as any });
    mount({ reading: [], video: [activity({ completed: true })] });
    await settle();
    expect(root.querySelector('a.home-hero')).toBeNull();
    expect(root.querySelector('.home-empty a')?.getAttribute('href')).toBe('/shelf');
    expect(root.querySelector('a.home-card')).toBeNull();
  });
});
