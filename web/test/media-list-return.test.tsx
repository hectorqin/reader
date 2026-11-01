// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType, type Location, type NavigateFunction, type NavigationType } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { MediaHistoryPage } from '../src/features/media/pages/MediaHistoryPage.tsx';
import { MediaSearchPage } from '../src/features/media/pages/MediaSearchPage.tsx';
import { MediaFavoritesPage } from '../src/features/media/pages/MediaFavoritesPage.tsx';
import { MediaPageFrame } from '../src/features/media/components/MediaPageFrame.tsx';
import type { SearchItem } from '../src/features/media/api/media-api.ts';

const favorites = { total: 60 };
vi.mock('../src/features/media/queries/media.queries.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/features/media/queries/media.queries.ts')>(),
  historyQuery: (_runtime: unknown, channel: string, params: URLSearchParams) => ({
    queryKey: ['list-return-history', channel, params.get('offset') ?? ''],
    queryFn: async () => ({ items: Array.from({ length: 30 }, (_, index) => ({ id: 'h' + index, itemId: 'item' + index, partId: 'p' + index, title: '历史 ' + index, updatedAt: '2026-10-01T00:00:00Z', available: true })), total: 30 }),
  }),
  favoritesQuery: (_runtime: unknown, params: URLSearchParams) => {
    const offset = Number(params.get('offset')) || 0;
    return {
      queryKey: ['list-return-favorites', offset],
      queryFn: async () => ({ items: offset < favorites.total ? [{ id: 'fav', kind: 'movie', title: '收藏电影', libraryId: 'lib', parentId: null, metadata: {}, overrides: {} }] : [], total: favorites.total }),
    };
  },
}));

const root = document.createElement('div');
document.body.append(root);
const results: SearchItem[] = Array.from({ length: 20 }, (_, index) => ({ id: 'film' + index, libraryId: 'lib', title: '结果 ' + index, kind: 'movie', channel: 'video', libraryName: '电影库', parentId: null, metadata: {}, overrides: {} }));
const search = vi.fn(async () => ({ items: results, total: results.length }));
const runtime = { mediaApi: { preferenceScope: () => 'list-return-test', search, coverUrl: () => '', thumbnailUrl: () => '' } } as any;

/** A stand-in detail page: the real frame, so its back arrow honours `state.returnTo`. */
function Detail() {
  return <MediaPageFrame className="media-secondary-page" title="详情"><p>详情内容</p></MediaPageFrame>;
}

/**
 * A plain MemoryRouter, not createMemoryRouter: a data router builds a fetch Request
 * per navigation, and on Node 24 undici rejects jsdom's AbortSignal there, so no
 * navigation ever happens in CI. A probe hands the test the router's state instead.
 */
interface RouterHandle { state: { location: Location; historyAction: NavigationType }; navigate: NavigateFunction }
function Probe({ handle }: { handle: RouterHandle }) {
  handle.state = { location: useLocation(), historyAction: useNavigationType() };
  handle.navigate = useNavigate();
  return null;
}

function mount(initial: string) {
  const router = {} as RouterHandle;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(<RuntimeContext.Provider value={{ ...runtime, queryClient }}><QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[initial]}>
      <Probe handle={router} />
      <Routes>
        <Route path="/media/search" element={<MediaSearchPage />} />
        <Route path="/media/favorites" element={<MediaFavoritesPage />} />
        <Route path="/media/:channel/history" element={<MediaHistoryPage />} />
        <Route path="/media/:channel/items/:id" element={<Detail />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider></RuntimeContext.Provider>, root));
  return router;
}

async function settle(done: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!done() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(done()).toBe(true);
}
const screen = () => root.querySelector<HTMLElement>('.media-screen')!;
function scrollTo(top: number) { screen().scrollTop = top; screen().dispatchEvent(new Event('scroll')); }
async function go(router: ReturnType<typeof mount>, delta: number) { await act(async () => { await router.navigate(delta); }); }

afterEach(() => { act(() => render(null, root)); favorites.total = 60; });

describe('media history', () => {
  it('restores the scroll after Back, Back after Forward, and the detail back arrow', async () => {
    const router = mount('/media/video/history');
    await settle(() => root.querySelectorAll('.media-history-row').length === 30);
    scrollTo(871);
    await act(async () => root.querySelector<HTMLAnchorElement>('.media-personal-title')!.click());
    await settle(() => root.textContent!.includes('详情内容'));
    expect(screen().scrollTop).toBe(0);
    await go(router, -1);
    await settle(() => root.querySelectorAll('.media-history-row').length === 30);
    expect(screen().scrollTop).toBe(871);
    await go(router, 1);
    await settle(() => root.textContent!.includes('详情内容'));
    await go(router, -1);
    await settle(() => screen().scrollTop === 871);
    await act(async () => root.querySelector<HTMLAnchorElement>('.media-personal-title')!.click());
    await settle(() => root.textContent!.includes('详情内容'));
    await act(async () => root.querySelector<HTMLAnchorElement>('.media-back-button')!.click());
    await settle(() => root.querySelectorAll('.media-history-row').length === 30);
    expect(router.state.location.pathname).toBe('/media/video/history');
    expect(screen().scrollTop).toBe(871);
  });
});

describe('media search', () => {
  it('opens a result whose back arrow returns to the search, query included', async () => {
    mount('/media/search?q=结果&scope=video&offset=0');
    await settle(() => root.querySelectorAll('.media-search-result').length === 20);
    await act(async () => root.querySelector<HTMLButtonElement>('.media-search-result')!.click());
    await settle(() => root.textContent!.includes('详情内容'));
    const back = root.querySelector<HTMLAnchorElement>('.media-back-button')!;
    expect(back.getAttribute('aria-label')).toBe('返回上一页');
    expect(decodeURIComponent(back.getAttribute('href')!)).toBe('/media/search?q=结果&scope=video&offset=0');
  });

  it('restores the scroll on browser Back and on Back after Forward', async () => {
    const router = mount('/media/search?q=结果');
    await settle(() => root.querySelectorAll('.media-search-result').length === 20);
    scrollTo(1960);
    await act(async () => root.querySelector<HTMLButtonElement>('.media-search-result')!.click());
    await settle(() => root.textContent!.includes('详情内容'));
    await go(router, -1);
    await settle(() => root.querySelectorAll('.media-search-result').length === 20);
    await settle(() => screen().scrollTop === 1960);
    expect((root.querySelector('input[name=q]') as HTMLInputElement).value).toBe('结果');
    await go(router, 1);
    await settle(() => root.textContent!.includes('详情内容'));
    await go(router, -1);
    await settle(() => root.querySelectorAll('.media-search-result').length === 20);
    await settle(() => screen().scrollTop === 1960);
  });

  it('browser Back between two searches shows the earlier search again', async () => {
    const router = mount('/media/search?q=结果');
    await settle(() => root.querySelectorAll('.media-search-result').length === 20);
    await act(async () => root.querySelector<HTMLButtonElement>('[data-scope=music]')!.click());
    await settle(() => router.state.location.search.includes('scope=music'));
    await go(router, -1);
    await settle(() => !router.state.location.search.includes('scope=music'));
    await settle(() => root.querySelector('[data-scope=all]')?.getAttribute('aria-pressed') === 'true');
    expect(root.querySelector('[data-scope=music]')?.getAttribute('aria-pressed')).not.toBe('true');
  });

  it('a new search does not jump to an old position', async () => {
    const router = mount('/media/search?q=结果');
    await settle(() => root.querySelectorAll('.media-search-result').length === 20);
    scrollTo(500);
    await act(async () => root.querySelector<HTMLButtonElement>('[data-scope=music]')!.click());
    await settle(() => router.state.location.search.includes('scope=music') && root.querySelectorAll('.media-search-result').length === 20);
    scrollTo(0);
    await act(async () => root.querySelector<HTMLButtonElement>('[data-scope=all]')!.click());
    await settle(() => router.state.location.search.includes('scope=all') && root.querySelectorAll('.media-search-result').length === 20);
    expect(screen().scrollTop).toBe(0);
  });
});

describe('media favorites', () => {
  it('clamps a page past the end to the last page instead of claiming there are no favorites', async () => {
    const router = mount('/media/favorites?offset=60');
    await settle(() => root.querySelectorAll('.media-favorite-row').length === 1);
    expect(router.state.location.search).toBe('');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(root.textContent).not.toContain('还没有收藏');
    expect(root.textContent).toContain('60 项收藏');
  });

  it('clamps to the last non-empty page and keeps a truly empty list empty', async () => {
    favorites.total = 61;
    const router = mount('/media/favorites?offset=180');
    await settle(() => root.querySelectorAll('.media-favorite-row').length === 1);
    expect(router.state.location.search).toBe('?offset=60');
    act(() => render(null, root));
    favorites.total = 0;
    mount('/media/favorites');
    await settle(() => root.textContent!.includes('还没有收藏'));
  });
});
