import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useRuntime } from './providers/runtime-context.tsx';
import { LoginPage } from '../features/auth/pages/LoginPage.tsx';
import { MediaChannelEntry } from '../features/media/components/channel-navigation.tsx';
import { MediaThemeController } from '../features/media/services/theme.ts';
import { FloatingNotice } from '../ui/floating-notice.tsx';

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
  // Reading-adjacent pages own their header and discovery actions. The migrated
  // shell used to inject a second, generic navigation bar above every page, which
  // changed the vertical rhythm and made shelf/library diverge from the legacy UI.
  // Media keeps its own channel navigation through MediaLayout.
  return <Outlet />;
}

export function AuthBoundary({ children }: { children?: ReactNode }) {
  const session = useAuthStore(state => state.session);
  if (!session) return <LoginPage />;
  return <>{children}</>;
}

export function MediaLayout() {
  const runtime = useRuntime();
  const location = useLocation();
  const current = location.pathname.startsWith('/media/music')
    ? 'music'
    : location.pathname.startsWith('/media/audiobook')
      ? 'audiobook'
      : 'video';
  // The legacy media shell applies its own palette while any media route is
  // mounted. Keep this scoped to MediaLayout so reading pages continue to use
  // the reader palette, and let React CSS consume the injected theme tokens.
  useEffect(() => {
    const theme = new MediaThemeController(runtime.mediaApi.preferenceScope(), () => undefined);
    return () => theme.dispose();
  }, [runtime]);
  // Keep the channel rail after the page content in the DOM, matching the legacy
  // shell. Its presentation stylesheet may pin it to the viewport, while the
  // route-owned page remains the first and primary content surface.
  return <><Outlet /><MediaChannelEntry current={current} /></>;
}

export function HomeRedirect() { return <Navigate to="/media/video" replace />; }

export function LoadingPage() { return <FloatingNotice message="正在加载…" busy />; }



