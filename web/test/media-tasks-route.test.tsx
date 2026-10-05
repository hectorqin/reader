// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
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
const runtime = { mediaApi: { preferenceScope: () => 'media-task-route-test' } } as any;

function mount(initialEntry: { pathname: string; state?: unknown }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/media/:channel/settings/tasks" element={<MediaTasksPage />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
    root,
  ));
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
    expect(backLink().getAttribute('href')).toBe('/media/music/settings/libraries');
    expect(backLink().getAttribute('title')).toBe('返回媒体库管理');

    await act(async () => {
      root.querySelector<HTMLButtonElement>('.media-task-tabs button:nth-child(2)')!.click();
    });
    expect(backLink().getAttribute('href')).toBe('/media/music/settings/libraries');
    expect(backLink().getAttribute('title')).toBe('返回媒体库管理');
  });

  it('falls back to the channel settings route for a direct deep link', () => {
    useAuthStore.setState({ verifiedUser: { role: 'admin' } as any });
    mount({ pathname: '/media/video/settings/tasks' });
    expect(backLink().getAttribute('href')).toBe('/media/video/settings');
    expect(backLink().getAttribute('title')).toBe('返回影音设置');
  });
});
