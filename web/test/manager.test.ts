// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryFilesScreen } from '../src/ui/library-screen.tsx';
import { ReaderApi, type SessionStore } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { OfflineStore } from '../src/store/offline.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';
import { FakeTransport, makePlatform, type RecordedRequest, type Responder } from './helpers/env.ts';
import type { BrowseListing } from '../src/api/types.ts';

/**
 * The file manager.
 *
 * jsdom has no layout engine, so nothing here is about how the screen *looks*.
 * What it covers is the part a regression would be silent about: which entries
 * are reachable in which mode, and — the one that actually costs data — that a
 * destructive call is never sent without an explicit selection and a confirmation.
 */

function entry(partial: Partial<BrowseListing['entries'][number]> & { name: string }): BrowseListing['entries'][number] {
  return {
    path: partial.name,
    type: 'file',
    size: 0,
    mtime: Date.now(),
    mode: 0o644,
    hidden: false,
    hiddenByRule: false,
    scanned: false,
    ext: '',
    indexed: false,
    shelfState: null,
    ...partial,
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

function makeScreen(transport: FakeTransport, calls: string[] = []): { screen: LibraryFilesScreen; calls: string[] } {
  const platform = makePlatform(transport);
  const sessions: SessionStore = {
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
  };
  const api = new ReaderApi(platform, sessions);
  api.setBaseUrl('http://nas:8080');
  const screen = new LibraryFilesScreen({
    api,
    offline: new OfflineStore(makePlatform(transport).kv),
    settings: { ...DEFAULT_APP_SETTINGS },
    onSettingsChange: () => {},
    // The file page, which is what this suite has always been about. The browsing
    // half is a *different screen* now with its own suite (`library-screen.test.ts`),
    // which is the whole reason the two can be tested apart at all.
    path: '',
    page: 1,
    fromShelf: true,
    onClose: () => calls.push('close'),
    onSignedOut: () => calls.push('signed-out'),
    onOpenLibrary: (path, page, replace) => calls.push(`library:${path}:${page}:${replace}`),
    onOpenBrowse: (path) => calls.push(`browse:${path}`),
    onOpenBook: (book) => calls.push(`book:${book.id}`),
  });
  document.body.append(screen.element);
  return { screen, calls };
}

/**
 * A responder that answers `/books` with "no books in this folder".
 *
 * The library screen asks both endpoints, so every bespoke responder in this file has
 * to answer both — and the file page's assertions are about the *listing*, so the
 * books answer is always the empty one. Written once here rather than as a branch in
 * eight responders, which is the shape that eventually gets one of them wrong.
 */
function withEmptyBooks(responder: ParameterizedResponder): ParameterizedResponder {
  return (request) =>
    request.url.startsWith('/api/v1/books')
      ? { status: 200, headers: {}, json: booksEmpty() }
      : responder(request);
}

/**
 * A folder with no *books* in it.
 *
 * The library screen asks two endpoints, because it has two pages: the file list and
 * the books in the same folder. Every test in this suite is about the file page, so
 * the book half is answered empty — but it has to be *answered*, because a transport
 * that replies `undefined` to `/api/v1/books` makes the screen report a crash rather
 * than the file listing the test is looking at.
 */
function booksEmpty(): { items: never[]; total: number; page: number; pageSize: number } {
  return { items: [], total: 0, page: 1, pageSize: 60 };
}

type ParameterizedResponder = (request: RecordedRequest) => ReturnType<Responder>;

beforeEach(() => {
  document.body.replaceChildren();
});

describe('library manager', () => {
  it('lists directories and files, and shows the entries the scanner skips', async () => {
    const transport = new FakeTransport();
    transport.respondWithBoth(
      listing({
        entries: [
          entry({ name: '科幻', type: 'dir', path: '科幻' }),
          entry({ name: '.trash', type: 'dir', path: '.trash', hidden: true, hiddenByRule: true }),
          entry({ name: '三体.epub', path: '三体.epub', scanned: true, ext: 'epub' }),
        ],
        dirs: 2,
        files: 1,
        total: 3,
      }),
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    const rows = screen.element.querySelectorAll('.manager-row');
    expect(rows).toHaveLength(3);
    // The rule-skipped folder is the answer to "my book is on disk but not on
    // the shelf", so it must be visible rather than filtered.
    expect(screen.element.textContent).toContain('.trash');
    expect(screen.element.querySelector('.manager-badge.warn')?.textContent).toBe('扫描忽略');
  });

  it('reports the directory counts after a successful listing', async () => {
    const transport = new FakeTransport();
    transport.respondWithBoth(
      listing({ dirs: 2, files: 3, size: 4096, total: 5, entries: [entry({ name: 'a.epub' })] }),
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    // The counts are the answer to "is my file in here at all", so a successful
    // listing must leave them on screen rather than blank.
    expect(screen.element.querySelector('.manager-status')?.textContent).toContain('3 个文件');
  });

  it('hides the write controls when the mount is read-only', async () => {
    const transport = new FakeTransport();
    transport.respondWithBoth(listing({ writable: false, entries: [entry({ name: '三体.epub', scanned: true })] }));
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    const matches = transport.requests.filter((request) => request.url.startsWith('/api/v1/library/browse'));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.method).toBe('GET');
    // The mkdir button is the only write affordance outside selection mode.
    const buttons = [...screen.element.querySelectorAll<HTMLButtonElement>('button')];
    const mkdir = buttons.find((button) => button.getAttribute('aria-label') === '新建文件夹');
    expect(mkdir?.hidden).toBe(true);
  });

  it('reports a folder tap as navigation instead of doing it itself', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) => {
      const path = new URL(`http://x${request.url}`).searchParams.get('path') ?? '';
      return path === '科幻'
        ? {
            status: 200,
            headers: {},
            json: listing({
              path: '科幻',
              name: '科幻',
              parent: '',
              crumbs: [
                { name: '书库', path: '' },
                { name: '科幻', path: '科幻' },
              ],
              entries: [entry({ name: '三体.epub', path: '科幻/三体.epub', scanned: true })],
              files: 1,
            }),
          }
        : {
            status: 200,
            headers: {},
            json: listing({ entries: [entry({ name: '科幻', type: 'dir', path: '科幻' })] }),
          };
    });
    const calls: string[] = [];
    const { screen } = makeScreen(transport, calls);
    await screen.open('', 1);
    (screen.element.querySelector('.manager-row') as HTMLElement).click();
    // The screen does not navigate itself any more: a folder is a route
    // (`#/library/科幻`), so the tap reports the intent and the router writes the
    // URL. That round trip is what makes a folder link shareable and Back leave
    // the manager rather than walk out of it one folder at a time.
    // The half travels with the navigation as well as the folder and the page: the
    // callback this screen uses is the *file* page's own, so walking into a folder
    // from here cannot land the reader on the covers — which is the failure the two
    // screens' separate callbacks exist to make impossible rather than merely to
    // avoid (a shared `{view}` argument is exactly how it used to happen).
    expect(calls).toEqual(['library:科幻:1:true']);
    expect(transport.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('shows the folder the route asked for, without navigating itself', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) => ({
      status: 200,
      headers: {},
      json: request.url.startsWith('/api/v1/books')
        ? { items: [], total: 0, page: 1, pageSize: 60 }
        : listing({
            path: '科幻',
            name: '科幻',
            parent: '',
            crumbs: [
              { name: '书库', path: '' },
              { name: '科幻', path: '科幻' },
            ],
            entries: [entry({ name: '三体.epub', path: '科幻/三体.epub', scanned: true })],
            files: 1,
          }),
    }));
    const { screen } = makeScreen(transport);
    // What a deep link, a Back and a forward walk all look like from here.
    await screen.open('科幻', 1);
    expect(screen.element.textContent).toContain('三体.epub');
    // The listing's own request, found rather than taken as the last one: the screen
    // asks for the folder's *books* in the same breath (see `load`), so "the last
    // request" is whichever of the two answers second.
    const browse = transport.requests.filter((request) => request.url.includes('/library/browse'));
    // `page` is always sent, even for the first: the path is optional because an
    // empty one *is* the root, while a page is a position the client asked for.
    expect(browse.at(-1)?.url).toBe('/api/v1/library/browse?path=%E7%A7%91%E5%B9%BB&page=1');
  });

  it('does not send a delete for a selection that was never made', async () => {
    const transport = new FakeTransport();
    transport.respondWithBoth(listing({ entries: [entry({ name: '三体.epub', scanned: true })] }));
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    // Tapping a row is navigation, not selection — and on a file there is nowhere
    // to navigate, so a tap must be a no-op rather than a deletion.
    (screen.element.querySelector('.manager-row') as HTMLElement).click();
    expect(transport.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
    expect(screen.element.querySelector('.manager-actions')?.hasAttribute('hidden')).toBe(true);
  });

  it('sends the selected paths, and only those, on a confirmed delete', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.method === 'GET'
        ? {
            status: 200,
            headers: {},
            json: listing({
              entries: [entry({ name: 'a.epub', path: 'a.epub' }), entry({ name: 'b.epub', path: 'b.epub' })],
              files: 2,
            }),
          }
        : { status: 200, headers: {}, json: { removed: 1 } },
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1);

    // Selection through the row's own action sheet, which is the keyboard-free
    // path a test can drive without a touch device.
    (screen.element.querySelector('.manager-more') as HTMLElement).click();
    // The action sheet is created inside an awaited promise, so it appears a
    // microtask after the click rather than synchronously.
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    const choose = [...screen.element.querySelectorAll('.dialog-list .button')].find(
      (button) => button.textContent === '选择',
    ) as HTMLElement;
    choose.click();
    // The sheet closes through a promise too, so the action bar is one tick away.
    await vi.waitFor(() => expect(screen.element.querySelector('.manager-selection')?.hasAttribute('hidden')).toBe(false));
    const deleteButton = [...screen.element.querySelectorAll('.manager-actions .button')].find(
      (button) => button.textContent === '删除',
    ) as HTMLElement;
    deleteButton.click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-actions')).not.toBeNull());
    const confirmButton = [...screen.element.querySelectorAll('.dialog-actions .button')].find(
      (button) => button.textContent === '删除',
    ) as HTMLElement;
    confirmButton.click();

    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.url.endsWith('/browse/delete'))).toBe(true);
    });
    const del = transport.requests.find((request) => request.url.endsWith('/browse/delete'));
    expect(JSON.parse(String(del?.body))).toEqual({ paths: ['a.epub'] });
  });

  it('reports a refused write instead of pretending it worked', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.method === 'GET'
        ? { status: 200, headers: {}, json: listing({ entries: [entry({ name: 'a.epub', path: 'a.epub' })] }) }
        : {
            status: 403,
            headers: {},
            json: { error: { code: 'READ_ONLY_MOUNT', message: 'the library mount is read-only' } },
          },
    );
    const { screen, calls } = makeScreen(transport);
    await screen.open('', 1);
    (screen.element.querySelector('.manager-more') as HTMLElement).click();
    const rename = [...screen.element.querySelectorAll('.dialog-list .button')].find(
      (button) => button.textContent === '重命名',
    ) as HTMLElement;
    rename.click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog input')).not.toBeNull());
    const input = screen.element.querySelector<HTMLInputElement>('.dialog input')!;
    input.value = 'b.epub';
    const form = screen.element.querySelector<HTMLFormElement>('form.dialog')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.url.endsWith('/browse/rename'))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    await vi.waitFor(() => {
      expect(screen.element.querySelector('.manager-status')?.textContent).toContain('read-only');
    });
    // A refused operation must not sign the reader out: the 403 here is about the
    // mount, not about their session.
    expect(calls).not.toContain('signed-out');
  });
});

describe('uploading from the manager', () => {
  /** A `File` the jsdom environment will accept. */
  const file = (name: string, body = 'bytes'): File => new File([body], name, { type: 'application/epub+zip' });

  const pick = async (screen: LibraryFilesScreen, files: File[]): Promise<void> => {
    const input = screen.element.querySelector<HTMLInputElement>('.manager-upload-input')!;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('asks what to do about a clash before sending any bytes', async () => {
    const transport = new FakeTransport();
    transport.respondWithBoth(listing({ entries: [entry({ name: '三体.epub', scanned: true })] }));
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    void pick(screen, [file('三体.epub')]);

    // The policy dialog appears first, so a user who has waited for a 400MB
    // upload is never told afterwards that it was a name clash.
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    const uploads = transport.requests.filter((request) => request.url.includes('upload'));
    expect(uploads).toHaveLength(0);
  });

  it('sends the file, the destination and the policy, and reports what landed', async () => {
    const transport = new FakeTransport();
    transport.respondWith(
      withEmptyBooks((request) =>
      request.url.includes('upload')
        ? {
            status: 200,
            headers: {},
            json: {
              uploaded: [{ path: '科幻/三体.epub', originalName: '三体.epub', name: '三体.epub', size: 5, kind: 'file', bookId: 'b1' }],
              skipped: [{ name: '坏.zip', reason: '无法解压' }],
              scan: { added: 1, updated: 0, removed: 0, failed: 0, startedAt: 1, finishedAt: 2 },
            },
          }
        : {
            status: 200,
            headers: {},
            json:
              new URL(`http://x${request.url}`).searchParams.get('path') === '科幻'
                ? listing({
                    path: '科幻',
                    name: '科幻',
                    parent: '',
                    crumbs: [
                      { name: '书库', path: '' },
                      { name: '科幻', path: '科幻' },
                    ],
                    entries: [],
                  })
                : listing({ entries: [entry({ name: '科幻', type: 'dir', path: '科幻' })] }),
          },
      ),
    );
    const { screen } = makeScreen(transport);
    // Open the folder first: the upload goes into the directory being viewed,
    // which is the whole contract of the feature. It is the *route* that opens it,
    // which is also why the destination survives a reload.
    await screen.open('科幻', 1);
    expect(screen.element.querySelector('.manager-crumb[aria-current="true"]')?.textContent).toBe('科幻');

    void pick(screen, [file('三体.epub')]);
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    const rename = [...screen.element.querySelectorAll('.dialog-list .button')].find(
      (button) => button.textContent === '两份都留（加 (2)）',
    ) as HTMLElement;
    rename.click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).toBeNull());

    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.url.includes('upload'))).toBe(true);
    });
    const request = transport.requests.find((r) => r.url.includes('upload'))!;
    const form = request.body as FormData;
    expect(form.get('path')).toBe('科幻');
    expect(form.get('onConflict')).toBe('rename');
    expect((form.get('file') as File).name).toBe('三体.epub');

    // The status line names the file that was *skipped*: a count alone leaves the
    // user with nothing to act on.
    await vi.waitFor(() => {
      expect(screen.element.querySelector('.manager-status')?.textContent).toContain('坏.zip');
    });
  });

  it('does not offer an upload at all on a read-only mount', async () => {
    const transport = new FakeTransport();
    transport.respondWithBoth(listing({ writable: false, entries: [] }));
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    const buttons = [...screen.element.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.find((button) => button.getAttribute('aria-label') === '上传书籍')?.hidden).toBe(true);
  });
});

describe('batch management', () => {
  const twoBooks = (): BrowseListing =>
    listing({
      entries: [
        entry({ name: '卷一.epub', path: '卷一.epub', scanned: true, indexed: true }),
        entry({ name: '卷二.epub', path: '卷二.epub', scanned: true, indexed: true }),
      ],
      files: 2,
    });

  /** Selects every row through the action sheet, as a keyboard-less test can. */
  const selectAll = async (screen: LibraryFilesScreen): Promise<void> => {
    for (const more of [...screen.element.querySelectorAll<HTMLElement>('.manager-more')]) {
      more.click();
      await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
      const choose = [...screen.element.querySelectorAll('.dialog-list .button')].find(
        (button) => button.textContent === '选择',
      ) as HTMLElement;
      choose.click();
      await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).toBeNull());
    }
  };

  it('sends one metadata patch for the whole selection', async () => {
    const transport = new FakeTransport();
    transport.respondWith(
      withEmptyBooks((request) =>
        request.url.includes('/browse/metadata')
          ? { status: 200, headers: {}, json: { applied: 2, books: ['a', 'b'], failed: [] } }
          : { status: 200, headers: {}, json: twoBooks() },
      ),
    );
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    await selectAll(screen);

    const metadata = [...screen.element.querySelectorAll('.manager-actions .button')].find(
      (button) => button.textContent === '改资料',
    ) as HTMLElement;
    metadata.click();
    await vi.waitFor(() => expect(screen.element.querySelector('[placeholder="留空则不改"]')).not.toBeNull());
    const author = screen.element.querySelector<HTMLInputElement>('.dialog input')!;
    author.value = '某某';
    screen.element.querySelector<HTMLFormElement>('form.dialog')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.url.endsWith('/browse/metadata'))).toBe(true);
    });
    const request = transport.requests.find((r) => r.url.endsWith('/browse/metadata'))!;
    // Bottom to top, because the *last* row was appended second and the list is
    // built in document order — what matters is that both were sent.
    expect(JSON.parse(String(request.body))).toEqual({
      paths: ['卷一.epub', '卷二.epub'],
      fields: { author: '某某' },
    });
    // The server's count, not a generic "完成".
    await vi.waitFor(() => {
      expect(screen.element.querySelector('.manager-status')?.textContent).toContain('已更新 2 本');
    });
  });

  it('has no shelf controls at all, on a row or in the batch bar', async () => {
    /*
     * #40: 「书库管理页面去掉 从书架拿掉 按钮」.
     *
     * The shelf directions used to live here — on the row menu and on the batch bar,
     * next to 删除 and 移动… Both of those write to the *mount*; a shelf write changes a
     * `user_books` row and touches no file at all. So 下架 was the one control on the
     * screen whose consequence did not match the page's promise, in a menu where the
     * entry beside it deletes the book from disk.
     *
     * It answered to the wrong audience as well: this half of the library is the
     * administrator's (the route is guarded — §3.4.4), while a shelf belongs to each
     * reader. The two directions now live on the two screens a reader owns: the shelf's
     * card menu and the browsing page's card (§3.5.2 / §3.5.3).
     *
     * This test is the negative half, and it is the one that keeps the button from
     * growing back: the menu still opens and still offers the disk actions, and neither
     * it nor the batch bar mentions a shelf in any wording.
     */
    const transport = new FakeTransport();
    transport.respondWithBoth(listing({
      writable: true,
      entries: [
        entry({ name: '在架.epub', path: '在架.epub', scanned: true, indexed: true, shelfState: 'on' }),
        entry({ name: '下架.epub', path: '下架.epub', scanned: true, indexed: true, shelfState: 'off' }),
      ],
    }));
    const { screen } = makeScreen(transport);
    await screen.open('', 1);

    (screen.element.querySelector<HTMLElement>('.manager-row .manager-more')!).click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    const menu = [...screen.element.querySelectorAll<HTMLElement>('.dialog-list .button')].map((b) => b.textContent);
    expect(menu).toContain('删除');
    expect(menu).not.toContain('从书架拿掉');
    expect(menu).not.toContain('放回书架');
    expect(menu).not.toContain('下架');
    expect(menu).not.toContain('加入书架');

    // The dialog answers a promise the screen owns, so it is dismissed the way a
    // reader dismisses it — by choosing 选择 — which also starts the selection the
    // batch bar below is asserted on.
    ([...screen.element.querySelectorAll<HTMLElement>('.dialog-list .button')].find(
      (button) => button.textContent === '选择',
    )!).click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).toBeNull());
    // The second row is still unselected, so tick it through the same sheet.
    (screen.element.querySelector<HTMLElement>('.manager-more')!).click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    ([...screen.element.querySelectorAll<HTMLElement>('.dialog-list .button')].find(
      (button) => button.textContent === '选择',
    )!).click();
    const bar = [...screen.element.querySelectorAll('.manager-actions .button')].map((button) => button.textContent);
    expect(bar).toContain('删除');
    expect(bar).not.toContain('下架');
    expect(bar).not.toContain('加入书架');
    expect(
      transport.requests.some((request) => request.url.endsWith('/browse/shelf')),
      'the file page must not write to a shelf at all',
    ).toBe(false);
  });


  it('marks the book that is not on the shelf, and only that one', async () => {
    /*
     * The row badge is the *only* thing on this screen that answers "why is this book
     * missing from my shelf" for a book the reader took off it. Before it, every row
     * was identical whatever its shelf state — so the screen that exists to explain a
     * missing book could not name one.
     *
     * The negative half of the assertion matters as much as the positive: a badge on
     * every row is a column of noise that hides the one row that is the exception, and
     * the exception is the reader's whole reason for being here.
     *
     * The badge *survives* the removal of the buttons (#40), and the distinction is the
     * point: the *write* did not belong on this screen, but the *answer* does. A reader
     * hunting for a book that is missing from their shelf is standing right here, and
     * two identical rows would explain nothing.
     */
    const transport = new FakeTransport();
    transport.respondWithBoth(listing({
      writable: true,
      entries: [
        entry({ name: '在架.epub', path: '在架.epub', scanned: true, indexed: true, shelfState: 'on' }),
        entry({ name: '下架.epub', path: '下架.epub', scanned: true, indexed: true, shelfState: 'off' }),
        entry({ name: '文件夹', type: 'dir', path: '文件夹', shelfState: null }),
      ],
    }));
    const { screen } = makeScreen(transport);
    await screen.open('', 1);

    const rows = [...screen.element.querySelectorAll<HTMLElement>('.manager-row')];
    const badgeOf = (name: string): string | undefined =>
      rows.find((row) => row.querySelector('.manager-label')?.textContent === name)
        ?.querySelector('.manager-badge.off')?.textContent ?? undefined;
    expect(badgeOf('下架.epub')).toBe('不在书架');
    expect(badgeOf('在架.epub')).toBeUndefined();
    expect(badgeOf('文件夹')).toBeUndefined();
  });

  it('keeps the form actions out of the fields-scan scroller', async () => {
    const transport = new FakeTransport();
    transport.json(twoBooks());
    const { screen } = makeScreen(transport);
    await screen.open('', 1);
    await selectAll(screen);
    await vi.waitFor(() => expect(screen.element.querySelector('.manager-actions .button')).not.toBeNull());
    ([...screen.element.querySelectorAll('.manager-actions .button')].find(
      (button) => button.textContent === '改资料',
    ) as HTMLElement).click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-fields')).not.toBeNull());

    // Seven optional fields do not fit on a phone, so the *fields* scroll and the
    // actions do not. A dialog that scrolled whole put 保存 below the fold, which
    // reads as a form with no way to commit it.
    const fields = screen.element.querySelector('.dialog-fields')!;
    const actions = screen.element.querySelector('.dialog-actions')!;
    expect(fields.contains(actions)).toBe(false);
    expect(fields.querySelectorAll('.dialog-field')).toHaveLength(7);
  });
});

describe('pagination and the refresh after an upload', () => {
  /** A listing of `total` entries, with `pageSize` of them on the page asked for. */
  const many = (total: number, requested: number, pageSize = 200): BrowseListing => {
    const from = (requested - 1) * pageSize;
    const count = Math.max(0, Math.min(pageSize, total - from));
    return listing({
      entries: Array.from({ length: count }, (_v, i) =>
        entry({ name: `第${from + i + 1}卷.epub`, path: `第${from + i + 1}卷.epub`, scanned: true, indexed: true }),
      ),
      total,
      dirs: 0,
      files: total,
      size: total * 1024,
    });
  };

  it('shows the page the route named, and hides the pager on a single page', async () => {
    const transport = new FakeTransport();
    transport.respondWith(
      withEmptyBooks((request) => {
        const requested = Number(new URL(`http://x${request.url}`).searchParams.get('page') ?? '1');
        return { status: 200, headers: {}, json: many(requested === 1 ? 12 : 340, requested) };
      }),
    );
    const { screen } = await makeScreen(transport);
    await screen.open('', 1);
    expect(screen.element.querySelector('.manager-pager')).toBeNull();

    await screen.open('', 2);
    // 340 entries is two pages, and the page comes from the *route* rather than from
    // a field: a page that lives in this class is one Back and one reload throw away.
    // Found rather than taken as the last request: the screen asks for the folder's
    // books in the same breath, so "the last one" is whichever answered second.
    expect(
      transport.requests.filter((request) => request.url.includes('/library/browse')).at(-1)?.url,
    ).toBe('/api/v1/library/browse?page=2');
    expect(screen.element.querySelector('.pager-page[aria-current="page"]')?.textContent).toBe('2');
  });

  it('reports a page turn to the shell instead of paging itself', async () => {
    const transport = new FakeTransport();
    transport.respondWith(
      withEmptyBooks((request) => {
        const requested = Number(new URL(`http://x${request.url}`).searchParams.get('page') ?? '1');
        return { status: 200, headers: {}, json: many(340, requested) };
      }),
    );
    const { screen, calls } = await makeScreen(transport);
    await screen.open('', 1);
    const next = [...screen.element.querySelectorAll<HTMLElement>('.manager-pager .pager-step')].find(
      (button) => button.getAttribute('aria-label') === '下一页',
    )!;
    next.click();
    // The URL is the state: the screen reports the *intent*, and the shell writes it.
    // The callback is this screen's own (`onOpenLibrary`), so the page turn cannot
    // carry the reader out of the file manager — see the note in `makeScreen`.
    expect(calls).toContain('library::2:true');
  });

  it('re-reads the directory after an upload, so the new file is on screen', async () => {
    const transport = new FakeTransport();
    let listingCount = 0;
    transport.respondWith(
      withEmptyBooks((request) => {
        if (request.url.includes('upload')) {
          return {
            status: 200,
            headers: {},
            json: {
              uploaded: [{ path: '三体.epub', originalName: '三体.epub', name: '三体.epub', size: 5, kind: 'file', bookId: 'b1' }],
              skipped: [],
              scan: { added: 1, updated: 0, removed: 0, failed: 0, startedAt: 1, finishedAt: 2 },
            },
          };
        }
        listingCount += 1;
        // The first read is the empty folder; every read after the upload sees the file.
        return {
          status: 200,
          headers: {},
          json: listing({
            entries:
              listingCount === 1
                ? []
                : [entry({ name: '三体.epub', path: '三体.epub', scanned: true, indexed: true })],
            files: listingCount === 1 ? 0 : 1,
            total: listingCount === 1 ? 0 : 1,
          }),
        };
      }),
    );
    const { screen } = await makeScreen(transport);
    await screen.open('', 1);
    expect(screen.element.querySelector('.manager-row')).toBeNull();

    const input = screen.element.querySelector<HTMLInputElement>('.manager-upload-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], '三体.epub')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    ([...screen.element.querySelectorAll('.dialog-list .button')].find(
      (button) => button.textContent === '跳过已有的',
    ) as HTMLElement).click();

    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.url.includes('upload'))).toBe(true);
    });
    // The bug this pins: the report was written and nothing else happened, so the row
    // for the file that had just landed was absent — and a list that does not contain
    // the thing you just did reads as a failed upload, whatever the message says.
    await vi.waitFor(() => expect(screen.element.querySelector('.manager-row')).not.toBeNull());
    expect(screen.element.textContent).toContain('三体.epub');
    // The report survives the reload: the reload's own status is the directory
    // summary, and the summary is not an answer to "did it work".
    expect(screen.element.querySelector('.manager-status')?.textContent).toContain('已入库 1 个文件');
  });

  it('names the page in the summary when the directory has more than one', async () => {
    const transport = new FakeTransport();
    transport.respondWith(withEmptyBooks(() => ({ status: 200, headers: {}, json: many(340, 1) })));
    const { screen } = await makeScreen(transport);
    await screen.open('', 1);
    // "340 个文件" under a screen showing 200 of them is a correct sentence and a
    // confusing one; naming the page makes the number and the rows agree.
    expect(screen.element.querySelector('.manager-status')?.textContent).toContain('第 1 / 2 页');
  });
});

describe('error classification', () => {
  it('does not treat a refused operation as a dead session', () => {
    // Both are 403 on this API and only one is about the credentials. Classifying
    // them together signed a reader out — and discarded their tokens — for trying
    // to rename a file on a read-only mount.
    expect(new ApiError('forbidden', 'the library mount is read-only', 'READ_ONLY_MOUNT', 403).isAuthFailure).toBe(false);
    expect(new ApiError('forbidden', 'admin role required', 'ADMIN_REQUIRED', 403).isAuthFailure).toBe(false);
    expect(new ApiError('forbidden', 'account disabled', 'ACCOUNT_DISABLED', 403).isAuthFailure).toBe(true);
    expect(new ApiError('unauthorized', 'token expired', 'TOKEN_EXPIRED', 401).isAuthFailure).toBe(true);
  });
});

it('opens a folder menu without also navigating into that folder', async () => {
  const transport = new FakeTransport(); transport.respondWithBoth(listing({ entries: [entry({ name: '子目录', type: 'dir' })], total: 1, dirs: 1 }));
  const { screen, calls } = makeScreen(transport); await screen.open('', 1);
  screen.element.querySelector<HTMLButtonElement>('.manager-more')!.click();
  expect(screen.element.querySelector('.dialog-list')).not.toBeNull(); expect(calls).toEqual([]);
  screen.dispose();
});
