import { ApiError } from '../api/errors.ts';
import type { ListQuery, ReaderApi } from '../api/client.ts';
import type { Book, ContinueReadingItem } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { Platform } from '../core/platform.ts';
import type { AppSettings, ShelfSort } from '../store/settings.ts';
import { mountUI } from './mount.ts';
import { DENSITY_LABELS, ShelfSettingsPanel } from './shelf-settings.tsx';
import { sortBooks, shelfOrder } from './shelf-order.ts';
import { Icon, IconButton, IconTextButton } from './toolkit.tsx';
import { type ComponentChildren, type JSX, useEffect, useState } from './vendor/preact.ts';

export interface ShelfScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  platform: Platform;
  /** Current shelf preferences, so the screen starts in the reader's own state. */
  settings: AppSettings;
  onOpenBook(book: Book): void;
  /**
   * Opens the library manager, optionally at a folder.
   *
   * A path rather than no argument because the manager is a *place* with a URL:
   * the shelf reports the intent and the router writes `#/library/<path>`, which
   * is what makes a folder shareable.
   */
  onOpenManager(path: string): void;
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
  /**
   * True until the first frame that has *anything* to show.
   *
   * Distinct from `loading`, which means "a page is in flight" and is drawn as a
   * spinner under a list that already exists. This one is about the first paint
   * of a cold start, where there is no list yet: a shelf that opens on a blank
   * page and then pops into a grid reads as a broken app, so it draws the shape
   * of the grid instead.
   */
  bootstrapping: boolean;
  /** Bumped after a mutation so the cached cover URLs re-key, not re-fetch. */
  revision: number;
}

/**
 * A section label above a row of the shelf.
 *
 * A `<h2>` rather than styled text, because both sections are real landmarks: a
 * screen reader should be able to jump between "继续阅读" and the shelf itself,
 * and the two bands genuinely are different lists.
 */
function SectionHeading({ label }: { label: string }): JSX.Element {
  return (
    <div className="shelf-section-head">
      <h2 className="shelf-section-title">{label}</h2>
    </div>
  );
}

/**
 * The shape of the shelf, before the shelf exists.
 *
 * Drawn from the *same* density the grid will use, so the transition from
 * placeholder to content is a fill-in rather than a reflow: a skeleton in the
 * wrong grid is worse than no skeleton, because the reader sees the layout move
 * twice and learns not to trust the first one. It is `aria-hidden` and costs no
 * requests — the point is only that the page has a shape on the first frame.
 */
function ShelfSkeleton({ density }: { density: AppSettings['shelfDensity'] }): JSX.Element {
  const count = density === 'compact' ? 12 : density === 'comfortable' ? 6 : 9;
  return (
    <div className="book-grid is-skeleton" data-density={density} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="book-card skeleton" key={index}>
          <div className="cover" />
          <div className="title skeleton-line" />
          <div className="author skeleton-line short" />
        </div>
      ))}
    </div>
  );
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
  /**
   * The whole screen, as one value the tree is a function of.
   *
   * Assigned in the constructor rather than as a field initialiser, and the
   * difference is not stylistic. A field initialiser and the constructor body are
   * *both* ways to describe the object's initial state, and the order between them
   * depends on the compiler's class-field target: with `useDefineForClassFields`
   * lowered (which is what the dev server emits) every initialiser runs *after*
   * the constructor body. So `mountUI(..., this.state)` in the constructor would
   * capture `undefined`, the first diff would render nothing, and the next `patch`
   * would spread `undefined` and produce a state object missing every key it did
   * not touch — a crash on the first field the tree reads. Initialising it here
   * makes the ordering the same under every target.
   */
  private state: ShelfState;
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
    this.state = {
      search: '',
      query: '',
      items: [],
      continueItems: [],
      total: 0,
      loading: false,
      status: '',
      settingsOpen: false,
      refreshing: false,
      bootstrapping: true,
      revision: 0,
    };
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
    // The skeleton is cleared by `refresh` on both paths (success clears it with
    // the first page, failure clears it in `handleError`), so this is only for the
    // case where a screen is disposed mid-flight and never draws again.
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
      this.patch({
        items: sortBooks(page.items, this.sort),
        continueItems,
        status: '',
        bootstrapping: false,
        revision: this.state.revision + 1,
      });
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
    // The first paint is over whatever the answer was: a skeleton that outlives
    // the request is a screen that never finishes loading.
    this.state = { ...this.state, bootstrapping: false };
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
    const hasQuery = state.query.length > 0;
    const empty = state.items.length === 0;
    return (
      <ShelfScroller
        containerRef={this.scrollRef}
        onScroll={(scroll) => this.onScroll(scroll)}
        onReachTop={() => {
          this.atTopSince = Date.now();
        }}
      >
        <header className="shelf-head">
          <div className="shelf-head-text">
            <h1 className="shelf-title">
              {hasQuery ? '搜索结果' : '我的书架'}
            </h1>
            <p className="shelf-subtitle muted">
              {hasQuery
                ? state.total > 0
                  ? `「${state.query}」匹配 ${state.total} 本`
                  : `没有匹配「${state.query}」的书`
                : this.subtitle(state.total)}
            </p>
          </div>
          <div className="shelf-head-actions">
            {/* The manager's entry point travels with the title rather than
                sitting in the toolbar: it is a *place*, not a filter, and the
                toolbar is where the filters are. */}
            <IconButton label="书库管理" icon="folder-open" onClick={() => this.options.onOpenManager('')} />
            <IconButton
              label={`书架设置 · ${DENSITY_LABELS[density]}`}
              icon="settings"
              onClick={() => this.patch({ settingsOpen: !state.settingsOpen })}
            />
          </div>
        </header>

        <div className="shelf-search" role="search">
          <Icon name="search" class="search-glyph" />
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
              <Icon name="close" />
            </button>
          ) : null}
        </div>

        {state.continueItems.length > 0 ? (
          <section className="shelf-section" aria-label="继续阅读">
            <SectionHeading label="继续阅读" />
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
          </section>
        ) : null}

        <section className="shelf-section" aria-label={hasQuery ? '搜索结果' : '全部书籍'}>
          <div className="shelf-toolbar">
            {hasQuery || state.total > 0 ? (
              <span className="shelf-count muted">
                {hasQuery ? `找到 ${state.total} 本` : `共 ${state.total} 本`}
              </span>
            ) : (
              <span className="shelf-count muted" />
            )}
            <div className="shelf-sort" role="group" aria-label="排序方式">
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
          </div>

          <div className="shelf-refresh" hidden={!state.refreshing}>
            {state.refreshing ? '正在刷新…' : ''}
          </div>

          {state.bootstrapping && empty ? <ShelfSkeleton density={density} /> : null}

          {!state.bootstrapping && empty ? (
            hasQuery ? (
              <div className="empty-state">
                <Icon name="search" class="empty-glyph" />
                <p>没有匹配的书</p>
                <p className="muted">换个关键词，或者检查一下作者名的写法</p>
                <button type="button" className="button" onClick={() => this.clearSearch()}>
                  清除搜索
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <Icon name="book" class="empty-glyph" />
                <p>书库还是空的</p>
                <p className="muted">
                  把书籍放进挂载的目录，扫一次，它们就会出现在这里
                </p>
                <div className="empty-actions">
                  <IconTextButton icon="folder-open" label="打开书库管理" onClick={() => this.options.onOpenManager('')} />
                  <IconTextButton icon="refresh" label="刷新" onClick={() => void this.manualRefresh()} />
                </div>
              </div>
            )
          ) : null}

          {!empty ? (
            <div
              className="book-grid"
              data-density={density}
              data-showAuthor={String(this.settings.shelfShowAuthor)}
              data-show-progress={String(this.settings.shelfShowProgress)}
            >
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
          ) : null}

          {state.loading && state.items.length > 0 ? <div className="spinner" /> : null}
          {state.status ? <div className="shelf-status muted">{state.status}</div> : null}
        </section>

        <ShelfSettingsPanel
          open={state.settingsOpen}
          settings={this.settings}
          onPatch={(patch) => this.applySettings(patch)}
          onClose={() => this.patch({ settingsOpen: false })}
        />
      </ShelfScroller>
    );
  }

  /**
   * The line under "我的书架".
   *
   * Says how much there is before a single request has answered, because the
   * count is already known from the local mirror — the one number a reader wants
   * on opening a library is how big it is, and a blank line while the server
   * thinks is a worse answer than a slightly stale one.
   */
  private subtitle(total: number): string {
    if (this.settings.shelfSort === 'title' && total > 0) return `按书名排列 · ${total} 本`;
    if (this.settings.shelfSort === 'author' && total > 0) return `按作者排列 · ${total} 本`;
    if (this.settings.shelfSort === 'added' && total > 0) return `最近入库 · ${total} 本`;
    if (total > 0) return `继续上次没读完的 · 共 ${total} 本`;
    return '自部署书库';
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
