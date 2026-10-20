// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { MinePage } from '../src/features/account/pages/MinePage.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { saveThemePreference } from '../src/shared/theme/theme.ts';

const root = document.createElement('div');
document.body.append(root);
const signOut = vi.fn(async () => undefined);
const runtime = {
  api: { baseUrl: 'https://reader.example.com/app', signOut },
  mediaApi: { preferenceScope: () => 'mine-test' },
} as any;
const user = (role: 'admin' | 'member') => ({ id: 'u', username: 'lin', displayName: '林间', role, createdAt: 0 });
const paint = () => act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <MemoryRouter initialEntries={['/me']}>
      <Routes><Route path="/me" element={<MinePage />} /></Routes>
    </MemoryRouter>
  </RuntimeContext.Provider>,
  root,
));

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  localStorage.clear();
  signOut.mockClear();
});

describe('我的', () => {
  it('shows who is signed in, which server, and links to the pages that own each setting', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    expect(root.querySelector('.mine-profile')?.textContent).toContain('林间');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('reader.example.com');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('成员');
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.mine-row')].map(a => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['书库', '/library'], ['书源', '/sources'],
      ['外观与主题跟随系统', '/me/theme'], ['影音浏览紧凑', '/me/browse'], ['播放', '/me/playback'],
      ['账号与连接', '/me/account'],
    ]);
    // Members see no administration group.
    expect(root.querySelector('[aria-label="管理"]')).toBeNull();
  });

  it('opens the shelf display sheet in place', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    const sheet = () => root.querySelector<HTMLElement>('[role=dialog][aria-label="书架设置"]')!;
    expect(sheet().hidden).toBe(true);
    act(() => { [...root.querySelectorAll<HTMLButtonElement>('button.mine-row')].find(b => b.textContent?.startsWith('书架显示'))!.click(); });
    expect(sheet().hidden).toBe(false);
  });

  it('gathers administration under 管理 for administrators and shows the chosen theme', () => {
    saveThemePreference('mine-test', { theme: 'blue', mode: 'dark' });
    useAuthStore.setState({ verifiedUser: user('admin') });
    paint();
    const labels = [...root.querySelectorAll('.mine-row-label')].map(el => el.textContent);
    expect(labels).toContain('媒体库');
    const admin = [...root.querySelectorAll('[aria-label="管理"] .mine-row-label')].map(el => el.textContent);
    expect(admin).toEqual(['系统设置', '扫描与刮削', '来源与刮削']);
    expect(root.querySelector('[aria-label="管理"] a[href="/me/plugins"]')).not.toBeNull();
    expect(root.textContent).toContain('雾蓝 · 深色');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('管理员');
  });

  it('signs out through the API', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    act(() => { root.querySelector<HTMLButtonElement>('.mine-row.is-danger')!.click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
