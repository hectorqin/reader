// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagerScreen } from '../src/ui/manager-screen.tsx';
import { ReaderApi, type SessionStore } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';
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

function makeScreen(transport: FakeTransport): { screen: ManagerScreen; calls: string[] } {
  const platform = makePlatform(transport);
  const sessions: SessionStore = {
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
  };
  const api = new ReaderApi(platform, sessions);
  api.setBaseUrl('http://nas:8080');
  const calls: string[] = [];
  const screen = new ManagerScreen({
    api,
    onClose: () => calls.push('close'),
    onSignedOut: () => calls.push('signed-out'),
  });
  document.body.append(screen.element);
  return { screen, calls };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('library manager', () => {
  it('lists directories and files, and shows the entries the scanner skips', async () => {
    const transport = new FakeTransport();
    transport.json(
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
    await screen.open();
    const rows = screen.element.querySelectorAll('.manager-row');
    expect(rows).toHaveLength(3);
    // The rule-skipped folder is the answer to "my book is on disk but not on
    // the shelf", so it must be visible rather than filtered.
    expect(screen.element.textContent).toContain('.trash');
    expect(screen.element.querySelector('.manager-badge.warn')?.textContent).toBe('扫描忽略');
  });

  it('reports the directory counts after a successful listing', async () => {
    const transport = new FakeTransport();
    transport.json(
      listing({ dirs: 2, files: 3, size: 4096, total: 5, entries: [entry({ name: 'a.epub' })] }),
    );
    const { screen } = makeScreen(transport);
    await screen.open();
    // The counts are the answer to "is my file in here at all", so a successful
    // listing must leave them on screen rather than blank.
    expect(screen.element.querySelector('.manager-status')?.textContent).toContain('3 个文件');
  });

  it('hides the write controls when the mount is read-only', async () => {
    const transport = new FakeTransport();
    transport.json(listing({ writable: false, entries: [entry({ name: '三体.epub', scanned: true })] }));
    const { screen } = makeScreen(transport);
    await screen.open();
    const matches = transport.requests.filter((request) => request.url.startsWith('/api/v1/library/browse'));
    expect(matches).toHaveLength(1);
    expect(matches[0]!.method).toBe('GET');
    // The mkdir button is the only write affordance outside selection mode.
    const buttons = [...screen.element.querySelectorAll<HTMLButtonElement>('.icon-button')];
    const mkdir = buttons.find((button) => button.getAttribute('aria-label') === '新建文件夹');
    expect(mkdir?.hidden).toBe(true);
  });

  it('navigates into a folder and asks the server for that path', async () => {
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
    const { screen } = makeScreen(transport);
    await screen.open();
    (screen.element.querySelector('.manager-row') as HTMLElement).click();
    await vi.waitFor(() => {
      expect(screen.element.textContent).toContain('三体.epub');
    });
    expect(transport.requests.at(-1)?.url).toBe('/api/v1/library/browse?path=%E7%A7%91%E5%B9%BB');
  });

  it('does not send a delete for a selection that was never made', async () => {
    const transport = new FakeTransport();
    transport.json(listing({ entries: [entry({ name: '三体.epub', scanned: true })] }));
    const { screen } = makeScreen(transport);
    await screen.open();
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
    await screen.open();

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
    await screen.open();
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

  const pick = async (screen: ManagerScreen, files: File[]): Promise<void> => {
    const input = screen.element.querySelector<HTMLInputElement>('.manager-upload-input')!;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('asks what to do about a clash before sending any bytes', async () => {
    const transport = new FakeTransport();
    transport.json(listing({ entries: [entry({ name: '三体.epub', scanned: true })] }));
    const { screen } = makeScreen(transport);
    await screen.open();
    void pick(screen, [file('三体.epub')]);

    // The policy dialog appears first, so a user who has waited for a 400MB
    // upload is never told afterwards that it was a name clash.
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-list')).not.toBeNull());
    const uploads = transport.requests.filter((request) => request.url.includes('upload'));
    expect(uploads).toHaveLength(0);
  });

  it('sends the file, the destination and the policy, and reports what landed', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
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
    );
    const { screen } = makeScreen(transport);
    await screen.open();
    // Open the folder first: the upload goes into the directory being viewed,
    // which is the whole contract of the feature.
    (screen.element.querySelector('.manager-row') as HTMLElement).click();
    await vi.waitFor(() => expect(screen.element.querySelector('.manager-crumb[aria-current="true"]')?.textContent).toBe('科幻'));

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
    transport.json(listing({ writable: false, entries: [] }));
    const { screen } = makeScreen(transport);
    await screen.open();
    const buttons = [...screen.element.querySelectorAll<HTMLButtonElement>('.icon-button')];
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
  const selectAll = async (screen: ManagerScreen): Promise<void> => {
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
    transport.respondWith((request) =>
      request.url.includes('/browse/metadata')
        ? { status: 200, headers: {}, json: { applied: 2, books: ['a', 'b'], failed: [] } }
        : { status: 200, headers: {}, json: twoBooks() },
    );
    const { screen } = makeScreen(transport);
    await screen.open();
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

  it('takes books off the shelf only after saying the files are untouched', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.includes('/browse/shelf')
        ? { status: 200, headers: {}, json: { applied: 2, books: ['a', 'b'], failed: [] } }
        : { status: 200, headers: {}, json: twoBooks() },
    );
    const { screen } = makeScreen(transport);
    await screen.open();
    await selectAll(screen);
    const shelve = [...screen.element.querySelectorAll('.manager-actions .button')].find(
      (button) => button.textContent === '下架',
    ) as HTMLElement;
    shelve.click();

    // The confirmation has to say the files survive: this is one word away from a
    // delete in the same bar, and the two mean opposite things.
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog p')?.textContent).toContain('文件一个都不会动'));
    const confirm = [...screen.element.querySelectorAll('.dialog-actions .button')].find(
      (button) => button.textContent === '删除',
    ) as HTMLElement;
    confirm.click();

    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.url.endsWith('/browse/shelf'))).toBe(true);
    });
    expect(JSON.parse(String(transport.requests.find((r) => r.url.endsWith('/browse/shelf'))!.body))).toEqual({
      paths: ['卷一.epub', '卷二.epub'],
      action: 'remove',
    });
    // And no delete was ever sent.
    expect(transport.requests.some((request) => request.url.endsWith('/browse/delete'))).toBe(false);
  });

  it('keeps the form actions out of the fields-scan scroller', async () => {
    const transport = new FakeTransport();
    transport.json(twoBooks());
    const { screen } = makeScreen(transport);
    await screen.open();
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

  it('would rather say nothing than guess when a path is not a book', async () => {
    const transport = new FakeTransport();
    transport.respondWith((request) =>
      request.url.includes('/browse/shelf')
        ? { status: 200, headers: {}, json: { applied: 0, books: [], failed: [{ path: '空目录', reason: 'NOT_A_BOOK' }] } }
        : { status: 200, headers: {}, json: listing({ entries: [entry({ name: '空目录', type: 'dir', path: '空目录' })], writable: true }) },
    );
    const { screen } = makeScreen(transport);
    await screen.open();
    await selectAll(screen);
    const shelve = [...screen.element.querySelectorAll('.manager-actions .button')].find(
      (button) => button.textContent === '下架',
    ) as HTMLElement;
    shelve.click();
    await vi.waitFor(() => expect(screen.element.querySelector('.dialog-actions')).not.toBeNull());
    ([...screen.element.querySelectorAll('.dialog-actions .button')].find(
      (button) => button.textContent === '删除',
    ) as HTMLElement).click();

    await vi.waitFor(() => {
      expect(screen.element.querySelector('.manager-status')?.textContent).toContain('不是书');
    });
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
