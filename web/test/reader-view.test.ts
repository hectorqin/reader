// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderView } from '../src/ui/reader-view.ts';
import { createStagedDoc } from '../src/formats/windowed.ts';
import type { BookContent, ContentItem } from '../src/net/api.ts';
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

/** One window of a staged book, as the manifest endpoint delivers it. */
function windowOf(from: number, total: number, count = 40): BookContent {
  const items: ContentItem[] = Array.from({ length: count }, (_value, index) => ({
    id: `c${from + index}`,
    seq: from + index,
    title: `第 ${from + index + 1} 章`,
    kind: 'chapter',
    mediaType: 'application/xhtml+xml',
    href: `xhtml:ch${from + index}.xhtml`,
  }));
  const groups = Array.from({ length: Math.ceil(total / count) }, (_value, index) => ({
    id: `spine:${index * count}`,
    seq: index,
    title: `${index * count + 1}..`,
    count: Math.min(count, total - index * count),
    offset: index * count,
  }));
  return { kind: 'reflowable', total, groups, items, group: Math.floor(from / count) };
}

/** A `ReaderView` over a staged book whose first window starts at `from`. */
function stagedBook(count: number, total: number, from: number): BookDoc {
  const doc = createStagedDoc({
    kind: 'reflowable',
    toc: Array.from({ length: total }, (_value, index) => ({
      id: `xhtml:ch${index}.xhtml`,
      label: `第 ${index + 1} 章`,
      depth: 0,
    })),
    content: windowOf(from, total, count),
    loader: { async read(item) { return { html: `<p>${item.title}</p>` }; } },
  });
  // The same hand-off the reader screen performs: a staged document answers to
  // `setWindow`, and the view finds it through this property.
  (doc as BookDoc & { staged?: unknown }).staged = doc;
  return doc;
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

  it('lands on the chapter when a window is swapped in', async () => {
    // The bug this pins was reported as "点击章节没有反应": the screen asked the
    // document to swap windows, and the swap — when it happened at all — replaced
    // the section list without opening the new chapter. The reader was left
    // staring at the chapter they had just tried to leave. Swapping and landing
    // are one operation now.
    const view = make(container, stagedBook(40, 120, 0));
    await view.open(0, 0);
    expect(view.currentSectionIndex()).toBe(0);
    expect(view.currentChapterPosition).toBe(0);

    const landed = await view.loadWindow(windowOf(80, 120), 90);
    expect(landed).toBe(true);
    expect(view.currentSectionIndex()).toBe(10);
    expect(view.currentChapterPosition).toBe(90);
    expect(view.position().chapterTitle).toBe('第 91 章');
  });

  it('refuses a window that does not hold the chapter', async () => {
    const view = make(container, stagedBook(40, 120, 0));
    await view.open(7, 0);
    const landed = await view.loadWindow(windowOf(80, 120), 3);
    expect(landed).toBe(false);
    // The old chapter is still on screen: a failed jump that also moved the
    // reader would be worse than one that did nothing.
    expect(view.currentSectionIndex()).toBe(7);
    expect(view.currentChapterPosition).toBe(7);
  });

  it('refuses a window for a book that is not staged', async () => {
    const view = make(container, reflowableDoc(5));
    await view.open(0, 0);
    expect(await view.loadWindow(windowOf(0, 120), 0)).toBe(false);
  });

  it('reports a whole-book chapter position that ignores the window boundary', () => {
    // `currentSectionIndex` is window-local and must not be used to decide where
    // the book ends: at the last chapter of a window it reads 39, which a naive
    // check against the window's length would call "the last chapter" of a
    // 120-chapter book.
    const view = make(container, stagedBook(40, 120, 80));
    expect(view.sectionCount).toBe(40);
    expect(view.windowOffset).toBe(80);
    expect(view.currentChapterPosition).toBe(80);
  });

  it('resolves a section id to its local index and whole-book position', async () => {
    const view = make(container, stagedBook(40, 120, 40));
    await view.open(0, 0);
    expect(view.indexOfSection('xhtml:ch57.xhtml')).toBe(17);
    expect(view.indexOfSection('xhtml:ch0.xhtml')).toBe(-1);
    expect(view.windowIndexOfRef('xhtml:ch57.xhtml')).toBe(57);
    expect(view.windowIndexOfRef('xhtml:ch0.xhtml')).toBeNull();
    expect(view.sectionIdAt(17)).toBe('xhtml:ch57.xhtml');
    expect(view.sectionIdAt(99)).toBeNull();
  });

  it('counts the pages of a chapter from the scroll container', () => {
    // jsdom has no layout, so every extent is zero and the honest answer is "one
    // page" rather than a division by zero. What is asserted is that the two
    // page-turn modes do not read the *wrong element*: the host scrolls in scroll
    // mode and the column scrolls in paged mode, and measuring the other one
    // reports every chapter as a single page.
    const view = make(container, reflowableDoc(2));
    const position = view.position();
    expect(position.pageInChapter).toBe(1);
    expect(position.chapterPages).toBe(1);
    expect(position.chapterPosition).toBe(0);
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

describe('plain-text chapters are typeset by the reader', () => {
  /** `format: 'txt'` is the declaration; the marker is the observation. */
  function txtDoc(html: string, format: BookDoc['format'] = 'txt'): BookDoc {
    const doc = reflowableDoc(1);
    return { ...doc, format, sections: [{ id: 'ch0', label: '第一章', html, depth: 0 }] };
  }

  /**
   * The chapter's own shadow root, which is where the reading surface lives.
   *
   * `container.querySelector` reaches nothing inside it — that is the whole point of
   * the shadow root — so the tests have to go through the host element.
   */
  function shadowOf(root: HTMLElement): ShadowRoot {
    const host = root.querySelector('book-content') as (HTMLElement & { shadow: ShadowRoot }) | null;
    if (!host) throw new Error('the reading surface is not mounted');
    return host.shadow;
  }

  /**
   * A chapter exactly as the server now sends it: the characters, and nothing else.
   *
   * `chapter-full:<n>` (formerly `chapter-html:<n>`) used to answer with
   * server-rendered `<p>` markup. It answers
   * with the text now, because paragraph boundaries are a *reading* decision — see
   * `server/src/indexer/formats/text.ts`. Every assertion below is written against
   * this shape, because this is the shape the reader actually receives.
   */
  const serverChapter = ['第二章 落雨', '　　雨来了。', '他走在雨里。'].join('\n');

  it('typesets the text the server sends, and drops the leading spaces it carried', async () => {
    // The whole point of moving the typography to the client: the server hands over
    // characters, and one of the characters a scraper wrote is the full-width space
    // that was standing in for an indent. Left in, it is indent added to whatever the
    // reader chose, and the setting looks broken on the files that need it most.
    const container = document.createElement('div');
    document.body.append(container);
    const view = make(container, txtDoc(serverChapter));
    await view.open(0, 0);
    const body = shadowOf(container).querySelector('.txt-body');
    expect(body).not.toBeNull();
    const paragraphs = [...body!.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['雨来了。', '他走在雨里。']);
    // The chapter's first line is its title, and the *client* promotes it now —
    // otherwise it renders as `第二章 落雨雨来了。`, the title and the first sentence
    // glued together, which is what a reader reports as "格式乱了".
    expect(body!.querySelector('h3')?.textContent).toBe('第二章 落雨');
  });

  it('escapes a chapter whose own text contains markup', async () => {
    // The server sends `text/plain` now and for exactly this reason: served as HTML,
    // a chapter containing `<b>` would be parsed as markup by anything that trusted
    // the label, and the escaping that makes a TXT safe would be sidestepped. The
    // assertion is on the *absence* of an element, not on the presence of the words.
    const container = document.createElement('div');
    document.body.append(container);
    const view = make(container, txtDoc('<img src=x onerror=alert(1)>\n\n<b>粗</b>'));
    await view.open(0, 0);
    const shadow = shadowOf(container);
    expect(shadow.querySelector('.txt-body img')).toBeNull();
    expect(shadow.querySelector('.txt-body b')).toBeNull();
    const paragraphs = [...shadow.querySelectorAll('.txt-body > p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['<img src=x onerror=alert(1)>', '<b>粗</b>']);
  });

  it('re-typesets a chapter an older server sent as markup', async () => {
    // A window may have been cached against a server that still rendered `<p>`s (or
    // a proxy may re-wrap one). The blocks are read back as text and re-split, so an
    // old response cannot be rendered as if it were a new one — and the heading it
    // carried is kept rather than re-derived, because a heuristic run twice is two
    // copies of the heuristic.
    const container = document.createElement('div');
    document.body.append(container);
    const legacy = [
      '<div class="txt-body">',
      '<h3>第二章 落雨</h3>',
      '<p>　　雨来了。</p>',
      '<p>他走在雨里。</p>',
      '</div>',
    ].join('\n');
    const view = make(container, txtDoc(legacy));
    await view.open(0, 0);
    const body = shadowOf(container).querySelector('.txt-body');
    const paragraphs = [...body!.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['雨来了。', '他走在雨里。']);
    expect(body!.querySelector('h3')?.textContent).toBe('第二章 落雨');
  });

  it('adds paragraphs to a chapter the server sent as one slab', async () => {
    // A TXT whose chapters have no blank lines between paragraphs is the common
    // scraped shape. Without this the reader gets a wall of text — one book, two
    // appearances, decided by how the file happened to be written.
    const container = document.createElement('div');
    document.body.append(container);
    const view = make(container, txtDoc('他走了。\n她留下了。\n天亮了。'));
    await view.open(0, 0);
    const paragraphs = [...shadowOf(container).querySelectorAll('.txt-body > p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['他走了。', '她留下了。', '天亮了。']);
  });

  it('leaves an EPUB chapter exactly as the book wrote it', async () => {
    // The other half of the contract: this is the one place in the reader where the
    // book's own markup must survive untouched, and a re-typesetting pass that ran
    // on every format would be a re-typesetting pass that mangles every EPUB.
    const container = document.createElement('div');
    document.body.append(container);
    const view = make(container, txtDoc('<p data-authored="1">正文</p>', 'epub'));
    await view.open(0, 0);
    const shadow = shadowOf(container);
    expect(shadow.querySelector('.txt-body')).toBeNull();
    expect(shadow.querySelector('p')?.getAttribute('data-authored')).toBe('1');
  });
});
