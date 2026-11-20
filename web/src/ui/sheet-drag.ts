/**
 * Dragging a phone bottom sheet by its grip and title bar (docs/ui.md §3.7).
 *
 * Two resting heights and one exit:
 *
 *  - pulled **down** past a third of its height, or flicked down, it closes — the
 *    same exit as ✕, so `busy` refuses it and the sheet springs back;
 *  - pulled **up** past halfway, or flicked up, a regular sheet *expands* to nearly
 *    the whole screen (`data-expanded`); pulled or flicked down from there it returns
 *    to its usual height, and closes only when pulled well below it;
 *  - a compact sheet (a confirmation, a prompt) is as tall as what it says, so it
 *    only drags down.
 *
 * The finger moves the sheet directly: the height while growing, a translate while
 * going down. Letting go animates to the chosen rest by *measuring* it — the heights
 * live in CSS (normal, reader, PWA, expanded), and the PWA sheet is pinned by its top
 * edge, so the only way to animate to "whatever CSS says" is to read the result and
 * transition the inline height to it.
 */

/** Movement before a press becomes a drag, so a tap on the title still is a tap. */
const SLOP = 6;
/** px/ms: a flick decides by direction, however short. */
const FLICK = 0.5;
/** Pulled this far below its resting height (as a share of it), it closes. */
const CLOSE_SHARE = 0.3;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SheetDragOptions {
  /** May the sheet grow (regular sheets) or only be pulled down (compact)? */
  expandable: boolean;
  /** Read at release, so a save that starts mid-drag still holds the sheet. */
  busy(): boolean;
  close(): void;
}

/** Controls a press on the handle must not steal: they keep their own taps. */
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"]';

export function startSheetDrag(event: PointerEvent, dialog: HTMLDialogElement, options: SheetDragOptions): void {
  if (!event.isPrimary || event.button !== 0) return;
  if ((event.target as Element).closest?.(INTERACTIVE)) return;
  const pointer = event.pointerId;
  const startY = event.clientY;
  const startHeight = dialog.getBoundingClientRect().height;
  const expanded = dialog.hasAttribute('data-expanded');
  // The usual height to fall back to from an expanded sheet: remembered when it grew.
  const normal = expanded ? Number(dialog.dataset.normalHeight) || startHeight : startHeight;
  const ceiling = expandedHeight(dialog);
  const samples: Array<{ y: number; t: number }> = [{ y: startY, t: event.timeStamp }];
  let dragging = false;

  const shape = (y: number) => {
    const visible = startHeight - (y - startY);
    const base = expanded ? normal : startHeight;
    // CSS caps a resting sheet's height; the finger may take it up to the expanded one.
    dialog.style.maxHeight = 'none';
    if (visible >= base) {
      // Growing: only a regular sheet, and never past the expanded height.
      const height = options.expandable ? Math.min(visible, Math.max(ceiling, base)) : base;
      dialog.style.top = 'auto';
      dialog.style.height = `${height}px`;
      dialog.style.transform = '';
    } else {
      dialog.style.top = 'auto';
      dialog.style.height = `${base}px`;
      dialog.style.transform = `translateY(${base - visible}px)`;
    }
    return { visible, base };
  };

  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointer) return;
    if (!dragging) {
      if (Math.abs(next.clientY - startY) < SLOP) return;
      dragging = true;
      dialog.setAttribute('data-dragging', '');
      try {
        dialog.setPointerCapture(pointer);
      } catch {
        /* the pointer already went away */
      }
    }
    next.preventDefault();
    samples.push({ y: next.clientY, t: next.timeStamp });
    if (samples.length > 6) samples.shift();
    shape(next.clientY);
  };

  const end = (last: PointerEvent) => {
    if (last.pointerId !== pointer) return;
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    if (!dragging) return;
    dialog.removeAttribute('data-dragging');
    // A cancelled pointer (the system took the gesture) is no decision: go back.
    const cancelled = last.type === 'pointercancel';
    const { visible, base } = shape(cancelled ? startY : last.clientY);
    const first = samples[0]!,
      recent = samples.at(-1)!;
    const velocity = recent.t > first.t ? (recent.y - first.y) / (recent.t - first.t) : 0;

    // From expanded, a flick down means "smaller", not "gone": only a real pull
    // below the usual height closes it.
    const flickCloses = !expanded && velocity > FLICK;
    if (!cancelled && visible < base && (base - visible > base * CLOSE_SHARE || flickCloses) && !options.busy()) {
      dismiss(dialog, options.close);
      return;
    }
    let grow = expanded;
    if (!cancelled && options.expandable) {
      const middle = (normal + Math.max(ceiling, normal)) / 2;
      if (velocity < -FLICK) grow = true;
      else if (velocity > FLICK) grow = false;
      else grow = visible > middle;
    }
    settle(dialog, grow, normal);
  };

  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}

/** The expanded height CSS gives this sheet, measured without showing it. */
function expandedHeight(dialog: HTMLDialogElement): number {
  const had = dialog.hasAttribute('data-expanded');
  const saved = {
    top: dialog.style.top,
    height: dialog.style.height,
    transform: dialog.style.transform,
    maxHeight: dialog.style.maxHeight,
  };
  dialog.style.top = '';
  dialog.style.height = '';
  dialog.style.transform = '';
  dialog.style.maxHeight = '';
  dialog.setAttribute('data-expanded', '');
  const height = dialog.getBoundingClientRect().height;
  if (!had) dialog.removeAttribute('data-expanded');
  Object.assign(dialog.style, saved);
  return height;
}

/** Animates from wherever the finger left it to the rest CSS gives `grow`. */
function settle(dialog: HTMLDialogElement, grow: boolean, normal: number): void {
  const from = dialog.getBoundingClientRect().height;
  const fromTransform = dialog.style.transform;
  if (grow) {
    dialog.dataset.normalHeight = String(normal);
    dialog.setAttribute('data-expanded', '');
  } else {
    delete dialog.dataset.normalHeight;
    dialog.removeAttribute('data-expanded');
  }
  reset(dialog);
  const to = dialog.getBoundingClientRect().height;
  if (reducedMotion() || (Math.abs(to - from) < 1 && !fromTransform)) return;
  // Back to the finger's position, then transition to the measured rest.
  dialog.style.top = 'auto';
  dialog.style.maxHeight = 'none';
  dialog.style.height = `${from}px`;
  dialog.style.transform = fromTransform;
  void dialog.offsetHeight;
  dialog.setAttribute('data-settling', '');
  dialog.style.height = `${to}px`;
  dialog.style.transform = '';
  finish(dialog, () => {
    dialog.removeAttribute('data-settling');
    reset(dialog);
  });
}

/** Slides the sheet out of the way, then closes it; a sheet that stays open comes back. */
function dismiss(dialog: HTMLDialogElement, close: () => void): void {
  const done = () => {
    close();
    // The caller may keep it open (it asked to confirm, say): put it back where it was.
    queueMicrotask(() => {
      if (!dialog.isConnected) return;
      dialog.removeAttribute('data-settling');
      reset(dialog);
    });
  };
  if (reducedMotion()) {
    done();
    return;
  }
  dialog.setAttribute('data-settling', '');
  dialog.style.transform = 'translateY(100%)';
  finish(dialog, done);
}

/** Hands every dimension back to CSS. */
function reset(dialog: HTMLDialogElement): void {
  dialog.style.top = '';
  dialog.style.height = '';
  dialog.style.maxHeight = '';
  dialog.style.transform = '';
}

/** Runs once the transition ends, or after its duration if no event comes (hidden tab). */
function finish(dialog: HTMLDialogElement, then: () => void): void {
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    dialog.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
    then();
  };
  const onEnd = (event: TransitionEvent) => {
    if (event.target === dialog) run();
  };
  dialog.addEventListener('transitionend', onEnd);
  const timer = setTimeout(run, 400);
}
