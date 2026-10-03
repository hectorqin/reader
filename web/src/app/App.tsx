import { useEffect, type ReactNode } from 'react';
import { Center, Loader } from '@mantine/core';
import { Navigate, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useRuntime } from './providers/runtime-context.tsx';
import { LoginPage } from '../features/auth/pages/LoginPage.tsx';
import { MiniPlayer } from '../features/media/components/MiniPlayer.tsx';

export function AppShell() {
  return <AuthBoundary><AuthenticatedShell /></AuthBoundary>;
}

function AuthenticatedShell() {
  const runtime = useRuntime();
  const user = useAuthStore(state => state.verifiedUser);
  const location = useLocation();
  const navigate = useNavigate();
  const reading = location.pathname.startsWith('/book/');
  const media = location.pathname.startsWith('/media');
  useEffect(() => {
    const openControls = () => {
      const state = runtime.playback.snapshot();
      navigate(`/media/${state.channel}/player?item=${encodeURIComponent(state.itemId)}&part=${encodeURIComponent(state.partId)}`);
    };
    runtime.player.addEventListener('open-controls', openControls);
    return () => runtime.player.removeEventListener('open-controls', openControls);
  }, [runtime, navigate]);
  useEffect(() => runtime.player.setVisible(location.pathname.startsWith('/media/')), [runtime, location.pathname]);
  return <>
    {!reading && !media && <header className="app-global-nav" aria-label="主导航">
      <Link to="/shelf">书架</Link><Link to="/library">书库</Link><Link to="/sources">书源</Link><Link to="/media/video">影音</Link><Link to="/settings">设置</Link>
      <span style={{ marginInlineStart: 'auto' }}>{user?.displayName || user?.username || ''}</span>
      <button type="button" onClick={() => void runtime.api.signOut()}>退出登录</button>
    </header>}
    <Outlet /><MiniPlayer />
  </>;
}

export function AuthBoundary({ children }: { children?: ReactNode }) {
  const session = useAuthStore(state => state.session);
  if (!session) return <LoginPage />;
  return <>{children}</>;
}

export function MediaLayout() {
  const location = useLocation();
  const current = location.pathname.startsWith('/media/music')
    ? 'music'
    : location.pathname.startsWith('/media/audiobook')
      ? 'audiobook'
      : 'video';
  return <>
    <nav className="media-channel-entry" aria-label="主导航">
      <span className="media-brand" aria-hidden="true">reader.</span>
      <Link to="/shelf">阅读</Link>
      <Link to="/media/video" aria-current={current === 'video' ? 'page' : undefined}>影视</Link>
      <Link to="/media/music" aria-current={current === 'music' ? 'page' : undefined}>音乐</Link>
      <Link to="/media/audiobook" aria-current={current === 'audiobook' ? 'page' : undefined}>有声书</Link>
    </nav>
    <Outlet />
  </>;
}

export function HomeRedirect() { return <Navigate to="/media/video" replace />; }

export function LoadingPage() { return <Center mih="50vh"><Loader /></Center>; }



