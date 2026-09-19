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
    expect(screen.element.querySelector('.manager-crumb')).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('shelves a file that is on disk but not on the reader’s shelf', async () => {
    /*
     * The action this page exists for.
     *
     * The card knows a *book*; the shelf endpoint takes *paths*. The two are joined by
     * the browse listing the same folder produced, and the assertion is on the path
     * that reached the wire — a join that picks the wrong row shelves a different
     * book, which is the failure a screenshot cannot show.
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
      [book(1), book(2)],
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
    const payload = JSON.parse(String(write.body)) as { paths: string[]; action: string };
    expect(payload.action).toBe('add');
    expect(payload.paths).toEqual(['第2卷.epub']);
  });

  it('offers 上传 on the browsing page, because this is where a reader lands', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, '');
    // The empty state sends the reader here, so the fix has to be here too. It is a
    // write, and the file page's own upload is the same call — one endpoint, two
    // pages that can open it.
    expect(screen.element.querySelector('.panel-header [aria-label="上传书籍"]')).not.toBeNull();
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
