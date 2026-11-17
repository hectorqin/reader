// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { StatsPage } from '../src/features/stats/pages/StatsPage.tsx';

const root = document.createElement('div');
document.body.append(root);
const user = { id: 'reader', username: 'reader', displayName: 'Reader', role: 'member' as const, createdAt: 0, mediaEnabled: false, features: { media: false } };
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return keyOf(d); };
const runtime = {
  api: {
    readingStats: vi.fn(async (query: { group: string; from: number; to: number }) => ({
      // The calendar asks for a year by day; answer it with three days of reading.
      series: query.to - query.from > 40 * 86400000 ? [{ key: daysAgo(1), seconds: 3 * 3600 }, { key: daysAgo(2), seconds: 20 * 60 }, { key: daysAgo(40), seconds: 60 }] : [],
      works: [], total: 0,
    })),
    readingStatsUsers: vi.fn(async () => []),
  },
  mediaApi: { timeStats: vi.fn(), statsUsers: vi.fn() },
} as any;
let client: QueryClient;
let where = '';
function Probe() { const location = useLocation(); where = location.pathname + location.search; return null; }
const paint = (path: string) => act(async () => render(
  <RuntimeContext value={runtime}><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Probe /><StatsPage /></MemoryRouter></QueryClientProvider></RuntimeContext>, root));
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ session: { user, accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 }, verifiedUser: user } as any);
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
});
afterEach(async () => { await act(async () => render(null, root)); vi.clearAllMocks(); useAuthStore.setState({ session: null, verifiedUser: null }); });

it('draws a year of days, darker for more time, with the streaks', async () => {
  await paint('/me/stats');
  await settle();
  const calendar = root.querySelector('[aria-label="阅读日历"]')!;
  const yearQuery = runtime.api.readingStats.mock.calls.map((call: any[]) => call[0]).find((q: any) => q.to - q.from > 40 * 86400000);
  expect(yearQuery.group).toBe('day');
  expect(new Date(yearQuery.from).getDay()).toBe(1);
  const days = calendar.querySelectorAll('button.stats-calendar-day');
  expect(days.length).toBeGreaterThanOrEqual(52 * 7 + 1);
  const level = (key: string) => [...days].find(day => day.getAttribute('aria-label')!.startsWith(`${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`) && !(day as HTMLButtonElement).disabled)?.getAttribute('data-level');
  expect(level(daysAgo(1))).toBe('5');
  expect(level(daysAgo(2))).toBe('2');
  expect(level(daysAgo(40))).toBe('1');
  expect(calendar.textContent).toContain('3 天有记录');
  expect(calendar.textContent).toContain('当前连续 2 天');
  expect(calendar.textContent).toContain('最长连续 2 天');
});

it('a day opens the chart on its month with the day picked', async () => {
  await paint('/me/stats?g=year');
  await settle();
  const key = daysAgo(1);
  const day = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="阅读日历"] button.stats-calendar-day')]
    .find(button => !button.disabled && button.getAttribute('data-level') === '5')!;
  await act(async () => day.click());
  expect(where).toBe(`/me/stats?at=${key.slice(0, 7)}&sel=${key}`);
});
