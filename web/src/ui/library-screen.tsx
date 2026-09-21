import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Book, BrowseEntry, BrowseListing } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { AppSettings } from '../store/settings.ts';
import { formatBytes, formatDate } from './dom.ts';
import { mountUI } from './mount.ts';
import { DialogView, METADATA_FIELDS, type Dialog, type DialogAnswer } from './dialog.tsx';
import { Pager } from './pager.tsx';
import { ShelfSettingsPanel } from './shelf-settings.tsx';
import { sortBooks } from './shelf-order.ts';
import { describeShelfAction, SHELF_ACTION_LABELS } from './shelf-membership.ts';
import { Button, Icon, IconButton, IconTextButton } from './toolkit.tsx';
import { type ComponentChildren, type JSX, useEffect, useRef, useState } from './vendor/preact.ts';

/**
 * 书库 — two screens over one place: browsing, and file management.
 *
 * ## Why the two halves are two screens
 *
 * The library is the server's `BOOKS_DIR`, and two questions are asked about it that
 * used to be answered by one screen with a tab in it:
 *
 *  - **"what is in here"** — answered by `LibraryBrowseScreen`: a grid of the books
 *    in a folder, a search field, and 加入书架 on the books that are not on the
 *    reader's shelf. This is the *reader's* half.
 *  - **"where did my book go, and let me move it"** — answered by
 *    `LibraryFilesScreen`: the file manager. This is the *administrator's* half, and
 *    the review's second round (#40) asked for it to be one: 上传, 重命名, 移动 and
 *    删除 all write to the server's disk, and a reader who only reads has no business
 *    on a page whose every control does that.
 *
 * ### What was wrong with one screen and two tabs
 *
 * The tab made the two halves *the same page*, which forced three false statements:
 *
 *  1. **One header for two lists.** The browsing half is a shop: a search field, a
 *     grid of covers sized to the window, and one action per card. The file half is
 *     an inventory: a breadcrumb, rows, badges and a batch bar. Sharing a header
 *     meant the breadcrumb appeared on the shop and the search field had to be left
 *     out of the inventory, and neither half's toolbar could be designed for itself.
 *  2. **One reachability rule.** `#/library/科幻` opened covers and the file manager
 *     was one press away on *every* link — so a URL a reader is handed led to a
 *     screen that can delete their books. Two routes make the browsing page the one
 *     a shared link opens and the file manager a place an administrator navigates to.
 *  3. **One page number.** The two halves paginate different lists at different
 *     sizes (60 covers, 200 rows), so switching had to reset the page, and "page 4"
 *     meant two different things depending on which tab was up.
 *
 * ### What they still share
 *
 * The folder they are about, the query-string and path vocabulary in the URL, and the
 * join between a *book* and the *file* it lives in (`stem`, below), which is the only
 * thing that makes "this file is not on your shelf" a statement anyone can make. The
 * switch between them is one control on each header, and it is a *navigation*: Back
 * returns to the half the reader was on, which is the correct reading of two screens
 * with two audiences.
 */

export interface LibraryBrowseScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  settings: AppSettings;
  /** The screen's own preferences (density, author visibility), persisted like the shelf's. */
  onSettingsChange(patch: Partial<AppSettings>): void;
  /** The folder, page and search the route asks for. */
  path: string;
  page: number;
  search: string;
  /** The reader came here from the shelf, so leaving goes back there. */
  fromShelf: boolean;
  /** Open the file manager. A navigation, not a tab switch — see the note above. */
  onOpenFiles(): void;
  onOpenBook(book: Book): void;
  /**
   * Walk to a folder, turn to a page, and/or change the search.
   *
   * All three *replace* the current entry: they are the same screen changing its own
   * argument, and a walk that pushed would make Back retrace the folders instead of
   * leaving the library. The search replaces for the same reason a page does — the
   * reader typing is one place changing, not a stack of queries.
   */
  onOpenBrowse(path: string, page: number, search: string, replace: boolean): void;
  /** Leave the library: back to the shelf, or out of the app. */
  onClose(): void;
  onSignedOut(): void;
}

export interface LibraryFilesScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  settings: AppSettings;
  onSettingsChange(patch: Partial<AppSettings>): void;
  path: string;
  page: number;
  fromShelf: boolean;
  /** Open the browsing half. A navigation — see `LibraryBrowseScreenOptions`. */
  onOpenBrowse(path: string): void;
  onOpenBook(book: Book): void;
  onOpenLibrary(path: string, page: number, replace: boolean): void;
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
 * Books per page of the browsing grid.
 *
 * The same number the shelf uses, for the same reason it is that number: 60 is a
 * grid of about twenty rows at the phone's default density, enough that turning a
 * page is a deliberate act rather than a scroll.
 */
const BOOK_PAGE_SIZE = 60;

/* ------------------------------------------------------------------ *
 * The browsing half — the reader's page
 * ------------------------------------------------------------------ */

interface BrowseState {
  path: string;
  page: number;
  /** What is in the field; `query` is the debounced value the URL carries. */
  search: string;
  query: string;
  /** The books of this folder that match the query, and how many there are. */
  books: Book[];
  total: number;
  /** The folder's own listing, for the crumbs and for the file→book join. */
  listing: BrowseListing | null;
  /** How many of the books on this page are not on the reader's shelf. */
  offShelf: number;
  loading: boolean;
  bootstrapping: boolean;
  busy: boolean;
  status: string;
  settingsOpen: boolean;
  /** A question the screen is waiting on an answer to (the upload conflict policy). */
  dialog: Dialog | null;
  /** Bumped after a mutation so the cached cover URLs re-key, not re-fetch. */
  revision: number;
}

/**
 * 书库 · 浏览 — the shop.
 *
 * ## Why it looks like a shop rather than like a list
 *
 * The report asked for 类似一个商城的布局, and the shape that produces is not
 * decoration: a shop shows as many covers as the window fits, in rows that fill it,
 * with the *search* at the top because that is how a browser narrows a catalogue.
 * The shelf's grid is capped by `--shelf-measure` and shows the reader's own books
 * at a density they chose; this one is uncapped, so a wide window is more covers
 * rather than more margin — the folder is the server's and its size is not the
 * reader's choice to make small.
 *
 * The search field is the page's own, and it queries `/books?path=…&search=…`: a
 * filter over *this folder*, not over the whole library, because the breadcrumb above
 * it says which folder it is filtering. Reaching the whole library from here is one
 * press — the shelf is the whole library, from the reader's side.
 */
export class LibraryBrowseScreen {
  readonly element: HTMLDivElement;
  private readonly ui: ReturnType<typeof mountUI>;
  private readonly uploadInput = document.createElement('input');
  private readonly draw: () => void;
  /** The message a completed write left for the next render. */
  private outcome: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private state: BrowseState;

  constructor(private readonly options: LibraryBrowseScreenOptions) {
    this.element = document.createElement('div');
    this.element.className = 'library-screen library-browse-screen';
    this.element.dataset['view'] = 'browse';

    // A file input lives outside the tree and is never re-created, so its `files`
    // list and its focus survive every re-render. On some WebViews a file input
    // removed from the document loses its value, and the second upload after a
    // cancel would then send nothing.
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
      path: options.path,
      page: options.page > 0 ? options.page : 1,
      search: '',
      query: options.search,
      books: [],
      total: 0,
      listing: null,
      offShelf: 0,
      loading: false,
      bootstrapping: true,
      busy: false,
      status: '',
      settingsOpen: false,
      dialog: null,
      revision: 0,
    };

    this.draw = (): void => this.ui.update(this.state);
    this.ui = mountUI(host, () => this.view(), this.state);
  }

  /**
   * Shows the folder, page and query the route asks for.
   *
   * The route is the request and this method is only the executor: a deep link, a
   * Back and a page turn all arrive here identically, which is what keeps the URL
   * and the grid from disagreeing.
   */
  async open(path: string, page: number, search: string): Promise<void> {
    this.state.path = path;
    this.state.page = page > 0 ? page : 1;
    this.state.query = search;
    // The field is only overwritten when the URL disagrees with what is *in* it —
    // i.e. a Back into a URL that carries a different query. Re-assigning it on every
    // load would move the caret to the end while the reader is still typing.
    if (this.state.search.trim() !== search) this.state.search = search;
    await this.load(path);
  }

  private async load(path: string): Promise<void> {
    if (this.state.loading) return;
    this.state.loading = true;
    if (!this.state.status) this.draw();
    this.draw();
    try {
      /*
       * Both in one `Promise.all`, because they are two halves of one folder.
       *
       * The book list is what the grid draws. The file listing is fetched for the
       * *other* half of the library — the header's counts, the empty state's "N 个文件里
       * 没有被扫描成书的" — and it is no longer needed to make 加入书架 possible: that
       * write carries a book id, so this page never has to reconstruct a path from a
       * filename.
       */
      const [listing, books] = await Promise.all([
        this.options.api.browse(path, 1),
        this.options.api
          .listBooks({
            path,
            // The *index*, not the reader's shelf. A shop that only showed books the
            // reader already owns would be a shop with nothing to add.
            scope: 'library',
            ...(this.state.query ? { search: this.state.query } : {}),
            page: this.state.page,
            pageSize: BOOK_PAGE_SIZE,
          })
          .catch(() => ({ items: [] as Book[], total: 0, page: 1, pageSize: BOOK_PAGE_SIZE })),
      ]);
      await this.options.offline.replaceBooks(books.items);
      this.state.listing = listing;
      this.state.books = sortBooks(books.items, this.options.settings.shelfSort);
      this.state.total = books.total;
      this.state.path = listing.path;
      this.state.status = this.outcome ?? '';
      this.state.bootstrapping = false;
      this.state.revision += 1;
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.loading = false;
      this.draw();
    }
  }

  private pageCount(): number {
    return Math.max(1, Math.ceil(this.state.total / BOOK_PAGE_SIZE));
  }

  private goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.pageCount());
    if (target === this.state.page) return;
    this.options.onOpenBrowse(this.state.path, target, this.state.query, true);
  }

  private openFolder(path: string): void {
    // Always page one and no query: page three of the folder the reader just left,
    // filtered by a word that may not exist in the new one, is not a place it makes
    // sense to arrive in.
    this.options.onOpenBrowse(path, 1, '', true);
  }

  private onSearchInput(value: string): void {
    this.state.search = value;
    this.draw();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    // Debounced: a folder of four hundred files over a LAN is fine, but a mobile
    // network plus a keystroke per character is not.
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.commitSearch(this.state.search.trim());
    }, 250);
  }

  private commitSearch(query: string): void {
    if (query === this.state.query) return;
    this.options.onOpenBrowse(this.state.path, 1, query, true);
  }

  private clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.state.search = '';
    this.state.query = '';
    this.options.onOpenBrowse(this.state.path, 1, '', true);
  }

  /**
   * The books on this page that are **not** on the reader's shelf.
   *
   * ## Why this is a set of ids rather than a set of titles
   *
   * This used to answer the question by joining each book onto the *file listing*,
   * because the endpoint took paths and a book had none: the two were connected by
   * matching the book's title against the filenames in the folder. That join is a
   * guess, and it is the bug #40 reported twice over:
   *
   *  - it only lands when a book's title happens to be its filename, which is false
   *    for anything the scanner read a title out of;
   *  - the listing is *paged*, so a book whose file was not on this page reported no
   *    path at all — and a card that cannot name its file got no control, which is
   *    why this library could hold a book and offer no way to shelve it.
   *
   * The server knows which book is in which file, so the write carries the **book
   * id** now and the join is gone. That also removes the `'off'`-is-only-knowable-for-
   * files-on-this-page state: `scope=library` marks every book with `shelfState`,
   * whether or not its file landed on the listing's first page.
   *
   * ## The count and the control are one set
   *
   * `offShelf` is the size of exactly this set, and the line above the grid and the
   * badges below it are drawn from the same answer. The alternative — a line that
   * counted the *folder* — is a sentence that disagrees with the thing under it.
   */
  private offShelfIds(): Set<string> {
    const offShelf = new Set<string>();
    for (const book of this.state.books) {
      // Only `'off'` gets a control. `'on'` is already there, and `undefined` is a
      // client talking to a server that predates the field — in which case offering
      // the button would be offering a write whose answer nobody can predict.
      if (book.shelfState === 'off') offShelf.add(book.id);
    }
    this.state.offShelf = offShelf.size;
    return offShelf;
  }

  private async shelveBooks(books: Book[]): Promise<void> {
    const ids = [...new Set(books.map((book) => book.id))];
    if (ids.length === 0 || this.state.busy) return;
    this.state.busy = true;
    this.state.status = `${SHELF_ACTION_LABELS.add}…`;
    this.draw();
    try {
      const result = await this.options.api.browseBatchShelf({ bookIds: ids }, 'add');
      this.outcome = describeShelfAction('add', result);
      // Read the folder back *before* the report is shown, in the same `try`: the
      // control on the card is drawn from `shelfState`, and a page that keeps offering
      // 加入书架 for a book it just added is a page whose next press does nothing.
      await this.load(this.state.path);
      this.outcome = null;
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.busy = false;
      this.draw();
    }
  }

  /**
   * Uploads picked files into the folder being browsed.
   *
   * The shop is where a reader *lands*, so 上传 is offered here as well as on the file
   * page. The two do exactly the same things — same endpoint, same conflict question,
   * same reload-then-report order — because the alternative is a reader who has just
   * been told "这个文件夹是空的" having to find the administrator's page to fix it.
   */
  private async handlePicked(): Promise<void> {
    const files = [...(this.uploadInput.files ?? [])];
    this.uploadInput.value = '';
    if (files.length === 0) return;
    if (this.state.listing?.writable === false) {
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
       * The folder is re-read *before* the report, and both are in this `try`.
       *
       * A report with no reload is a grid that does not contain the thing just
       * uploaded, which reads as a failed upload whatever the message above it says.
       */
      this.outcome = describeUpload(result);
      await this.load(this.state.path);
      this.outcome = null;
      this.toast(describeUpload(result));
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.busy = false;
      this.draw();
    }
  }

  private async pickConflictPolicy(): Promise<'rename' | 'skip' | 'overwrite' | 'fail' | null> {
    return new Promise((resolve) => {
      this.state.dialog = {
        kind: 'pick',
        title: '同名文件怎么办？',
        options: [
          { value: 'rename', label: '两份都留（加 (2)）' },
          { value: 'skip', label: '跳过已有的' },
          { value: 'overwrite', label: '覆盖（会替换原文件）' },
          { value: 'fail', label: '有重名就整批不动' },
        ],
        resolve: (answer) => resolve(answer as 'rename' | 'skip' | 'overwrite' | 'fail' | null),
      };
      this.draw();
    });
  }

  private toast(text: string): void {
    this.state.status = text;
    this.draw();
  }

  private handleError(err: unknown): void {
    this.state.bootstrapping = false;
    if (err instanceof ApiError) {
      if (err.isAuthFailure) {
        this.options.onSignedOut();
        return;
      }
      this.toast(err.message);
      return;
    }
    this.toast(err instanceof Error ? err.message : '出错了');
  }

  private patch(patch: Partial<BrowseState>): void {
    Object.assign(this.state, patch);
    this.draw();
  }

  // ---- the tree ----

  private view(): ComponentChildren {
    const state = this.state;
    const listing = state.listing;
    return (
      <>
        <header className="library-header collection-header">
          <div className="collection-heading">
            <IconButton label="返回" icon="arrow-left" onClick={() => this.options.onClose()} />
            <div className="collection-heading-text"><h1>书库</h1><p className="muted">浏览本地书籍，发现下一本好书</p></div>
            <IconButton label={'书架设置 · ' + this.options.settings.shelfDensity} icon="tune" onClick={() => this.patch({ settingsOpen: !state.settingsOpen })} />
          </div>
          <nav className="collection-links" aria-label="书库操作">
            <button type="button" className="button collection-link" onClick={() => this.options.onOpenFiles()}><Icon name="folder" /><span>文件管理</span><Icon name="chevron-right" /></button>
            <button type="button" aria-label="上传书籍" hidden={!listing?.writable} className="button collection-link" disabled={state.busy} onClick={() => this.uploadInput.click()}><Icon name="upload" /><span>上传书籍</span><Icon name="chevron-right" /></button>
          </nav>
          {(listing?.crumbs.length ?? 0) > 1 && <>
          <div className="manager-crumbs library-path" aria-label="当前文件夹">
            {(listing?.crumbs ?? []).map((crumb, index) => (
              <>
                {index > 0 ? <span className="manager-crumb-sep">/</span> : null}
                <button
                  type="button"
                  key={`${crumb.path}#${index}`}
                  className="manager-crumb"
                  aria-current={index === (listing?.crumbs.length ?? 0) - 1}
                  onClick={() => this.openFolder(crumb.path)}
                >
                  {crumb.name}
                </button>
              </>
            ))}
          </div>
          </>}
        </header>

        <div className="manager-body library-browse-body">
          {/*
            The search field, and the reason the browsing half is a page of its own.
            It filters *this folder* — the breadcrumb above it is the scope — and it
            lives in the same URL as the folder and the page, so a filtered view is a
            link rather than a session.
          */}
          <div className="shelf-search library-search" role="search">
            <Icon name="search" class="search-glyph" />
            <input
              type="search"
              placeholder="搜索书名、作者"
              aria-label="搜索书库"
              enterKeyHint="search"
              value={state.search}
              onInput={(event) => this.onSearchInput((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (this.searchTimer) clearTimeout(this.searchTimer);
                  this.searchTimer = null;
                  this.commitSearch(state.search.trim());
                }
              }}
            />
            {state.search.length > 0 ? (
              <button type="button" className="search-clear" aria-label="清除搜索" onClick={() => this.clearSearch()}>
                <Icon name="close" />
              </button>
            ) : null}
          </div>

          {state.bootstrapping && state.books.length === 0 ? <div className="spinner" /> : null}
          {this.grid()}
          {this.pageCount() > 1 ? (
            <Pager
              className="shelf-pager"
              page={state.page}
              pageCount={this.pageCount()}
              busy={state.loading}
              onGo={(page) => this.goToPage(page)}
            />
          ) : null}
          {(state.status || state.total > 0) && <div className="manager-status muted">{state.status || this.summary()}</div>}
        </div>

        {state.dialog ? (
          <DialogView dialog={state.dialog} onClose={(answer) => this.closeDialog(answer)} destructive="删除" />
        ) : null}
        <ShelfSettingsPanel
          open={state.settingsOpen}
          settings={this.options.settings}
          onPatch={(patch) => this.options.onSettingsChange(patch)}
          onClose={() => this.patch({ settingsOpen: false })}
        />
      </>
    );
  }

  private grid(): ComponentChildren {
    const state = this.state;
    if (state.books.length === 0) {
      if (state.bootstrapping) return null;
      const hasFiles = (state.listing?.files ?? 0) > 0;
      const writable = state.listing?.writable === true;
      const hasQuery = state.query.length > 0;
      return (
        <div className="empty-state collection-empty">
          <Icon name={hasQuery ? 'search' : 'book'} class="empty-glyph" />
          <p>{hasQuery ? '没有匹配的书' : hasFiles ? '这个文件夹里没有可阅读的书' : '书库还没有书'}</p>
          <p className="muted">
            {hasQuery
              ? `「${state.query}」在这个文件夹里没有匹配`
              : hasFiles ? '这里有 ' + state.listing!.files + ' 个文件，可在文件管理中查看识别结果。'
              : writable ? '上传 EPUB、TXT 等书籍，开始建立你的书库。' : '管理员添加书籍后，就能在这里浏览并加入书架。'}
          </p>
          <div className="empty-actions">
            {hasQuery ? (
              <button type="button" className="button primary" onClick={() => this.clearSearch()}>
                清除搜索
              </button>
            ) : !hasFiles && writable ? (
              <IconTextButton className="primary" label="上传第一本书" icon="upload" disabled={state.busy} onClick={() => this.uploadInput.click()} />
            ) : hasFiles ? (
              <IconTextButton className="primary" label="文件管理" icon="folder" onClick={() => this.options.onOpenFiles()} />
            ) : null}
          </div>
        </div>
      );
    }
    const offShelf = this.offShelfIds();
    return (
      <>
        <div className="library-preview-hint muted">
          {state.offShelf > 0 ? `这一页有 ${state.offShelf} 本还不在书架上，点封面上的按钮可以加进去` : ''}
        </div>
        <div
          className="book-grid library-browse-grid"
          data-density={this.options.settings.shelfDensity}
          data-showAuthor={String(this.options.settings.shelfShowAuthor)}
          data-show-progress={String(this.options.settings.shelfShowProgress)}
        >
          {state.books.map((book) => (
            <BookCard
              key={`${book.id}#${state.revision}`}
              book={book}
              revision={state.revision}
              api={this.options.api}
              progress={this.options.offline.progressFor(book.id)}
              onOpen={() => this.options.onOpenBook(book)}
              {...(offShelf.has(book.id) ? { onShelve: () => void this.shelveBooks([book]) } : {})}
            />
          ))}
        </div>
      </>
    );
  }

  private summary(): string {
    const state = this.state;
    if (state.loading && state.books.length === 0) return '载入中…';
    if (state.listing === null) return '';
    if (state.query) return `找到 ${state.total} 本`;
    const parts = [`${state.total} 本`];
    if (state.total > 0) parts.push(`第 ${state.page} / ${this.pageCount()} 页`);
    return parts.join(' · ');
  }

  private closeDialog(answer: DialogAnswer): void {
    const dialog = this.state.dialog;
    this.state.dialog = null;
    this.draw();
    if (dialog?.kind === 'pick') dialog.resolve(answer as string | null);
  }

  dispose(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.state.dialog = null;
    this.ui.unmount();
  }
}

/* ------------------------------------------------------------------ *
 * The file page — the administrator's
 * ------------------------------------------------------------------ */

interface FilesState {
  path: string;
  page: number;
  listing: BrowseListing | null;
  /** Which entries are ticked. Empty means "navigate" mode. */
  selected: ReadonlySet<string>;
  loading: boolean;
  busy: boolean;
  status: string;
  dialog: Dialog | null;
}

/**
 * 书库 · 文件 — the file manager.
 *
 * Every control on this page writes to the server's disk, which is why it is a page
 * of its own and why the browsing half links to it by name rather than sharing a tab:
 * a reader browsing covers has no business one press away from 删除.
 */
export class LibraryFilesScreen {
  readonly element: HTMLDivElement;
  private readonly ui: ReturnType<typeof mountUI>;
  private readonly uploadInput = document.createElement('input');
  private readonly draw: () => void;
  private outcome: string | null = null;
  private state: FilesState;

  constructor(private readonly options: LibraryFilesScreenOptions) {
    this.element = document.createElement('div');
    this.element.className = 'library-screen library-files-screen';
    this.element.dataset['view'] = 'files';

    this.uploadInput.type = 'file';
    this.uploadInput.multiple = true;
    this.uploadInput.className = 'manager-upload-input';
    this.uploadInput.setAttribute('aria-hidden', 'true');
    this.uploadInput.tabIndex = -1;
    this.uploadInput.addEventListener('change', () => void this.handlePicked());

    const host = document.createElement('div');
    host.className = 'library-ui';
    this.element.append(host, this.uploadInput);

    this.state = {
      path: options.path,
      page: options.page > 0 ? options.page : 1,
      listing: null,
      selected: new Set<string>(),
      loading: false,
      busy: false,
      status: '',
      dialog: null,
    };

    this.draw = (): void => this.ui.update(this.state);
    this.ui = mountUI(host, () => this.view(), this.state);
  }

  async open(path: string, page: number): Promise<void> {
    this.state.page = page > 0 ? page : 1;
    await this.load(path);
  }

  private async load(path: string): Promise<void> {
    if (this.state.loading) return;
    this.state.loading = true;
    this.draw();
    try {
      const listing = await this.options.api.browse(path, this.state.page);
      this.state.listing = listing;
      this.state.path = listing.path;
      this.state.status = this.outcome ?? '';
      // A reload invalidates any selection: the paths it held are rows of a list that
      // is no longer on screen, and a batch action that includes an invisible row is
      // the one way this screen can delete something the reader did not tick.
      this.state.selected = new Set<string>();
    } catch (err) {
      this.handleError(err);
    } finally {
      this.state.loading = false;
      this.draw();
    }
  }

  private get writable(): boolean {
    return this.state.listing?.writable ?? false;
  }

  private pageCount(): number {
    const total = this.state.listing?.total ?? 0;
    return Math.max(1, Math.ceil(total / FILE_PAGE_SIZE));
  }

  private goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.pageCount());
    if (target === this.state.page) return;
    this.options.onOpenLibrary(this.state.path, target, true);
  }

  private openFolder(path: string): void {
    this.options.onOpenLibrary(path, 1, true);
  }

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

  /**
   * One row's actions.
   *
   * ## Why the shelf actions are not here
   *
   * They used to be: the menu offered 「从书架拿掉」/「放回书架」 per the row's
   * `shelfState`, and the batch bar offered both. #40 asked for the removal button to
   * go, and the reason holds beyond personal taste — **this page writes to the disk,
   * and shelf membership is not a disk fact.**
   *
   * Every other entry in this list (重命名, 移动, 删除, 改资料, 上传) changes what is on
   * the mount. 「从书架拿掉」 changes a row in `user_books` and touches no file, so it was
   * the one control here whose consequence did not match the page's promise, in a menu
   * where the entry next to it deletes the book from disk.
   *
   * It is also the wrong *audience*: this screen is the administrator's (the route is
   * guarded — §3.4.4), and a shelf is a per-reader thing. The reader's own directions
   * belong on the two screens the reader owns: the shelf's card menu (§3.5.2) and the
   * browsing page's card, which is where a book that is not on the shelf can be added.
   */
  private async openEntryMenu(entry: BrowseEntry): Promise<void> {
    if (!this.writable) {
      this.toast('书库是只读挂载，无法修改');
      return;
    }
    const action = await this.pick(`「${entry.name}」`, [
      { value: 'select', label: '选择' },
      { value: 'metadata', label: '改资料' },
      { value: 'rename', label: '重命名' },
      { value: 'move', label: '移动到…' },
      { value: 'delete', label: '删除' },
    ]);
    if (action === 'select') {
      this.toggle(entry);
      return;
    }
    // Everything below acts on exactly this row, so the selection is replaced rather
    // than merged: an action started from one row's menu must not quietly include a
    // batch ticked earlier and now off screen.
    this.select([entry.path]);
    if (action === 'metadata') return this.promptBatchMetadata();
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
      (result) => this.reportMetadataBatch(result),
    );
  }

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
       * The reload also has to keep the *page*: a reader who uploaded from page three
       * asked for a book to appear there, and being thrown back to page one makes the
       * upload look like it moved them.
       */
      this.outcome = describeUpload(result);
      await this.load(this.state.path);
      this.outcome = null;
      this.toast(describeUpload(result));
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
   * What a metadata batch did, as a sentence.
   *
   * Distinct from `describeShelfAction`, and the distinction is the point: a metadata
   * edit has no reader-facing verb (`已更新 3 本` is the honest summary of "three books
   * were retitled"), while a shelf action does (`加入书架 3 本`). Sharing one sentence
   * between them is how "the reader pressed 加入书架 and was told a batch was updated"
   * happens, which is a page that cannot answer what it was just asked.
   *
   * Defensive about the response's shape, and not out of caution: this runs in a
   * `.then` on a request whose *answer* is the only thing that says how many books
   * were touched, and a server that answers a batch with an empty body would make the
   * sentence throw.
   */
  private reportMetadataBatch(result: { applied?: number; failed?: Array<{ path: string; reason: string }> }): string {
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
   * simply did not happen.
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
    this.state.status = this.outcome;
    await this.load(this.state.path);
    this.outcome = null;
    this.state.busy = false;
    this.draw();
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
      this.toast(err.message);
      return;
    }
    this.toast(err instanceof Error ? err.message : '出错了');
  }

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
    const listing = this.state.listing;
    return (
      <>
        <div className="panel-header library-header">
          <IconButton label="返回" icon="arrow-left" onClick={() => this.options.onClose()} />
          <IconTextButton label="浏览书籍" icon="book" onClick={() => this.options.onOpenBrowse(this.state.path)} />
          <div className="manager-crumbs">
            {(listing?.crumbs ?? []).map((crumb, index) => (
              <>
                {index > 0 ? <span className="manager-crumb-sep">/</span> : null}
                <button
                  type="button"
                  key={`${crumb.path}#${index}`}
                  className="manager-crumb"
                  aria-current={index === (listing?.crumbs.length ?? 0) - 1}
                  onClick={() => this.openFolder(crumb.path)}
                >
                  {crumb.name}
                </button>
              </>
            ))}
          </div>
          {/* Hidden rather than omitted, with `hidden` as the state: a control that
              can only answer 403 teaches the reader to distrust every other control,
              and *which* controls are missing is what this says. */}
          <IconButton
            label="上传书籍"
            icon="upload"
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
          {this.state.loading && listing === null ? <div className="spinner" /> : null}
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
          {this.pageCount() > 1 ? (
            <Pager
              className="manager-pager"
              page={this.state.page}
              pageCount={this.pageCount()}
              busy={this.state.loading}
              onGo={(page) => this.goToPage(page)}
            />
          ) : null}
          <div className="manager-status muted">{this.state.status || this.summary(listing)}</div>
        </div>

        <SelectionBar
          count={this.state.selected.size}
          writable={this.writable}
          only={[...this.state.selected][0]}
          entries={listing?.entries ?? []}
          onClear={() => this.select([])}
          onRename={(path, name) => void this.promptRename(path, name)}
          onMetadata={() => void this.promptBatchMetadata()}
          onMove={() => void this.promptMove()}
          onDelete={() => void this.confirmDelete()}
        />
        {this.state.selected.size > 0 ? (
          <div className="manager-selection">已选 {this.state.selected.size} 项</div>
        ) : null}
        {this.state.dialog ? (
          <DialogView dialog={this.state.dialog} onClose={(answer) => this.closeDialog(answer)} destructive="删除" />
        ) : null}
      </>
    );
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
    if (listing === null) return '载入中…';
    if (listing.total === 0) {
      return listing.writable ? '空文件夹 · 可以用右上角的新建按钮添加子目录' : '空文件夹';
    }
    /*
     * The counts are the directory's, and the page is named when there is more than
     * one. "400 个文件" under a screen showing 200 of them is a correct sentence and a
     * confusing one; saying which page it is makes the number and the rows agree.
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
 * What an upload did, as a sentence.
 *
 * A function rather than a `toast` call because the message has to survive the reload
 * the upload triggers: the reload's own status line is the directory summary, and the
 * summary is not an answer to "did it work".
 */
function describeUpload(result: Awaited<ReturnType<ReaderApi['upload']>>): string {
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
 * A book on the browsing grid.

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
          <Icon name="add-circle" />
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
        <Icon name={entry.type === 'dir' ? 'folder' : 'file-text'} class="manager-icon" />
        <span className="manager-label">{entry.name}</span>
      </div>
      <div className="manager-meta muted">{meta}</div>
      {selectable || selecting ? (
        <IconButton
          label={`${entry.name} 的操作`}
          icon="more"
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
            No shelf directions here any more (#40). Everything else on this bar writes
            to the mount; 下架 wrote a `user_books` row and touched no file, so it was the
            one button whose consequence did not match the page. The reader's two
            directions live on the two screens the reader owns — the shelf and the
            browsing page — where the book in front of them is the book being shelved.
          */}
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
