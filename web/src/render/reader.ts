/**
 * The reflowable book reader.
 *
 * Owns the chapter lifecycle for EPUB and TXT:
 *
 *   chapter N-1 (cached) → chapter N (mounted, paginated) → chapter N+1 (prefetched)
 *
 * Four decisions are load-bearing and worth stating.
 *
 * ### 1. Chapters are fetched one at a time, and windowed
 *
 * The whole book is never downloaded. The manifest carries the first window of
 * chapters; turning past its last one fetches the next window. A 1200-chapter
 * omnibus therefore costs one window of metadata and one chapter of bytes to
 * open, and the client's memory holds at most three chapters.
 *
 * ### 2. Chapter identity is the server's `href`, never a spine index
 *
 * Windowed manifests return a prefix of the spine, so an index computed against
 * a window means a different chapter in the full spine. This was a real bug in
 * the first version of the server contract and is why items are addressed by
 * archive path.
 *
 * ### 3. Progress is reported on the chapter's turn, not on every page
 *
 * A page turn happens several times a minute and each one is a write to the
 * user's account. Reporting on page turn would be a request per swipe; reporting
 * only on chapter change would lose the reader's place inside a chapter. So it is
 * debounced, and flushed on close and on visibility change — the two moments a
 * browser may not give us another chance.
 *
 * ### 4. Append-vs-replace for the text of a book with no spine
 *
 * A TXT file with no chapter headings has no addressable structure. Scrolling it
 * as a stream is the only honest option, and the server exposes it as byte
 * ranges (`chunk:<offset>`). The reader appends rather than replacing, because
 * replacing would fight the reader's own scroll position.
 */

import { ApiClient, type BookContent, type BookDto, type ContentItem } from '../net/api.ts';
import {
  contains,
  groupForSpine,
  toLocalIndex,
  toSpineIndex,
  toWindow,
  type Window,
} from './window.ts';
import { ChapterContainer, type ReaderStyle } from './container.ts';
import { Paginator, capturePosition, pageFraction, restorePosition } from './paginator.ts';
import { PrefetchCache } from './prefetch.ts';
import { Emitter } from '../lib/events.ts';
import { bookPercent, parseLocator, serializeLocator, type Locator } from '../lib/locator.ts';
import { withAssetToken } from '../net/asset-url.ts';

export interface ReaderState {
  book: BookDto;
  /** All groups, so the table of contents is complete before every window is fetched. */
  groups: BookContent['groups'];
  /** Items of the loaded window. */
  items: ContentItem[];
  /** Index into `items` of the chapter on screen. */
  index: number;
  /** Total chapters in the book (not just this window). */
  total: number;
  page: number;
  pageCount: number;
  warnings: string[];
}

export interface ReaderOptions {
  /** Device name recorded with each progress update. */
  device?: string;
  /** Milliseconds to coalesce progress writes; 0 disables debouncing. */
  progressDebounceMs?: number;
  /** Host platform, so the reader can adapt gesture expectations. */
  platform?: 'web' | 'android';
  /** Type size and page width, mirrored into each chapter document. */
  style: ReaderStyle;
}

export class BookReader {
  readonly state: Emitter<ReaderState> = new Emitter();
  private readonly container: ChapterContainer;
  private readonly paginator: Paginator;
  private readonly cache = new PrefetchCache();
  private window: Window | null = null;
  private current: ReaderState | null = null;
  private locator: Locator | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelPrefetch: (() => void) | null = null;
  private readonly device: string;

  private style: ReaderStyle;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: ApiClient,
    private readonly book: BookDto,
    private readonly options: ReaderOptions,
  ) {
    this.device = options.device ?? 'web';
    this.style = options.style;
    this.container = new ChapterContainer(host);
    this.paginator = new Paginator(null, {
      columnGap: options.style.columnGap,
      pagePadding: options.style.pagePadding,
    });
  }

  /**
   * Open the book at a stored position.
   *
   * One request. The manifest carries the addressable structure as well as the
   * book, so there is no second round trip before the first page can be drawn —
   * which over a tunnel is the difference between a book opening and a book that
   * appears to hang.
   */
  async open(bookId: string, group = 0): Promise<ReaderState> {
    const manifest = await this.api.manifest(bookId, group);
    this.window = toWindow(manifest.content ?? null, {
      ...(manifest.kind !== undefined ? { kind: manifest.kind } : {}),
      ...(manifest.total !== undefined ? { total: manifest.total } : {}),
      ...(manifest.groups !== undefined ? { groups: manifest.groups } : {}),
      ...(manifest.items !== undefined ? { items: manifest.items } : {}),
    });

    const saved = parseLocator(
      (await this.api.progress(bookId).catch(() => ({ progress: null }))).progress?.locator ?? '',
    );
    this.locator = saved;

    // A saved chapter is matched by its `href`, which is the only identifier
    // that survives a window boundary. Falling back to the window's first item
    // is right: it is where a book starts.
    const target = saved
      ? this.window.items.findIndex((item) => item.href === saved.chapter)
      : -1;
    await this.show(target >= 0 ? target : 0, saved ?? undefined);
    return this.current!;
  }

  /** The chapter's document, for highlight and search integration. */
  get chapterDocument(): Document | null {
    return this.container.document();
  }

  /** Turn pages; a spill at either end moves to the neighbouring chapter. */
  async turn(pages: number): Promise<void> {
    if (!this.current || !this.window) return;
    const { changed, spill } = this.paginator.turn(pages);
    if (spill !== 0) {
      const next = this.current.index + Math.sign(spill);
      if (next < 0 || next >= this.window.items.length) {
        if (changed) this.publish();
        return;
      }
      await this.show(next);
      // A forward spill lands on the *first* page of the next chapter and a
      // backward spill on its last, which is what a real book does.
      if (spill > 0) this.paginator.goTo(0);
      else this.paginator.goTo(this.paginator.total - 1);
      this.publish();
      return;
    }
    if (changed) this.publish();
  }

  /** Jump to a chapter by index within the loaded window. */
  /**
   * Jump to a whole-book position.
   *
   * Fetches the window that contains it when necessary, which is what makes the
   * table of contents of a 1200-chapter book work with only one window in memory.
   */
  async goToSpine(spine: number): Promise<void> {
    if (!this.window) return;
    await this.ensureWindow(spine);
    if (!this.window || !contains(this.window, spine)) return;
    await this.show(toLocalIndex(this.window, spine));
  }

  /**
   * Jump to a table-of-contents entry.
   *
   * Either a whole-book index or a chapter href works: a comic's table of
   * contents is a list of volumes, and its entries map to a group rather than to
   * a single chapter.
   */
  async goToSpineOfHref(href: string): Promise<boolean> {
    if (!this.window) return false;
    const local = this.window.items.findIndex((item) => item.href === href);
    if (local >= 0) {
      await this.show(local);
      return true;
    }
    return false;
  }

  /** Recompute geometry after a resize, keeping the reader's place. */
  relayout(): void {
    if (!this.current) return;
    const geometry = this.paginator.layout(this.container.width());
    const position = capturePosition(this.container.scroller(), this.paginator.index, geometry.stride);
    const after = this.paginator.layout(this.container.width());
    this.paginator.goTo(restorePosition(this.container.scroller(), position, after.stride));
    this.publish();
  }

  /** Update the type size and repaginate, keeping the reader's place. */
  async restyle(style: ReaderStyle): Promise<void> {
    this.style = style;
    if (!this.current) return;
    await this.reshow();
  }

  /**
   * Re-render the current chapter from the cache.
   *
   * Used after a type-size change: a chapter document is styled at load time, and
   * the only way to re-style it is to load it again. Reading it from the prefetch
   * cache makes this a re-layout rather than a network round trip.
   */
  private async reshow(): Promise<void> {
    const state = this.current;
    if (!state) return;
    const item = this.window?.items[state.index];
    if (!item) return;
    const stride = this.paginator.layout(this.container.width()).stride;
    const position = capturePosition(this.container.scroller(), this.paginator.index, stride);
    await this.show(state.index, {
      chapter: item.href,
      spine: toSpineIndex(this.window!, state.index),
      block: position.blockIndex,
      ratio: position.offsetRatio,
      percent: state.pageCount > 1 ? state.page / state.pageCount : 0,
    });
  }

  /**
   * Flush the pending progress write.
   *
   * Called on `pagehide` and when the app goes to the background. A browser that
   * is being closed does not run another timer, so a debounced write that is not
   * flushed here is a lost position.
   */
  async flush(): Promise<void> {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    await this.writeProgress();
  }

  destroy(): void {
    this.cancelPrefetch?.();
    this.cache.clear();
    this.container.destroy();
    this.state.clear();
  }

  // ---------------------------------------------------------------- internals

  private async show(index: number, restore?: Locator): Promise<void> {
    const window = this.window;
    if (!window) return;
    const item = window.items[index];
    if (!item) return;

    const xml = await this.cache
      .get(item.href, () => this.api.asset(this.book.id, item.href))
      .then((blob) => blob.text());

    // The chapter's own images and stylesheets are fetched by the browser, not by
    // us, so their URLs have to be self-authenticating before the document is
    // handed to the frame.
    await this.container.mount(withAssetToken(xml, this.api), this.style);
    // The scroller belongs to the chapter's own document, so the paginator is
    // pointed at it after the frame has loaded and laid out.
    this.paginator.attach(this.container.scroller());
    const geometry = this.paginator.layout(this.container.width());

    // Restoring an intra-chapter position is only meaningful for the chapter it
    // was captured in. Landing in a different chapter uses its first page.
    const target =
      restore && restore.chapter === item.href
        ? restorePosition(this.container.scroller(), { blockIndex: restore.block, offsetRatio: restore.ratio }, geometry.stride)
        : 0;
    this.paginator.goTo(Math.min(target, geometry.pageCount - 1));

    this.current = {
      book: this.book,
      groups: window.groups,
      items: window.items,
      index,
      total: window.total,
      page: this.paginator.index,
      pageCount: this.paginator.total,
      warnings: [],
    };
    this.scheduleProgress();
    this.prefetchFrom(index);
    this.publish();
  }

  private publish(): void {
    if (!this.current) return;
    const state: ReaderState = {
      ...this.current,
      page: this.paginator.index,
      pageCount: this.paginator.total,
    };
    this.current = state;
    this.state.emit(state);
  }

  private scheduleProgress(): void {
    const delay = this.options.progressDebounceMs ?? 4000;
    if (delay === 0) {
      void this.writeProgress();
      return;
    }
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      void this.writeProgress();
    }, delay);
  }

  private async writeProgress(): Promise<void> {
    const window = this.window;
    const state = this.current;
    if (!window || !state) return;
    const item = window.items[state.index];
    if (!item) return;

    const stride = this.paginator.layout(this.container.width()).stride;
    const position = capturePosition(this.container.scroller(), this.paginator.index, stride);
    const fraction = pageFraction(this.paginator.index, this.paginator.total);
    // The spine index is derived from the loaded window's group, never from the
    // window's own array offset: `items` holds one window, so `index` is local.
    const spine = toSpineIndex(window, state.index);
    const locator: Locator = {
      chapter: item.href,
      spine,
      block: position.blockIndex,
      ratio: position.offsetRatio,
      percent: bookPercent(spine, window.total, fraction),
    };
    this.locator = locator;

    await this.api
      .putProgress(this.book.id, {
        locator: serializeLocator(locator),
        percentage: locator.percent,
        chapterTitle: item.title,
        device: this.device,
        updatedAt: Date.now(),
      })
      .catch(() => {
        // A failed progress write is not worth interrupting reading for. The next
        // turn retries, and the position is still on the device.
      });
  }

  /** Prefetch the next chapter, and cancel the previous prefetch. */
  private prefetchFrom(index: number): void {
    const window = this.window;
    if (!window) return;
    this.cancelPrefetch?.();
    const keys = window.items.map((item) => item.href);
    this.cancelPrefetch = this.cache.warm(keys, index, (key) => this.api.asset(this.book.id, key), {
      // A phone on a tunnel re-reading a volume should not download it three
      // pages at a time, but it should not stall on every turn either.
      ahead: this.options.platform === 'android' ? 1 : 2,
      sizeOf: (key) => window.items.find((item) => item.href === key)?.size,
    });
  }

  /** Load the window holding a whole-book index, if it is not loaded already. */
  private async ensureWindow(spine: number): Promise<void> {
    if (!this.window || contains(this.window, spine)) return;
    const group = groupForSpine(this.window, spine);
    if (!group) return;
    const loaded = await this.api.items(this.book.id, group.seq);
    this.window = toWindow(loaded);
  }
}
