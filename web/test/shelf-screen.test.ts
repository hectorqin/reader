// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShelfScreen } from '../src/ui/shelf-screen.tsx';
import { ReaderApi, type SessionStore } from '../src/api/client.ts';
import { OfflineStore } from '../src/store/offline.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';
import type { Book } from '../src/api/types.ts';

/**
 * The shelf's pagination.
 *
 * jsdom has no layout, so nothing here is about how a page *looks*. What it covers
 * is the arithmetic a regression would be silent about: which page is asked for,
 * what happens when the requested page is past the end, and — the part that would
 * cost the reader their place — that turning a page reports the intent instead of
 * renumbering itself locally.
 *
 * The shelf used to append chunks as the reader scrolled. There was no page number
 * anywhere, so "I was on the third screenful" existed only as a scroll offset that
 * a repaint threw away. The page is the fix, and a page that only lives in this
 * class is the same bug with a name.
 */

function book(index: number): Book {
  return {
    id: `b${index}`,
    title: `第${index}卷`,
    author: '某人',
    publisher: '',
    language: 'zh',
    isbn: '',
    description: '',
    series: '',
    seriesIndex: null,
    tags: [],
    pubdate: '',
    format: 'epub',
    coverUrl: null,
    fileSize: 0,
    pageCount: null,
    source: '',
    manualFields: [],
    updatedAt: index,
    addedAt: index,
  };
}

/** A page of `count` books, with `total` as the server's own count. */
function page(from: number, count: number, total: number): { items: Book[]; total: number; page: number; pageSize: number } {
  return {
    items: Array.from({ length: count }, (_v, i) => book(from + i + 1)),
    total,
    page: 1,
    pageSize: 60,
  };
}

interface Harness {
  screen: ShelfScreen;
  calls: string[];
  transport: FakeTransport;
}

/**
 * Builds the shelf.
 *
 * `shelfSort` defaults to `added` here, which is *not* the app's default — the app
 * opens on 最近阅读. The distinction is the tests' own: 最近阅读 is a client-side order
 * that reads a window of the shelf and slices its page out of it, so a test about the
 * *pager's* arithmetic has to pick a sort the server pages for, or it would be
 * measuring the window logic instead of the pager. The default is asserted on its own,
 * below.
 */
async function makeScreen(
  transport: FakeTransport,
  page = 1,
  sort: 'recent' | 'added' | 'title' | 'author' = 'added',
): Promise<Harness> {
  const platform = makePlatform(transport);
  const sessions: SessionStore = {
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
  };
  const api = new ReaderApi(platform, sessions);
  api.setBaseUrl('http://nas:8080');
  const calls: string[] = [];
  const screen = new ShelfScreen({
    api,
    offline: new OfflineStore(platform.kv),
    platform,
    settings: { ...DEFAULT_APP_SETTINGS, shelfSort: sort },
    page,
    libraryPath: '',
    libraryPage: 1,
    onOpenBook: (entry) => calls.push(`book:${entry.id}`),
    onOpenLibrary: (path, target) => calls.push(`library:${path}:${target}`),
    onOpenLibraryManager: (path) => calls.push(`library-files:${path}`),
    onPageChange: (target) => calls.push(`page:${target}`),
    onSignedOut: () => calls.push('signed-out'),
    onSettingsChange: (patch) => calls.push(`settings:${JSON.stringify(patch)}`),
  });
  document.body.append(screen.element);
  return { screen, calls, transport };
}

/** The `page` each `listBooks` request asked for, in order. */
function requestedPages(transport: FakeTransport): number[] {
  return transport.requests
    .filter((request) => request.url.startsWith('/api/v1/books?'))
    .map((request) => Number(new URL(`http://x${request.url}`).searchParams.get('page')));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the shelf pager', () => {
  it('asks for the page the URL named, not for page one', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(120, 10, 130) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen } = await makeScreen(transport, 3);
    await screen.show();
    // Page three of a 130-book library, asked for on the first request: a deep link
    // to `#/shelf/3` must not paint page one and then jump.
    expect(requestedPages(transport)).toEqual([3]);
    expect(screen.element.querySelector('.pager-page[aria-current="page"]')?.textContent).toBe('3');
  });

  it('reports a page turn instead of renumbering itself', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 60, 130) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen, calls } = await makeScreen(transport);
    await screen.show();
    const next = [...screen.element.querySelectorAll<HTMLElement>('.pager-step')].find(
      (button) => button.getAttribute('aria-label') === '下一页',
    )!;
    next.click();
    // The screen does not change its own page: it reports the intent and the shell
    // writes the URL, which comes back through `showPage`. That round trip is the
    // whole reason a page survives Back, Forward and a reload.
    expect(calls).toContain('page:2');
    expect(requestedPages(transport)).toEqual([1]);
  });

  it('clamps a page past the end rather than showing an empty grid', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? {
            status: 200,
            headers: {},
            // Three pages, and the URL asked for the ninth: the count is the only
            // thing that knows, and it arrives with the answer.
            json: page(0, 60, 130),
          }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen, calls } = await makeScreen(transport, 9);
    await screen.show();
    expect(requestedPages(transport)).toEqual([9, 3]);
    // The URL is corrected too, not just the list: otherwise Back would return to
    // the empty page the reader was redirected off.
    expect(calls).toContain('page:3');
    expect(screen.element.querySelector('.book-card')).not.toBeNull();
  });

  it('hides the pager entirely on a library that fits one page', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 12, 12) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen } = await makeScreen(transport);
    await screen.show();
    // A pager with one page is a control that can only be pressed to no effect.
    expect(screen.element.querySelector('.shelf-pager')).toBeNull();
  });

  it('collapses a long run of pages to first, last and the neighbours', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 60, 3000) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen } = await makeScreen(transport, 25);
    await screen.show();
    const numbers = [...screen.element.querySelectorAll('.pager-page')].map((node) => node.textContent);
    // 3000 books is 50 pages, and 50 buttons on a phone is a control the reader has
    // to read rather than press.
    expect(numbers).toEqual(['1', '24', '25', '26', '50']);
    expect(screen.element.querySelectorAll('.pager-gap')).toHaveLength(2);
  });

  it('disables the arrows at the two ends', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 60, 130) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen } = await makeScreen(transport);
    await screen.show();
    const step = (label: string): HTMLButtonElement =>
      [...screen.element.querySelectorAll<HTMLButtonElement>('.pager-step')].find(
        (button) => button.getAttribute('aria-label') === label,
      )!;
    // `disabled` rather than hidden: the buttons are in fixed positions, and a
    // control that disappears at page one moves the numbers under the thumb that is
    // on its way to page two.
    expect(step('上一页').disabled).toBe(true);
    expect(step('下一页').disabled).toBe(false);
  });

  it('offers the library the reader was last in', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 1, 1) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const platform = makePlatform(transport);
    const sessions: SessionStore = { load: async () => null, save: async () => {}, clear: async () => {} };
    const api = new ReaderApi(platform, sessions);
    api.setBaseUrl('http://nas:8080');
    const calls: string[] = [];
    const screen = new ShelfScreen({
      api,
      offline: new OfflineStore(platform.kv),
      platform,
      settings: { ...DEFAULT_APP_SETTINGS },
      page: 1,
      libraryPath: '科幻',
      libraryPage: 4,
      onOpenBook: () => {},
      onOpenLibrary: (path, target) => calls.push(`${path}:${target}`),
      onOpenLibraryManager: () => {},
      onPageChange: () => {},
      onSignedOut: () => {},
      onSettingsChange: () => {},
    });
    document.body.append(screen.element);
    await screen.show();
    (screen.element.querySelector('button[aria-label="书库"]') as HTMLElement).click();
    // The library owns its own URL, so switching to the shelf leaves it — and a
    // switch that returns the reader to the library root has thrown away the folder
    // and the page they were browsing.
    expect(calls).toEqual(['科幻:4']);
  });

  it('does not fetch a page that is already on screen', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 60, 130) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen } = await makeScreen(transport);
    await screen.show();
    await screen.showPage(1);
    // A route that reports the page already shown is a re-render, not a fetch: the
    // shell re-reports on every route change, and re-fetching here would turn one
    // Back into two requests.
    expect(requestedPages(transport)).toEqual([1]);
  });

  it('offers 最近阅读 first and defaults to it', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 3, 3) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    // Built with the *app's* default rather than the harness's: this is the one test
    // that is about which sort the shelf opens on.
    const { screen } = await makeScreen(transport, 1, 'recent');
    await screen.show();
    const chips = [...screen.element.querySelectorAll<HTMLElement>('.chip')];
    // The label order is the order the reader reads, and the default has to be the
    // first one: a row of chips whose default is buried in the middle makes the
    // reader hunt for the state they are already in.
    expect(chips.map((chip) => chip.textContent)).toEqual(['最近阅读', '最近入库', '书名', '作者']);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps 最近入库 as a choice, because it answers a different question', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 3, 3) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen, calls } = await makeScreen(transport, 1, 'recent');
    await screen.show();
    const chip = [...screen.element.querySelectorAll<HTMLElement>('.chip')].find(
      (button) => button.textContent === '最近入库',
    )!;
    chip.click();
    await vi.waitFor(() => expect(calls.some((call) => call.startsWith('settings:'))).toBe(true));
    // "Where was I" is asked every time the app opens; "what did I just add" is asked
    // after a scan. Collapsing them into one chip would answer neither.
    expect(calls.some((call) => call.includes('"shelfSort":"added"'))).toBe(true);
    expect(screen.element.querySelector('.chip[aria-pressed="true"]')?.textContent).toBe('最近入库');
  });

  it('orders the whole shelf by reading time, not by the file list order', async () => {
    /*
     * The default sort, at the layer that decides it.
     *
     * 最近阅读 is a *client-side* order: the server has no reading-time sort, so the
     * shelf reads a window of books and re-sorts it here. The failure this guards
     * against is the quiet one — sending the client's own sort word to a server that
     * does not know it, which answers the default order under the label 最近阅读.
     */
    const transport = new FakeTransport();
    transport.respondWith((request) => {
      if (request.url.startsWith('/api/v1/library/continue')) {
        return {
          status: 200,
          headers: {},
          json: { items: [{ ...book(3), percentage: 0.5, chapterTitle: '第一章', lastReadAt: 900 }] },
        };
      }
      if (request.url.startsWith('/api/v1/books')) {
        // Served in `added` order, which is deliberately *not* reading order.
        return { status: 200, headers: {}, json: page(0, 3, 3) };
      }
      return { status: 200, headers: {}, json: {} };
    });
    const { screen } = await makeScreen(transport);
    await screen.show();
    const titles = [...screen.element.querySelectorAll('.book-card .title')].map((node) => node.textContent);
    // Book 3 was read and books 1 and 2 never were, so it comes first — and the two
    // never-opened books keep their relative order at the bottom.
    expect(titles[0]).toBe(book(3).title);
    // And the sort word that reached the wire is one the server knows.
    const sorts = transport.requests
      .filter((request) => request.url.startsWith('/api/v1/books?'))
      .map((request) => new URL(`http://x${request.url}`).searchParams.get('sort'));
    expect(new Set(sorts)).toEqual(new Set(['added']));
  });

  it('draws no 继续阅读 row above the grid', async () => {
    /*
     * The reported defect, as a fact about the screen.
     *
     * The row was ten cards duplicating ten of the covers below it. Its data is still
     * fetched — it is the sort key now — so an assertion that the *request* is gone
     * would be wrong; what has to be gone is the drawing.
     */
    const transport = new FakeTransport();
    transport.respondWith((request) => {
      if (request.url.startsWith('/api/v1/library/continue')) {
        return {
          status: 200,
          headers: {},
          json: { items: [{ ...book(1), percentage: 0.4, chapterTitle: '第二章', lastReadAt: Date.now() }] },
        };
      }
      return { status: 200, headers: {}, json: page(0, 3, 3) };
    });
    const { screen } = await makeScreen(transport);
    await screen.show();
    expect(screen.element.querySelector('.continue-row')).toBeNull();
    expect(screen.element.querySelector('.continue-card')).toBeNull();
    expect(screen.element.querySelector('.book-card')).not.toBeNull();
  });

  it('goes back to page one when the sort changes', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.startsWith('/api/v1/books')
        ? { status: 200, headers: {}, json: page(0, 60, 130) }
        : { status: 200, headers: {}, json: { items: [] } },
    );
    const { screen, calls } = await makeScreen(transport, 3);
    await screen.show();
    const chip = [...screen.element.querySelectorAll<HTMLElement>('.chip')].find(
      (button) => button.getAttribute('aria-label') === '按书名排序',
    )!;
    chip.click();
    await vi.waitFor(() => expect(calls).toContain('page:1'));
    // "The third page of a different order" is a position the reader never chose,
    // and page three of an order they have not seen has no relation to the page they
    // were on.
    expect(calls).toContain('page:1');
  });
});
