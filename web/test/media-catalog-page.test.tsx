// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { saveMediaPreferences, type MediaPreferences } from '../src/features/media/services/preferences.ts';
import { MediaCatalogPage } from '../src/features/media/pages/MediaCatalogPage.tsx';
import { MediaNarratorsPage } from '../src/features/media/pages/MediaNarratorsPage.tsx';
import { ChannelMenu } from '../src/features/media/components/channel-menu.tsx';

const state = vi.hoisted(() => ({
  libraries: [] as Array<{ id: string; name: string; kind: string }>,
  total: 3,
  sorts: [] as string[],
}));

vi.mock('../src/features/media/queries/media.queries.ts', () => ({
  catalogQuery: (_runtime: unknown, channel: string, kind: string, params: URLSearchParams) => ({
    queryKey: ['catalog-test', channel, kind, params.toString()],
    queryFn: async () => {
      state.sorts.push(params.get('sort') ?? 'default');
      const offset = Number(params.get('offset')) || 0;
      const count = Math.max(0, Math.min(60, state.total - offset));
      return { total: state.total, items: Array.from({ length: count }, (_, index) => ({ id: `i${offset + index}`, libraryId: 'a', kind, title: `作品 ${offset + index}`, parentId: null, metadata: {}, overrides: {} })) };
    },
  }),
  useMediaLibraries: () => ({ data: { items: state.libraries } }),
  librariesQuery: () => ({ queryKey: ['libraries-test'], queryFn: async () => ({ items: state.libraries }) }),
}));

const root = document.createElement('div');
document.body.append(root);
const scope = 'catalog-page-test';
const request = vi.fn(async (_path: string) => ({ items: [] }));
const runtime = {
  mediaApi: { preferenceScope: () => scope, request, cover: async () => null, narrators: async () => ({ items: [], total: 0 }) },
  player: { play: vi.fn() },
} as any;

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
const where = () => root.querySelector('[data-testid=location]')!.textContent;

function mount(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(
    <RuntimeContext.Provider value={runtime}><QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/media/audiobook/narrators" element={<MediaNarratorsPage />} />
          <Route path="/media/:channel/:category?" element={<MediaCatalogPage />} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider></RuntimeContext.Provider>,
    root,
  ));
}
async function settle(done: () => boolean) {
  // Up to 4s rather than 50 polls: a slow CI runner's first render alone can take over half a second.
  const deadline = Date.now() + 4000;
  while (!done() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(done()).toBe(true);
}
const prefer = (patch: Partial<MediaPreferences>) => saveMediaPreferences(scope, { density: 'compact', showContinue: true, showLibraryName: true, ...patch });
const tiles = () => root.querySelectorAll('.media-grid .media-tile').length;

afterEach(() => {
  act(() => render(null, root));
  localStorage.clear();
  useAuthStore.setState({ session: null, verifiedUser: null });
  state.libraries = []; state.total = 3; state.sorts = [];
  request.mockClear();
});

describe('影音浏览 preferences on the catalog', () => {
  it('draws the grid in the chosen 封面密度 and follows a change made while it is open', async () => {
    state.libraries = [{ id: 'a', name: '音乐库', kind: 'music' }];
    prefer({ density: 'comfortable' });
    mount('/media/music/albums?library=a');
    await settle(() => tiles() === 3);
    expect(root.querySelector('.media-grid')!.getAttribute('data-density')).toBe('comfortable');
    act(() => { prefer({ density: 'compact' }); });
    expect(root.querySelector('.media-grid')!.getAttribute('data-density')).toBe('compact');
  });

  it('uses 默认排序 when the URL names no sort, and an explicit sort when it does', async () => {
    state.libraries = [{ id: 'a', name: '音乐库', kind: 'music' }];
    prefer({ sort: 'title-desc' });
    mount('/media/music/albums?library=a');
    await settle(() => tiles() === 3);
    expect(state.sorts).toEqual(['title-desc']);
    // The preference is the baseline, so it is not flagged as an applied filter.
    expect(root.querySelector('[aria-label="已应用筛选"]')).toBeNull();
    act(() => render(null, root));
    state.sorts = [];
    mount('/media/music/albums?library=a&sort=default');
    await settle(() => tiles() === 3);
    expect(state.sorts).toEqual(['default']);
    expect(root.querySelector('[aria-label="已应用筛选"]')).not.toBeNull();
  });

  it('shows the continue card only when 首页显示最近续播 is on', async () => {
    state.libraries = [{ id: 'a', name: '片库', kind: 'video' }];
    prefer({ showContinue: false });
    mount('/media/video?library=a');
    await settle(() => tiles() === 3);
    expect(request.mock.calls.some(([path]) => String(path).startsWith('history'))).toBe(false);
    act(() => { prefer({ showContinue: true }); });
    await settle(() => request.mock.calls.some(([path]) => String(path).startsWith('history')));
  });

  it('hides the 来源库 selector when 列表工具栏显示来源库 is off, unless a link has narrowed to one of several', async () => {
    state.libraries = [{ id: 'a', name: '音乐库', kind: 'music' }, { id: 'b', name: '另一个库', kind: 'music' }];
    prefer({ showLibraryName: false });
    mount('/media/music/albums');
    await settle(() => tiles() === 3);
    expect(root.querySelector('.media-library-filter [aria-label="来源库"]')).toBeNull();
    expect(root.querySelector('.media-catalog-count')?.textContent).toBe('3 张专辑');
    act(() => render(null, root));
    mount('/media/music/albums?library=b');
    await settle(() => tiles() === 3);
    expect(root.querySelector('.media-library-filter [aria-label="来源库"]')).not.toBeNull();
    act(() => render(null, root));
    prefer({ showLibraryName: true });
    mount('/media/music/albums');
    await settle(() => tiles() === 3);
    expect(root.querySelector('.media-library-filter [aria-label="来源库"]')).not.toBeNull();
  });
});

describe('catalog pagination', () => {
  it('clamps a page past the end to the last page, replacing the history entry', async () => {
    state.libraries = [{ id: 'a', name: '音乐库', kind: 'music' }];
    state.total = 130;
    mount('/media/music/tracks?library=a&offset=180');
    await settle(() => where() === '/media/music/tracks?library=a&offset=120' && tiles() === 10);
    expect(root.querySelector('.media-pagination span')?.textContent).toBe('3 / 3');
    expect(root.querySelector('.media-empty')).toBeNull();
  });

  it('clamps to the first page when everything went away, which then says the library is empty', async () => {
    state.libraries = [{ id: 'a', name: '音乐库', kind: 'music' }];
    state.total = 0;
    mount('/media/music/tracks?library=a&offset=60');
    await settle(() => where() === '/media/music/tracks?library=a');
  });
});

describe('category tabs', () => {
  it('draws 有声书 and 演播者 on the narrator page, with 演播者 current', async () => {
    state.libraries = [{ id: 'b', name: '书库', kind: 'audiobook' }];
    mount('/media/audiobook/narrators');
    await settle(() => root.querySelectorAll('.media-tabs .media-tab-link').length === 2);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.media-tabs .media-tab-link')];
    expect(links.map(link => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['有声书', '/media/audiobook', null],
      ['演播者', '/media/audiobook/narrators', 'page'],
    ]);
  });

  it('marks the default category current at both the bare channel path and its own path', async () => {
    state.libraries = [{ id: 'a', name: '音乐库', kind: 'music' }];
    for (const path of ['/media/music', '/media/music/albums']) {
      mount(path);
      await settle(() => tiles() === 3);
      expect(root.querySelector('.media-tabs [aria-current=page]')?.textContent).toBe('专辑');
      act(() => render(null, root));
    }
  });
});

describe('channel ⋯ menu', () => {
  const labels = () => [...document.querySelectorAll('[role^=menuitem]')].map(item => item.textContent?.trim());
  function open() {
    act(() => render(<MemoryRouter><ChannelMenu channel="music" /></MemoryRouter>, root));
    act(() => root.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')!.click());
  }
  it('offers 媒体库管理 to an administrator only, and not before the role is known', () => {
    open();
    expect(labels()).toEqual(['收藏', '历史', '队列']);
    act(() => render(null, root));
    useAuthStore.setState({ verifiedUser: { role: 'member' } as any });
    open();
    expect(labels()).toEqual(['收藏', '历史', '队列']);
    act(() => render(null, root));
    useAuthStore.setState({ verifiedUser: { role: 'admin' } as any });
    open();
    expect(labels()).toEqual(['收藏', '历史', '队列', '媒体库管理']);
  });
});
