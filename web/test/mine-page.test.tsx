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
  it('shows who is signed in, which server, and opens every row as a page', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    expect(root.querySelector('.mine-profile')?.textContent).toContain('林间');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('reader.example.com');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('成员');
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.mine-row')].map(a => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['书库', '/library'], ['书源', '/sources'], ['时长统计阅读、观影、听书', '/me/stats'],
      ['偏好设置跟随系统', '/me/settings'],
      ['账号与连接', '/me/account'], ['外部阅读器OPDS', '/me/opds'],
    ]);
    // Only signing out is a button (it asks first); nothing else opens a sheet in place.
    expect([...root.querySelectorAll('button.mine-row')].map(b => b.textContent)).toEqual(['退出登录']);
    // Members see no administration group.
    expect(root.querySelector('[aria-label="管理"]')).toBeNull();
  });

  it('gathers administration under 管理 for administrators, one page per job, and shows the chosen theme', () => {
    saveThemePreference('mine-test', { theme: 'blue', mode: 'dark' });
    useAuthStore.setState({ verifiedUser: user('admin') });
    paint();
    const labels = [...root.querySelectorAll('.mine-row-label')].map(el => el.textContent);
    expect(labels).toContain('媒体库');
    const admin = [...root.querySelectorAll<HTMLAnchorElement>('[aria-label="管理"] a.mine-row')].map(a => [a.querySelector('.mine-row-label')?.textContent, a.getAttribute('href')]);
    expect(admin).toEqual([
      ['用户管理', '/me/admin/users'], ['注册与邀请', '/me/admin/registration'], ['服务配置', '/me/admin/services'],
      ['扫描与刮削', '/media/video/settings/tasks'],
    ]);
    expect(root.textContent).toContain('雾蓝 · 深色');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('管理员');
  });

  it('signs out through the API, after a confirmation', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    act(() => { root.querySelector<HTMLButtonElement>('.mine-row.is-danger')!.click(); });
    expect(signOut).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === '退出登录')!;
    act(() => { confirm.click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
