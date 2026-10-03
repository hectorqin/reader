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
    {!reading && <header className="app-global-nav" aria-label="主导航">
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
  return <>
    <nav className="media-app-nav" aria-label="影音导航">
      <Link to="/media/video">影视</Link><Link to="/media/music">音乐</Link><Link to="/media/audiobook">有声书</Link>
      <Link to="/media/search">搜索</Link><Link to="/media/favorites">收藏</Link><Link to="/media/video/history">历史</Link>
    </nav>
    <Outlet />
  </>;
}

export function HomeRedirect() { return <Navigate to="/media/video" replace />; }

export function LoadingPage() { return <Center mih="50vh"><Loader /></Center>; }



