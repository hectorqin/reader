import { type ComponentChildren, useLayoutEffect, useRef } from './vendor/preact.ts';
import { IconButton } from './toolkit.tsx';

/** Native modal supplies focus containment and makes the background inert. */
export function Modal({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose(): void; children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      queueMicrotask(() => { if (previous?.isConnected) previous.focus({ preventScroll: true }); });
    };
  }, []);
  return <dialog ref={ref} className="source-modal" aria-label={title} aria-busy={busy}
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
