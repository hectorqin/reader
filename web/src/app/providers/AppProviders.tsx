import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AppRuntime } from '../runtime.ts';
import { RuntimeContext } from './runtime-context.tsx';
import { useMediaEnabled } from '../../shared/stores/features.ts';
import { CompanionLayer } from '../../features/reader/companion/CompanionLayer.tsx';

export function AppProviders({ runtime, children }: { runtime: AppRuntime; children: ReactNode }) {
  const media=useMediaEnabled();
  useEffect(() => {
    if(!media)return;
    const host = runtime.player.element;
    document.body.append(host);
    runtime.playback.start();
    return () => { runtime.playback.stop(); host.remove(); };
  }, [runtime,media]);
  useEffect(() => runtime.connect(), [runtime]);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') void runtime.flush();
      else void runtime.api.renewSessionIfNeeded().catch(() => undefined);
    };
    const flush = () => { void runtime.flush(); };
    const online = () => { void runtime.api.renewSessionIfNeeded().catch(() => undefined); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', online);
    };
  }, [runtime]);
  return <RuntimeContext value={runtime}>
    <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    {/* 小窗阅读 lives above the router, not inside a route: changing pages must not
        take the second reading view down with the page it was opened from. */}
    <CompanionLayer />
  </RuntimeContext>;
}
