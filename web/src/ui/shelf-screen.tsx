import { ApiError } from '../api/errors.ts';
import type { ListQuery, ReaderApi } from '../api/client.ts';
import type { Book } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { Platform } from '../core/platform.ts';
import type { AppSettings, ShelfSort } from '../store/settings.ts';
import { mountUI } from './mount.ts';
import { DENSITY_LABELS, SHELF_SORTS, ShelfSettingsPanel } from './shelf-settings.tsx';
import { isLocalSort, shelfOrder, shelfServerSort, sortBooks, type ReadingTimes } from './shelf-order.ts';
import { Icon, IconButton, IconTextButton } from './toolkit.tsx';
import { type ComponentChildren, type JSX, useEffect, useState } from './vendor/preact.ts';

export interface ShelfScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  platform: Platform;
  /** Current shelf preferences, so the screen starts in the reader's own state. */
  settings: AppSettings;
  /** The page the URL asked for. 1-based; the screen reports every change back. */
  page: number;
  /**
   * The folder and page the library screen was last showing.
   *
   * The library owns a URL of its own, so switching to the shelf *leaves* it — and
   * a reader who switches back expects the folder they were in, not the library
   * root. The router carries these on the shelf's own route for exactly that
   * reason (see `Route` in `router.ts`).
   */
  libraryPath: string;
  libraryPage: number;
  onOpenBook(book: Book): void;
  /**
   * Switches to the library screen, at a folder and page — and, by default, on the
   * *browsing* half of it. See `onOpenLibraryView` for the other half.
   *
   * Both halves of the location are carried because the library is a *place* the
   * reader was last in: the path is what makes `#/library/科幻` shareable, and the
   * page is what makes coming back to the library land where they left it rather
   * than on the first sixty entries of a folder with four hundred.
   */
  onOpenLibrary(path: string, page: number): void;
  /**
   * Switches to the library screen's *file manager*.
   *
   * The shelf has one entry point to the library and it used to open the browsing
   * half, because that was the only half there was. The screen now has two — books
   * to browse, files to manage (see `LibraryScreen`) — and the shelf's own button
   * is about *books*, so it opens the preview page. This callback is the other
   * direction, kept so the two can be switched between without going back to the
   * shelf first.
   */
  onOpenLibraryManager(path: string): void;
  /**
   * Reports the page the reader turned to, so the URL can follow it.
   *
   * A path rather than nothing because the shelf is paginated now, and a page that
   * lives only in component state is a page that Back, Forward and a reload all
   * throw away — the three things the router exists to make work.
   */
  onPageChange(page: number): void;
  onSignedOut(): void;
  /** Persisted through the app's settings store, like the reader's own. */
  onSettingsChange(patch: Partial<AppSettings>): void;
}

/**
 * Sort options, in the order the toolbar and the sheet show them.
 *
 * The list itself lives beside the settings sheet that offers the same four as a
 * *default*, because the two are one list: a value in one and not the other is a
 * setting the reader can store but never select.
 *
 * Two of the four are about *time* and they are two different times — when the
 * reader last read the book, and when the book arrived in the library — which is
 * exactly the pair that used to be collapsed into "最近更新". 最近阅读 comes first
 * because it is the default, and a row of chips whose default is buried in the
 * middle makes the reader hunt for the state they are already in.
 *
 * 最近入库 stays. It was very nearly dropped in favour of 最近阅读, and keeping both
 * is right for a reason the report gives: they answer questions that are asked at
 * different times. "Where was I" is asked every time the app is opened; "what did
 * I just put in there" is the question a reader has *after a scan*, which is
 * precisely when neither 书名 nor 作者 is the sort they want.
 */
const SORTS: Array<{ value: ShelfSort; label: string }> = SHELF_SORTS;

/**
 * How many books a client-side sort fetches.
 *
 * `recent` orders the whole shelf by reading time, and it therefore cannot use the
 * server's pagination — sorting one page and paginating it would be a different
 * order from "the shelf sorted by recency", which is what the label says. So the
 * pages are read and stitched here, and this is the ceiling on how many.
 *
 * 500 is chosen to match the server's own `pageSize` maximum many times over while
 * still being one round trip on a LAN: six requests at the documented default of
 * 200, all issued at once. A library larger than this loses the tail of its
 * never-opened books from *this one sort* — which is stated in the subtitle rather
 * than hidden, and is the correct trade against opening a 3000-book shelf by
 * reading three thousand rows through a phone.
 */
const RECENT_WINDOW = 500;

/**
 * Books per page.
 *
 * 60 is a grid of about twenty rows at the phone's default density and about five
 * at the widest, which is enough that turning a page is a deliberate act rather
 * than a scroll. It is also the same number the shelf used as its infinite-scroll
 * *chunk*, so a library that felt responsive before still fills the screen in one
 * request.
 */
const PAGE_SIZE = 60;

interface ShelfState {
  /**
   * Which page of the list is on screen, and where it came from.
   *
   * `page` is what the URL says (the screen is told to show it and never derives
   * it); `pageCount` is what the last response implies. They are separate because
   * a search that shrinks the result set must clamp the page *after* the answer
   * arrives rather than before the request is made.
   */
  page: number;
  pageCount: number;
  /** What the "书库" switch will open, carried on this route by the shell. */
  libraryPath: string;
  libraryPage: number;
  /** Written into the search field; the debounced query is `applied`. */
  search: string;
  query: string;
  items: Book[];
  /**
   * When each book was last read, for the 最近阅读 ordering.
   *
   * Fetched even when the sort is something else, and not out of laziness: it is
   * *also* what draws the progress bar on every cover, so the shelf already had
   * this data and was throwing the timestamps away. Keeping them means the default
   * sort costs no extra request.
   */
  readingTimes: ReadingTimes;
  /**
   * Whether `readingTimes` has been filled in at all.
   *
   * Distinct from "it is empty", which is true both before the first answer and for
   * a reader who has never opened a book. Without the distinction the shelf would
   * paint 最近阅读 with every book tied at zero for one frame and then reorder
   * itself — the shelf shuffling under the reader's thumb, which is the exact thing
   * the tie-break in `shelf-order.ts` exists to prevent.
   */
  readingTimesLoaded: boolean;
  /**
   * How many books the last 最近阅读 sort could not place.
   *
   * Non-zero only for a library bigger than `RECENT_WINDOW`, and reported in the
   * subtitle rather than hidden: a sort that silently drops the books it cannot
   * order is a shelf with books missing from it.
   */
  unsortedTail: number;
  total: number;
  /**
   * True while a page is in flight.
   *
   * Distinct from `bootstrapping`, which is about the first paint: this one draws a
   * spinner *under* a list that already exists, and it is what disables the pager
   * so two page turns cannot race and land out of order.
   */
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
      page: options.page > 0 ? options.page : 1,
      pageCount: 1,
      libraryPath: options.libraryPath,
      libraryPage: options.libraryPage,
      search: '',
      query: '',
      items: [],
      readingTimes: new Map(),
      readingTimesLoaded: false,
      unsortedTail: 0,
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
      // The cached list is drawn before the first request, and that is also why the
      // reading times are kicked off here rather than inside `refresh`: the default
      // sort needs them, and waiting for two round trips to show a list the device
      // already holds is the wrong trade on a train.
      this.patch({ items: sortBooks(cached, this.sort, this.state.readingTimes) });
    }
    await Promise.all([this.loadReadingTimes(), this.refresh()]);
    // The skeleton is cleared by `refresh` on both paths (success clears it with
    // the first page, failure clears it in `handleError`), so this is only for the
    // case where a screen is disposed mid-flight and never draws again.
  }

  /**
   * Shows the page the URL asks for.
   *
   * Called by the shell when the route changes *while this screen is already on
   * screen* — a Back, a Forward, or a link to `#/shelf/3`. The screen is told which
   * page to show and never derives it from its own state, which is what keeps the
   * URL and the list from disagreeing after a Back.
   */
  async showPage(page: number): Promise<void> {
    const target = page > 0 ? page : 1;
    if (target === this.state.page && !this.state.bootstrapping) return;
    // A page turn scrolls to the top, because the alternative is landing halfway
    // down page two of a *different* list — and the reader has no way to tell that
    // the jump was the page turn rather than a lost scroll position.
    this.lastScrollTop = 0;
    await this.refresh(target);
  }

  /**
   * The timestamps the 最近阅读 ordering is built from.
   *
   * One request for the whole shelf, through the same endpoint the 继续阅读 row used
   * to be drawn from — so removing that row took nothing off the wire, it only
   * stopped it drawing a second copy of books that are already on the grid.
   *
   * A failure is swallowed into "no times yet" rather than into the status line:
   * this is a *sort key*, and a reader who cannot reach the continue endpoint can
   * still read their shelf in every other order. An error banner about an ordering
   * would be a worse answer than the ordering falling back to the server's.
   */
  private async loadReadingTimes(limit = RECENT_WINDOW): Promise<void> {
    try {
      const items = await this.options.api.continueReading(limit);
      const times = new Map<string, number>();
      for (const item of items) {
        // `lastReadAt` is null for a progress row that has never been pushed; the
        // book is then "read at unknown time", which is *not* the same as never
        // read, and it sorts by the time the row was last written instead.
        times.set(item.id, item.lastReadAt ?? item.updatedAt ?? 0);
      }
      this.patch({ readingTimes: times, readingTimesLoaded: true });
      // The grid on screen was sorted with the old map, so it is re-sorted now —
      // otherwise the first paint of a cold start would be in server order and the
      // second in reading order, which is the shelf shuffling itself.
      if (isLocalSort(this.sort)) this.patch({ items: sortBooks(this.state.items, this.sort, times) });
    } catch {
      // Left unloaded: `refresh` decides what to do about it, because only it knows
      // what is on screen.
    }
  }

  /**
   * Fetches one page of the shelf.
   *
   * `page` defaults to the page currently shown, so a refresh after a scan lands
   * the reader back where they were rather than on page one. It is a *replacement*,
   * not an append: the infinite scroll this screen used to have appended a chunk
   * and knew nothing about pages, so a list longer than one page grew without
   * bound and Back had nothing to go back *to*.
   *
   * ## The two shapes of a sort
   *
   * A **server-side** sort pages, because the server is what does the ordering and
   * its order is therefore a property of the whole result set. A **client-side**
   * sort (only 最近阅读) cannot: the shelf would be sorting one pageful of sixty and
   * drawing it under a pager that claims "page 1 of 34", which is a wrong answer to
   * the question the label asks. So that sort reads a window of the shelf in one
   * go, sorts it here, and slices its own page out of the result.
   */
  async refresh(page = this.state.page): Promise<void> {
    const requested = page > 0 ? page : 1;
    // Set before the request, cleared in the `finally`: the pager is drawn from it,
    // and a pager that stays live while a page is in flight is a pager the reader
    // can press twice and land two pages away from where they aimed.
    this.patch({ loading: true });
    try {
      if (isLocalSort(this.sort)) {
        await this.refreshByRecency(requested);
        return;
      }
      const result = await this.options.api.listBooks(this.listQuery(requested));
      /*
       * A page past the end is clamped *after* the answer, not before the request.
       *
       * The count is the only thing that knows how many pages there are, and asking
       * for page 9 of a library that shrank to 3 pages while the reader was on it
       * answers an empty list rather than an error. Left unclamped the reader gets a
       * blank grid with a page number above it and no way to tell that the list is
       * fine — so the clamp re-asks for the last real page, once.
       */
      const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      const effective = Math.min(requested, pageCount);
      if (effective !== requested) {
        if (this.state.page !== effective) this.options.onPageChange(effective);
        await this.refresh(effective);
        return;
      }
      await this.options.offline.replaceBooks(result.items);
      this.patch({
        page: requested,
        pageCount,
        // Sorted *within* the page, never across pages: a page is a continuation of
        // the server's order, and re-sorting a pageful locally would be right only
        // by coincidence.
        items: sortBooks(result.items, this.sort),
        total: result.total,
        unsortedTail: 0,
        status: '',
        bootstrapping: false,
        revision: this.state.revision + 1,
      });
      this.restoreScroll();
    } catch (err) {
      this.handleError(err);
    } finally {
      this.patch({ loading: false });
    }
  }

  /**
   * The 最近阅读 page, assembled from a window of the whole shelf.
   *
   * The window is fetched in `PAGE_SIZE`-sized chunks *in parallel*, because the
   * server's own `pageSize` cap is what it is and because a shelf that opens with
   * six sequential round trips is a shelf that opens slowly on exactly the network
   * (a phone, away from home) where the local mirror cannot help.
   *
   * The page number the reader asked for is *not* clamped to what the window holds:
   * the pager for this sort is drawn over the window, so the two always agree, and
   * clamping against the server's total instead would offer pages of a list that
   * has been reordered.
   */
  private async refreshByRecency(requested: number): Promise<void> {
    if (!this.state.readingTimesLoaded) await this.loadReadingTimes();
    const times = this.state.readingTimes;

    const first = await this.options.api.listBooks({ ...this.listQuery(1), pageSize: PAGE_SIZE });
    const window = Math.min(first.total, RECENT_WINDOW);
    const chunkCount = Math.max(1, Math.ceil(window / PAGE_SIZE));
    const rest =
      chunkCount > 1
        ? await Promise.all(
            Array.from({ length: chunkCount - 1 }, (_value, index) =>
              this.options.api
                .listBooks({ ...this.listQuery(index + 2), pageSize: PAGE_SIZE })
                // A chunk that fails is skipped rather than failing the screen: the
                // shelf is a list, and losing the tail of it is a smaller failure
                // than losing all of it.
                .then((page) => page.items)
                .catch(() => [] as Book[]),
            ),
          )
        : [];
    const all = [first.items, ...rest].flat();

    /*
     * The clamp here is against the *window*, and it is applied after the sort.
     *
     * A URL can name page nine of a shelf that has shrunk to three, and the answer
     * is the last real page rather than an empty grid — the same rule the server
     * sort follows, asked of a different authority. It is reported to the shell so
     * that Back does not return to the empty page.
     */
    const pageCount = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const effective = Math.min(requested, pageCount);
    if (effective !== requested) {
      if (this.state.page !== effective) this.options.onPageChange(effective);
      await this.refresh(effective);
      return;
    }

    const sorted = sortBooks(all, 'recent', times);
    const start = (requested - 1) * PAGE_SIZE;
    await this.options.offline.replaceBooks(all);
    this.patch({
      page: requested,
      pageCount,
      items: sorted.slice(start, start + PAGE_SIZE),
      total: first.total,
      // How much of the shelf this ordering could not place, for the subtitle. It is
      // zero for every library that fits the window, which is nearly all of them.
      unsortedTail: Math.max(0, first.total - all.length),
      status: '',
      bootstrapping: false,
      revision: this.state.revision + 1,
    });
    this.restoreScroll();
  }

  /**
   * Puts the scroll position back after a render.
   *
   * Restored in the next frame, because the list is empty for one tick and a scroll
   * position with nothing to scroll to is clamped to zero.
   */
  private restoreScroll(): void {
    const scroll = this.scrollRef.current;
    if (!scroll) return;
    requestAnimationFrame(() => {
      scroll.scrollTop = this.lastScrollTop;
    });
  }

  /**
   * Turns to a page, from the pager or from a keyboard.
   *
   * The screen does not change its own page directly: it *reports* the intent and
   * the shell writes the URL, which comes back through `showPage`. That round trip
   * is what makes a page addressable, and it is why `onPageChange` is called even
   * when the fetch is already in flight — the URL is the state, not this class.
   */
  private goToPage(page: number): void {
    const target = Math.min(Math.max(1, page), this.state.pageCount);
    if (target === this.state.page) return;
    this.options.onPageChange(target);
  }

  /**
   * The request for one page of the shelf.
   *
   * `sort` is translated through `shelfServerSort`, which is what keeps 最近阅读 from
   * being sent to a server that has never heard of it — that ordering is done here,
   * over a window, and the request it rides on is an `added` page the client is
   * about to re-sort. Sending the client's own vocabulary would be a 400 the day the
   * server validates the parameter, and a silently-different order every day before
   * that.
   */
  private listQuery(page: number, pageSize = PAGE_SIZE): ListQuery {
    const sort = shelfServerSort(this.sort);
    return {
      ...(this.state.query ? { search: this.state.query } : {}),
      sort,
      order: shelfOrder(sort),
      page,
      pageSize,
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
    // Ordering changes the whole result set, so a re-fetch rather than a
    // client-side re-sort: the server is the authority, and it is the only side
    // that can re-sort a library larger than one page. Page one as well, because
    // "the third page of a different order" is a position the reader never chose.
    if (this.state.page !== 1) {
      this.options.onPageChange(1);
      return;
    }
    void this.refresh(1);
  }

  private onScroll(scroll: HTMLDivElement): void {
    this.lastScrollTop = scroll.scrollTop;
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
          /*
           * The offline list is a *pageful* of the cached shelf, sliced here.
           *
           * The mirror holds whatever has been seen — for the 最近阅读 sort that is
           * the whole window, and for a server sort it is the pages the reader has
           * actually visited. Drawing all of it would be showing a list longer than
           * the one the pager describes, so the same slice is applied as online.
           */
          const sorted = sortBooks(cached, this.sort, this.state.readingTimes);
          const start = isLocalSort(this.sort) ? (this.state.page - 1) * PAGE_SIZE : 0;
          const items = isLocalSort(this.sort) ? sorted.slice(start, start + PAGE_SIZE) : sorted;
          this.patch({
            items,
            ...(isLocalSort(this.sort)
              ? { pageCount: Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)) }
              : {}),
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
            {/*
              The library's entry point travels with the title rather than sitting
              in the toolbar: it is a *place*, not a filter, and the toolbar is where
              the filters are. It carries the folder and page the reader was last in
              *there*, so switching back and forth is a toggle rather than a reset.

              The two glyphs are `books` and `tune`, and the pair they replaced —
              `folder-open` and `gear` — was the reported complaint about this row.
              See `tools/icons/paths.mjs`: at 18px a folder's four strokes and a
              gear's twelve teeth are the two densest shapes in the set, and a header
              that also carries a 24px title cannot afford either. The replacements
              say the same two things with fewer, longer strokes, and they are drawn
              to the set's own weight so they do not read as a different family.
            */}
            <IconButton
              label="书库"
              icon="books"
              onClick={() => this.options.onOpenLibrary(state.libraryPath, state.libraryPage)}
            />
            <IconButton
              label={`书架设置 · ${DENSITY_LABELS[density]}`}
              icon="tune"
              onClick={() => this.patch({ settingsOpen: !state.settingsOpen })}
            />
          </div>
        </header>

        <div className="shelf-search" role="search">
          <Icon name="magnifying-glass" class="search-glyph" />
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
              <Icon name="xmark" />
            </button>
          ) : null}
        </div>

        <section className="shelf-section" aria-label={hasQuery ? '搜索结果' : '全部书籍'}>
          <div className="shelf-toolbar">
            {hasQuery || state.total > 0 ? (
              <span className="shelf-count muted" data-testid="shelf-count">
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
                <Icon name="magnifying-glass" class="empty-glyph" />
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
                  <IconTextButton
                    icon="books"
                    label="打开书库"
                    onClick={() => this.options.onOpenLibrary(state.libraryPath, state.libraryPage)}
                  />
                  <IconTextButton icon="arrows-rotate" label="刷新" onClick={() => void this.manualRefresh()} />
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
          {/* The pager sits *inside* the section, under the covers it turns: a
              control that pages a list belongs under that list, and at the top it
              would be a second toolbar competing with the sort row. It is hidden
              entirely on a single-page library, because a pager with one page is a
              control that can only be pressed to no effect. */}
          {state.pageCount > 1 ? (
            <Pager
              page={state.page}
              pageCount={state.pageCount}
              busy={state.loading}
              onGo={(page) => this.goToPage(page)}
            />
          ) : null}
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
   *
   * It names the order, now that the order is a *choice* with four answers rather
   * than an implicit one: a reader who cannot see which of "最近阅读" and "最近入库"
   * is in effect has no way to tell why a book is where it is. That sentence also
   * has to be true of the 最近阅读 window, so a library bigger than it says so here
   * rather than quietly showing a shorter list under a bigger count.
   */
  private subtitle(total: number): string {
    if (total > 0) {
      const label = SORTS.find((option) => option.value === this.sort)?.label ?? '';
      const base = this.sort === 'recent' ? `最近阅读 · 共 ${total} 本` : `按${label}排列 · ${total} 本`;
      if (this.state.unsortedTail > 0) {
        return `${base}（其中 ${this.state.unsortedTail} 本未参与排序）`;
      }
      return base;
    }
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

/**
 * The page control under a list of books.
 *
 * ## Why numbered pages rather than a "load more" button
 *
 * The shelf used to append a chunk whenever the reader reached the bottom, which
 * means the list had no length the reader could see and no position they could
 * return to: closing the app and opening it again started from the top, and the
 * only record of "I was on the third screenful" was a scroll offset that does not
 * survive a repaint. A library of two thousand books is a *place*, and a place needs
 * a position.
 *
 * ## Why the window rather than every page
 *
 * Two thousand books is 34 pages, and 34 buttons on a phone is a control the reader
 * has to read instead of press. The window is `1 … n-1 n n+1 … N`, so the two ends
 * are always one press away and the middle is one press away from wherever they
 * are — which is every page a reader actually asks for.
 *
 * ## Why the arrows stay in the layout when they are disabled
 *
 * `disabled` rather than `hidden`: the buttons are in fixed positions, so a control
 * that disappears at page one moves the page numbers sideways under the reader's
 * thumb on the way to page two.
 */
function Pager({
  page,
  pageCount,
  busy,
  onGo,
}: {
  page: number;
  pageCount: number;
  busy: boolean;
  onGo(page: number): void;
}): JSX.Element {
  const numbers: Array<number | 'gap'> = [];
  const push = (value: number | 'gap'): void => {
    if (numbers.at(-1) !== value) numbers.push(value);
  };
  for (let n = 1; n <= pageCount; n += 1) {
    // First, last, and the pages around the reader: everything else collapses into
    // one ellipsis per run, so the control is the same width at 3 pages and at 300.
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) push(n);
    else push('gap');
  }
  return (
    <nav className="shelf-pager" aria-label="翻页">
      <button
        type="button"
        className="pager-step"
        aria-label="上一页"
        disabled={busy || page <= 1}
        onClick={() => onGo(page - 1)}
      >
        <Icon name="chevron-left" />
      </button>
      {numbers.map((value, index) =>
        value === 'gap' ? (
          <span className="pager-gap" key={`gap-${index}`} aria-hidden="true">
            …
          </span>
        ) : (
          <button
            type="button"
            key={value}
            className="pager-page"
            aria-label={`第 ${value} 页`}
            aria-current={value === page ? 'page' : undefined}
            disabled={busy}
            onClick={() => onGo(value)}
          >
            {value}
          </button>
        ),
      )}
      <button
        type="button"
        className="pager-step"
        aria-label="下一页"
        disabled={busy || page >= pageCount}
        onClick={() => onGo(page + 1)}
      >
        <Icon name="chevron-right" />
      </button>
    </nav>
  );
}
