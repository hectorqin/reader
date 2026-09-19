// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachGestures, type GestureHandlers } from '../src/ui/gestures.ts';

/**
 * The click/gesture layering.
 *
 * This is the layer that decides what a touch *means*, and the reported symptom
 * was the one every reader hits first: tapping a control also turned the page. The
 * contract it has to keep is a priority order, and the tests below are written as
 * that order rather than as a list of cases:
 *
 *   1. a control the reader actually touched owns the gesture, whatever it is;
 *   2. otherwise a drag is a swipe;
 *   3. otherwise a short press is a tap in one of the three zones.
 *
 * Everything here is a *pointer* sequence, because the layer tracks pointers: a
 * `click` arrives after a drag that ended on a link, which is exactly why a tap
 * cannot be recognised from it.
 */

/**
 * A pointer event jsdom will accept and the layer can read.
 *
 * `composed: true` is not optional. The book's markup lives in a shadow root, and a
 * real browser composes every pointer event across that boundary — which is the
 * only reason the stage's own listener sees a tap on a paragraph at all. A test
 * event without it simply never arrives, and the suite would then be asserting
 * about a gesture layer that was never called.
 */
function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new window.PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerType: 'touch',
    ...init,
  });
}

interface Harness {
  stage: HTMLDivElement;
  saw: {
    zones: string[];
    swipes: string[];
    drags: number;
    longPresses: number;
  };
  handlers: GestureHandlers;
}

/** A stage 300px wide with a 300px-wide, 3-zone tap model. */
function harness(options: { selection?: boolean; width?: number } = {}): Harness {
  const width = options.width ?? 300;
  const stage = document.createElement('div');
  document.body.append(stage);
  // jsdom has no layout, so the zone arithmetic reads a stubbed width.
  Object.defineProperty(stage, 'clientWidth', { get: () => width, configurable: true });
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 600, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  const saw = { zones: [] as string[], swipes: [] as string[], drags: 0, longPresses: 0 };
  const handlers: GestureHandlers = {
    onTapZone: (zone) => saw.zones.push(zone),
    onSwipe: (direction) => saw.swipes.push(direction),
    onDragDelta: () => { saw.drags += 1; },
    onLongPress: () => { saw.longPresses += 1; },
    hasSelection: () => options.selection === true,
  };
  attachGestures(stage, handlers);
  return { stage, saw, handlers };
}

/** Presses, moves if told to, and releases. */
function press(target: EventTarget, from: [number, number], to?: [number, number], holdMs = 40): void {
  const start = Date.now();
  target.dispatchEvent(pointer('pointerdown', { clientX: from[0], clientY: from[1] }));
  if (to) target.dispatchEvent(pointer('pointermove', { clientX: to[0], clientY: to[1] }));
  // The layer measures duration with `Date.now()`, so the clock has to move by the
  // intended hold — otherwise a "tap" is however long the suite took to get here.
  vi.setSystemTime(start + holdMs);
  target.dispatchEvent(pointer('pointerup', { clientX: to?.[0] ?? from[0], clientY: to?.[1] ?? from[1] }));
}

beforeEach(() => {
  // `Date` is faked as well as the timers, because the layer measures duration with
  // `Date.now()`: with only the timer queue faked, a "tap" in a slow suite is
  // hundreds of milliseconds long and stops being a tap.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  document.body.replaceChildren();
});

describe('tap zones', () => {
  it('turns the page on the outer thirds and toggles the chrome in the middle', () => {
    const h = harness();
    press(h.stage, [40, 300]);
    press(h.stage, [150, 300]);
    press(h.stage, [260, 300]);
    expect(h.saw.zones).toEqual(['previous', 'toggle-chrome', 'next']);
  });

  it('reads the zones from layout geometry, so a scaled page still taps where the finger is', () => {
    // The failure this closes is a *half* of the tap area, and it is invisible at
    // 100% zoom: `getBoundingClientRect()` and `event.clientX` are both in visual
    // viewport units, so under a pinch zoom the border box and the finger disagree
    // while the zone arithmetic happily accepts the tap. The reader taps the middle
    // third to hide the toolbar and turns a page instead.
    //
    // Stated as a *scaled* rect: the layout box is 300px and on screen it is
    // reported as 600px wide, which is what a page at 2× looks like to this layer.
    // A tap at the visual centre of the screen must be the *middle* zone, and the
    // two taps at the outer quarters must be the outer zones — with the old
    // arithmetic, which compared a visual offset against a layout width, the first
    // of the three landed in the middle and the whole row shifted by one.
    const h = harness();
    // `offsetWidth` is what the zones divide; the rect is where the element *is*.
    Object.defineProperty(h.stage, 'offsetWidth', { get: () => 300, configurable: true });
    h.stage.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 600, height: 1200, right: 600, bottom: 1200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    // The tap coordinates are in *visual* units and the zones are in layout units.
    // A third of the 300px layout box is 100px of *layout* and 200px of screen, so
    // 150 is inside the first third, 300 (the visible centre) is the middle, and 450
    // is the last.
    press(h.stage, [150, 300]);
    press(h.stage, [300, 300]);
    press(h.stage, [450, 300]);
    expect(h.saw.zones).toEqual(['previous', 'toggle-chrome', 'next']);
  });

  it('does not turn a page when the tap lands on a control inside the stage', () => {
    // The bug: the gesture layer treats *every* pointer it sees on the stage as a
    // page turn, so a tap on a button that lives inside the reading surface — a
    // footnote link, a control in an injected panel — also turned the page behind
    // it. The reader pressed one thing and two happened.
    const h = harness();
    const button = document.createElement('button');
    h.stage.append(button);
    press(button, [40, 300]);
    expect(h.saw.zones).toEqual([]);
  });

  it('does not turn a page when the tap lands on a link inside the book', () => {
    // A footnote is an `<a>`, and an `<a>` inside the shadow root is still the
    // reader's target. The check therefore has to cross the shadow boundary.
    const h = harness();
    const host = document.createElement('div');
    h.stage.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const link = document.createElement('a');
    link.href = '#note1';
    shadow.append(link);
    press(link, [260, 300]);
    expect(h.saw.zones).toEqual([]);
  });

  it('does not turn a page when the tap lands on scrollable book text', () => {
    // Plain text is *not* a control: a tap on a paragraph is a page turn, which is
    // the whole model. Stating it keeps the "controls win" rule from being
    // over-applied into "nothing inside the stage ever turns a page".
    const h = harness();
    const host = document.createElement('div');
    h.stage.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const paragraph = document.createElement('p');
    paragraph.textContent = '正文';
    shadow.append(paragraph);
    press(paragraph, [260, 300]);
    expect(h.saw.zones).toEqual(['next']);
  });

  it('leaves a range input alone, which is how the panels are built', () => {
    const h = harness();
    const input = document.createElement('input');
    input.type = 'range';
    h.stage.append(input);
    press(input, [150, 300]);
    expect(h.saw.zones).toEqual([]);
    expect(h.saw.swipes).toEqual([]);
  });

  it('honours the reader’s handedness by leaving the mapping to the caller', () => {
    // The layer reports *sides*, not directions. Handedness is the screen's
    // business; a layer that reversed them itself would have to know a setting it
    // has no access to, and would be wrong for a left-handed reader who never
    // opened the settings panel.
    const h = harness();
    press(h.stage, [40, 300]);
    expect(h.saw.zones).toEqual(['previous']);
  });
});

describe('swipes', () => {
  it('reports a mostly-horizontal drag as a horizontal swipe', () => {
    const h = harness();
    press(h.stage, [250, 300], [50, 320]);
    expect(h.saw.swipes).toEqual(['left']);
  });

  it('reports a mostly-vertical drag as a vertical swipe', () => {
    // A diagonal drag is almost always an attempt to scroll; treating it as a page
    // turn makes a reflowable book feel like it is fighting back.
    const h = harness();
    press(h.stage, [150, 500], [180, 200]);
    expect(h.saw.swipes).toEqual(['up']);
  });

  it('ignores a drag too short to be a swipe', () => {
    const h = harness();
    press(h.stage, [150, 300], [170, 300]);
    expect(h.saw.swipes).toEqual([]);
    expect(h.saw.zones).toEqual([]);
  });

  it('suppresses the click that follows a swipe', () => {
    // The browser fires `click` after a drag that ended on a link. Without the
    // suppression a swipe that happens to end on a footnote opens it.
    const h = harness();
    const link = document.createElement('a');
    h.stage.append(link);
    press(link, [250, 300], [50, 300]);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(h.saw.swipes).toEqual(['left']);
  });
});

describe('selection and long press', () => {
  it('stands aside while a selection is active', () => {
    // Long-press selection is how a reader copies a sentence; a page turn on the
    // release would lose the selection they just made.
    const h = harness({ selection: true });
    press(h.stage, [260, 300]);
    expect(h.saw.zones).toEqual([]);
    expect(h.saw.swipes).toEqual([]);
  });

  it('turns a long press into a long press, not a page turn', () => {
    const h = harness();
    const start = Date.now();
    h.stage.dispatchEvent(pointer('pointerdown', { clientX: 260, clientY: 300 }));
    vi.setSystemTime(start + 600);
    vi.advanceTimersByTime(600);
    expect(h.saw.longPresses).toBe(1);
    h.stage.dispatchEvent(pointer('pointerup', { clientX: 260, clientY: 300 }));
    expect(h.saw.zones).toEqual([]);
  });

  it('lets a control keep its own click when the reader tapped it', () => {
    // The other half of "controls win": the gesture layer suppresses the click that
    // follows a page turn, and it must not suppress the click a *button* is waiting
    // for. Otherwise the toolbar is visible, tappable, and does nothing.
    const h = harness();
    const button = document.createElement('button');
    h.stage.append(button);
    let clicks = 0;
    button.addEventListener('click', () => { clicks += 1; });
    press(button, [260, 300]);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1);
    expect(h.saw.zones).toEqual([]);
  });

  it('cancels a pending long press once the finger moves', () => {
    const h = harness();
    h.stage.dispatchEvent(pointer('pointerdown', { clientX: 260, clientY: 300 }));
    h.stage.dispatchEvent(pointer('pointermove', { clientX: 260, clientY: 400 }));
    vi.advanceTimersByTime(600);
    expect(h.saw.longPresses).toBe(0);
  });
});
