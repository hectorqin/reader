import { Button } from '../../../ui/toolkit.tsx';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../../api/errors.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { ReaderScreen } from '../../../ui/reader-screen.tsx';
import type { Book } from '../../../api/types.ts';

export function ReaderPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { bookId = '' } = useParams();
  const location = useLocation();
  // A deep link or a cold PWA start has no entry to go back to: 返回 goes to the shelf instead of leaving the app.
  const firstEntry = location.key === 'default';
  const back = useRef<() => void>(() => undefined);
  back.current = () => { if (firstEntry) navigate('/shelf', { replace: true }); else navigate(-1); };
  const host = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    setBook(null); setError(null);
    const id = decodeURIComponent(bookId);
    void runtime.api.getBook(id).then(result => { if (live) setBook(result.book); }).catch(reason => {
      if (!live) return;
      // Offline, a book downloaded for offline reading still opens from its mirrored record;
      // the reader then reads its bytes from the local cache.
      const mirrored = reason instanceof ApiError && reason.isConnectivity ? runtime.offline.books().find(item => item.id === id) : undefined;
      if (mirrored) setBook(mirrored); else setError(reason);
    });
    return () => { live = false; };
  }, [runtime, bookId]);
  useEffect(() => {
    if (!host.current || !book) return;
    const screen = new ReaderScreen({
      api: runtime.api,
      offline: runtime.offline,
      sync: runtime.sync,
      platform: runtime.platform,
      themeScope: runtime.mediaApi.preferenceScope(),
      settings: runtime.settings.current,
      ...(runtime.pageHost ? { pageHost: runtime.pageHost } : {}),
      ...(runtime.speechBridge ? { speechBridge: runtime.speechBridge } : {}),
      onBack: () => back.current(),
      onSettingsChange: patch => { void runtime.updateSettings(patch); },
      onSignedOut: () => { void runtime.api.signOut(); },
    });
    host.current.replaceChildren(screen.element);
    // Register the reader's own persistence hook. Calling runtime.flush() here
    // would recurse through runtime.registerReader while the app is flushing.
    const unregister = runtime.registerReader(book, () => screen.flushProgress());
    void screen.open(book);
    return () => {
      unregister();
      const saved = screen.flushProgress();
      screen.dispose();
      host.current?.replaceChildren();
      // Leaving the reader is when 首页's 继续阅读 and the shelf's 最近阅读 are looked at
      // next. Push the position now rather than after the sync debounce, then re-read
      // both instead of showing the cached answer for up to a minute (#663).
      void saved.catch(() => undefined)
        .then(() => runtime.offline.flush()).then(() => runtime.sync.flush()).catch(() => undefined)
        .finally(() => {
          void runtime.queryClient.invalidateQueries({ queryKey: ['home'] });
          void runtime.queryClient.invalidateQueries({ queryKey: ['shelf'] });
        });
    };
  }, [runtime, book, navigate]);
  if (error) return <div className="page-state" role="alert"><h2>无法打开这本书</h2><p>{error instanceof Error ? error.message : '请求失败'}</p><Button onClick={() => back.current()}>返回</Button></div>;
  if (!book) return <div className="page-state" role="status"><div className="spinner" aria-hidden="true" /><p>正在打开书籍…</p></div>;
  return <div ref={host} className="reader-route-host" />;
}


