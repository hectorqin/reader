import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { useLayoutEffect, useRef } from 'react';
import { placeNotifications } from './notifications.ts';
import '../styles/confirmation.css';

/** SweetAlert lives in its own top-layer host, including over an existing modal. */
export function FloatingConfirm({title='确认操作',text,confirmText='确认操作',cancelText='取消操作',onConfirm,onCancel,theme}: {
  title?: string; text: string; confirmText?: string; cancelText?: string;
  onConfirm(): void; onCancel(): void; theme?: 'media';
}) {
  const callbacks = useRef({ onConfirm, onCancel });
  callbacks.current = { onConfirm, onCancel };
  useLayoutEffect(() => {
    let active = true;
    const previous = document.activeElement;
    const host = document.createElement('dialog');
    host.className = 'confirmation-host';
    host.setAttribute('aria-label', title);
    if (theme === 'media') host.dataset.mediaTheme = 'true';
    document.body.append(host);
    host.showModal();
    const cancel = (event: Event) => { event.preventDefault(); Swal.close(); };
    host.addEventListener('cancel', cancel);
    const cleanup = () => {
      host.removeEventListener('cancel', cancel);
      host.close();
      host.remove();
      placeNotifications();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
    void Swal.fire({ target: host, titleText: title, text, icon: 'warning', showCancelButton: true,
      confirmButtonText: confirmText, cancelButtonText: cancelText, focusCancel: true,
      returnFocus: false, heightAuto: false, scrollbarPadding: false, animation: false,
      customClass: { popup: theme === 'media' ? 'reader-confirm-popup media-confirm-popup' : 'reader-confirm-popup', confirmButton: 'button primary', cancelButton: 'button' },
      buttonsStyling: false,
    }).then(result => {
      if (!active) return;
      active = false;
      cleanup();
      if (result.isConfirmed) callbacks.current.onConfirm(); else callbacks.current.onCancel();
    });
    return () => {
      if (!active) return;
      active = false;
      Swal.close();
      cleanup();
    };
  }, []);
  // SweetAlert renders outside the feature root. Keep a hidden announcement in
  // the React tree so tests and assistive technology can observe the reason.
  const hiddenStyle = { position: 'absolute' as const, width: 1, height: 1, overflow: 'hidden' as const, clipPath: 'inset(50%)' };
  return <span role="alert" style={hiddenStyle}>
    {text}
    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => callbacks.current.onConfirm()}>{confirmText}</button>
    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => callbacks.current.onCancel()}>{cancelText}</button>
  </span>;
}
