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

async function makeScreen(transport: FakeTransport, page = 1): Promise<Harness> {
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
    settings: { ...DEFAULT_APP_SETTINGS },
    page,
    libraryPath: '',
    libraryPage: 1,
    onOpenBook: (entry) => calls.push(`book:${entry.id}`),
    onOpenLibrary: (path, target) => calls.push(`library:${path}:${target}`),
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

  it('opens a continue card through the same book object the shelf uses', async () => {
    /*
     * The defect in #40, at the layer the reader touches.
     *
     * The server answered `/library/continue` with the *progress row's* naming —
     * `{ bookId, title, author, percentage, chapterTitle, updatedAt, coverUrl }` —
     * while the card is typed as `ContinueReadingItem extends Book` and the tap path
     * reads `book.id`. Nothing failed loudly: `title` and `coverUrl` are spelled the
     * same in both shapes, so the card drew correctly, and tapping it handed the
     * shell `{ id: undefined }` — i.e. `#/book/undefined`, which 404s and surfaces as
     * "这本书不在书架上了".
     *
     * The request here is the *real* one (no item field is spelled `bookId`), and the
     * assertion is on what the tap passes on, because that is the value the shell
     * routes with. A test that asserted the card *rendered* passed before the fix.
     */
    const transport = new FakeTransport();
    transport.respondWith((request) => {
      if (request.url.startsWith('/api/v1/library/continue')) {
        return { status: 200, headers: {}, json: { items: [{ ...book(1), percentage: 0.4, chapterTitle: '第二章', lastReadAt: Date.now() }] } };
      }
      return { status: 200, headers: {}, json: page(0, 0, 0) };
    });
    const { screen, calls } = await makeScreen(transport);
    await screen.show();
    const card = screen.element.querySelector<HTMLElement>('.continue-card');
    expect(card, 'a continue card must be drawn').toBeTruthy();
    card!.click();
    expect(calls).toContain('book:b1');
    expect(calls).not.toContain('book:undefined');
  });

  it('fills in a missing id from the field the old server sent', async () => {
    /*
     * The compatibility direction, and it is deliberate rather than defensive.
     *
     * The upstream bug was a *naming* drift between two hand-written types, and the
     * one thing that made it expensive was that it was silent: a reader on an older
     * server (or the Android WebView, which caches the client separately from the
     * API) got a card that drew and a tap that went nowhere, with no error anywhere.
     * Accepting `bookId` as a synonym means the tap works either way round, so the
     * fix cannot be half-deployed into a broken state.
     */
    const transport = new FakeTransport();
    transport.respondWith((request) => {
      if (request.url.startsWith('/api/v1/library/continue')) {
        return { status: 200, headers: {}, json: { items: [{ bookId: 'legacy-1', title: '旧服务端的书', author: '', percentage: 0.2, chapterTitle: '', updatedAt: 1, coverUrl: null }] } };
      }
      return { status: 200, headers: {}, json: page(0, 0, 0) };
    });
    const { screen, calls } = await makeScreen(transport);
    await screen.show();
    screen.element.querySelector<HTMLElement>('.continue-card')?.click();
    expect(calls).toContain('book:legacy-1');
  });

  it('does not draw a card it cannot open', async () => {
    /*
     * And the last line of defence.
     *
     * A card whose book has no id at all is a card with a dead tap — the exact
     * symptom reported as "提示书本不在书架上". Dropping it is better than drawing it:
     * the reader loses one shortcut from a row of many, instead of gaining a control
     * that lies about being one.
     */
    const transport = new FakeTransport();
    transport.respondWith((request) => {
      if (request.url.startsWith('/api/v1/library/continue')) {
        return { status: 200, headers: {}, json: { items: [{ title: '没有 id 的书', author: '', percentage: 0.2, chapterTitle: '', coverUrl: null }] } };
      }
      return { status: 200, headers: {}, json: page(0, 0, 0) };
    });
    const { screen } = await makeScreen(transport);
    await screen.show();
    expect(screen.element.querySelector('.continue-card')).toBeNull();
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
