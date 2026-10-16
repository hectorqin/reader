// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { MediaLayout } from '../src/app/App.tsx';
import { MinePage } from '../src/features/account/pages/MinePage.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { saveMediaTheme } from '../src/features/media/services/theme.ts';

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
      <Routes><Route path="/me" element={<MediaLayout />}><Route index element={<MinePage />} /></Route></Routes>
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
      ['外观与主题跟随系统', '/media/video/settings/theme'], ['播放', '/media/video/settings/playback'],
      ['账号与连接', '/media/video/settings/account'],
    ]);
  });

  it('offers media library management only to administrators and shows the chosen theme', () => {
    saveMediaTheme('mine-test', 'midnight');
    useAuthStore.setState({ verifiedUser: user('admin') });
    paint();
    const labels = [...root.querySelectorAll('.mine-row-label')].map(el => el.textContent);
    expect(labels).toContain('媒体库');
    expect(root.textContent).toContain('深夜');
    expect(root.querySelector('.mine-profile')?.textContent).toContain('管理员');
  });

  it('signs out through the API and keeps the channel rail with 我的 marked current', () => {
    useAuthStore.setState({ verifiedUser: user('member') });
    paint();
    act(() => { root.querySelector<HTMLButtonElement>('.mine-row.is-danger')!.click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
    const current = root.querySelector('nav.media-channel-entry a[aria-current="page"]');
    expect(current?.textContent).toContain('我的');
    expect(current?.getAttribute('href')).toBe('/me');
  });
});
