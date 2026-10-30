import { useEffect, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useRuntime } from './providers/runtime-context.tsx';
import { LoginPage } from '../features/auth/pages/LoginPage.tsx';
import { AppNav, navMode } from './AppNav.tsx';
import { ThemeController } from '../shared/theme/theme.ts';

export function AppShell() {
  return <AuthBoundary><AuthenticatedShell /></AuthBoundary>;
}

function AuthenticatedShell() {
  const runtime = useRuntime();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const openControls = () => {
      const state = runtime.playback.snapshot();
      navigate(`/media/${state.channel}/player?item=${encodeURIComponent(state.itemId)}&part=${encodeURIComponent(state.partId)}`);
    };
    runtime.player.addEventListener('open-controls', openControls);
    return () => runtime.player.removeEventListener('open-controls', openControls);
  }, [runtime, navigate]);
  useEffect(() => runtime.player.setVisible(location.pathname.startsWith('/media/')), [runtime, location.pathname]);
  const mode = navMode(location.pathname);
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
export function MediaLayout() { return <Outlet />; }

