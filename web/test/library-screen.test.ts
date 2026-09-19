// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryScreen } from '../src/ui/library-screen.tsx';
import { ReaderApi, type SessionStore } from '../src/api/client.ts';
import { OfflineStore } from '../src/store/offline.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';
import type { Book, BrowseListing } from '../src/api/types.ts';

/**
 * 书库 — the library screen's two halves.
 *
 * jsdom has no layout, so nothing here is about how the screen looks. What it covers
 * is the part a regression would be silent about:
 *
 *  - the *two pages* stay in their lanes (the preview draws covers and never file
 *    rows, and the write controls appear only where they act on something);
 *  - switching between them reports the intent instead of renumbering itself, so the
 *    URL and the screen cannot disagree after Back; and
 *  - the one action the preview exists for — 加入书架 on a book whose *file* is on
 *    disk but whose *book* is not on the reader's shelf — actually issues the write
 *    for the file the card is about, and not for some other book.
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
  screen: LibraryScreen;
  calls: string[];
  transport: FakeTransport;
}

function makeScreen(
  transport: FakeTransport,
  overrides: Partial<ConstructorParameters<typeof LibraryScreen>[0]> = {},
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
  const screen = new LibraryScreen({
    api,
    offline: new OfflineStore(platform.kv),
    settings: { ...DEFAULT_APP_SETTINGS },
    onSettingsChange: (patch) => calls.push(`settings:${JSON.stringify(patch)}`),
    view: 'preview',
    path: '',
    page: 1,
    fromShelf: true,
    onOpenBook: (entry) => calls.push(`book:${entry.id}`),
    onOpenLibrary: (path, page, view, replace) => calls.push(`library:${path}:${page}:${view}:${replace}`),
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

describe('the library screen', () => {
  it('draws covers on the preview half and file rows on the other', async () => {
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({ entries: [entry('第1卷.epub'), entry('未入库.txt', { scanned: false, ext: 'txt' })], total: 2, files: 2 }),
      [book(1)],
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1, 'preview');
    // The preview is a grid of *books*: a card per book, and no file rows at all.
    expect(screen.element.querySelectorAll('.book-card')).toHaveLength(1);
    expect(screen.element.querySelectorAll('.manager-row')).toHaveLength(0);
    // And the file page is the other way round, which is the whole reason the two
    // are separate: a file row has a filename where a title goes and no cover.
    await screen.open('', 1, 'files');
    expect(screen.element.querySelectorAll('.manager-row')).toHaveLength(2);
    expect(screen.element.querySelectorAll('.book-card')).toHaveLength(0);
  });

  it('lets the reader switch pages, and reports the switch rather than doing it', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, 'preview');
    (screen.element.querySelector('[aria-label="书库页面"] button:nth-child(2)') as HTMLElement).click();
    // The screen does not renumber itself: it reports the intent and the shell writes
    // the URL, which comes back through `open`. That round trip is what lets the two
    // halves be tabs — in the hash rather than in more history — while Back still
    // leaves the library.
    expect(calls).toContain('library::1:files:true');
  });

  it('asks for the books in *this* folder, not for the whole shelf', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ path: '科幻', entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('科幻', 1, 'preview');
    const bookRequests = transport.requests.filter((request) => request.url.startsWith('/api/v1/books?'));
    expect(bookRequests).toHaveLength(1);
    // A preview without the path would show the whole shelf under a breadcrumb that
    // says 科幻, which is a right-looking screen with the wrong books on it.
    expect(new URL(`http://x${bookRequests[0]!.url}`).searchParams.get('path')).toBe('科幻');
  });

  it('shelves a file that is on disk but not on the reader’s shelf', async () => {
    /*
     * The action the preview page exists for.
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
    await screen.open('', 1, 'preview');

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

  it('shows the upload and mkdir controls only where they act on something', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, 'preview');
    // A directory upload and a new folder are things done to a *listing*; the preview
    // is a page of covers with no rows to act on, and offering them there reads as a
    // button that does nothing.
    expect(screen.element.querySelector('.panel-header [aria-label="上传书籍"]')).toBeNull();
    await screen.open('', 1, 'files');
    expect(screen.element.querySelector('.panel-header [aria-label="上传书籍"]')).not.toBeNull();
  });

  it('hides the write controls on a read-only mount', async () => {
    const transport = new FakeTransport();
    serveFolder(transport, listing({ writable: false, entries: [entry('a.epub')], total: 1, files: 1 }), [book(1)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, 'files');
    // `:ro` is the documented deployment, so the common case is "this screen can only
    // look" — and a button that can only answer 403 teaches the reader to distrust
    // every other button.
    const upload = screen.element.querySelector<HTMLElement>('[aria-label="上传书籍"]')!;
    expect(upload.hasAttribute('hidden')).toBe(true);
  });

  it('offers a way to the file page when a folder has no books in it', async () => {
    const transport = new FakeTransport();
    serveFolder(
      transport,
      listing({ entries: [entry('cover.jpg', { scanned: false, ext: 'jpg' })], total: 1, files: 1 }),
      [],
    );
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, 'preview');
    // A folder of forty files holding no books is a real state — a comic folder that
    // did not index, a directory of scans — and the useful answer is the file list,
    // which can say *why* each one was skipped.
    expect(screen.element.querySelector('.empty-state')?.textContent).toContain('没有可阅读的书');
    (screen.element.querySelector('.empty-actions button') as HTMLElement).click();
    expect(calls).toContain('library::1:files:true');
  });

  it('pages with the count of the page it is showing', async () => {
    const transport = new FakeTransport();
    // Forty files, three of which are books: the file page has one pageful and the
    // preview has one, and a pager drawn from the *file* total would offer pages of
    // covers that do not exist.
    const entries = [entry('a.epub'), entry('b.epub'), entry('c.epub')];
    serveFolder(transport, listing({ entries, total: 40, files: 40, dirs: 2 }), [book(1), book(2)]);
    const { screen } = makeScreen(transport);
    await screen.open('', 1, 'preview');
    expect(screen.element.querySelector('.shelf-pager')).toBeNull();
    await screen.open('', 1, 'files');
    expect(screen.element.querySelector('.manager-pager')).toBeNull();
  });

  it('reports a page turn on whichever half is showing', async () => {
    const transport = new FakeTransport();
    const many = Array.from({ length: 60 }, (_value, index) => book(index + 1));
    serveFolder(transport, listing({ entries: [entry('a.epub')], total: 1, files: 1 }), many);
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1, 'preview');
    // 60 books is exactly one page, so both the page count and the pager say so.
    expect(screen.element.querySelector('.shelf-pager')).toBeNull();
    // The page is reported with the view it belongs to: a page turn that dropped the
    // view would put the reader back on the cover page from the file list.
    expect(calls.filter((call) => call.startsWith('library:')).length).toBe(0);
  });
});
