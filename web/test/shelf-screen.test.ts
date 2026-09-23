// @vitest-environment jsdom
import { noticeText } from './helpers/notices.ts';
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
  offline: OfflineStore;
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
  const offline = new OfflineStore(platform.kv);
  const screen = new ShelfScreen({
    api,
    offline,
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
  return { screen, calls, transport, offline };
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

/**
 * 书架的移除 —— the one direction the shelf itself was missing.
 *
 * The report asked for the pair to be completed, and the shelf is where a reader
 * stands when they decide a book should not be there: the library page is a place
 * they *went to*, and reaching it to drop one book means leaving the shelf, finding
 * the file and coming back. So the control belongs on the card.
 *
 * The two properties asserted here are the ones a wrong implementation gets wrong
 * silently: the *path* the write carries (a card knows a book, the endpoint takes a
 * file) and the list the reader is left looking at.
 */
describe('taking a book off the shelf', () => {
  function serveShelf(transport: FakeTransport, books: Book[]): void {
    transport.respondWith((request) => {
      if (request.url.includes('/browse/shelf')) {
        return { status: 200, headers: {}, json: { applied: 1, books: ['b1'], failed: [] } };
      }
      if (request.url.startsWith('/api/v1/books')) {
        return { status: 200, headers: {}, json: { items: books, total: books.length, page: 1, pageSize: 60 } };
      }
      if (request.url.startsWith('/api/v1/library/browse')) {
        return {
          status: 200,
          headers: {},
          json: {
            path: '', crumbs: [{ name: '书库', path: '' }], parent: null,
            entries: [{ name: '第1卷.epub', path: '第1卷.epub', type: 'file', size: 0, mtime: 0, mode: 0o644,
              hidden: false, hiddenByRule: false, scanned: true, ext: 'epub', indexed: true, shelfState: 'on' }],
            total: 1, dirs: 0, files: 1, size: 0, writable: true, name: '',
          },
        };
      }
      return { status: 200, headers: {}, json: { items: [] } };
    });
  }

  it('asks the reader before it takes a book away', async () => {
    /*
     * `remove` is the only shelf action that takes something away, so it is the only
     * one that asks. It is also the one whose wording has to be exact: the reader's
     * first fear is that 下架 deleted the file, and a dialog that does not say so in
     * as many words is a dialog they will not press.
     */
    const transport = new FakeTransport();
    serveShelf(transport, [book(1)]);
    const { screen } = await makeScreen(transport);
    await screen.show();
    const menu = screen.element.querySelector<HTMLElement>('[aria-label="第1卷 的操作"]')!;
    expect(menu, 'a card needs a way to its own actions').not.toBeNull();
    menu.click();
    const item = [...screen.element.querySelectorAll<HTMLElement>('button')].find(
      (button) => button.textContent?.trim() === '从书架拿掉',
    )!;
    expect(item, 'the shelf must offer the direction that is missing from it').not.toBeNull();
    item.click();
    await vi.waitFor(() => expect(screen.element.textContent).toContain('从书架拿掉'));
    // The dialog names the book and says the file is untouched.
    expect(screen.element.textContent).toContain('第1卷');
    expect(screen.element.textContent).toContain('磁盘');
    // Nothing has been written yet — the second press is what writes.
    expect(transport.requests.some((request) => request.url.includes('/browse/shelf'))).toBe(false);
  });

  it('drops the book from the offline mirror too, so it does not come back', async () => {
    /*
     * The mirror is drawn *before* the first request on every open (`show()` renders
     * `offline.books()` and only then replaces it), so a removal the mirror does not
     * hear about is a book that comes back on the next cold start — and, offline, stays.
     *
     * That is the failure this asserts against, and it is the one a screenshot cannot
     * show: the shelf looks correct immediately after the write, because the list was
     * re-read from the server. It is the *second* launch that is wrong.
     */
    const transport = new FakeTransport();
    serveShelf(transport, [book(1)]);
    const { screen, offline } = await makeScreen(transport);
    await screen.show();
    await offline.load();
    expect(offline.books().map((entry) => entry.id)).toContain('b1');
    screen.element.querySelector<HTMLElement>('[aria-label="第1卷 的操作"]')!.click();
    [...screen.element.querySelectorAll<HTMLElement>('.dialog-list button')][0]!.click();
    await vi.waitFor(() => expect(screen.element.textContent).toContain('取消'));
    [...screen.element.querySelectorAll<HTMLElement>('.dialog-actions button')].at(-1)!.click();
    // The report is the reader's words: the menu item was 「从书架拿掉」, and a status
    // line answering 「下架 1 本」 would be a second name for the thing they just pressed.
    await vi.waitFor(() => expect(noticeText()).toContain('从书架拿掉 1 本'));
    expect(offline.books().map((entry) => entry.id)).not.toContain('b1');
  });

  it('writes the book id the card holds, and never guesses a path', async () => {
    /*
     * The write names the book by **id**, and that is the fix for the second half of
     * 「找不到「xxx」在磁盘上的路径」.
     *
     * The card used to reconstruct a library path by listing the root and matching the
     * book's title against the filenames it found. That only lands when a book's title
     * is its own filename — false for anything whose metadata the scanner read — and
     * cannot see past the root's first page. When it missed, the reader was told the
     * book could not be found on disk, *after* asking for it to be taken off their own
     * shelf: a place where the file's name has no bearing on anything.
     *
     * So the assertion is not just "a request went out" but "the request carries the id,
     * and no directory listing was consulted to produce it".
     */
    const transport = new FakeTransport();
    serveShelf(transport, [book(1)]);
    const { screen } = await makeScreen(transport);
    await screen.show();
    screen.element.querySelector<HTMLElement>('[aria-label="第1卷 的操作"]')!.click();
    const item = [...screen.element.querySelectorAll<HTMLElement>('button')].find(
      (button) => button.textContent?.trim() === '从书架拿掉',
    )!;
    item.click();
    await vi.waitFor(() => expect(screen.element.textContent).toContain('取消'));
    // The confirm button is named after the *action*, not "确认": "确认" does not say
    // what is about to happen, and this is the one dialog where that matters.
    const confirm = [...screen.element.querySelectorAll<HTMLElement>('.dialog-actions button')].at(-1)!;
    confirm.click();
    await vi.waitFor(() =>
      expect(transport.requests.some((request) => request.url.includes('/browse/shelf'))).toBe(true),
    );
    const payload = JSON.parse(
      String(transport.requests.find((request) => request.url.includes('/browse/shelf'))!.body),
    ) as { paths?: string[]; bookIds?: string[]; action: string };
    expect(payload.action).toBe('remove');
    expect(payload.bookIds).toEqual(['b1']);
    // No path, and no listing to make one from: the reader presses a card, not a file.
    expect(payload.paths).toBeUndefined();
    expect(
      transport.requests.some(
        (request) => request.url.startsWith('/api/v1/library/browse') && request.url.includes('page='),
      ),
      'the shelf must not look the book up on disk in order to take it off the shelf',
    ).toBe(false);
  });

  it('takes a book off the shelf even when its title is nothing like its filename', async () => {
    /*
     * The exact report: a book whose metadata title is a long sentence (the scanner
     * reads it out of the file) and whose name on disk is something else entirely.
     *
     * Under the old join this was the normal case *failing*: `findEntry` matched the
     * title's stem against the listing and found nothing, so the removal answered
     * 「找不到「半小时漫画宇宙大爆炸（半小时读完138亿年宇宙史，一口气搞懂大爆炸、奇点、黑洞、
     * 引力波、暗物质……混子哥陈磊新作！）」在磁盘上的路径」 — a sentence about a book the
     * reader was looking at. The id form cannot fail this way, and this asserts it
     * through the same path a reader would: open the menu, confirm, check the body.
     */
    const transport = new FakeTransport();
    const longTitled: Book = {
      ...book(1),
      id: 'b-long',
      title: '半小时漫画宇宙大爆炸（半小时读完138亿年宇宙史，一口气搞懂大爆炸、奇点、黑洞、引力波、暗物质……混子哥陈磊新作！）',
      source: 'half-hour-universe',
    };
    serveShelf(transport, [longTitled]);
    const { screen } = await makeScreen(transport);
    await screen.show();
    screen.element.querySelector<HTMLElement>(`[aria-label="${longTitled.title} 的操作"]`)!.click();
    [...screen.element.querySelectorAll<HTMLElement>('button')]
      .find((button) => button.textContent?.trim() === '从书架拿掉')!
      .click();
    await vi.waitFor(() => expect(screen.element.textContent).toContain('取消'));
    [...screen.element.querySelectorAll<HTMLElement>('.dialog-actions button')].at(-1)!.click();
    await vi.waitFor(() =>
      expect(transport.requests.some((request) => request.url.includes('/browse/shelf'))).toBe(true),
    );
    const payload = JSON.parse(
      String(transport.requests.find((request) => request.url.includes('/browse/shelf'))!.body),
    ) as { bookIds?: string[]; action: string };
    expect(payload.bookIds).toEqual(['b-long']);
    // And nothing was reported as unfindable.
    expect(screen.element.textContent).not.toContain('找不到');
  });

  it('drops the book from the list it just wrote about', async () => {
    /*
     * The list is the point of the action, so it has to change.
     *
     * A re-read of the page is not equivalent to removing the card: the reader's list
     * shrinks by one book and the request would also *reorder* nothing they asked to
     * have reordered. Refetching the page is the honest answer — the server is the
     * authority on what the shelf holds — and it is what makes a page turn not land
     * on a book the reader just removed.
     */
    const transport = new FakeTransport();
    const books = [book(1), book(2)];
    transport.respondWith((request) => {
      if (request.url.includes('/browse/shelf')) {
        return { status: 200, headers: {}, json: { applied: 1, books: ['b1'], failed: [] } };
      }
      if (request.url.startsWith('/api/v1/books')) {
        const after = transport.requests.some((entry) => entry.url.includes('/browse/shelf'));
        const items = after ? books.slice(1) : books;
        return { status: 200, headers: {}, json: { items, total: items.length, page: 1, pageSize: 60 } };
      }
      if (request.url.startsWith('/api/v1/library/browse')) {
        return {
          status: 200, headers: {},
          json: {
            path: '', crumbs: [{ name: '书库', path: '' }], parent: null,
            entries: [{ name: '第1卷.epub', path: '第1卷.epub', type: 'file', size: 0, mtime: 0, mode: 0o644,
              hidden: false, hiddenByRule: false, scanned: true, ext: 'epub', indexed: true, shelfState: 'on' }],
            total: 1, dirs: 0, files: 1, size: 0, writable: true, name: '',
          },
        };
      }
      return { status: 200, headers: {}, json: { items: [] } };
    });
    const { screen } = await makeScreen(transport);
    await screen.show();
    expect(screen.element.querySelectorAll('.book-card')).toHaveLength(2);
    screen.element.querySelector<HTMLElement>('[aria-label="第1卷 的操作"]')!.click();
    [...screen.element.querySelectorAll<HTMLElement>('button')]
      .find((button) => button.textContent?.trim() === '从书架拿掉')!
      .click();
    await vi.waitFor(() => expect(screen.element.textContent).toContain('取消'));
    [...screen.element.querySelectorAll<HTMLElement>('.dialog-actions button')].at(-1)!.click();
    await vi.waitFor(() => expect(screen.element.querySelectorAll('.book-card')).toHaveLength(1));
    expect(screen.element.querySelector('[aria-label="第1卷 的操作"]')).toBeNull();
  });
});
