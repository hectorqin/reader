// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { AdminServicesPage } from '../src/features/account/pages/AdminPages.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import type { User } from '../src/api/types.ts';
import { dismissAllNotices } from '../src/ui/notifications.ts';

const root = document.createElement('div');
const groups = [
  { group: 'tts', label: '朗读', revision: 1, values: {}, secrets: {}, fields: [] },
  { group: 'modules', label: '功能模块', revision: 1, values: {}, secrets: {}, fields: [] },
  { group: 'tmdb', label: 'TMDB', revision: 1, values: {}, secrets: {}, fields: [] },
];
const runtime = { api: { businessSettingsRequest: vi.fn(async () => ({ groups })) } } as any;
const user: User = { id: 'admin', username: 'admin', displayName: '管理员', role: 'admin', createdAt: 0 };
const paint = () => act(async () => render(
  <RuntimeContext.Provider value={runtime}>
    <MemoryRouter><AdminServicesPage /></MemoryRouter>
  </RuntimeContext.Provider>, root,
));

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  dismissAllNotices();
});

const selectGroup = (group: string) => act(() => {
  const select = root.querySelector<HTMLSelectElement>('[aria-label="配置分类"]')!;
  select.value = group;
  select.dispatchEvent(new Event('change', { bubbles: true }));
});

it('shows the ready status only within the modules settings', async () => {
  useAuthStore.setState({ verifiedUser: { ...user, mediaState: 'ready' } });
  await paint();
  expect(root.querySelector('[role="status"]')).toBeNull();
  selectGroup('modules');
  expect(root.querySelector('[aria-label="功能模块"] [role="status"]')?.textContent).toBe('影音服务：已就绪');
  selectGroup('tmdb');
  expect(root.querySelector('[role="status"]')).toBeNull();
});

it.each([
  ['disabled', '已关闭'],
  ['stopping', '正在停止'],
  ['starting', '正在启动'],
  ['failed', '启动失败，请检查服务日志'],
  ['closed', '已停止'],
  [undefined, '状态待确认'],
] as const)('shows %s only in modules and updates it when capabilities change', async (mediaState, label) => {
  useAuthStore.setState({ verifiedUser: mediaState ? { ...user, mediaState } : user });
  await paint();
  expect(root.querySelector('[role="status"]')).toBeNull();
  selectGroup('modules');
  expect(root.querySelector('[aria-label="功能模块"] [role="status"]')?.textContent).toBe(`影音服务：${label}`);
  act(() => useAuthStore.getState().verify({ ...user, mediaState: 'ready' }));
  expect(root.querySelector('[role="status"]')?.textContent).toBe('影音服务：已就绪');
  selectGroup('tts');
  expect(root.querySelector('[role="status"]')).toBeNull();
});
