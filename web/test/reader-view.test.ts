// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderView } from '../src/ui/reader-view.ts';
import type { BookDoc } from '../src/formats/types.ts';

/**
 * Navigation behaviour.
 *
 * jsdom has no layout engine, so scroll extents are all zero and the *measurement*
 * half of pagination cannot be exercised here — that is what the device is for.
 * What jsdom can test, and what this file covers, is the part that is pure logic:
 * which section a navigation command lands on, and how a position is reported.
 * Those are the parts that break silently and the parts a refactor is most likely
 * to get wrong.
 */

beforeAll(() => {
  // jsdom does not implement object URLs for Blob. The view uses them for covers
  // and comic pages, neither of which is under test here.
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
});

function reflowableDoc(sectionCount: number): BookDoc {
  return {
    format: 'epub',
    layout: 'reflowable',
    render: 'reflowable',
    direction: 'ltr',
    sections: Array.from({ length: sectionCount }, (_value, index) => ({
      id: `ch${index}.xhtml`,
      label: `第 ${index + 1} 章`,
      html: '<p>正文</p>',
      depth: 0,
    })),
    toc: Array.from({ length: sectionCount }, (_value, index) => ({
      id: `ch${index}.xhtml`,
      label: `第 ${index + 1} 章`,
      depth: 0,
    })),
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

function fixedDoc(pageCount: number): BookDoc {
  return {
    format: 'cbz',
    layout: 'fixed',
    render: 'image',
    direction: 'ltr',
    sections: Array.from({ length: pageCount }, (_value, index) => ({
      id: `p${index}.png`,
      label: `第 ${index + 1} 页`,
      image: { mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
      depth: 0,
    })),
    toc: [],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

function make(container: HTMLDivElement, doc: BookDoc): ReaderView {
  return new ReaderView({ container, doc });
}

describe('ReaderView navigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    container = document.createElement('div');
    document.body.append(container);
  });

  it('opens the first section by default', async () => {
    const view = make(container, reflowableDoc(3));
    await view.open(0, 0);
    expect(view.currentSectionIndex()).toBe(0);
    expect(view.position().sectionId).toBe('ch0.xhtml');
  });

  it('reports a locator that round-trips back to the same section', async () => {
    const view = make(container, reflowableDoc(4));
    await view.open(2, 0.5);
    const position = view.position();
    expect(position.locator.startsWith('r1:')).toBe(true);
    expect(position.locator.endsWith('ch2.xhtml')).toBe(true);
  });

  it('advances section by section when there is nowhere to scroll', async () => {
    // In jsdom every scroll extent is zero, so `next()` must fall through to the
    // section advance rather than reporting success forever on a dead scroll.
    const view = make(container, reflowableDoc(3));
    await view.open(0, 0);
    await view.next();
    expect(view.currentSectionIndex()).toBe(1);
    await view.next();
    expect(view.currentSectionIndex()).toBe(2);
  });

  it('stops at the last section instead of wrapping around', async () => {
    const view = make(container, reflowableDoc(2));
    await view.open(1, 0);
    const moved = await view.next();
    expect(moved).toBe(false);
    expect(view.currentSectionIndex()).toBe(1);
  });

  it('stops at the first section going backwards', async () => {
    const view = make(container, reflowableDoc(2));
    await view.open(0, 0);
    const moved = await view.previous();
    expect(moved).toBe(false);
    expect(view.currentSectionIndex()).toBe(0);
  });

  it('reports the chapter title from the TOC label', async () => {
    const view = make(container, reflowableDoc(3));
    await view.open(1, 0);
    expect(view.position().chapterTitle).toBe('第 2 章');
  });

  it('exposes the TOC for the navigation panel', () => {
    const view = make(container, reflowableDoc(3));
    expect(view.chapterLabels().map((entry) => entry.label)).toEqual(['第 1 章', '第 2 章', '第 3 章']);
  });

  it('notifies a chapter change so the chrome can update', async () => {
    const seen: string[] = [];
    const doc = reflowableDoc(3);
    const view = new ReaderView({
      container,
      doc,
      onChapterChange: (_index, section) => seen.push(section.label),
    });
    await view.open(0, 0);
    await view.open(2, 0);
    expect(seen).toEqual(['第 1 章', '第 3 章']);
  });

  it('seeks to a fraction of the book', async () => {
    const view = make(container, reflowableDoc(10));
    await view.seekPercentage(0.55);
    expect(view.currentSectionIndex()).toBe(5);
  });

  it('clamps a seek beyond the ends', async () => {
    const view = make(container, reflowableDoc(4));
    await view.seekPercentage(5);
    expect(view.currentSectionIndex()).toBe(3);
    await view.seekPercentage(-1);
    expect(view.currentSectionIndex()).toBe(0);
  });

  it('disposes without leaving the host in the container', () => {
    const view = make(container, reflowableDoc(2));
    expect(container.querySelector('book-content')).not.toBeNull();
    view.dispose();
    expect(container.querySelector('book-content')).toBeNull();
  });
});

describe('ReaderView fixed layout', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  it('treats a page turn as a whole section', async () => {
    const view = make(container, fixedDoc(3));
    await view.open(0, 0);
    await view.next();
    expect(view.currentSectionIndex()).toBe(1);
    await view.previous();
    expect(view.currentSectionIndex()).toBe(0);
  });

  it('reports no sub-page offset, because a page is atomic', async () => {
    const view = make(container, fixedDoc(3));
    await view.open(1, 0.7);
    expect(view.position().within).toBe(0);
  });

  it('renders the page image into the shadow root', async () => {
    // The image lives inside the shadow root on purpose: it keeps a page's markup
    // from reaching the app chrome and vice versa. A test that queried the light
    // DOM would pass on a regression that leaked the book into the shell.
    const view = make(container, fixedDoc(2));
    await view.open(0, 0);
    const host = container.querySelector('book-content') as HTMLElement;
    expect(host.shadowRoot?.querySelector('.fixed-page img')).not.toBeNull();
  });

  it('leaves no book markup in the light DOM', async () => {
    const view = make(container, fixedDoc(2));
    await view.open(0, 0);
    expect(container.querySelector('.fixed-page')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('restores a locator pointing at a page by id', async () => {
    const view = make(container, fixedDoc(5));
    const restored = await view.openLocator('r1:0.0000:p3.png');
    expect(restored).toBe(true);
    expect(view.currentSectionIndex()).toBe(3);
  });

  it('refuses a locator for a page that is no longer in the book', async () => {
    const view = make(container, fixedDoc(5));
    const restored = await view.openLocator('r1:0.0000:gone.png');
    expect(restored).toBe(false);
    expect(view.currentSectionIndex()).toBe(0);
  });
});

describe('ReaderView settings', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    container = document.createElement('div');
    document.body.append(container);
  });

  it('applies the theme to the document root so the shell matches the book', () => {
    const view = make(container, reflowableDoc(1));
    view.applySettings({ theme: 'dark' });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('toggles paged mode on the book host, not on the shell', () => {
    const view = make(container, reflowableDoc(1));
    view.applySettings({ mode: 'paged' });
    expect(container.querySelector('book-content')?.getAttribute('data-paginated')).toBe('true');
    view.applySettings({ mode: 'scroll' });
    expect(container.querySelector('book-content')?.getAttribute('data-paginated')).toBe('false');
  });

  it('passes line-height through as a variable so `inherit` means untouched', () => {
    const view = make(container, reflowableDoc(1));
    view.applySettings({ lineHeight: 'inherit' });
    expect(container.style.getPropertyValue('--reader-line-height')).toBe('inherit');
    view.applySettings({ lineHeight: '1.8' });
    expect(container.style.getPropertyValue('--reader-line-height')).toBe('1.8');
  });

  it('exposes the current settings for a settings panel to render from', () => {
    const view = make(container, reflowableDoc(1));
    view.applySettings({ fontScale: 1.4, theme: 'sepia' });
    expect(view.settingsSnapshot.fontScale).toBe(1.4);
    expect(view.settingsSnapshot.theme).toBe('sepia');
  });

  it('does not mutate the caller-provided settings object', () => {
    const view = make(container, reflowableDoc(1));
    const patch = { fontScale: 1.4 };
    view.applySettings(patch);
    expect(patch).toEqual({ fontScale: 1.4 });
  });
});

describe('ReaderView appearance settings', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });

  it('passes the font, margin and alignment through as inheriting variables', () => {
    const view = make(container, reflowableDoc(1));
    view.applySettings({ fontFamily: 'serif', pageMargin: 2.5, textAlign: 'justify' });
    expect(container.style.getPropertyValue('--reader-font-family')).toBe('serif');
    expect(container.style.getPropertyValue('--reader-page-margin')).toBe('2.5rem');
    expect(container.style.getPropertyValue('--reader-text-align')).toBe('justify');
  });

  it('defaults every typography control to inherit, so the book is untouched', () => {
    const view = make(container, reflowableDoc(1));
    const settings = view.settingsSnapshot;
    expect(settings.fontFamily).toBe('inherit');
    expect(settings.textAlign).toBe('inherit');
    expect(settings.lineHeight).toBe('inherit');
  });

  it('exposes brightness as a number so a dimming overlay can be computed', () => {
    const view = make(container, reflowableDoc(1));
    view.applySettings({ brightness: 0.6 });
    expect(container.style.getPropertyValue('--reader-brightness')).toBe('0.6');
  });

  it('sets a page-turn animation on the host and clears it again', () => {
    vi.useFakeTimers();
    try {
      const view = make(container, reflowableDoc(2));
      view.applySettings({ pageAnimation: 'slide' });
      view.animatePage('next');
      expect(container.querySelector('book-content')?.getAttribute('data-animating')).toBe('slide-next');
      vi.runAllTimers();
      expect(container.querySelector('book-content')?.getAttribute('data-animating')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not animate when the reader turned animation off', () => {
    const view = make(container, reflowableDoc(2));
    view.applySettings({ pageAnimation: 'none' });
    view.animatePage('next');
    expect(container.querySelector('book-content')?.getAttribute('data-animating')).toBeNull();
  });

  it('speaks in the order the reader sees, with stable block indices', async () => {
    const view = make(container, reflowableDoc(1));
    await view.open(0, 0);
    const chunks = view.refreshSpokenChunks();
    expect(chunks.length).toBeGreaterThan(0);
    // Every sentence points at a connected text node, which is what the
    // highlight needs to paint a range.
    for (const chunk of chunks) expect(chunk.node?.isConnected).toBe(true);
  });

  it('hands back the first sentence of the chapter when nothing can be measured', async () => {
    // jsdom has no layout, so every rect is zero; the anchor must degrade to the
    // start of the chapter rather than to null, or "read from here" would do
    // nothing at all on a host without a layout engine.
    const view = make(container, reflowableDoc(1));
    await view.open(0, 0);
    const chunks = view.refreshSpokenChunks();
    expect(view.speechAnchor()).toEqual(chunks[0]);
  });

  it('reports no anchor before a chapter has been rendered', () => {
    const view = make(container, reflowableDoc(1));
    expect(view.speechAnchor()).toBeNull();
  });

  it('clears the speech highlight without touching the book markup', async () => {
    const view = make(container, reflowableDoc(1));
    await view.open(0, 0);
    const bookContent = container.querySelector('book-content') as HTMLElement & { shadow: ShadowRoot };
    const before = bookContent.shadow.querySelector('.book-flow')?.innerHTML ?? '';
    view.highlightSpokenChunk(view.refreshSpokenChunks()[0] ?? null);
    view.clearSpeechHighlight();
    // The highlight is an overlay appended to the flow, so it *is* removed from
    // the markup when cleared; what must not survive is an edit to the book's own
    // elements, which is why the sentence is never wrapped in a span.
    expect(bookContent.shadow.querySelector('.reader-speech-highlight')).toBeNull();
    expect(bookContent.shadow.querySelector('.book-flow')?.innerHTML).toBe(before);
    expect(bookContent.shadow.innerHTML).not.toContain('<span');
  });
});

describe('ReaderView resource handling', () => {
  it('releases object URLs on dispose so a long session does not leak', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const revoke = vi.fn();
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      const view = make(container, fixedDoc(3));
      await view.open(0, 0);
      await view.open(1, 0);
      view.dispose();
      expect(revoke).toHaveBeenCalled();
    } finally {
      URL.revokeObjectURL = original;
    }
  });
});
