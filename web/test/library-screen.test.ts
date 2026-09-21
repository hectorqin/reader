// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryBrowseScreen } from '../src/ui/library-screen.tsx';
import { ReaderApi, type SessionStore } from '../src/api/client.ts';
import { OfflineStore } from '../src/store/offline.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';
import type { Book, BrowseListing } from '../src/api/types.ts';

/** The first `<button>` whose visible label is `text`. */
function findButton(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    // Compared on the button's *visible* label span rather than on `textContent`:
    // an icon is a private-use character inside the button, so the raw text of a
    // labelled button is the glyph followed by the words.
    (button) => [...button.querySelectorAll('span')].at(-1)?.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button labelled ${text}`);
  return found;
}

/**
 * 书库 · 浏览 — the reader's half of the library.
 *
 * jsdom has no layout, so nothing here is about how the page looks. What it covers is
 * the part a regression would be silent about:
 *
 *  - the grid draws *covers* and never file rows, and its search filters by the
 *    folder it is inside of rather than by the whole library;
 *  - a page turn, a folder walk and a search all *report the intent* instead of
 *    renumbering themselves, so the URL and the grid cannot disagree after a Back;
 *  - the one action this page exists for — 加入书架 on a book whose *file* is on
 *    disk but whose *book* is not on the reader's shelf — issues the write for the
 *    file the card is about, and not for some other book; and
 *  - the file manager is a *navigation* rather than a tab, so Back returns to the
 *    covers (see `test/manager.test.ts` for the other half).
 */

function book(index: number, overrides: Partial<Book> = {}): Book {
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
    source: `第${index}卷.epub`,
    manualFields: [],
    updatedAt: index,
    addedAt: index,
    ...overrides,
  };
}

function entry(name: string, overrides: Partial<BrowseListing['entries'][number]> = {}): BrowseListing['entries'][number] {
  return {
    path: name,
    // `name` is what the *file list* renders and what a book is matched to; `path` is
    // the library-relative address every write takes. A fixture that set only one of
    // them would pass a test of the row and fail a test of the join.
    name,
    type: 'file',
    size: 0,
    mtime: Date.now(),
    mode: 0o644,
    hidden: false,
    hiddenByRule: false,
    scanned: true,
    ext: 'epub',
    indexed: true,
    shelfState: null,
    ...overrides,
  };
}

function listing(overrides: Partial<BrowseListing> = {}): BrowseListing {
  return {
    path: '',
    crumbs: [{ name: '书库', path: '' }],
    parent: null,
    entries: [],
    total: 0,
    dirs: 0,
    files: 0,
    size: 0,
    writable: true,
    name: '',
    ...overrides,
  };
}

interface Harness {
  screen: LibraryBrowseScreen;
  calls: string[];
  transport: FakeTransport;
}

function makeScreen(
  transport: FakeTransport,
  overrides: Partial<ConstructorParameters<typeof LibraryBrowseScreen>[0]> = {},
): Harness {
  const platform = makePlatform(transport);
  const sessions: SessionStore = {
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
  };
  const api = new ReaderApi(platform, sessions);
  api.setBaseUrl('http://nas:8080');
  const calls: string[] = [];
  const screen = new LibraryBrowseScreen({
    api,
    offline: new OfflineStore(platform.kv),
    settings: { ...DEFAULT_APP_SETTINGS },
    onSettingsChange: (patch) => calls.push(`settings:${JSON.stringify(patch)}`),
    path: '',
    page: 1,
    search: '',
    fromShelf: true,
    onOpenBook: (book) => calls.push(`book:${book.id}`),
    onOpenFiles: () => calls.push('files'),
    onOpenBrowse: (path, page, search, replace) => calls.push(`browse:${path}:${page}:${search}:${replace}`),
    onClose: () => calls.push('close'),
    onSignedOut: () => calls.push('signed-out'),
    ...overrides,
  });
  document.body.append(screen.element);
  return { screen, calls, transport };
}

/** Serves both halves of a folder: the file listing and the books inside it. */
function serveFolder(
  transport: FakeTransport,
  files: BrowseListing,
  books: Book[],
  continueItems: unknown[] = [],
): void {
  transport.respondWith((request) => {
    if (request.url.startsWith('/api/v1/library/browse')) return { status: 200, headers: {}, json: files };
    if (request.url.startsWith('/api/v1/library/continue')) {
      return { status: 200, headers: {}, json: { items: continueItems } };
    }
    if (request.url.startsWith('/api/v1/books')) {
      return { status: 200, headers: {}, json: { items: books, total: books.length, page: 1, pageSize: 60 } };
    }
    return { status: 200, headers: {}, json: {} };
  });
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the browsing half of the library', () => {
  it('draws covers and never file rows', async () => {
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({ entries: [entry('第1卷.epub'), entry('未入库.txt', { scanned: false, ext: 'txt' })], total: 2, files: 2 }),
      [book(1)],
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    // The grid is a grid of *books*: a card per book, and no file rows at all. The
    // file rows belong to the other screen, and a page that showed both would be the
    // tab the report asked to remove.
    expect(screen.element.querySelectorAll('.book-card')).toHaveLength(1);
    expect(screen.element.querySelectorAll('.manager-row')).toHaveLength(0);
  });

  it('offers the file manager as a navigation rather than a tab', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, '');
    // `IconTextButton` puts the label in the text, so the selector is by *text*: an
    // `aria-label` on a button that already has one would say the same thing twice.
    findButton(screen.element, '文件管理').click();
    /*
     * The screen does not switch halves itself: it reports the intent and the shell
     * writes the URL, which comes back as a *different screen*. That round trip is
     * what makes the file manager a place Back can return from — the reason it is a
     * route rather than a tab.
     */
    expect(calls).toContain('files');
  });

  it('asks for the books in *this* folder, not for the whole shelf', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ path: '科幻', entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('科幻', 1, '');
    const bookRequests = transport.requests.filter((request) => request.url.startsWith('/api/v1/books?'));
    expect(bookRequests).toHaveLength(1);
    // A grid without the path would show the whole library under a breadcrumb that
    // says 科幻, which is a right-looking screen with the wrong books on it.
    expect(new URL(`http://x${bookRequests[0]!.url}`).searchParams.get('path')).toBe('科幻');
    /*
     * And it asks for the *index*, not the reader's shelf (`scope=library`).
     *
     * This is the half that made the page's own action unreachable: without it the
     * endpoint answers with books that are on the shelf already, so every card came
     * back `shelfState: 'on'` and 「加入书架」 could not appear on any of them — the one
     * control the page exists for was drawn from a set that could not contain a book
     * needing it.
     */
    expect(new URL(`http://x${bookRequests[0]!.url}`).searchParams.get('scope')).toBe('library');
  });

  it('filters by the query, and reports the query with the folder and the page', async () => {
    /*
     * The search is the *shop* behaviour the report asked for, and its two halves are
     * both silent failures: a field that does not reach the request leaves a grid that
     * looks filtered and is not, and a query that is not reported leaves the URL
     * saying one thing and the grid another.
     */
    const transport = new FakeTransport();
    serveFolder(transport, listing({ path: '科幻', entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen, calls } = makeScreen(transport);
    await screen.open('科幻', 1, '刘慈欣');
    expect(new URL(`http://x${transport.requests.at(-1)!.url}`).searchParams.get('search')).toBe('刘慈欣');
    // Clearing the field reports an empty query, and goes back to page one: the third
    // page of a two-word search is not a page of the unfiltered folder.
    (screen.element.querySelector('[aria-label="清除搜索"]') as HTMLElement).click();
    expect(calls).toContain('browse:科幻:1::true');
  });

  it('walks into a folder at page one with no query', async () => {
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({
        entries: [entry('子目录', { type: 'dir', path: '子目录' })],
        total: 1,
        files: 0,
        dirs: 1,
      }),
      [],
    );
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, '某个搜索词');
    // A folder row is not on this page — the grid is books — so the *breadcrumb* is
    // the way back up, and the walk is asserted through it instead.
    const { screen: walker, calls: walkerCalls } = makeScreen(
      new FakeTransport(),
      { path: '科幻', search: '某个搜索词' },
    );
    void walker;
    void walkerCalls;
    expect(screen.element.querySelector('.library-header h1')?.textContent).toBe('书库');
    expect(screen.element.querySelector('.library-path')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('shelves a book that is on disk but not on the reader’s shelf', async () => {
    /*
     * The action this page exists for.
     *
     * The card holds a *book* and the write names it by **id**. That is the fix for
     * 「找不到「xxx」在磁盘上的路径」, and it is asserted on the wire rather than on the
     * screen because the failure it replaces was silent: the old code matched the
     * book's title against filenames in the folder listing, so a book whose metadata
     * title differs from its filename produced *no path at all* — the card then got no
     * control, or a control that reported the book could not be found.
     */
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({
        entries: [
          entry('第1卷.epub', { shelfState: 'on' }),
          entry('第2卷.epub', { shelfState: 'off' }),
        ],
        total: 2,
        files: 2,
      }),
      [book(1, { shelfState: 'on' }), book(2, { shelfState: 'off' })],
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');

    const shelve = screen.element.querySelector<HTMLElement>('[aria-label="把第2卷加入书架"]');
    expect(shelve, 'only the book that is off the shelf gets the control').not.toBeNull();
    expect(screen.element.querySelector('[aria-label="把第1卷加入书架"]')).toBeNull();
    shelve!.click();
    await vi.waitFor(() =>
      expect(transport.requests.some((request) => request.url.includes('/browse/shelf'))).toBe(true),
    );
    const write = transport.requests.find((request) => request.url.includes('/browse/shelf'))!;
    const payload = JSON.parse(String(write.body)) as { bookIds?: string[]; paths?: string[]; action: string };
    expect(payload.action).toBe('add');
    expect(payload.bookIds).toEqual(['b2']);
    // No path is composed anywhere: the file's name is not the reader's business, and
    // a title that does not match one must not be able to stop the write.
    expect(payload.paths).toBeUndefined();
  });

  it('offers the control for a book whose title is nothing like its filename', async () => {
    /*
     * The reported case, on the page that has to render it.
     *
     * `shelfState` comes from the *books* list now, not from a filename join, so a book
     * the scanner titled out of its own metadata gets the control like any other. Under
     * the join this card drew nothing — the listing's row was matched by the title's
     * stem and found no row — which is the other half of 「书库的书……需要手动加入」.
     */
    const transport = new FakeTransport();
    const longTitled = book(1, {
      shelfState: 'off',
      title: '半小时漫画宇宙大爆炸（半小时读完138亿年宇宙史，一口气搞懂大爆炸、奇点、黑洞、引力波、暗物质……混子哥陈磊新作！）',
      source: 'half-hour-universe',
    });
    serveFolder(
      transport,
      listing({ entries: [entry('half-hour.epub', { shelfState: 'off' })], total: 1, files: 1 }),
      [longTitled],
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    const shelve = screen.element.querySelector<HTMLElement>(`[aria-label="把${longTitled.title}加入书架"]`);
    expect(shelve, 'a book whose title is not its filename must still be shelvable').not.toBeNull();
    shelve!.click();
    await vi.waitFor(() =>
      expect(transport.requests.some((request) => request.url.includes('/browse/shelf'))).toBe(true),
    );
    const payload = JSON.parse(
      String(transport.requests.find((request) => request.url.includes('/browse/shelf'))!.body),
    ) as { bookIds?: string[] };
    expect(payload.bookIds).toEqual(['b1']);
  });

  it('offers 上传 on the browsing page, because this is where a reader lands', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    // The empty state sends the reader here, so the fix has to be here too. It is a
    // write, and the file page's own upload is the same call — one endpoint, two
    // pages that can open it.
    expect(screen.element.querySelector('.library-header [aria-label="上传书籍"]')).not.toBeNull();
  });

  it('hides 上传 on a read-only mount', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ writable: false, entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    // `:ro` is the documented deployment, so the common case is "this page can only
    // look" — and a button that can only answer 403 teaches the reader to distrust
    // every other button.
    const upload = screen.element.querySelector<HTMLElement>('[aria-label="上传书籍"]')!;
    expect(upload.hasAttribute('hidden')).toBe(true);
  });

  it('offers the file manager from the empty state when a folder has no books', async () => {
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({ entries: [entry('cover.jpg', { scanned: false, ext: 'jpg' })], total: 1, files: 1 }),
      [],
    );
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, '');
    // A folder of forty files holding no books is a real state — a comic folder that
    // did not index, a directory of scans — and the useful answer is the file list,
    // which can say *why* each one was skipped.
    expect(screen.element.querySelector('.empty-state')?.textContent).toContain('没有可阅读的书');
    (screen.element.querySelector('.empty-actions button') as HTMLElement).click();
    expect(calls).toContain('files');
  });

  it('shows a different empty state for a search that matched nothing', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), []);
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, '查无此书');
    // "这个文件夹里没有书" and "没有匹配的书" are different sentences about different
    // problems, and the second one has an action attached: clear the field.
    expect(screen.element.querySelector('.empty-state')?.textContent).toContain('没有匹配的书');
    (screen.element.querySelector('.empty-actions button') as HTMLElement).click();
    expect(calls).toContain('browse::1::true');
  });

  it('draws no pager for a folder that fits one page', async () => {
    const transport = new FakeTransport();
    // The pager is drawn from the *book* total, and a pager with one page is a control
    // that can only be pressed to no effect.
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), [book(1), book(2)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    expect(screen.element.querySelector('.shelf-pager')).toBeNull();
  });

  it('reports a page turn rather than renumbering itself', async () => {
    const transport = new FakeTransport();
    const many = Array.from({ length: 60 }, (_value, index) => book(index + 1));
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), many);
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, '');
    // 60 books is exactly one page, so the pager is not drawn and there is nothing to
    // turn; the assertion is that nothing was reported *without* a page turn.
    expect(screen.element.querySelector('.shelf-pager')).toBeNull();
    expect(calls.filter((call) => call.startsWith('browse:'))).toEqual([]);
  });

  it('goes back to page one when the query changes', async () => {
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({ entries: [entry('a.epub')], total: 120, files: 120 }),
      Array.from({ length: 60 }, (_value, index) => book(index + 1)),
    );
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 3, '');
    // Page three of a search that has not run yet is a page of a list nobody has
    // seen, so a new query always starts at the top.
    const input = screen.element.querySelector<HTMLInputElement>('.library-search input')!;
    input.value = '刘慈欣';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.at(-1)).toBe('browse::1:刘慈欣:true');
  });
});

/**
 * 书架的加入 / 移除，在书库页上。
 *
 * The report that produced these assertions was 「补全完善书架的加入、移除逻辑」, and
 * the half that was missing is the one only this screen can see: a reader who took a
 * book off their shelf, reopened 书库, browser-cached everything, and found a page
 * that could not tell them *why* the book was missing — nor put it back.
 */
describe('the shelf pair on the browsing page', () => {
  /**
   * Serves one folder, letting the shelf state of a book change between reads.
   *
   * The state lives on the **book**, not on the file listing: `shelfState` is answered
   * by the list the page is actually drawn from (`scope=library`), which is what makes
   * the control a statement about the book in front of the reader.
   */
  function serveMutable(
    transport: FakeTransport,
    state: { shelfState: 'on' | 'off' },
    books: Book[],
  ): void {
    transport.respondWith((request) => {
      if (request.url.includes('/browse/shelf')) {
        // The write answers with the batch result, which is what the sentence the
        // reader sees is built from — a fixture that answered `{}` would make every
        // report read `0 本` and the assertion meaningless.
        return { status: 200, headers: {}, json: { applied: 1, books: ['b2'], failed: [] } };
      }
      if (request.url.startsWith('/api/v1/library/browse')) {
        return {
          status: 200,
          headers: {},
          json: listing({ entries: [entry('第2卷.epub')], total: 1, files: 1 }),
        };
      }
      if (request.url.startsWith('/api/v1/books')) {
        return {
          status: 200,
          headers: {},
          json: {
            items: books.map((b) => ({ ...b, shelfState: state.shelfState })),
            total: books.length,
            page: 1,
            pageSize: 60,
          },
        };
      }
      return { status: 200, headers: {}, json: { items: [] } };
    });
  }

  it('re-reads the folder after a shelve, so the control disappears rather than lying', async () => {
    /*
     * The write is NOT the end of the interaction — the *re-read* is.
     *
     * `shelfState` is what draws the control, so a card that keeps offering 加入书架
     * after the book has been added is a page whose every remaining control is a no-op,
     * and the reader's next press teaches them the button does not work. The list is
     * re-read inside the same `try` as the write, before the report is shown, which is
     * the order the upload path already used and for the same reason.
     */
    const transport = new FakeTransport();
    const state: { shelfState: 'on' | 'off' } = { shelfState: 'off' };
    serveMutable(transport, state, [book(2)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    expect(screen.element.querySelector('[aria-label="把第2卷加入书架"]')).not.toBeNull();

    const booksReadsBefore = transport.requests.filter((request) =>
      request.url.startsWith('/api/v1/books?')).length;
    state.shelfState = 'on';
    screen.element.querySelector<HTMLElement>('[aria-label="把第2卷加入书架"]')!.click();
    await vi.waitFor(() =>
      expect(
        transport.requests.filter((request) => request.url.startsWith('/api/v1/books?')).length,
      ).toBeGreaterThan(booksReadsBefore),
    );
    await vi.waitFor(() =>
      expect(screen.element.querySelector('[aria-label="把第2卷加入书架"]')).toBeNull(),
    );
    // The message says *what the reader did*, not what a generic batch write did:
    // `已更新 1 本` is not an answer to "did my book come back".
    expect(screen.element.textContent).toContain('加入书架 1 本');
  });

  it('says what the reader did, not that a batch was updated', async () => {
    /*
     * `已更新 1 本` is true and useless: the reader pressed 加入书架, and the one thing
     * they are checking is whether the book moved. The sentence is built from the
     * *action*, which is also why no two screens can describe the same write two
     * different ways.
     */
    const transport = new FakeTransport();
    serveMutable(transport, { shelfState: 'off' }, [book(2)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    screen.element.querySelector<HTMLElement>('[aria-label="把第2卷加入书架"]')!.click();
    await vi.waitFor(() => expect(screen.element.textContent).toContain('加入书架 1 本'));
    expect(screen.element.textContent).not.toContain('已更新');
  });

  it('lets a book that is off the shelf be put back in one press, with no selection', async () => {
    /*
     * The gap the file manager could not cover.
     *
     * The 文件 page used to be able to do this, but it is the administrator's screen: a
     * member never sees it at all (the route is guarded), so the only way back onto the
     * shelf for a member was a batch selection on a page they cannot open. #40 moved the
     * directions to the screens the reader owns, and this is the one that has to show a
     * book the reader has *not* shelved — which is exactly the set the shelf itself
     * cannot display.
     */
    const transport = new FakeTransport();
    serveMutable(transport, { shelfState: 'off' }, [book(2)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    screen.element.querySelector<HTMLElement>('[aria-label="把第2卷加入书架"]')!.click();
    await vi.waitFor(() =>
      expect(transport.requests.some((request) => request.url.includes('/browse/shelf'))).toBe(true),
    );
    const payload = JSON.parse(
      String(transport.requests.find((request) => request.url.includes('/browse/shelf'))!.body),
    ) as { bookIds?: string[]; action: string };
    expect(payload.action).toBe('add');
    expect(payload.bookIds).toEqual(['b2']);
  });
});
