import { useLayoutEffect, useRef } from './vendor/preact.ts';
import { dismissNotice, notify, type NoticeKind } from './notifications.ts';

/** Renderless bridge for state-driven screens; all messages use the global host. */
export function FloatingNotice({ message, busy = false, error = false, kind, duration }: {
  message: string; busy?: boolean; error?: boolean; kind?: NoticeKind; duration?: number;
}) {
  const id = useRef(Symbol('screen-notice'));
  useLayoutEffect(() => {
    notify(message, { kind: busy ? 'loading' : error ? 'error' : kind ?? 'info', ...(duration !== undefined ? { duration } : {}) }, id.current);
  }, [message, busy, error, kind, duration]);
  useLayoutEffect(() => () => dismissNotice(id.current), []);
  return null;
}
