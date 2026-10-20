// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';

/** 书架 (prototypes 2/19): 在读 / 想读 / 已读 and 分组 drive the query and the URL; ⋯ marks a book. */
const shelfCalls: unknown[][] = [];
const book = { id: 'b1', title: '夜航船', author: '示例作者', coverUrl: null, format: 'epub', readingState: 'reading' };
vi.mock('../src/features/shelf/queries/shelf.queries.ts', () => ({
  useShelf: (...args: unknown[]) => { shelfCalls.push(args); return { data: { items: [book], total: 1, pageSize: 60 }, isPending: false, error: null }; },
  useShelfGroups: (enabled: boolean) => ({ data: enabled ? { authors: [], series: ['三体'], tags: ['科幻'], formats: [] } : undefined, isPending: false, error: null }),
}));
const { ShelfPage } = await import('../src/features/shelf/pages/ShelfPage.tsx');

const root = document.createElement('div');
document.body.append(root);
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
const setReadingStatus = vi.fn(async () => undefined);
const runtime = {
  api: { baseUrl: 'https://reader.example.com', currentSession: () => null, setReadingStatus, coverBytes: async () => new Uint8Array() },
  offline: { progressFor: () => undefined },
  updateSettings: async () => undefined,
} as any;
let location = '';
function Where() { location = useLocation().search; return null; }
const paint = (path: string) => act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <QueryClientProvider client={new QueryClient()}><MantineProvider>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="/shelf" element={<><ShelfPage /><Where /></>} /></Routes></MemoryRouter>
    </MantineProvider></QueryClientProvider>
  </RuntimeContext.Provider>, root));
const click = (text: string) => act(() => [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!.click());
afterEach(() => { act(() => render(null, root)); shelfCalls.length = 0; setReadingStatus.mockClear(); });

it('filters by reading state and by one 分组, keeping both in the URL', async () => {
  paint('/shelf?status=want');
  expect(shelfCalls.at(-1)?.[3]).toEqual({ status: 'want' });
  expect([...root.querySelectorAll('[aria-label="阅读状态"] button')].map(button => [button.textContent, button.getAttribute('aria-pressed')]))
    .toEqual([['全部', 'false'], ['在读', 'false'], ['想读', 'true'], ['已读', 'false']]);
  await click('在读');
  expect(new URLSearchParams(location).get('status')).toBe('reading');
  await click('分组');
  await click('系列 · 三体');
  expect(Object.fromEntries(new URLSearchParams(location))).toMatchObject({ status: 'reading', series: '三体', page: '1' });
  expect(shelfCalls.at(-1)?.[3]).toEqual({ status: 'reading', series: '三体' });
  // The active group is its own chip; pressing it removes the group and keeps the state.
  await act(() => root.querySelector<HTMLButtonElement>('.shelf-group-active')!.click());
  expect(Object.fromEntries(new URLSearchParams(location))).toEqual({ sort: 'recent', page: '1', status: 'reading' });
});

it('shows a card\'s state and marks it from the ⋯ menu', async () => {
  paint('/shelf');
  expect(root.querySelector('.book-state')?.textContent).toBe('在读');
  await act(() => root.querySelector<HTMLButtonElement>('.book-more')!.click());
  const options = [...root.querySelectorAll('.dialog button')].map(button => button.textContent);
  expect(options).toEqual(['标记为想读', '标记为已读', '清除标记', '从书架拿掉', '取消']);
  await click('标记为已读');
  expect(setReadingStatus).toHaveBeenCalledWith('b1', 'finished');
  await act(() => root.querySelector<HTMLButtonElement>('.book-more')!.click());
  await click('清除标记');
  expect(setReadingStatus).toHaveBeenLastCalledWith('b1', null);
});
