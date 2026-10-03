import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { IconButton } from './toolkit.tsx';
import { placeNotifications } from './notifications.ts';

/** Native modal supplies focus containment and makes the background inert. */
export function Modal({ title, busy, onClose, children, className }: {
  title: string; busy: boolean; onClose(): void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    placeNotifications();
    return () => {
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
      placeNotifications();
      queueMicrotask(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={ref} className={['source-modal', className].filter(Boolean).join(' ')} aria-label={title} aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const dialog = event.currentTarget;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="source-modal-header"><h2>{title}</h2><IconButton icon="xmark" label="关闭弹窗" disabled={busy} onClick={onClose} /></header>
    {children}
  </dialog>;
}
