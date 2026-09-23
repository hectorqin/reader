import { Notyf, NotyfEvent, type NotyfNotification } from 'notyf';
import 'notyf/notyf.min.css';
import '../styles/notifications.css';

export type NoticeKind = 'info' | 'success' | 'error' | 'loading';
export interface NoticeOptions { kind?: NoticeKind; duration?: number }
interface ActiveNotice { notification: NotyfNotification; node: HTMLElement; message: string; kind: NoticeKind }
const active = new Map<symbol, ActiveNotice>();
let library: Notyf | undefined;
let container: HTMLElement | undefined;
let announcer: HTMLElement | undefined;

function service(): Notyf {
  if (!library) {
    library = new Notyf({ position: { x: 'center', y: 'bottom' }, ripple: false, dismissible: true,
      types: ['info', 'success', 'error', 'loading'].map(type => ({ type, icon: false, background: 'var(--reader-surface)', className: 'global-notice' })),
    });
    container = document.querySelector<HTMLElement>('.notyf')!;
    announcer = document.querySelector<HTMLElement>('.notyf-announcer')!;
    container.setAttribute('aria-label', '全局消息提示');
    // Each visible message supplies the appropriate status/alert semantics.
    announcer.setAttribute('aria-live', 'off');
    announcer.setAttribute('aria-hidden', 'true');
  }
  placeNotifications();
  return library;
}

/** The one global host follows native dialogs into the top layer. */
export function placeNotifications(): void {
  if (!container) return;
  const target = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) ?? document.body;
  if (container.parentElement !== target) target.append(container);
  if (announcer && announcer.parentElement !== target) target.append(announcer);
}

export function dismissNotice(id: symbol): void {
  const current = active.get(id);
  if (!current) return;
  active.delete(id);
  library?.dismiss(current.notification);
  // Replacement and screen disposal should not leave overlapping exit cards.
  current.node.dispatchEvent(new Event('animationend'));
  current.node.dispatchEvent(new Event('webkitAnimationEnd'));
}

/** Plain text only: Notyf accepts HTML, whereas server/plugin messages are untrusted. */
export function notify(message: string, options: NoticeOptions = {}, id = Symbol('notice')): symbol {
  if (!message) { dismissNotice(id); return id; }
  const notyf = service(), kind = options.kind ?? 'info';
  for (const [key, notice] of active) {
    if (!notice.node.isConnected || notice.node.classList.contains('notyf__toast--disappear')) dismissNotice(key);
  }
  const current = active.get(id);
  if (current?.kind === kind && current.message === message) return id;
  if (current?.kind === 'loading' && kind === 'loading') {
    current.message = message;
    current.node.querySelector('.notyf__message')!.textContent = message;
    return id;
  }
  dismissNotice(id);
  if (active.size >= 3) dismissNotice(active.keys().next().value!);
  const escaped = document.createElement('span'); escaped.textContent = message;
  const notification = notyf.open({ type: kind, message: escaped.innerHTML, dismissible: kind !== 'loading',
    duration: kind === 'loading' ? 0 : options.duration ?? Math.min(12_000, Math.max(6000, message.length * 100)),
  });
  const node = container!.lastElementChild as HTMLElement;
  node.dataset.kind = kind;
  const content = node.querySelector<HTMLElement>('.notyf__message')!;
  content.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  content.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  content.setAttribute('aria-atomic', 'true');
  const close = node.querySelector('button');
  if (close) { close.type = 'button'; close.setAttribute('aria-label', '关闭提示'); }
  active.set(id, { notification, node, message, kind });
  notification.on(NotyfEvent.Dismiss, () => dismissNotice(id));
  return id;
}

export function dismissAllNotices(): void {
  for (const id of active.keys()) dismissNotice(id);
}
