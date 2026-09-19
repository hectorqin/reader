import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Book, BrowseEntry, BrowseListing, ShelfAction } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { AppSettings } from '../store/settings.ts';
import { formatBytes, formatDate } from './dom.ts';
import { mountUI } from './mount.ts';
import { DialogView, METADATA_FIELDS, type Dialog, type DialogAnswer } from './dialog.tsx';
import { Pager } from './pager.tsx';
import { ShelfSettingsPanel } from './shelf-settings.tsx';
import { sortBooks } from './shelf-order.ts';
import { Button, Icon, IconButton, IconTextButton } from './toolkit.tsx';
import { type ComponentChildren, type JSX, useEffect, useRef, useState } from './vendor/preact.ts';

/**
 * 书库 — the library, as two pages over one place.
 *
 * ## Why the screen has two halves, and why they are one route
 *
 * The library is the server's `BOOKS_DIR`, and there are two questions a reader
 * asks about it that used to be answered by two different screens with no
 * relationship between them:
 *
 *  - **"what is in here"** — the shelf, which shows the books *this account* has;
 *  - **"where did my book go"** — the file manager, which shows the files the
 *    server *has*, including the ones the scanner skips and the ones that never
 *    made it onto the shelf.
 *
 * The report asks for the first of those to exist *in the library*, and the reason
 * it needs to is the one fact neither screen could state on its own: a book can be
 * a file on disk and not a book on your shelf, and the fix is one tap in a
 * *browsing* UI rather than a batch operation in a file list. So the library is one
 * screen with two pages —
 *
 *  - **预览 (preview)**, the default: a grid of the books in this folder, the same
 *    grid the shelf uses, each one tappable to read and with 加入书架 on the ones
 *    that are not on the shelf yet;
 *  - **文件 (files)**: the file manager, which is what this screen used to be.
 *
 * They share the breadcrumb, the folder they are looking at, and the route, so
 * switching between them is a *tab* rather than a navigation — and the route keeps
 * the page so Back leaves the library instead of unwinding the switches.
 *
 * ## The two halves talk to different endpoints, and that is the point
 *
 * The preview page is drawn from `/books` — the DTO that carries titles, covers and
 * the `source` of each field — and the file page from `/library/browse`, which
 * carries paths, sizes and the scanner's flags. Rendering the *browse* entries as a
 * grid would be cheaper and wrong: a browse entry has a filename, not a title, and
 * its cover is nowhere in it. The grid is the `/books` shape, so the preview asks
 * for `/books` — which also means a book that is *only* on the shelf and not in
 * this folder is correctly absent, because the folder is the question.
 */

export interface LibraryScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  settings: AppSettings;
  /** The screen's own preferences (density, author visibility), persisted like the shelf's. */
  onSettingsChange(patch: Partial<AppSettings>): void;
  /** Which page of the library is showing. */
  view: 'preview' | 'files';
  /** The folder and page, both from the route. */
  path: string;
  page: number;
  /** The reader came here from the shelf, so leaving goes back there. */
  fromShelf: boolean;
  onOpenBook(book: Book): void;
  /**
   * Walk to a folder, at a page, and/or switch page.
   *
   * `replace` is what distinguishes the two things this call means: walking into a
   * folder and switching between the library's own two pages *replace* the entry
   * (one screen changing its own argument, so Back leaves the screen rather than
   * retracing the walk), while leaving for the shelf pushes (a different screen).
   */
  onOpenLibrary(path: string, page: number, view: 'preview' | 'files', replace: boolean): void;
  /** Leave the library: back to the shelf, or out of the app. */
  onClose(): void;
  onSignedOut(): void;
}

/** Long-press, in milliseconds, before a touch starts a selection. */
const LONG_PRESS_MS = 450;

/**
 * Entries per page of the *files* listing.
 *
 * A mirror of the server's own default, declared here because the client computes
 * the page *count* and the server computes the page — and if the two numbers
 * disagree the pager offers pages that do not exist.
 */
const FILE_PAGE_SIZE = 200;

/**
 * Books per page of the *preview* grid.
 *
 * The same number the shelf uses, for the same reason it is that number: 60 is a
 * grid of about twenty rows at the phone's default density, enough that turning a
 * page is a deliberate act rather than a scroll.
 */
const BOOK_PAGE_SIZE = 60;

/** What each shelf action is called, in the reader's words. */
const SHELF_ACTION_LABELS: Record<ShelfAction, string> = {
  add: '加入书架',
  remove: '下架',
  // Aliases of the two above: the server accepts both spellings and folds them into
  // one write, so the labels are the same words rather than a second verb.
  hide: '下架',
  unhide: '加入书架',
};

interface LibraryState {
  /** Which of the two pages is on screen. Owned by the route, like the path. */
  view: 'preview' | 'files';
  path: string;
  page: number;
  /**
   * Both listings, held together.
   *
   * `files` is the raw directory and `books` is the indexed subset of it, and the
   * preview's own page count comes from the *books* total rather than from the file
   * total — a folder of forty files holding twelve books is one page of covers.
   */
  files: BrowseListing | null;
  books: Book[];
  booksTotal: number;
  /** How many of the books on this page are not on the reader's shelf. */
  offShelf: number;
  /** Which entries are ticked, on the files page. Empty means "navigate" mode. */
  selected: ReadonlySet<string>;
  loading: boolean;
  /** A write is in flight; every other write is refused until it settles. */
  busy: boolean;
  status: string;
  dialog: Dialog | null;
  settingsOpen: boolean;
  /** Bumped after a mutation so the cached cover URLs re-key, not re-fetch. */
  revision: number;
}

/**
 * The library screen.
 *
 * One class, two `view` branches, because the two pages share everything that is
 * expensive to get right: the folder, the page, the writability of the mount, the
 * busy/status/dialog state and the reload-after-a-write protocol. Splitting them
 * into two classes would mean two copies of "a write reloads the listing and the
 * listing does not overwrite the write's report", which is the one piece of
 * sequencing in this screen that a copy gets wrong.
 */
export class LibraryScreen {
  readonly element: HTMLDivElement;
  private readonly ui: ReturnType<typeof mountUI>;
  private readonly state: LibraryState;
  private readonly uploadInput = document.createElement('input');
  private readonly draw: () => void;
  /** The message a completed write left for the next render. */
  private outcome: string | null = null;

  constructor(private readonly options: LibraryScreenOptions) {
    this.element = document.createElement('div');
    this.element.className = 'library-screen';
    /*
     * Which half is showing, on the *element*.
     *
     * The stylesheet dims the file page's ⋯ menu through `[data-writable]` the same
     * way, and the two attributes are the same idea: a fact about the screen that CSS
     * acts on and a test or a review driver can select on without reading the tree.
     * Without it, "which page am I looking at" is only knowable from the segmented
     * control's `aria-pressed`, which is a property of a *control* rather than of the
     * screen the reader is on.
     */
    this.element.dataset['view'] = options.view;

    // A file input lives outside the tree on purpose: it is never re-created, so
    // its `files` list and its focus survive every re-render. On some WebViews a
    // file input removed from the document loses its value, and the second upload
    // after a cancel would then send nothing.
    this.uploadInput.type = 'file';
    this.uploadInput.multiple = true;
    this.uploadInput.className = 'manager-upload-input';
    this.uploadInput.setAttribute('aria-hidden', 'true');
    this.uploadInput.tabIndex = -1;
    this.uploadInput.addEventListener('change', () => void this.handlePicked());

    const host = document.createElement('div');
    // `display: contents`, so the host adds no layout box and the screen stays the
    // flex column its children are written against.
    host.className = 'library-ui';
    this.element.append(host, this.uploadInput);

    this.state = {
      view: options.view,
      path: options.path,
      page: options.page > 0 ? options.page : 1,
      files: null,
      books: [],
      booksTotal: 0,
      offShelf: 0,
      selected: new Set<string>(),
      loading: false,
      busy: false,
      status: '',
      dialog: null,
      settingsOpen: false,
      revision: 0,
    };

    this.draw = (): void => this.ui.update(this.state);
    this.ui = mountUI(host, () => this.view(), this.state);
  }

  /**
   * Shows the folder, page and half the route asks for.
   *
   * The path, the page *and the view* all come from the URL rather than from this
   * screen's own memory, so a deep link, a Back and a forward walk all arrive here
   * the same way: the route is the request, and this method is only the executor.
   */
  async open(path: string, page: number, view: 'preview' | 'files' = this.state.view): Promise<void> {
    const switching = view !== this.state.view;
    this.state.view = view;
    this.state.page = page > 0 ? page : 1;
    this.element.dataset['view'] = view;
    // Switching tabs invalidates the tick selection: the paths it held are rows of a
    // list that is not on screen any more, and a batch action that includes an
    // invisible row is the one way this screen can delete something the reader did
    // not tick.
    if (switching) this.state.selected = new Set<string>();
    await this.load(path);
  }

  private async load(path: string): Promise<void> {
    if (this.state.loading) return;
    this.state.loading = true;
    if (!this.state.status) this.setStatus('载入中…');
    this.draw();
    try {
      // Both in one `Promise.all`, because they are two halves of one folder: the
      // file listing is what says how many things are here and how big, and the book
      // listing is what the grid needs. Fetching them in sequence would make the
      // breadcrumb appear and *then* the page numbers move.
      const [files, books] = await Promise.all([
        this.options.api.browse(path, this.state.page),
        this.options.api.listBooks({ path, page: this.state.page, pageSize: BOOK_PAGE_SIZE }).catch(
          // A server that has not learned the `path` filter yet answers the whole
          // shelf, which would be a *wrong* folder shown under a right breadcrumb.
          // An empty grid is the honest answer to "this server cannot tell me".
          () => ({ items: [] as Book[], total: 0, page: 1, pageSize: BOOK_PAGE_SIZE }),
        ),
      ]);
      if (this.state.view === 'preview') await this.options.offline.replaceBooks(books.items);
      this.state.files = files;
      this.state.books = sortBooks(books.items, this.options.settings.shelfSort);
      this.state.booksTotal = books.total;
      this.applyWritable(files.writable);
      this.state.path = files.path;
      // The status line describes what was just done, when something was. A plain
      // listing has nothing to report but the summary the tree computes.
      this.state.status = this.outcome ?? '';
      // A reload invalidates any selection, for the reason `open` does.
      this.state.selected = new Set<string>();
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.loading = false;
      this.draw();
    }
  }

  /** The mount's writability, read by CSS rather than branched on in the tree. */
  private applyWritable(writable: boolean): void {
    this.element.dataset['writable'] = String(writable);
  }

  private get writable(): boolean {
    return this.state.files?.writable ?? false;
  }

  private setStatus(text: string): void {
    this.state.status = text;
  }

  private toast(text: string): void {
    this.state.status = text;
    this.draw();
  }

  private handleError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.isAuthFailure) {
        this.options.onSignedOut();
        return;
      }
      this.setStatus(err.message);
      return;
    }
    this.setStatus(err instanceof Error ? err.message : '出错了');
  }

  // ---- navigation ----

  /**
   * Turns to a page, on whichever half is showing.
   *
   * The screen does not change its own page: it *reports* the intent and the shell
   * writes the URL, which comes back through `open`. That round trip is what makes
   * a page survive Back, Forward and a reload.
   */
  private goToPage(page: number): void {
    const count = this.pageCount();
    const target = Math.min(Math.max(1, page), count);
    if (target === this.state.page) return;
    this.options.onOpenLibrary(this.state.path, target, this.state.view, true);
  }

  private pageCount(): number {
    if (this.state.view === 'preview') {
      return Math.max(1, Math.ceil(this.state.booksTotal / BOOK_PAGE_SIZE));
    }
    const total = this.state.files?.total ?? 0;
    return Math.max(1, Math.ceil(total / FILE_PAGE_SIZE));
  }

  private openFolder(path: string): void {
    // Always page one: page three of the folder the reader just left is not a place
    // it makes sense to arrive in.
    this.options.onOpenLibrary(path, 1, this.state.view, true);
  }

  private switchView(view: 'preview' | 'files'): void {
    if (view === this.state.view) return;
    // Page one on the switch, and for the reason the two views have different page
    // counts: page four of the file list is page four of nothing in a grid of
    // twelve books, and a tab that lands on an empty page reads as a broken tab.
    this.options.onOpenLibrary(this.state.path, 1, view, true);
  }

  // ---- selection, on the files page ----

  private select(paths: Iterable<string>): void {
    this.state.selected = new Set(paths);
    this.draw();
  }

  private toggle(entry: BrowseEntry): void {
    const selected = new Set(this.state.selected);
    if (selected.has(entry.path)) selected.delete(entry.path);
    else selected.add(entry.path);
    this.state.selected = selected;
    this.draw();
  }

  private selectedList(): string[] {
    return [...this.state.selected];
  }

  /**
   * One tap on a row.
   *
   * The row navigates; the checkbox that appears in selection mode is what selects.
   * That split is the whole reason a destructive tap cannot happen while scrolling a
   * library of ten thousand files.
   */
  private activate(entry: BrowseEntry): void {
    if (entry.type === 'other') return;
    if (this.state.selected.size > 0) {
      this.toggle(entry);
      return;
    }
    if (entry.type === 'dir') this.openFolder(entry.path);
  }

  // ---- writes ----

  private async openEntryMenu(entry: BrowseEntry): Promise<void> {
    if (!this.writable) {
      this.toast('书库是只读挂载，无法修改');
      return;
    }
    /*
     * The shelf entry names the action that applies to *this* book.
     *
     * `shelfState` is `'on'`, `'off'` or `null`, and only one of the three means
     * anything here: `null` is a folder or a non-book. Offering "从书架拿掉" for a
     * book that is already off the shelf answers the same word whatever the book's
     * state, so a reader looking at a book *missing* from their shelf had no way to
     * put it back.
     */
    const action = await this.pick(`「${entry.name}」`, [
      { value: 'select', label: '选择' },
      { value: 'metadata', label: '改资料' },
      ...(entry.shelfState === 'on'
        ? [{ value: 'shelve:remove', label: '从书架拿掉' }]
        : entry.shelfState === 'off'
          ? [{ value: 'shelve:add', label: '放回书架' }]
          : []),
      { value: 'rename', label: '重命名' },
      { value: 'move', label: '移动到…' },
      { value: 'delete', label: '删除' },
    ]);
    if (action === 'select') {
      this.toggle(entry);
      return;
    }
    // Everything below acts on exactly this row, so the selection is replaced
    // rather than merged: an action started from one row's menu must not quietly
    // include a batch ticked earlier and now off screen.
    this.select([entry.path]);
    if (action === 'metadata') return this.promptBatchMetadata();
    if (action === 'shelve:add') return this.batchShelf('add');
    if (action === 'shelve:remove') return this.batchShelf('remove');
    if (action === 'rename') return this.promptRename(entry.path, entry.name);
    if (action === 'move') return this.promptMove();
    if (action === 'delete') return this.confirmDelete();
  }

  private async promptRename(path: string, currentName: string): Promise<void> {
    const name = await this.prompt('重命名', currentName);
    if (name === null || name.trim() === '' || name === currentName) return;
    await this.mutate(() => this.options.api.browseRename(path, name.trim()), `重命名 ${currentName}`);
  }

  private async promptMkdir(): Promise<void> {
    const name = await this.prompt('新建文件夹', '');
    if (name === null || name.trim() === '') return;
    await this.mutate(() => this.options.api.browseMkdir(this.state.path, name.trim()), `新建 ${name.trim()}`);
  }

  /**
   * Moving a batch asks for a path rather than offering a folder picker.
   *
   * A picker would be a second navigation UI inside the first, and the one place a
   * reader is most likely to land in the wrong folder is precisely where the files
   * go. A typed, library-relative path is unambiguous.
   */
  private async promptMove(): Promise<void> {
    const target = await this.prompt('移动到（书库内的路径，留空为根目录）', this.state.path);
    if (target === null) return;
    const paths = this.selectedList();
    await this.mutate(() => this.options.api.browseMove(paths, target.trim()), `移动 ${paths.length} 项`);
  }

  private async confirmDelete(): Promise<void> {
    const count = this.state.selected.size;
    const ok = await this.confirm(
      `删除 ${count} 项？`,
      '文件会从磁盘上直接删除，不进回收站。删除后需要重新扫描书库，书架才会更新。',
    );
    if (!ok) return;
    const paths = this.selectedList();
    await this.mutate(() => this.options.api.browseDelete(paths), `删除 ${paths.length} 项`);
  }

  private async promptBatchMetadata(): Promise<void> {
    const paths = this.selectedList();
    if (paths.length === 0) return;
    const fields = await this.batchMetadataDialog(paths.length);
    if (fields === null) return;
    if (Object.keys(fields).length === 0) {
      this.toast('没有填写任何字段');
      return;
    }
    await this.mutate(
      () => this.options.api.browseBatchMetadata(paths, fields),
      `改资料（${paths.length} 项）`,
      (result) => this.reportBatch(result),
    );
  }

  /**
   * Puts books on the caller's shelf, or takes them off it.
   *
   * Only `remove` confirms, and only `remove` needs to: it is the one that takes
   * something away. Adding is the reader saying "show me this", and a dialog in
   * front of it would be a dialog in front of the repair — which is what 加入书架
   * on a preview card is.
   */
  private async batchShelf(action: ShelfAction, paths = this.selectedList()): Promise<void> {
    if (paths.length === 0) return;
    const label = SHELF_ACTION_LABELS[action];
    if (action === 'remove') {
      const ok = await this.confirm(
        `${label} ${paths.length} 项？`,
        '只是从你的书架上拿掉，磁盘上的文件一个都不会动，随时可以放回来。',
      );
      if (!ok) return;
    }
    await this.mutate(
      () => this.options.api.browseBatchShelf(paths, action),
      `${label}（${paths.length} 项）`,
      (result) => this.reportBatch(result),
    );
  }

  /**
   * Shelves one book from a preview card, by the path it lives at.
   *
   * The card knows the *book*; the shelf endpoint takes *paths*. The two are joined by
   * the browse listing the same folder produced, and — because `shelvableTitles` only
   * offers the control for a book whose file *this page* can name — the lookup here
   * cannot fail for a button that was drawn. It returns `[]` rather than throwing if
   * it somehow does, because a write with no paths is a no-op and a crash in a click
   * handler is a dead button.
   */
  private shelvePaths(books: Book[]): string[] {
    const entries = this.state.files?.entries ?? [];
    const byName = new Map<string, BrowseEntry>();
    // Indexed by the filename *without* its extension: `title` is the embedded
    // metadata and `name` is what is on disk, so a book whose title was edited by
    // hand no longer matches its filename — and the join therefore has to try the
    // names the server's own scanner could have matched it by.
    for (const entry of entries) {
      if (entry.type !== 'file') continue;
      byName.set(stem(entry.name), entry);
    }
    return [
      ...new Set(
        books
          .map(
            (book) =>
              byName.get(stem(book.title))?.path ??
              byName.get(stem(book.source))?.path ??
              byName.get(stem(book.id))?.path,
          )
          .filter((path): path is string => path !== undefined && path !== ''),
      ),
    ];
  }

  private async shelveBooks(books: Book[]): Promise<void> {
    const paths = this.shelvePaths(books);
    if (paths.length === 0) return;
    await this.batchShelf('add', paths);
  }

  /**
   * Uploads the picked files into the directory currently open.
   *
   * The progress line is the whole point of the display: a book is routinely
   * hundreds of megabytes on a phone over Wi-Fi, and a screen that says nothing for
   * two minutes reads as broken. The input is cleared *before* the upload rather
   * than after, so picking the same file twice in a row works.
   */
  private async handlePicked(): Promise<void> {
    const files = [...(this.uploadInput.files ?? [])];
    this.uploadInput.value = '';
    if (files.length === 0) return;
    if (!this.writable) {
      this.toast('书库是只读挂载，无法上传');
      return;
    }

    const policy = await this.pickConflictPolicy();
    if (!policy) return;

    const total = files.reduce((sum, file) => sum + file.size, 0);
    this.state.busy = true;
    this.draw();
    try {
      const result = await this.options.api.upload(files, this.state.path, policy, (fraction) => {
        this.toast(`上传中… ${Math.round(fraction * 100)}%（${formatBytes(total)}）`);
      });
      /*
       * The directory is re-read before the report, and both are in this `try`.
       *
       * A report with no reload is a list that does not contain the thing just
       * uploaded, which reads as a failed upload whatever the message above it says.
       * Reloading is what makes the report *true*.
       */
      this.outcome = this.describeUpload(result);
      await this.load(this.state.path);
      this.outcome = null;
      this.toast(this.describeUpload(result));
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.busy = false;
      this.draw();
    }
  }

  private async pickConflictPolicy(): Promise<'rename' | 'skip' | 'overwrite' | 'fail' | null> {
    const answer = await this.pick('同名文件怎么办？', [
      { value: 'rename', label: '两份都留（加 (2)）' },
      { value: 'skip', label: '跳过已有的' },
      { value: 'overwrite', label: '覆盖（会替换原文件）' },
      { value: 'fail', label: '有重名就整批不动' },
    ]);
    return answer as 'rename' | 'skip' | 'overwrite' | 'fail' | null;
  }

  /**
   * What an upload did, as a sentence.
   *
   * A function rather than a `toast` call because the message has to survive the
   * reload the upload triggers: the reload's own status line is the directory
   * summary, and the summary is not an answer to "did it work".
   */
  private describeUpload(result: Awaited<ReturnType<ReaderApi['upload']>>): string {
    const parts: string[] = [];
    if (result.uploaded.length > 0) parts.push(`已入库 ${result.uploaded.length} 个文件`);
    if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length} 个`);
    const added = result.scan?.added ?? 0;
    parts.push(added > 0 ? `新增 ${added} 本` : '没有新书');
    // A skipped file is the one thing the user has to act on, so it is named rather
    // than counted: "跳过 1 个" without a name is a dead end.
    const first = result.skipped[0];
    if (first) parts.push(`（${first.name}：${first.reason}）`);
    return parts.join(' · ');
  }

  /**
   * What a batch write did, as a sentence.
   *
   * Defensive about the response's shape, and not out of caution: this runs in a
   * `.then` on a request whose *answer* is the only thing that says how many books
   * were touched, and a server that answers a batch with an empty body would make the
   * sentence throw — which turns "已更新 12 本" into an unhandled rejection with no
   * message at all. A count of zero and a skipped count of zero is the honest reading
   * of "the server told me nothing".
   */
  private reportBatch(result: { applied?: number; failed?: Array<{ path: string; reason: string }> }): string {
    const applied = result.applied ?? 0;
    const failed = result.failed ?? [];
    if (applied === 0 && failed.length > 0) {
      return `没有可处理的书籍（${failed.length} 项不是书）`;
    }
    const skipped = failed.length > 0 ? `，跳过 ${failed.length} 项` : '';
    return `已更新 ${applied} 本${skipped}`;
  }

  /**
   * Runs a mutating call, reports its outcome, and reloads only on success.
   *
   * The order matters: reloading after a *failed* write would replace the error
   * message with a fresh directory listing, so the screen would look like the rename
   * simply did not happen — the worst possible answer to "why did nothing change".
   */
  private async mutate(
    action: () => Promise<unknown>,
    label: string,
    describe?: (result: never) => string,
  ): Promise<void> {
    if (this.state.busy) return;
    this.state.busy = true;
    this.toast(`${label}…`);
    this.draw();
    let result: unknown;
    try {
      result = await action();
    } catch (err) {
      this.handleError(err);
      this.state.busy = false;
      this.draw();
      return;
    }
    this.outcome = describe ? describe(result as never) : `${label} 完成`;
    this.setStatus(this.outcome);
    await this.load(this.state.path);
    this.outcome = null;
    this.state.busy = false;
    this.draw();
  }

  // ---- dialogs ----

  private batchMetadataDialog(count: number): Promise<Record<string, string> | null> {
    return new Promise((resolve) => {
      this.state.dialog = { kind: 'form', title: `改资料（${count} 项）`, count, fields: METADATA_FIELDS, resolve };
      this.draw();
    });
  }

  private prompt(title: string, value: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.state.dialog = { kind: 'prompt', title, value, resolve };
      this.draw();
    });
  }

  private confirm(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.state.dialog = { kind: 'confirm', title, body, resolve };
      this.draw();
    });
  }

  private async pick(title: string, options: Array<{ value: string; label: string }>): Promise<string | null> {
    // De-duplicated by value: two rows that resolve to the same action are one
    // action, and showing it twice reads as two different things.
    const seen = new Set<string>();
    const unique = options.filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
    return new Promise((resolve) => {
      this.state.dialog = { kind: 'pick', title, options: unique, resolve };
      this.draw();
    });
  }

  private closeDialog(answer: DialogAnswer): void {
    const dialog = this.state.dialog;
    this.state.dialog = null;
    this.draw();
    if (!dialog) return;
    if (dialog.kind === 'prompt') dialog.resolve(answer as string | null);
    else if (dialog.kind === 'confirm') dialog.resolve(answer as boolean);
    else if (dialog.kind === 'pick') dialog.resolve(answer as string | null);
    else dialog.resolve(answer as Record<string, string> | null);
  }

  // ---- the tree ----

  private view(): ComponentChildren {
    const files = this.state.files;
    const preview = this.state.view === 'preview';
    return (
      <>
        <div className="panel-header library-header">
          <IconButton label="返回" icon="arrow-left" onClick={() => this.options.onClose()} />
          <LibraryTabs view={this.state.view} onSwitch={(view) => this.switchView(view)} />
          <div className="manager-crumbs">
            {(files?.crumbs ?? []).map((crumb, index) => (
              <>
                {index > 0 ? <span className="manager-crumb-sep">/</span> : null}
                <button
                  type="button"
                  key={`${crumb.path}#${index}`}
                  className="manager-crumb"
                  aria-current={index === (files?.crumbs.length ?? 0) - 1}
                  onClick={() => this.openFolder(crumb.path)}
                >
                  {crumb.name}
                </button>
              </>
            ))}
          </div>
          {/* The write controls belong to the *file* page and are hidden on the
              preview: uploading a book and creating a folder are things done to a
              directory, and the preview is a page of covers with no rows to act on.
              The density and display controls are the preview's own, and sit on the
              other side of the same bar. */}
          {preview ? (
            <IconButton
              label={`书架设置 · ${this.options.settings.shelfDensity}`}
              icon="tune"
              onClick={() => this.patch({ settingsOpen: !this.state.settingsOpen })}
            />
          ) : (
            <>
              {/* Hidden rather than omitted, with `hidden` as the state: a control
                  that can only answer 403 teaches the reader to distrust every other
                  control, and *which* controls are missing is what this says. */}
              <IconButton
                label="上传书籍"
                icon="file-arrow-up"
                hidden={!this.writable}
                disabled={this.state.busy}
                onClick={() => this.uploadInput.click()}
              />
              <IconButton
                label="新建文件夹"
                icon="plus"
                hidden={!this.writable}
                disabled={this.state.busy}
                onClick={() => void this.promptMkdir()}
              />
            </>
          )}
        </div>

        <div
          className="manager-body"
          onClick={(event) => {
            // Clicking the empty area clears a selection, which is the gesture people
            // already have for "never mind". The check is on the target so a click
            // inside a row (which bubbles) does not.
            if (event.target === event.currentTarget) this.select([]);
          }}
        >
          {this.state.loading && files === null ? <div className="spinner" /> : null}
          {preview ? this.previewBody() : this.filesBody()}
          {this.pageCount() > 1 ? (
            <Pager
              className={preview ? 'shelf-pager' : 'manager-pager'}
              page={this.state.page}
              pageCount={this.pageCount()}
              busy={this.state.loading}
              onGo={(page) => this.goToPage(page)}
            />
          ) : null}
          <div className="manager-status muted">{this.state.status || this.summary(files)}</div>
        </div>

        {!preview ? (
          <SelectionBar
            count={this.state.selected.size}
            writable={this.writable}
            only={[...this.state.selected][0]}
            entries={files?.entries ?? []}
            onClear={() => this.select([])}
            onRename={(path, name) => void this.promptRename(path, name)}
            onMetadata={() => void this.promptBatchMetadata()}
            onShelve={() => void this.batchShelf('remove')}
            onUnshelve={() => void this.batchShelf('unhide')}
            onMove={() => void this.promptMove()}
            onDelete={() => void this.confirmDelete()}
          />
        ) : null}
        {!preview && this.state.selected.size > 0 ? (
          <div className="manager-selection">已选 {this.state.selected.size} 项</div>
        ) : null}
        {this.state.dialog ? (
          <DialogView
            dialog={this.state.dialog}
            onClose={(answer) => this.closeDialog(answer)}
            destructive="删除"
          />
        ) : null}
        <ShelfSettingsPanel
          open={this.state.settingsOpen}
          settings={this.options.settings}
          onPatch={(patch) => this.options.onSettingsChange(patch)}
          onClose={() => this.patch({ settingsOpen: false })}
        />
      </>
    );
  }

  /** The grid of books in this folder, with the shelf repair on each card. */
  private previewBody(): ComponentChildren {
    if (this.state.files !== null && this.state.books.length === 0) {
      return (
        <div className="empty-state">
          <Icon name="book" class="empty-glyph" />
          <p>{this.state.files.total === 0 ? '这个文件夹是空的' : '这个文件夹里没有可阅读的书'}</p>
          <p className="muted">
            {this.state.files.total === 0
              ? '用文件页的上传按钮放几本进来'
              : `${this.state.files.files} 个文件里，没有被扫描成书的；被忽略的文件在文件页能看到原因`}
          </p>
          <div className="empty-actions">
            <IconTextButton icon="file-lines" label="看文件" onClick={() => this.switchView('files')} />
          </div>
        </div>
      );
    }
    const shelvable = this.shelvableTitles();
    return (
      <>
        <div className="library-preview-hint muted">
          {this.state.offShelf > 0
            ? `这一页有 ${this.state.offShelf} 本还不在书架上，点封面右下角可以加进去`
            : ''}
        </div>
        <div
          className="book-grid library-preview-grid"
          data-density={this.options.settings.shelfDensity}
          data-showAuthor={String(this.options.settings.shelfShowAuthor)}
          data-show-progress={String(this.options.settings.shelfShowProgress)}
        >
          {this.state.books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              revision={this.state.revision}
              api={this.options.api}
              progress={this.options.offline.progressFor(book.id)}
              onOpen={() => this.options.onOpenBook(book)}
              {...(shelvable.has(book.title)
                ? { onShelve: () => void this.shelveBooks([book]) }
                : {})}
            />
          ))}
        </div>
      </>
    );
  }

  /**
   * *Can this book be shelved from here* — and the count for the line above the grid.
   *
   * The question is deliberately not "is this book on the shelf", and the difference
   * is the whole reason this is one function rather than a set membership test at the
   * card. The endpoint takes **paths**, and a book DTO has no path: the file the book
   * lives in is only knowable from the browse listing, which is *paged*. So on page
   * two of a folder, a book whose file is on page one cannot be shelved from here —
   * and the honest answer is to draw no control, rather than a control that reports
   * "找不到这些书在磁盘上的路径" when it is pressed.
   *
   * Three states come out of this and the card reads all three:
   *
   *  - **file here, `shelfState: 'on'`** → nothing to do, no control;
   *  - **file here, `shelfState: 'off'`** → 加入书架, which is the page's whole point;
   *  - **file not on this page** → no control, because this page cannot name it.
   *
   * The count is of the second group, from the page the reader is looking at: a line
   * that counted the *folder* would disagree with the badges under it.
   */
  private shelvableTitles(): Set<string> {
    const entries = this.state.files?.entries ?? [];
    const byName = new Map<string, BrowseEntry>();
    for (const entry of entries) {
      if (entry.type !== 'file') continue;
      byName.set(stem(entry.name), entry);
    }
    const shelvable = new Set<string>();
    for (const book of this.state.books) {
      const entry =
        byName.get(stem(book.title)) ?? byName.get(stem(book.source)) ?? byName.get(stem(book.id));
      // `'on'` and `null` are both "nothing to offer": the first is already on the
      // shelf, and the second is a file the server does not index as a book — a page
      // image, a stray `.nfo` — which the shelf endpoint would refuse anyway.
      if (entry?.shelfState === 'off' && this.state.files?.writable !== false) {
        shelvable.add(book.title);
      }
    }
    this.state.offShelf = shelvable.size;
    return shelvable;
  }

  /** The file rows. */
  private filesBody(): ComponentChildren {
    const listing = this.state.files;
    return (
      <div className="manager-list">
        {listing && listing.total === 0 ? (
          <div className="empty-state">
            <p>这个文件夹是空的</p>
          </div>
        ) : null}
        {(listing?.entries ?? []).map((entry) => (
          <Row
            key={entry.path}
            entry={entry}
            selecting={this.state.selected.size > 0}
            selected={this.state.selected.has(entry.path)}
            onActivate={() => this.activate(entry)}
            onToggle={() => this.toggle(entry)}
            onMenu={() => void this.openEntryMenu(entry)}
          />
        ))}
      </div>
    );
  }

  private patch(patch: Partial<LibraryState>): void {
    Object.assign(this.state, patch);
    // Kept in step with the state rather than set once, because the whole point of
    // the attribute is that it describes what is on screen *now*.
    this.element.dataset['view'] = this.state.view;
    this.draw();
  }

  /**
   * The directory summary, shown until something has something better to say.
   *
   * Kept as a function of the listing rather than written into the status line at
   * load time, because the two used to fight: a report set by a completed write was
   * overwritten by the summary of the reload that write triggered, so the one message
   * the reader had to read was the one message they never saw.
   */
  private summary(listing: BrowseListing | null): string {
    if (listing === null) return '';
    if (this.state.view === 'preview') {
      const parts = [`${this.state.booksTotal} 本`];
      if (this.state.booksTotal > 0) {
        parts.push(`第 ${this.state.page} / ${this.pageCount()} 页`);
      }
      return parts.join(' · ');
    }
    if (listing.total === 0) {
      return listing.writable ? '空文件夹 · 可以用右上角的新建按钮添加子目录' : '空文件夹';
    }
    /*
     * The counts are the directory's, and the page is named when there is more than
     * one. "400 个文件" under a screen showing 200 of them is a correct sentence and
     * a confusing one; saying which page it is makes the number and the rows agree.
     */
    const hidden = listing.entries.filter((entry) => entry.hidden || entry.hiddenByRule).length;
    const parts = [`${listing.dirs} 个文件夹`, `${listing.files} 个文件`, formatBytes(listing.size)];
    if (hidden > 0) parts.push(`${hidden} 个被扫描忽略`);
    if (this.pageCount() > 1) parts.push(`第 ${this.state.page} / ${this.pageCount()} 页`);
    return parts.join(' · ');
  }

  dispose(): void {
    this.closeDialog(null);
    this.ui.unmount();
  }
}

/**
 * A file's name without its extension.
 *
 * This is the join between a *book* and the *file* it lives in, and it is the only
 * one available: `BookDto` carries a title and a `source` (the embedded metadata's
 * own idea of where it came from) but never a path, while the browse listing carries
 * paths and filenames. Stripping the extension is what makes `第1卷` and `第1卷.epub`
 * the same thing.
 *
 * Defensive about the input because both sides are user data: a `source` may be empty
 * (a book with no embedded metadata) and a title may be empty (a renamed file). An
 * empty stem simply matches nothing, which is the correct answer.
 */
function stem(name: string | undefined | null): string {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * The switch between the library's two pages.
 *
 * Two buttons in a segmented control rather than a tab strip, because there are
 * exactly two of them and they are the same *shape* of choice as the reader's other
 * segmented controls — so the stylesheet for it already exists and the control
 * cannot drift from the rest of the app.
 *
 * The labels are 预览 and 文件 rather than 书架 and 书库: the screen *is* the
 * library, and naming one of its halves with the screen's own name is how a reader
 * ends up unable to tell which one they are looking at.
 */
function LibraryTabs({
  view,
  onSwitch,
}: {
  view: 'preview' | 'files';
  onSwitch(view: 'preview' | 'files'): void;
}): JSX.Element {
  return (
    <div className="segmented library-tabs" role="group" aria-label="书库页面">
      <button type="button" aria-pressed={view === 'preview'} onClick={() => onSwitch('preview')}>
        预览
      </button>
      <button type="button" aria-pressed={view === 'files'} onClick={() => onSwitch('files')}>
        文件
      </button>
    </div>
  );
}

/**
 * A book on the preview grid.
 *
 * The same card as the shelf's, plus one control: a book that is *not* on the shelf
 * gets a 加入书架 affordance on its cover. That control is the whole reason the
 * preview page exists — a file on disk that is not a book on the shelf is the one
 * thing neither the shelf nor the file list could fix in one tap — so it is drawn
 * on the card rather than buried in a selection.
 *
 * The cover is fetched through the same blob cache the shelf uses, keyed on the same
 * URL, so a reader who walks shelf → library → folder does not fetch the same cover
 * three times.
 */
function BookCard({
  book,
  revision,
  api,
  progress,
  onOpen,
  onShelve,
}: {
  book: Book;
  revision: number;
  api: ReaderApi;
  progress: { percentage: number } | undefined;
  onOpen(): void;
  onShelve?: () => void;
}): JSX.Element {
  const url = useCoverUrl(api, book.coverUrl, revision);
  return (
    <div className="book-card is-row">
      <button type="button" className="book-open" aria-label={`${book.title} ${book.author}`.trim()} onClick={onOpen}>
        <div className="cover">
          {url ? (
            <img src={url} alt="" loading="lazy" />
          ) : (
            <div className="placeholder">{book.title.slice(0, 12) || '无封面'}</div>
          )}
          <span className="format-badge">{book.format}</span>
          {progress && progress.percentage > 0.005 ? (
            <div className="cover-progress">
              <span style={`width:${Math.round(Math.min(1, Math.max(0, progress.percentage)) * 100)}%`} />
            </div>
          ) : null}
        </div>
        <div className="title">{book.title || '未命名'}</div>
        <div className="author">{book.author || '未知作者'}</div>
      </button>
      {onShelve ? (
        <button type="button" className="book-shelve" aria-label={`把${book.title}加入书架`} onClick={onShelve}>
          <Icon name="circle-plus" />
          <span>加入书架</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The covers' blob cache.
 *
 * Process-wide and keyed on the cover URL, shared with the shelf by construction:
 * the two screens fetch the same bytes for the same book, and a second cache would
 * be a second copy of every cover in memory.
 */
const coverCaches = new WeakMap<ReaderApi, Map<string, string>>();

function coverCacheFor(api: ReaderApi): Map<string, string> {
  let cache = coverCaches.get(api);
  if (!cache) {
    cache = new Map<string, string>();
    coverCaches.set(api, cache);
  }
  return cache;
}

function useCoverUrl(api: ReaderApi, coverUrl: string | null | undefined, revision: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const cache = coverCacheFor(api);
  useEffect(() => {
    if (!coverUrl) {
      setUrl(null);
      return;
    }
    const hit = cache.get(coverUrl);
    if (hit) {
      setUrl(hit);
      return;
    }
    let live = true;
    void api
      .coverBytes(coverUrl)
      .then((bytes) => {
        const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
        cache.set(coverUrl, objectUrl);
        if (live) setUrl(objectUrl);
      })
      .catch(() => {
        if (live) setUrl(null);
      });
    return () => {
      live = false;
    };
  }, [coverUrl, revision]);
  return url;
}

/**
 * One row of the file list.
 *
 * Kept a component so the long-press timer lives in the row that owns it: a timer
 * held by the screen and pointing at "the last row touched" is how a long press
 * turns into a selection of the row the finger has since left.
 */
interface RowProps {
  entry: BrowseEntry;
  selecting: boolean;
  selected: boolean;
  onActivate(): void;
  onToggle(): void;
  onMenu(): void;
}

function Row({ entry, selecting, selected, onActivate, onToggle, onMenu }: RowProps): JSX.Element {
  const selectable = entry.type !== 'other';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const [down, setDown] = useState(false);

  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // A row can be unmounted mid-press (a reload, a navigation), and a timer that
  // outlives its row would select a path that is no longer on screen.
  useEffect(() => cancel, []);

  const start = (): void => {
    fired.current = false;
    if (!selectable) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      onToggle();
    }, LONG_PRESS_MS);
  };

  const meta: ComponentChildren[] = [
    <span>{entry.type === 'dir' ? '' : formatBytes(entry.size)}</span>,
    <span>{formatDate(entry.mtime)}</span>,
  ];
  if (entry.hiddenByRule) meta.push(<span className="manager-badge warn">扫描忽略</span>);
  else if (entry.scanned) meta.push(<span className="manager-badge">书籍</span>);
  if (entry.hidden && !entry.hiddenByRule) meta.push(<span className="manager-badge">隐藏</span>);
  /*
   * The shelf badge, and only when the answer is "off".
   *
   * "在书架上" on every row of a folder of books that are all on the shelf is a
   * column of noise that hides the one row that is not. The reader is here to find
   * the books that are *missing* from the shelf — that is the question this screen
   * exists to answer — so the mark is on the exception.
   */
  if (entry.shelfState === 'off') meta.push(<span className="manager-badge off">不在书架</span>);

  return (
    <div
      className="manager-row"
      data-type={entry.type}
      data-selected={String(selected)}
      data-down={String(down)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        // A long press already acted; the click that follows must not navigate.
        if (fired.current) {
          fired.current = false;
          event.stopPropagation();
          return;
        }
        onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      onTouchMove={cancel}
      onMouseDown={() => {
        setDown(true);
        start();
      }}
      onMouseUp={() => {
        setDown(false);
        cancel();
      }}
      onMouseLeave={() => {
        setDown(false);
        cancel();
      }}
    >
      <span className="manager-check" aria-hidden="true" />
      <div className="manager-name">
        <Icon name={entry.type === 'dir' ? 'folder' : 'file-lines'} class="manager-icon" />
        <span className="manager-label">{entry.name}</span>
      </div>
      <div className="manager-meta muted">{meta}</div>
      {selectable || selecting ? (
        <IconButton
          label={`${entry.name} 的操作`}
          icon="ellipsis"
          class="manager-more"
          onClick={() => {
            cancel();
            onMenu();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The batch action bar.
 *
 * Rendered only while something is selected: an always-present toolbar of
 * move/delete buttons on a screen whose primary gesture is tapping a folder is a
 * permanent invitation to the wrong action.
 */
interface SelectionBarProps {
  count: number;
  writable: boolean;
  only: string | undefined;
  entries: BrowseEntry[];
  onClear(): void;
  onRename(path: string, name: string): void;
  onMetadata(): void;
  onShelve(): void;
  onUnshelve(): void;
  onMove(): void;
  onDelete(): void;
}

function SelectionBar(props: SelectionBarProps): JSX.Element {
  if (props.count === 0) return <div className="manager-actions" hidden />;
  const name = props.entries.find((entry) => entry.path === props.only)?.name ?? '';
  return (
    <div className="manager-actions">
      <Button onClick={props.onClear}>取消</Button>
      {props.writable ? (
        <>
          {props.count === 1 && props.only !== undefined ? (
            <Button onClick={() => props.onRename(props.only!, name)}>重命名</Button>
          ) : null}
          <Button onClick={props.onMetadata}>改资料</Button>
          {/*
            Both shelf directions are shown, and shown *always*: a selection can hold
            a mixture and the reader's intent is "make these match", which has a
            direction. Hiding one of the two behind a state check would mean a
            selection that is half on and half off the shelf could only be pushed one
            way.
          */}
          <Button onClick={props.onShelve}>下架</Button>
          <Button onClick={props.onUnshelve}>加入书架</Button>
          <Button onClick={props.onMove}>移动…</Button>
          <Button className="danger" onClick={props.onDelete}>
            删除
          </Button>
        </>
      ) : (
        <span className="muted">书库是只读挂载，无法修改</span>
      )}
    </div>
  );
}
