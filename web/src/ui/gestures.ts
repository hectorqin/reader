/**
 * Touch handling, isolated from the view so it can be reasoned about alone.
 *
 * The rules that matter on a phone, and why:
 *
 *  - A tap in the middle third toggles the chrome; taps in the outer thirds turn
 *    the page. This is the convention every mobile reader uses, and violating it
 *    is immediately noticeable.
 *  - A swipe must be mostly horizontal to count. A diagonal drag is almost
 *    always an attempt to scroll, and treating it as a page turn makes a
 *    reflowable book feel like it is fighting back.
 *  - Distinguishing a tap from a drag cannot use `click`: on a scrollable page
 *    the browser fires `click` after a drag that ended on a link. The gesture
 *    layer tracks movement itself and suppresses the click.
 *  - Pinch-to-zoom is deliberately not implemented. Text size belongs to the
 *    reader's own control, and a visual zoom fights CSS pagination.
 */

export interface GestureHandlers {
  onTapZone(zone: 'previous' | 'toggle-chrome' | 'next'): void;
  onSwipe(direction: 'left' | 'right' | 'up' | 'down'): void;
  /** Fires continuously while a finger is down and moving, for scroll mode. */
  onDragDelta(deltaX: number, deltaY: number): void;
  onLongPress(x: number, y: number): void;
  /** True when a text selection is active: gestures must then stand aside. */
  hasSelection(): boolean;
}

const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION = 260;
const SWIPE_MIN_DISTANCE = 48;
const SWIPE_MAX_OFF_AXIS = 0.8;
const LONG_PRESS_MS = 500;

export function attachGestures(element: HTMLElement, handlers: GestureHandlers): () => void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;

  const clearLongPress = (): void => {
    if (longPressTimer === null) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (handlers.hasSelection()) return;
    tracking = true;
    suppressClick = false;
    startX = event.clientX;
    startY = event.clientY;
    startTime = Date.now();
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      // A long press is the reader asking to select text, so gestures must not
      // turn it into a page turn when the finger lifts.
      suppressClick = true;
      handlers.onLongPress(event.clientX, event.clientY);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!tracking) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.hypot(deltaX, deltaY) > TAP_MAX_DISTANCE) clearLongPress();
    handlers.onDragDelta(deltaX, deltaY);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!tracking) return;
    tracking = false;
    clearLongPress();
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const duration = Date.now() - startTime;
    const distance = Math.hypot(deltaX, deltaY);

    if (suppressClick || handlers.hasSelection()) return;

    const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_MAX_OFF_AXIS;
    if (distance >= SWIPE_MIN_DISTANCE && duration < 800) {
      suppressClick = true;
      if (horizontal) handlers.onSwipe(deltaX < 0 ? 'left' : 'right');
      else handlers.onSwipe(deltaY < 0 ? 'up' : 'down');
      return;
    }

    if (distance <= TAP_MAX_DISTANCE && duration <= TAP_MAX_DURATION) {
      suppressClick = true;
      const third = element.clientWidth / 3;
      const x = event.clientX - element.getBoundingClientRect().left;
      if (x < third) handlers.onTapZone('previous');
      else if (x > third * 2) handlers.onTapZone('next');
      else handlers.onTapZone('toggle-chrome');
    }
  };

  const onPointerCancel = (): void => {
    tracking = false;
    clearLongPress();
  };

  const onClickCapture = (event: MouseEvent): void => {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('click', onClickCapture, true);

  return () => {
    clearLongPress();
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('click', onClickCapture, true);
  };
}
