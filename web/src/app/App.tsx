import { useEffect, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useRuntime } from './providers/runtime-context.tsx';
import { LoginPage } from '../features/auth/pages/LoginPage.tsx';
import { AppNav, navMode } from './AppNav.tsx';
import { playerPath } from '../features/media/stores/playback.store.ts';
import { ThemeController } from '../shared/theme/theme.ts';
import { useMediaEnabled } from '../shared/stores/features.ts';

export function AppShell() {
  return <AuthBoundary><AuthenticatedShell /></AuthBoundary>;
}

function AuthenticatedShell() {
  const runtime = useRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  const media=useMediaEnabled();
  useEffect(() => {
    if(!media)return;
    const openControls = () => {
      navigate(playerPath(runtime.playback.snapshot()));
    };
    runtime.player.addEventListener('open-controls', openControls);
    return () => runtime.player.removeEventListener('open-controls', openControls);
  }, [runtime, navigate,media]);
  useEffect(() => {if(media)runtime.player.setVisible(location.pathname.startsWith('/media/'));}, [runtime, location.pathname,media]);
  const mode = !media&&location.pathname.startsWith('/media')?'push':navMode(location.pathname);
  // One app theme for every page; the reader may wear its own reading theme on top.
  useEffect(() => {
    const theme = new ThemeController(runtime.mediaApi.preferenceScope());
    return () => theme.dispose();
  }, [runtime]);
  useEffect(() => {
    if (mode === 'hidden') delete document.body.dataset.appNav; else document.body.dataset.appNav = mode;
    return () => { delete document.body.dataset.appNav; };
  }, [mode]);
  return <div className="app-shell">
    <div className="app-shell-body"><Outlet /></div>
    {mode !== 'hidden' && <AppNav mode={mode} />}
  </div>;
}

export function AuthBoundary({ children }: { children?: ReactNode }) {
  const session = useAuthStore(state => state.session);
  if (!session) return <LoginPage />;
  return <>{children}</>;
}

/** Media routes: the page itself. Theme and navigation belong to AuthenticatedShell. */
export function MediaLayout() {
  const enabled=useMediaEnabled();
  if(!enabled)return <section className="media-screen media-page" role="status"><h1>影音模块未启用</h1><p>请联系管理员检查全站开关及你的影音权限。</p><Link to="/">返回首页</Link></section>;
  return <Outlet />;
}
