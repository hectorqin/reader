// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReaderView, type ViewSettings } from '../src/ui/reader-view.ts';
import type { BookDoc } from '../src/formats/types.ts';

/**
 * Page turns against a *laid-out* scroll container.
 *
 * jsdom reports every scroll extent as zero, so the interesting half of paging —
 * "am I at the top yet", "which column am I in" — cannot be exercised on a bare
 * jsdom element. This file installs a small scroll model instead: extents are
 * real numbers, `scrollTop` assigns are rounded and clamped the way a browser
 * rounds them, and `scrollLeft` does the same. Everything else about the view is
 * the production code.
 *
 * The bugs it exists to catch are the ones that only appear *between* two
 * measurements: a `previous()` that decides where it is by comparing `scrollTop`
 * against a constant, and a `restoreOffset()` that writes an offset the same
 * comparison then refuses to recognise.
 */

beforeAll(() => {
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:stub', writable: true });
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, writable: true });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  // `requestAnimationFrame` is used by `applySettings`; jsdom provides it, but the
  // tests below never need the frame to have run.
  globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => {
    void cb;
    return 0;
  }) as typeof requestAnimationFrame;
});

/**
 * A scrollable element with the geometry a browser would give it.
 *
 * `scrollTop`/`scrollLeft` are rounded to whole pixels on assignment, which is
 * what Chromium does and exactly what makes a `> 8` comparison unreliable: a
 * restore that computes 1000.4 lands on 1000, and a step that computes 0.4 lands
 * on 0.
 */
function scrollable(element: HTMLElement, geometry: { clientHeight: number; scrollHeight: number; clientWidth?: number; scrollWidth?: number }): void {
  const state = { top: 0, left: 0 };
  Object.defineProperty(element, 'clientHeight', { get: () => geometry.clientHeight, configurable: true });
  Object.defineProperty(element, 'scrollHeight', { get: () => geometry.scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientWidth', { get: () => geometry.clientWidth ?? 400, configurable: true });
  Object.defineProperty(element, 'scrollWidth', { get: () => geometry.scrollWidth ?? 400, configurable: true });
  Object.defineProperty(element, 'scrollTop', {
    get: () => Math.round(state.top),
    set: (value: number) => {
      state.top = Math.min(Math.max(0, value), Math.max(0, geometry.scrollHeight - geometry.clientHeight));
    },
    configurable: true,
  });
  Object.defineProperty(element, 'scrollLeft', {
    get: () => Math.round(state.left),
    set: (value: number) => {
      state.left = Math.min(Math.max(0, value), Math.max(0, (geometry.scrollWidth ?? 400) - (geometry.clientWidth ?? 400)));
    },
    configurable: true,
  });
}

function doc(sectionCount: number, override: Partial<BookDoc> = {}): BookDoc {
  return {
    format: 'epub',
    layout: 'reflowable',
    render: 'reflowable',
    direction: 'ltr',
    sections: Array.from({ length: sectionCount }, (_v, i) => ({
      id: `ch${i}.xhtml`,
      label: `第 ${i + 1} 章`,
      html: '<p>正文</p>',
      depth: 0,
    })),
    toc: [],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
    ...override,
  };
}

const SCREEN = 800;

/** A view whose chapter is `screens` viewports tall, in scroll mode. */
function scrollingView(container: HTMLDivElement, screens: number, sectionCount = 4): ReaderView {
  const view = new ReaderView({ container, doc: doc(sectionCount) });
  const element = view.elementHost;
  scrollable(element, { clientHeight: SCREEN, scrollHeight: SCREEN * screens });
  return view;
}

/** A view whose chapter is `columns` viewport widths wide, in paged mode. */
function pagedView(container: HTMLDivElement, columns: number, sectionCount = 4): ReaderView {
  const view = new ReaderView({ container, doc: doc(sectionCount) });
  const settings: Partial<ViewSettings> = { mode: 'paged' };
  view.applySettings(settings);
  const flow = view.elementHost.flow;
  scrollable(flow, {
    clientHeight: SCREEN,
    scrollHeight: SCREEN,
    clientWidth: 400,
    scrollWidth: 400 * columns,
  });
  return view;
}

describe('page turns in scroll mode', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  it('keeps a turned page when a later viewport observation restores the offset', async () => {
    let resize: (() => void) | undefined;
    const previousObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const view = scrollingView(container, 4);
    try {
      await view.open(0, 0);
      await view.next();
      const before = view.position();
      expect(before.pageInChapter).toBe(2);
      resize?.();
      expect(view.position().locator).toBe(before.locator);
      expect(view.position().pageInChapter).toBe(2);
      await view.seekPageInChapter(2);
      view.applySettings({ theme: 'green' });
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(view.position().pageInChapter).toBe(3);
    } finally {
      view.dispose();
      globalThis.ResizeObserver = previousObserver;
    }
  });

  it('walks back page by page and reports the page it is on', async () => {
    // The regression: `previous()` decided whether it had room by comparing
    // `scrollTop` against 8, then *subtracted* 0.9 of a screen. The two numbers do
    // not agree, so the offsets a *forward* press left behind were not offsets a
    // *backward* press recognised as boundaries — the page appeared to bounce.
    //
    // A chapter of 2.6 screens was the case that made it visible: the partial last
    // screen meant the 0.9 arithmetic left a remainder above the threshold, so an
    // extra press slid back down instead of crossing the chapter.
    const view = scrollingView(container, 2.6);
    await view.open(1, 1);
    // Offset 1 is the end of the chapter, which is its last *screen*, not its
    // bottom edge: the reader sees the top of page 3.
    expect(view.position().pageInChapter).toBe(3);
    expect(view.elementHost.scrollTop).toBeGreaterThan(0);

    await view.previous();
    expect(view.position().pageInChapter).toBe(2);
    await view.previous();
    expect(view.position().pageInChapter).toBe(1);
    expect(view.elementHost.scrollTop).toBe(0);
    // Now, and only now, is there nothing left to go back to inside this chapter.
    expect(view.currentSectionIndex()).toBe(1);
    await view.previous();
    expect(view.currentSectionIndex()).toBe(0);
  });

  it('takes as many presses to cross a chapter as the footer says it has pages', async () => {
    // The number in the footer and the number of presses remaining are the same
    // measurement; if they come from different arithmetic the reader counts presses
    // and finds one missing.
    const view = scrollingView(container, 3);
    await view.open(1, 0);
    const pages = view.position().chapterPages;
    expect(pages).toBe(3);
    // Three screens: from page 1, two forward presses reach page 3, and the next
    // one crosses the boundary rather than sliding half a page further.
    const visited: number[] = [];
    for (let press = 0; press < pages; press += 1) {
      visited.push(view.position().pageInChapter);
      await view.next();
    }
    expect(visited).toEqual([1, 2, 3]);
    expect(view.currentSectionIndex()).toBe(2);
  });

  it('does not move backwards past the top of the chapter', async () => {
    const view = scrollingView(container, 2);
    await view.open(1, 1);
    await view.previous();
    expect(view.elementHost.scrollTop).toBe(0);
    // Already at the top: the next press must cross the chapter boundary rather
    // than nudging the scroll by a fraction of a pixel and counting that as a move.
    const before = view.elementHost.scrollTop;
    const moved = await view.previous();
    expect(moved).toBe(true);
    expect(view.currentSectionIndex()).toBe(0);
    expect(before).toBe(0);
  });

  it('never leaves the reader at a scroll offset that still has room to go back into', async () => {
    // The "goes forward, then jumps back" symptom. Every offset a page turn leaves
    // behind has to be one the *opposite* turn agrees is a page boundary, or two
    // presses in a row undo each other.
    const view = scrollingView(container, 3);
    await view.open(1, 0);
    for (let i = 0; i < 3; i += 1) await view.next();
    expect(view.currentSectionIndex()).toBe(2);
    // Walking back must retrace the same number of steps, not fewer.
    for (let i = 0; i < 3; i += 1) await view.previous();
    expect(view.currentSectionIndex()).toBe(1);
  });

  it('lands on the last screen of the previous chapter going back', async () => {
    // `stepSection(-1, true)` asks for offset 1, which is the *end* of the chapter
    // — the screen a reader who pressed "back" at the top of chapter two expects to
    // see, not the first screen of chapter one.
    const view = scrollingView(container, 3);
    await view.open(1, 0);
    await view.previous();
    expect(view.currentSectionIndex()).toBe(0);
    expect(view.elementHost.scrollTop).toBe(SCREEN * 3 - SCREEN);
  });

  it('steps forward by a whole screen, not by 90% of one', async () => {
    // A 0.9-of-a-screen step leaves a sliver of the previous screen on every page,
    // which reads as "the page did not turn". A whole screen is what every reader
    // means by a page.
    const view = scrollingView(container, 4);
    await view.open(1, 0);
    await view.next();
    expect(view.elementHost.scrollTop).toBe(SCREEN);
  });
});

describe('page turns in paged mode', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  it('advances one column and stops at the last one', async () => {
    const view = pagedView(container, 3);
    await view.open(1, 0);
    const flow = view.elementHost.flow;
    expect(flow.scrollLeft).toBe(0);
    await view.next();
    expect(flow.scrollLeft).toBe(400);
    await view.next();
    expect(flow.scrollLeft).toBe(800);
    await view.next();
    // No fourth column: the turn crosses into the next chapter.
    expect(view.currentSectionIndex()).toBe(2);
  });

  it('walks back to the first column without overshooting into the previous chapter', async () => {
    // The reported symptom, in paged mode: `stepColumn(-1)` computed the target
    // from `clientWidth`, while the layout's stride includes the column gap, so the
    // target drifted off the boundary and a *back* press could land on a position
    // the forward press did not recognise — the page appeared to bounce.
    const view = pagedView(container, 3);
    await view.open(1, 0);
    const flow = view.elementHost.flow;
    await view.next();
    await view.next();
    expect(flow.scrollLeft).toBe(800);
    await view.previous();
    expect(flow.scrollLeft).toBe(400);
    await view.previous();
    expect(flow.scrollLeft).toBe(0);
    await view.previous();
    expect(view.currentSectionIndex()).toBe(0);
  });

  it('counts pages from the scrollable range, not from the content height', async () => {
    // The subtle one. A chapter taller than a whole number of screens has a scroll
    // range smaller than its content height, and a page count computed from the
    // *content* asks for offsets past the end: the last one clamps, so the final
    // press leaves the reader on a page the counter does not admit exists, and the
    // press after that crosses the chapter from what the footer still calls page 3.
    //
    // 2.31 screens: the range is 1.31 screens, so the pages are 1, 2 and 3 — and
    // three presses have to reach the end.
    const view = scrollingView(container, 2.31);
    await view.open(1, 0);
    const total = view.position().chapterPages;
    expect(total).toBe(3);
    for (let page = 2; page <= total; page += 1) {
      await view.next();
      expect(view.position().pageInChapter).toBe(page);
    }
    // On the last page, and the *next* press crosses the chapter rather than
    // sliding to a position the counter cannot name.
    expect(view.currentSectionIndex()).toBe(1);
    await view.next();
    expect(view.currentSectionIndex()).toBe(2);
  });

  it('reports a page count that matches where the turns land', async () => {
    // The footer's "page 2/3" and the number of presses it takes to reach the end
    // are the same measurement; a chapter reported as 3 pages that needs 4 presses
    // is the bug, and this is the assertion that ties them together.
    const view = pagedView(container, 3);
    await view.open(1, 0);
    expect(view.position().chapterPages).toBe(3);
    for (let page = 2; page <= 3; page += 1) {
      await view.next();
      expect(view.position().pageInChapter).toBe(page);
    }
  });
});

/**
 * The footer scrubber, in the unit the footer reads out.
 *
 * The report is specific: the slider under the readout moved the *book*, not the
 * page, so dragging it to one place left the reader in another chapter than the
 * "第 3/9 页" beside its thumb. These assertions are written against the two things
 * that have to agree — where a drag lands, and where the next page turn goes from.
 */
describe('seeking a page inside the chapter', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.append(container);
  });

  it('lands on the page the readout names, in scroll mode', async () => {
    const view = scrollingView(container, 4);
    await view.open(1, 0);
    const total = view.position().chapterPages;
    expect(total).toBe(4);
    for (let page = 1; page <= total; page += 1) {
      await view.seekPageInChapter(page - 1);
      expect(view.position().pageInChapter).toBe(page);
      // Still in the chapter the reader was in: a scrub is not navigation.
      expect(view.currentSectionIndex()).toBe(1);
    }
  });

  it('lands on the page the readout names, in paged mode', async () => {
    const view = pagedView(container, 4);
    await view.open(1, 0);
    expect(view.position().chapterPages).toBe(4);
    for (let page = 1; page <= 4; page += 1) {
      await view.seekPageInChapter(page - 1);
      expect(view.position().pageInChapter).toBe(page);
      expect(view.currentSectionIndex()).toBe(1);
    }
  });

  it('leaves the next turn stepping from where the drag landed', async () => {
    // The half that a "does the drag move the page" check misses: the scrub and
    // the page turn have to share one arithmetic, or the reader drags to page 3
    // and the next press jumps somewhere that is not page 4.
    const view = scrollingView(container, 5);
    await view.open(1, 0);
    await view.seekPageInChapter(2);
    expect(view.position().pageInChapter).toBe(3);
    await view.next();
    expect(view.position().pageInChapter).toBe(4);
    await view.previous();
    expect(view.position().pageInChapter).toBe(3);
  });

  it('clamps a page outside the chapter instead of following it', async () => {
    // The slider is bounded by `chapterPages`, but a stale render or a chapter
    // that re-paginated under a held thumb can still hand over a page number the
    // chapter no longer has. Landing on the ends is the honest answer; inventing
    // a destination is not.
    const view = scrollingView(container, 3);
    await view.open(1, 0);
    await view.seekPageInChapter(99);
    expect(view.position().pageInChapter).toBe(3);
    expect(view.currentSectionIndex()).toBe(1);
    await view.seekPageInChapter(-5);
    expect(view.position().pageInChapter).toBe(1);
    expect(view.currentSectionIndex()).toBe(1);
  });

  it('does not cross a chapter boundary, even at the last page', async () => {
    // The distinction from the old whole-book seek: dragging to the last page of a
    // chapter must stop there. A slider that navigated would take a reader who
    // wanted the end of this chapter to the start of the next one, having asked
    // for neither.
    const view = scrollingView(container, 3);
    await view.open(1, 0);
    await view.seekPageInChapter(2);
    expect(view.position().pageInChapter).toBe(3);
    expect(view.currentSectionIndex()).toBe(1);
  });
});
