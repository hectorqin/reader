import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Clapperboard, Headphones, House, Music2, UserRound, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useRuntime } from './providers/runtime-context.tsx';

/**
 * hidden: the book and the player own the whole screen.
 * top:    a top-level destination; the bar shows everywhere.
 * push:   a page reached from a top-level one (detail, settings, library files):
 *         on a phone it replaces the bar with its own back arrow, on desktop the
 *         sidebar stays.
 */
export type NavMode = 'hidden' | 'top' | 'push';

const mediaTop = /^\/media\/(video|music|audiobook)(?:\/([^/]+))?$/;
const pushed = new Set(['favorites', 'queue', 'settings', 'history', 'folders', 'player', 'narrators']);

export function navMode(pathname: string): NavMode {
  if (pathname.startsWith('/book/') || /^\/media\/[^/]+\/player(\/|$)/.test(pathname)) return 'hidden';
  if (pathname === '/' || pathname === '/shelf' || pathname === '/me') return 'top';
  const media = mediaTop.exec(pathname);
  if (media) return media[2] && pushed.has(media[2]) ? 'push' : 'top';
  return 'push';
}

interface Destination { to: string; label: string; icon: LucideIcon; current(path: string): boolean }
const destinations: Destination[] = [
  { to: '/', label: '首页', icon: House, current: path => path === '/' },
  { to: '/shelf', label: '书架', icon: BookOpen, current: path => /^\/(shelf|library|sources)(\/|$)/.test(path) },
  { to: '/media/video', label: '影音', icon: Clapperboard, current: path => path.startsWith('/media') },
  { to: '/me', label: '我的', icon: UserRound, current: path => path === '/me' || path.startsWith('/me/') },
];
const channels: Array<{ id: string; to: string; label: string; icon: LucideIcon }> = [
  { id: 'video', to: '/media/video', label: '影视', icon: Clapperboard },
  { id: 'music', to: '/media/music', label: '音乐', icon: Music2 },
  { id: 'audiobook', to: '/media/audiobook', label: '有声书', icon: Headphones },
];

/** The one navigation: a tab bar on a phone, a sidebar from 900px up. */
export function AppNav({ mode }: { mode: Exclude<NavMode, 'hidden'> }) {
  const { pathname } = useLocation();
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser ?? state.session?.user ?? null);
  const channel = /^\/media\/(video|music|audiobook)/.exec(pathname)?.[1];
  const name = user?.displayName || user?.username || '';
  return <nav className="app-nav" aria-label="主导航" data-mode={mode}>
    <Link className="app-nav-brand" to="/" aria-label="reader. 首页">reader.</Link>
    <ul className="app-nav-list">
      {destinations.map(({ to, label, icon: Icon, current }) => {
        const active = current(pathname);
        return <li key={to}>
          <Link className="app-nav-item" to={to} aria-current={active ? 'page' : undefined}>
            <span className="app-nav-icon" aria-hidden="true"><Icon size={22} strokeWidth={active ? 2.1 : 1.8} /></span>
            <span className="app-nav-label">{label}</span>
          </Link>
          {to === '/media/video' && <ul className="app-nav-sub" aria-label="影音频道">
            {channels.map(item => <li key={item.id}>
              <Link className="app-nav-subitem" data-channel={item.id} to={item.to} aria-current={channel === item.id ? 'page' : undefined}>
                <i aria-hidden="true" />{item.label}
              </Link>
            </li>)}
          </ul>}
        </li>;
      })}
    </ul>
    {user && <Link className="app-nav-user" to="/me" aria-label="我的账号">
      <span className="app-nav-avatar" aria-hidden="true">{Array.from(name)[0]}</span>
      <span className="app-nav-user-text"><strong>{name}</strong><small>{host(runtime.api.baseUrl)}</small></span>
    </Link>}
  </nav>;
}

function host(baseUrl: string): string { try { return new URL(baseUrl).host; } catch { return baseUrl; } }
