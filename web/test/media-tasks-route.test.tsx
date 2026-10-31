// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { MediaTasksPage } from '../src/features/media/pages/MediaTasksPage.tsx';

vi.mock('../src/features/media/queries/media.queries.ts', () => ({
  librariesQuery: () => ({ queryKey: ['media-task-route-libraries'], queryFn: async () => ({ items: [] }) }),
  jobsQuery: () => ({ queryKey: ['media-task-route-jobs'], queryFn: async () => ({ items: [] }) }),
  aiJobsQuery: () => ({ queryKey: ['media-task-route-ai-jobs'], queryFn: async () => ({ items: [] }) }),
}));

const root = document.createElement('div');
document.body.append(root);
let capabilities = { summary: false, scan: true };
const runtime = { mediaApi: { preferenceScope: () => 'media-task-route-test' }, api: { aiCapabilities: async () => capabilities } } as any;

function mount(initialEntry: { pathname: string; state?: unknown }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={queryClient}>
        <>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/media/:channel/settings/tasks" element={<MediaTasksPage />} />
            </Routes>
          </MemoryRouter>
        </>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
    root,
  ));
}

/** Lets the capabilities query resolve; fails after a second if `done` never holds. */
async function settle(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(done()).toBe(true);
}

function backLink() {
  return root.querySelector<HTMLAnchorElement>('.media-back-button')!;
}

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
});

describe('media task page return route', () => {
  it('uses the source route and keeps it when switching task tabs', async () => {
    useAuthStore.setState({ verifiedUser: { role: 'admin' } as any });
    mount({ pathname: '/media/music/settings/tasks', state: { returnTo: '/media/music/settings/libraries' } });
    await settle(() => root.querySelectorAll('.media-task-tabs button').length === 3);
    expect(backLink().getAttribute('href')).toBe('/media/music/settings/libraries');
    expect(backLink().getAttribute('title')).toBe('返回媒体库管理');

    await act(async () => {
      root.querySelector<HTMLButtonElement>('.media-task-tabs button:nth-child(2)')!.click();
    });
    expect(backLink().getAttribute('href')).toBe('/media/music/settings/libraries');
    expect(backLink().getAttribute('title')).toBe('返回媒体库管理');
  });

  it('offers AI 扫描 only while the AI switches allow it', async () => {
    useAuthStore.setState({ verifiedUser: { role: 'admin' } as any });
    const tabs = () => [...root.querySelectorAll('.media-task-tabs button')].map(button => button.textContent);
    capabilities = { summary: true, scan: false };
    mount({ pathname: '/media/video/settings/tasks', search: '?tab=ai' } as any);
    await settle(() => root.querySelectorAll('.media-task-tabs button').length > 0);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(tabs()).toEqual(['媒体库扫描', '刮削']);
    // A link straight to the AI tab lands on 媒体库扫描 instead of an empty panel.
    expect(root.querySelector('.media-task-tabs [aria-current=page]')?.textContent).toBe('媒体库扫描');
    act(() => render(null, root));
    capabilities = { summary: false, scan: true };
    mount({ pathname: '/media/video/settings/tasks' });
    await settle(() => tabs().length === 3);
    expect(tabs()).toEqual(['媒体库扫描', 'AI 扫描', '刮削']);
  });

  it('falls back to 我的 for a direct deep link', () => {
    useAuthStore.setState({ verifiedUser: { role: 'admin' } as any });
    mount({ pathname: '/media/video/settings/tasks' });
    expect(backLink().getAttribute('href')).toBe('/me');
    expect(backLink().getAttribute('title')).toBe('返回我的');
  });
});
