import { Alert, Center, Loader, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { ReaderScreen } from '../../../ui/reader-screen.tsx';
import type { Book } from '../../../api/types.ts';

export function ReaderPage() {
  const runtime = useRuntime();
  const navigate = useNavigate();
  const { bookId = '' } = useParams();
  const host = useRef<HTMLDivElement>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    setBook(null); setError(null);
    void runtime.api.getBook(decodeURIComponent(bookId)).then(result => { if (live) setBook(result.book); }).catch(reason => { if (live) setError(reason); });
    return () => { live = false; };
  }, [runtime, bookId]);
  useEffect(() => {
    if (!host.current || !book) return;
    const screen = new ReaderScreen({
      api: runtime.api,
      offline: runtime.offline,
      sync: runtime.sync,
      platform: runtime.platform,
      settings: runtime.settings.current,
      ...(runtime.pageHost ? { pageHost: runtime.pageHost } : {}),
      ...(runtime.speechBridge ? { speechBridge: runtime.speechBridge } : {}),
      onBack: () => navigate(-1),
      onSettingsChange: patch => { void runtime.updateSettings(patch); },
      onSignedOut: () => { void runtime.api.signOut(); },
    });
    host.current.replaceChildren(screen.element);
    // Register the reader's own persistence hook. Calling runtime.flush() here
    // would recurse through runtime.registerReader while the app is flushing.
    const unregister = runtime.registerReader(book, () => screen.flushProgress());
    void screen.open(book);
    return () => { unregister(); screen.dispose(); host.current?.replaceChildren(); };
  }, [runtime, book, navigate]);
  if (error) return <Center mih="60vh"><Stack align="center"><Alert color="red">无法打开这本书：{error instanceof Error ? error.message : '请求失败'}</Alert></Stack></Center>;
  if (!book) return <Center mih="60vh"><Stack align="center"><Loader /><Text>正在打开书籍…</Text></Stack></Center>;
  return <div ref={host} className="reader-route-host" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }} />;
}


