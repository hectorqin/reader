import { useLayoutEffect, useState } from './vendor/preact.ts';
import { IconButton } from './toolkit.tsx';

/** Transient feedback stays out of document flow; ongoing operations remain visible. */
export function FloatingNotice({ message, busy = false }: { message: string; busy?: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  useLayoutEffect(() => {
    setDismissed(false);
    if (busy) return;
    const timer = setTimeout(() => setDismissed(true), Math.min(12_000, Math.max(6000, message.length * 100)));
    return () => clearTimeout(timer);
  }, [message, busy]);
  if (!message || dismissed) return null;
  return <div className="app-toast floating-notice" data-shown="true">
    <span role="status" aria-live="polite" aria-atomic="true">{message}</span>
    {!busy && <IconButton label="关闭提示" icon="xmark" onClick={() => setDismissed(true)} />}
  </div>;
}
