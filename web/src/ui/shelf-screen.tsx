import { ApiError } from '../api/errors.ts';
import type { ListQuery, ReaderApi } from '../api/client.ts';
import type { Book, ContinueReadingItem } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { Platform } from '../core/platform.ts';
import type { AppSettings, ShelfSort } from '../store/settings.ts';
import { mountUI } from './mount.ts';
import { DENSITY_LABELS, ShelfSettingsPanel } from './shelf-settings.tsx';
import { sortBooks, shelfOrder } from './shelf-order.ts';
import { IconButton } from './toolkit.tsx';
import { type ComponentChildren, type JSX, useEffect, useState } from './vendor/preact.ts';

export interface ShelfScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  platform: Platform;
  /** Current shelf preferences, so the screen starts in the reader's own state. */
  settings: AppSettings;
  onOpenBook(book: Book): void;
  /** Opens the library file manager. Admin-ish by nature, but gated by the mount. */
  onOpenManager(): void;
  onSignedOut(): void;
  /** Persisted through the app's settings store, like the reader's own. */
  onSettingsChange(patch: Partial<AppSettings>): void;
}

/** Sort options, in the order the sheet shows them. */
const SORTS: Array<{ value: ShelfSort; label: string }> = [
  { value: 'updated', label: '最近更新' },
  { value: 'added', label: '最近入库' },
  { value: 'title', label: '书名' },
  { value: 'author', label: '作者' },
];

const PAGE_SIZE = 60;

interface ShelfState {
  /** Written into the search field; the debounced query is `applied`. */
  search: string;
  query: string;
  items: Book[];
  continueItems: ContinueReadingItem[];
  total: number;
  loading: boolean;
  status: string;
  settingsOpen: boolean;
  refreshing: boolean;
  /** Bumped after a mutation so the cached cover URLs re-key, not re-fetch. */
  revision: number;
}

/**
 * The shelf.
 *
 * Behaviour rule that drives the whole screen: it renders from the local mirror
 * first and only then replaces it with server data. On a LAN or with a cold
 * cache that is invisible; on a train it is the difference between the library
 * appearing instantly and an indefinite spinner (product design §8.2).
 *
 * ## What was added, and the rule behind each
 *
 * The shelf is the most-opened screen in the app and was the least configurable,
 * which is an odd pairing: a reader who opens it forty times a day is the one who
 * notices that the covers are too small, that the list is in the wrong order, and
 * that clearing a search takes three taps. Every addition below follows one rule —
 * **it must be a thing a reader would change twice**, because a settings screen
 * full of switches nobody flips is worse than no settings screen.
 *
 *  - **Sort, as a control on the shelf** rather than only in settings, because
 *    "show me what I just added" is a per-session intent, not a preference.
 *  - **Density and author visibility in settings**, because those *are*
 *    preferences: they are about the screen and the eyes, and they persist.
 *  - **A clear button in the search field**, because on a phone the alternative is
 *    selecting four characters with a fat-finger cursor.
 *  - **Progress on the cover**, because the one question a shelf answers for a
 *    reader who has twenty books going is "where was I".
 *  - **A pull-to-refresh at the top**, because the shelf is now the only place a
 *    scan's result becomes visible, and "I added a book, why is it not here" is
 *    the complaint that a manual refresh answers.
 *
 * ## What the framework changed
 *
 * Nine node fields (`grid`, `continueRow`, `statusLine`, `countLabel`, `sortRow`,
 * `refreshBar`, `settingsButton`, `settingsPanel`, `scroll`) and four render
 * methods that had to agree with each other. They are now one `ShelfState` and a
 * tree that is a function of it: the count label, the sort chips, the density
 * dataset and the settings sheet cannot disagree about what is set, because
 * there is one place each value is read from.
 *
 * The scroll handling stays imperative, because it *is* imperative: a scroll
 * listener that reads `scrollTop` and fires a fetch has no markup to render.
 */
export class ShelfScreen {
  readonly element: HTMLDivElement;
  private readonly ui: ReturnType<typeof mountUI>;
  private state: ShelfState = {
    search: '',
    query: '',
    items: [],
    continueItems: [],
    total: 0,
    loading: false,
    status: '',
    settingsOpen: false,
    refreshing: false,
    revision: 0,
  };
  private readonly settings: AppSettings;
  /** Session sort; seeded from settings and written back when it changes. */
  private sort: ShelfSort;
  /** Scroll position from before the last refresh, so a refresh does not jump. */
  private lastScrollTop = 0;
  /** Timestamp of when the shelf first reached the top, for pull-to-refresh. */
  private atTopSince: number | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scrollRef = { current: null as HTMLDivElement | null };

  constructor(private readonly options: ShelfScreenOptions) {
    this.settings = { ...options.settings };
    this.sort = options.settings.shelfSort;

    this.element = document.createElement('div');
    this.element.className = 'shelf-screen';
    this.element.style.cssText = 'flex:1 1 auto; min-height:0; display:flex; flex-direction:column;';
    this.ui = mountUI(this.element, () => this.view(), this.state);
  }

  async show(): Promise<void> {
    await this.options.offline.load();
    const cached = this.options.offline.books();
    if (cached.length > 0) {
      this.patch({ items: sortBooks(cached, this.sort) });
    }
    await this.refresh();
  }

  /**
   * Refetches the first page and the "continue reading" row.
   *
   * Both in one `Promise.all`, because they are two halves of one screen: fetching
   * them in sequence made the shelf appear and *then* a row appear above it,
   * pushing everything down under the reader's thumb.
   */
  async refresh(): Promise<void> {
    try {
      const [page, continueItems] = await Promise.all([
        this.options.api.listBooks(this.listQuery(1)),
        this.options.api.continueReading(10).catch(() => [] as ContinueReadingItem[]),
      ]);
      this.state.total = page.total;
      await this.options.offline.replaceBooks(page.items);
      this.patch({ items: sortBooks(page.items, this.sort), continueItems, status: '', revision: this.state.revision + 1 });
      const scroll = this.scrollRef.current;
      // Restored after the render, because the list is empty for one tick and a
      // scroll position with nothing to scroll to is clamped to zero.
      if (scroll) requestAnimationFrame(() => {
        scroll.scrollTop = this.lastScrollTop;
      });
    } catch (err) {
      this.handleError(err);
    }
  }

  private listQuery(page: number): ListQuery {
    return {
      ...(this.state.query ? { search: this.state.query } : {}),
      sort: this.sort,
      order: shelfOrder(this.sort),
      page,
      pageSize: PAGE_SIZE,
    };
  }

  private draw(): void {
    this.ui.update(this.state);
  }

  private patch(patch: Partial<ShelfState>): void {
    this.state = { ...this.state, ...patch };
    this.draw();
  }

  private setStatus(status: string): void {
    this.patch({ status });
  }

  private applySettings(patch: Partial<AppSettings>): void {
    Object.assign(this.settings, patch);
    this.options.onSettingsChange(patch);
    this.draw();
  }

  // ---- search, sort, scroll ----

  private onSearchInput(value: string): void {
    this.patch({ search: value, query: value.trim() });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    // Debounced: a shelf of 2000 books over a LAN is fine, but a mobile network
    // plus a keystroke per character is not.
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.refresh();
    }, 250);
  }

  private clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.patch({ search: '', query: '' });
    void this.refresh();
  }

  private pickSort(sort: ShelfSort): void {
    if (this.sort === sort) return;
    this.sort = sort;
    // Written back so the choice survives a restart. It is a preference as much
    // as it is a per-session intent, and the two cannot be told apart — so
    // persisting is the less surprising of the two harms.
    this.options.onSettingsChange({ shelfSort: sort });
    this.settings.shelfSort = sort;
    this.lastScrollTop = 0;
    // Ordering changes the whole result set, so a refresh rather than a
    // client-side re-sort: the server is the authority, and it is the only side
    // that can re-sort a library larger than one page.
    this.patch({ items: sortBooks(this.state.items, sort), revision: this.state.revision + 1 });
    void this.refresh();
  }

  private onScroll(scroll: HTMLDivElement): void {
    this.lastScrollTop = scroll.scrollTop;
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 400) {
      void this.loadMore();
    }
    // Pull-to-refresh fires only when the reader has already overscrolled and lets
    // go — a refresh on every scroll-to-top would fire constantly on a phone.
    if (scroll.scrollTop < 24 && this.atTopSince !== null && Date.now() - this.atTopSince > 400) {
      this.atTopSince = null;
      void this.manualRefresh();
    }
  }

  private async manualRefresh(): Promise<void> {
    this.patch({ refreshing: true });
    try {
      await this.refresh();
    } finally {
      setTimeout(() => this.patch({ refreshing: false }), 900);
    }
  }

  private async loadMore(): Promise<void> {
    if (this.state.loading || this.state.items.length >= this.state.total) return;
    this.patch({ loading: true });
    try {
      const page = Math.floor(this.state.items.length / PAGE_SIZE) + 1;
      const result = await this.options.api.listBooks(this.listQuery(page));
      await this.options.offline.replaceBooks(result.items);
      this.patch({
        // Appended the way the server ordered them, not re-sorted: a page is a
        // *continuation* of the order, and re-sorting it here would be right only
        // by coincidence.
        items: [...this.state.items, ...result.items],
        total: result.total,
        revision: this.state.revision + 1,
      });
    } catch (err) {
      if (!(err instanceof ApiError) || !err.isConnectivity) this.setStatus('加载更多失败');
    } finally {
      this.patch({ loading: false });
    }
  }

  private handleError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.isAuthFailure) {
        this.options.onSignedOut();
        return;
      }
      if (err.isConnectivity) {
        const cached = this.options.offline.books();
        if (cached.length > 0) {
          this.patch({
            items: sortBooks(cached, this.sort),
            status: `离线模式 · ${cached.length} 本可读`,
            revision: this.state.revision + 1,
          });
          return;
        }
        this.setStatus('连不上服务端');
        return;
      }
      this.setStatus(err.message);
      return;
    }
    this.setStatus(err instanceof Error ? err.message : '出错了');
  }

  // ---- the tree ----

  private view(): JSX.Element {
    const state = this.state;
    const density = this.settings.shelfDensity;
    return (
      <ShelfScroller
        containerRef={this.scrollRef}
        onScroll={(scroll) => this.onScroll(scroll)}
        onReachTop={() => {
          this.atTopSince = Date.now();
        }}
      >
        <div className="shelf-search">
          <input
            type="search"
            placeholder="搜索书名、作者、系列"
            aria-label="搜索书库"
            enterKeyHint="search"
            value={state.search}
            onInput={(event) => this.onSearchInput((event.currentTarget as HTMLInputElement).value)}
            onKeyDown={(event) => {
              // `search` inputs fire a non-standard `search` event on clear, but
              // only in some browsers; Enter is the one that is reliable
              // everywhere and it also means "stop waiting for the debounce".
              if (event.key === 'Enter') {
                if (this.searchTimer) clearTimeout(this.searchTimer);
                this.searchTimer = null;
                this.patch({ query: state.search.trim() });
                void this.refresh();
              }
            }}
          />
          {state.search.length > 0 ? (
            <button type="button" className="search-clear" aria-label="清除搜索" onClick={() => this.clearSearch()}>
              ✕
            </button>
          ) : null}
        </div>

        {state.continueItems.length > 0 ? (
          <div>
            <div className="shelf-section-title">继续阅读</div>
            <div className="continue-row">
              {state.continueItems.map((item) => (
                <ContinueCard
                  key={item.id}
                  item={item}
                  revision={state.revision}
                  api={this.options.api}
                  onOpen={() => this.options.onOpenBook(item)}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="shelf-toolbar">
          <div className="shelf-count muted">
            {state.query ? `找到 ${state.total} 本` : state.total > 0 ? `共 ${state.total} 本` : ''}
          </div>
          <div className="shelf-sort">
            <span className="shelf-sort-label muted">排序</span>
            {SORTS.map((option) => (
              <button
                type="button"
                key={option.value}
                className="chip"
                aria-pressed={option.value === this.sort}
                aria-label={`按${option.label}排序`}
                onClick={() => this.pickSort(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <IconButton
            label={`书架设置 · ${DENSITY_LABELS[density]}`}
            onClick={() => this.patch({ settingsOpen: !state.settingsOpen })}
          >
            ⚙
          </IconButton>
          {/* The file manager's entry point sits next to the shelf settings gear
              because that is where "the library itself" already lives. It is
              offered to every account, not just admins: the mount decides whether
              it can write anything, and a reader whose own book failed to appear
              is exactly who needs to look. */}
          <IconButton label="书库管理" onClick={() => this.options.onOpenManager()}>
            🗂
          </IconButton>
        </div>

        <div className="shelf-refresh" hidden={!state.refreshing}>
          {state.refreshing ? '正在刷新…' : ''}
        </div>

        <div
          className="book-grid"
          data-density={density}
          data-showAuthor={String(this.settings.shelfShowAuthor)}
          data-showProgress={String(this.settings.shelfShowProgress)}
        >
          {state.items.length === 0 && !state.loading ? (
            <div className="empty-state">
              <p>{state.query ? '没有匹配的书' : '书库还是空的'}</p>
              <p className="muted">
                {state.query ? '换个关键词试试' : '确认已经挂载书籍目录，并在设置里触发一次扫描'}
              </p>
            </div>
          ) : null}
          {state.items.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              progress={this.options.offline.progressFor(book.id)}
              revision={state.revision}
              api={this.options.api}
              onOpen={() => this.options.onOpenBook(book)}
            />
          ))}
        </div>

        <div className="shelf-status muted">{state.status}</div>

        {this.state.loading && this.state.items.length > 0 ? <div className="spinner" /> : null}

        <ShelfSettingsPanel
          open={state.settingsOpen}
          settings={this.settings}
          onPatch={(patch) => this.applySettings(patch)}
          onClose={() => this.patch({ settingsOpen: false })}
        />
      </ShelfScroller>
    );
  }

  dispose(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.ui.unmount();
  }
}

/**
 * The scrolling container.
 *
 * A component because the scroll listener, the "first reached the top" stamp and
 * the measured container all belong to one node — the previous version reached
 * for `this.scroll` from four methods. `onScroll` is passed the element itself,
 * so the caller reads `scrollTop` from the node that fired rather than from a
 * field that may be a render behind.
 */
function ShelfScroller({
  containerRef,
  onScroll,
  onReachTop,
  children,
}: {
  containerRef: { current: HTMLDivElement | null };
  onScroll(scroll: HTMLDivElement): void;
  onReachTop(): void;
  children: ComponentChildren;
}): JSX.Element {
  const [reachedTop, setReachedTop] = useState(false);
  return (
    <div
      id="shelf-scroll"
      className="shelf"
      ref={containerRef}
      onScroll={(event) => {
        const scroll = event.currentTarget as HTMLDivElement;
        onScroll(scroll);
        if (scroll.scrollTop >= 24) {
          setReachedTop(false);
        } else if (!reachedTop) {
          setReachedTop(true);
          onReachTop();
        }
      }}
    >
      {children}
    </div>
  );
}

/** A cover, resolved to a blob URL once and re-used across renders. */
function useCoverUrl(api: ReaderApi, coverUrl: string | null | undefined, revision: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const cache = coverCache(api);
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
        // The screen can be disposed while a cover is in flight; setting state on
        // an unmounted component is a leak of the object URL, nothing more.
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
 * Object URLs outlive individual cards.
 *
 * A shelf that scrolls away and back must not re-fetch forty covers, and a
 * revoked URL is a broken image, so the cache is process-wide and released on
 * `pagehide` rather than per card.
 */
const coverCaches = new WeakMap<ReaderApi, Map<string, string>>();

function coverCache(api: ReaderApi): Map<string, string> {
  let cache = coverCaches.get(api);
  if (!cache) {
    cache = new Map<string, string>();
    coverCaches.set(api, cache);
  }
  return cache;
}

function BookCard({
  book,
  progress,
  revision,
  api,
  onOpen,
}: {
  book: Book;
  progress: { percentage: number } | undefined;
  revision: number;
  api: ReaderApi;
  onOpen(): void;
}): JSX.Element {
  const url = useCoverUrl(api, book.coverUrl, revision);
  return (
    <button type="button" className="book-card" aria-label={`${book.title} ${book.author}`.trim()} onClick={onOpen}>
      <div className="cover">
        {url ? <img src={url} alt="" loading="lazy" /> : <div className="placeholder">{book.title.slice(0, 12) || '无封面'}</div>}
        <span className="format-badge">{book.format}</span>
        {/* Drawn from the local mirror, which the sync engine keeps current — so
            it is correct offline, with no extra request per card. */}
        {progress && progress.percentage > 0.005 ? (
          <div className="cover-progress">
            <span style={`width:${Math.round(Math.min(1, Math.max(0, progress.percentage)) * 100)}%`} />
          </div>
        ) : null}
      </div>
      <div className="title">{book.title || '未命名'}</div>
      <div className="author">{book.author || '未知作者'}</div>
    </button>
  );
}

function ContinueCard({
  item,
  revision,
  api,
  onOpen,
}: {
  item: ContinueReadingItem;
  revision: number;
  api: ReaderApi;
  onOpen(): void;
}): JSX.Element {
  const url = useCoverUrl(api, item.coverUrl, revision);
  const width = `${Math.round(Math.min(1, Math.max(0, item.percentage)) * 100)}%`;
  return (
    <button type="button" className="continue-card" onClick={onOpen}>
      <div
        className="cover"
        style="aspect-ratio:2/3;border-radius:6px;overflow:hidden;background:var(--reader-line);display:grid;place-items:center;"
      >
        {url ? (
          <img src={url} alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />
        ) : (
          <div className="placeholder">{item.title.slice(0, 8)}</div>
        )}
      </div>
      <div className="title" style="font-size:.8rem;margin-top:.3rem;">
        {item.title}
      </div>
      <div className="muted" style="font-size:.7rem;">
        {item.chapterTitle || `${Math.round(item.percentage * 100)}%`}
      </div>
      <div className="progress-track">
        <span style={`width:${width}`} />
      </div>
    </button>
  );
}
