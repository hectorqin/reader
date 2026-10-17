// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { AppShell } from '../src/app/App.tsx';
import { navMode } from '../src/app/AppNav.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';

const root = document.createElement('div');
document.body.append(root);
const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined };
const runtime = {
  api: { baseUrl: 'https://reader.example.com' },
  mediaApi: { preferenceScope: () => 'shell-test' },
  player: { ...listeners, setVisible: () => undefined },
  playback: { snapshot: () => ({}) },
} as any;
const user = { id: 'u', username: 'lin', displayName: '林间', role: 'member', createdAt: 0 };
const paint = (path: string) => {
  act(() => render(null, root)); // a fresh router per call
  act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route element={<AppShell />}><Route path="*" element={<main data-testid="page">页面</main>} /></Route></Routes>
    </MemoryRouter>
  </RuntimeContext.Provider>,
  root,
));
};

beforeEach(() => useAuthStore.setState({ session: { user } as any, verifiedUser: user as any }));

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  delete document.body.dataset.appNav;
  delete document.body.dataset.mediaTheme;
});

describe('shell navigation', () => {
  it('decides where the bar shows: top-level pages, pushed pages, and the full-screen ones', () => {
    expect(['/', '/shelf', '/me', '/media/video', '/media/music/albums', '/media/audiobook/books'].map(navMode)).toEqual(Array(6).fill('top'));
    expect(['/library', '/sources', '/media/video/items/x', '/media/video/settings', '/media/video/favorites', '/media/queue'].map(navMode)).toEqual(Array(6).fill('push'));
    expect(['/book/abc', '/media/video/player', '/media/music/player/lyrics'].map(navMode)).toEqual(Array(3).fill('hidden'));
  });

  it('puts the navigation after the page, marks 影音 and the channel current, and themes the body', () => {
    paint('/media/music/albums');
    const page = root.querySelector('[data-testid="page"]')!;
    const nav = root.querySelector<HTMLElement>('nav.app-nav')!;
    expect(nav.getAttribute('aria-label')).toBe('主导航');
    expect(page.closest('.app-shell-body')).not.toBeNull();
    expect(page.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...nav.querySelectorAll('.app-nav-item')].map(a => a.textContent)).toEqual(['首页', '书架', '影音', '我的']);
    expect(nav.querySelector('.app-nav-item[aria-current="page"]')?.textContent).toBe('影音');
    expect(nav.querySelector('.app-nav-subitem[aria-current="page"]')?.textContent).toBe('音乐');
    expect(document.body.dataset.appNav).toBe('top');
    expect(document.body.dataset.mediaTheme).toBe('system');
  });

  it('keeps the sidebar on pushed pages, and removes the bar for the book and the player', () => {
    paint('/media/video/items/film-1');
    expect(root.querySelector('nav.app-nav')?.getAttribute('data-mode')).toBe('push');
    expect(document.body.dataset.appNav).toBe('push');
    paint('/media/video/player');
    expect(root.querySelector('nav.app-nav')).toBeNull();
    expect(document.body.dataset.appNav).toBeUndefined();
  });

  it('leaves the book to its own reading theme', () => {
    paint('/book/abc');
    expect(root.querySelector('nav.app-nav')).toBeNull();
    expect(document.body.dataset.mediaTheme).toBeUndefined();
  });

  it('marks the reading destinations under 书架 and the account page under 我的', () => {
    paint('/sources');
    expect(root.querySelector('.app-nav-item[aria-current="page"]')?.textContent).toBe('书架');
    paint('/me');
    expect(root.querySelector('.app-nav-item[aria-current="page"]')?.textContent).toBe('我的');
  });
});
