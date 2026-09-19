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
 *
 * ## One gesture belongs to one target, and the innermost one wins
 *
 * This layer sits on the *stage* — the whole reading surface — so it sees every
 * touch, including the ones aimed at things drawn on top of it. Turning all of
 * them into page turns is what made a tap on a footnote open the footnote *and*
 * turn the page behind it, and it is the reason this file has a hit test at all.
 *
 * The test is `composedPath()` rather than `event.target`, because the book lives
 * in a shadow root and a shadow boundary *retargets* the event: a tap on a `<p>`
 * inside the book arrives at this listener with the shadow host as its target, so
 * a check written against `target` cannot tell a paragraph from a button inside
 * the same shadow tree. The composed path is the whole chain — the real element
 * first, then its ancestors, across every shadow boundary — which is the only
 * view from which "what did the reader actually touch" has an answer.
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

/**
 * Elements that own a gesture outright.
 *
 * An interactive control the reader touched is the thing they meant, and the layer
 * must not reinterpret the touch as a page turn: a link is a footnote or a
 * cross-reference, a button is a control, an input is a control that also *drags*
 * (a range thumb is how the read-aloud scrubber is used, and turning the page on
 * every scrub would make it unusable).
 *
 * `label` and `summary` are in the list because they are controls too; `[role]`
 * covers the panel's composite widgets; `contenteditable` covers a text field the
 * book brought with it.
 */
const INTERACTIVE = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="slider"]',
  '[role="link"]',
  '[contenteditable="true"]',
].join(',');

/**
 * Whether the touch landed on something that owns it.
 *
 * The path is walked innermost-first and the first element that is either
 * interactive or a *nested* scroller decides. Reaching the stage means nothing was
 * in the way, which is the case where a tap is a page turn.
 */
function ownsGesture(path: EventTarget[], stage: HTMLElement, skipScrollable: ReadonlySet<Element>): boolean {
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node === stage) return false;
    // `matches` on the element itself, not `closest`: `closest` would walk up out
    // of the element's own tree and find an ancestor control in a *different*
    // subtree, which would make a tap on a paragraph inside a link-styled section
    // behave like a tap on the link.
    if (node.matches(INTERACTIVE)) return true;
    // Any *nested* scrollable area also owns the touch — a horizontally scrollable
    // table inside a chapter, an embedded overflow box. Hijacking those is how a
    // reader loses the ability to pan them.
    //
    // "Nested" is the load-bearing word. The reading surface itself is a scroll
    // container (that is what scroll mode *is*), and it sits on the path between
    // the book's markup and the stage, so a rule that asked only "is it scrollable"
    // made the reading surface claim every gesture it received. Every tap then
    // belonged to a scroller and turned no pages — the layers below were correct and
    // unreachable, which is the hardest kind of layering bug to see from the code.
    if (node instanceof HTMLElement && !skipScrollable.has(node) && isScrollable(node)) return true;
  }
  return false;
}

/** True when an element scrolls its own content on either axis. */
function isScrollable(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll';
  const vertical = scrolls(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  const horizontal = scrolls(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
  return vertical || horizontal;
}

/**
 * The scrollers that are not "a nested scroller".
 *
 * The reading surface, found from the stage rather than passed in: it is the shadow
 * host the reader injects the book into, and it is the *only* element between the
 * markup and the stage that is deliberately scrollable. Discovering it here keeps
 * the caller from having to know, and keeps this file's rule — "a nested scroller
 * outranks a page turn" — true for every scroller that is genuinely nested.
 */
function readingSurface(stage: HTMLElement): Element[] {
  const found: Element[] = [];
  for (const host of stage.querySelectorAll('*')) {
    if (host.shadowRoot) found.push(host);
  }
  // A host with no shadow root yet (the book is still loading) still exists as a
  // custom element; `book-content` is the tag the reader creates.
  for (const host of stage.querySelectorAll('book-content')) {
    if (!found.includes(host)) found.push(host);
  }
  return found;
}

export function attachGestures(element: HTMLElement, handlers: GestureHandlers): () => void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;
  /**
   * True while the gesture belongs to a control rather than to this layer.
   *
   * Decided once on `pointerdown` and remembered, rather than re-tested on every
   * `pointermove`: the path of a moving finger can end somewhere different from
   * where it started, and re-deciding mid-drag would let a swipe that began on a
   * control become a page turn halfway through.
   */
  let owned = false;

  const clearLongPress = (): void => {
    if (longPressTimer === null) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  // Computed once per attachment: the reading surface is created before this layer
  // is attached and does not change identity for the life of the screen.
  const skipScrollable = new Set(readingSurface(element));

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    tracking = true;
    suppressClick = false;
    startX = event.clientX;
    startY = event.clientY;
    startTime = Date.now();
    clearLongPress();

    // A selection in progress outranks everything: the reader is choosing text,
    // and any of these gestures would discard the choice they are making.
    owned = handlers.hasSelection() || ownsGesture(event.composedPath(), element, skipScrollable);
    // Deliberately *not* `suppressClick = true` here. Suppressing the click is how
    // this layer stops the browser turning a swipe into a tap on whatever link the
    // finger happened to end on — but a gesture that belonged to a control was
    // never turned into anything, so the control's own click has to arrive.
    // Setting the flag here is what made a toolbar button visible, tappable, and
    // inert: the layer ate the click it was waiting for.
    if (owned) return;

    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      // A long press is the reader asking to select text, so gestures must not
      // turn it into a page turn when the finger lifts.
      suppressClick = true;
      handlers.onLongPress(event.clientX, event.clientY);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!tracking || owned) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.hypot(deltaX, deltaY) > TAP_MAX_DISTANCE) clearLongPress();
    handlers.onDragDelta(deltaX, deltaY);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!tracking) return;
    tracking = false;
    const wasOwned = owned;
    owned = false;
    clearLongPress();
    if (wasOwned) return;

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
      // The zone is a *layout* box, so it is read from layout geometry rather than
      // from client coordinates.
      //
      // The two agree only while the page is unscaled. `getBoundingClientRect()`
      // and `event.clientX` are both in *visual viewport* units, so under a pinch
      // zoom — or any transformed ancestor — they disagree with up to half the
      // tolerance above, and a tap lands in the neighbouring zone: the reader taps
      // the middle third to hide the toolbar and turns a page instead, or taps the
      // right third to turn a page and gets nothing but a toolbar. `offsetWidth`
      // and `offsetLeft` are in the element's own untransformed pixel space, which
      // is the space the three zones are defined in.
      // Two boxes, and the reason is that they answer two different questions.
      //
      // The *content* box (`offsetWidth`) is what the three zones are a division of,
      // and `offsetWidth` is in the element's own untransformed pixel space — which
      // is the space the zones are defined in. The *border* box
      // (`getBoundingClientRect`) is where the element is on screen right now, which
      // is the space `event.clientX` is in. Dividing one by the other is exact while
      // the page is unscaled and wrong under a pinch zoom, where half a third of a
      // 390px screen is several pixels of error and the arithmetic above has already
      // accepted the tap.
      //
      // `offsetWidth` is preferred and falls back to the border box: a host with no
      // layout (jsdom, an embedded WebView before its first layout) reports zero for
      // it, and a stage with no measurable width cannot have zones — reporting a tap
      // in one would be inventing a position.
      const rect = element.getBoundingClientRect();
      const layoutWidth = element.offsetWidth;
      const width = layoutWidth > 0 ? layoutWidth : rect.width || element.clientWidth;
      if (width <= 0) return;
      // Where the tap landed, in the element's own space: on the border box's left
      // edge, less the border, less anything the element has been scrolled by.
      //
      // `rect` is in visual units and so is `clientX`, so the *difference* is a
      // visual distance; it is divided by the ratio between the two boxes to bring
      // it back into the space the zones are measured in. Without an ancestor
      // transform and without a zoom the ratio is exactly 1 and the line is a
      // no-op — which is what makes this a correction rather than a conversion.
      const scale = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
      const x = (event.clientX - rect.left - element.clientLeft * scale) / scale + element.scrollLeft;
      const third = width / 3;
      if (x < third) handlers.onTapZone('previous');
      else if (x > third * 2) handlers.onTapZone('next');
      else handlers.onTapZone('toggle-chrome');
    }
  };

  const onPointerCancel = (): void => {
    tracking = false;
    owned = false;
    clearLongPress();
  };

  const onClickCapture = (event: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    // Only a click this layer already accounted for is stopped. A click the reader
    // aimed at a control was never suppressed, so the control still receives it —
    // the `owned` branch sets `suppressClick` and returns before any gesture is
    // recognised, and this method then clears the flag on the very first click.
    event.preventDefault();
    event.stopPropagation();
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
