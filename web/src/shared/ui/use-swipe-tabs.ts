import { useCallback, useEffect, useRef } from 'react';

/**
 * Swipe left/right over a page to move to the neighbouring tab.
 *
 * Touch only: a mouse drag on a page is a text selection, and desktop has the
 * tabs in plain sight. The element gets `touch-action: pan-y` (`.swipe-tabs` in
 * app.css), so vertical scrolling stays the browser's and a horizontal move is
 * left to this hook instead of being claimed as the browser's back gesture.
 *
 * A touch is not a swipe when it starts on something that owns horizontal
 * movement itself — a form control, a range thumb, a row that scrolls sideways —
 * or while text is selected. Anything the browser turns into a vertical scroll
 * arrives as pointercancel and is dropped, so a slightly diagonal scroll down a
 * long list does not switch tabs.
 */
export type SwipeDirection = 'next' | 'previous';

const MIN_DISTANCE = 60;
/** How much more horizontal than vertical a swipe has to be. */
const MIN_RATIO = 1.8;
const MAX_DURATION = 700;
const OWNERS = 'input,select,textarea,[contenteditable="true"],[role="slider"],[data-no-swipe]';

function ownsHorizontal(path: EventTarget[], root: HTMLElement): boolean {
  for (const node of path) {
    if (node === root) return false;
    if (!(node instanceof HTMLElement)) continue;
    if (node.matches(OWNERS)) return true;
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

function hasSelection(): boolean {
  const selection = document.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== '';
}

/**
 * Marks the swipe that is about to change the page, so the entering content can
 * slide in from the side the finger came from (see `[data-swipe]` in app.css).
 */
function markSwipe(direction: SwipeDirection): void {
  const root = document.documentElement;
  root.dataset['swipe'] = direction;
  window.setTimeout(() => { if (root.dataset['swipe'] === direction) delete root.dataset['swipe']; }, 260);
}

/**
 * Returns a ref for the swipe surface. `onSwipe` is called with `next` for a swipe
 * to the left (the content moves the way the finger does) and `previous` for one
 * to the right; return false when there is no tab that way, so nothing animates.
 */
export function useSwipeTabs<T extends HTMLElement>(onSwipe: ((direction: SwipeDirection) => boolean) | null) {
  const handler = useRef(onSwipe);
  useEffect(() => { handler.current = onSwipe; }, [onSwipe]);
  const detach = useRef<(() => void) | null>(null);
  // Only a page that swipes gives up horizontal panning (and pinch zoom with it).
  const enabled = onSwipe !== null;

  return useCallback((element: T | null) => {
    detach.current?.();
    detach.current = null;
    if (!element || !enabled) return;
    element.classList.add('swipe-tabs');
    let start: { x: number; y: number; time: number; id: number } | null = null;
    let suppressClick = false;

    const down = (event: PointerEvent) => {
      start = null;
      if (event.pointerType !== 'touch' || !event.isPrimary || !handler.current) return;
      if (ownsHorizontal(event.composedPath(), element) || hasSelection()) return;
      start = { x: event.clientX, y: event.clientY, time: Date.now(), id: event.pointerId };
    };
    const up = (event: PointerEvent) => {
      const began = start;
      start = null;
      if (!began || began.id !== event.pointerId || !handler.current) return;
      const dx = event.clientX - began.x, dy = event.clientY - began.y;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * MIN_RATIO) return;
      if (Date.now() - began.time > MAX_DURATION || hasSelection()) return;
      const direction: SwipeDirection = dx < 0 ? 'next' : 'previous';
      // The finger lifted over a card or a link; the swipe was not a tap on it.
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 400);
      if (handler.current(direction)) markSwipe(direction);
    };
    const cancel = () => { start = null; };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('click', click, true);
    detach.current = () => {
      element.classList.remove('swipe-tabs');
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('click', click, true);
    };
  }, [enabled]);
}
