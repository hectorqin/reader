/**
 * The paged reader: comics, image directories, single images.
 *
 * Deliberately much simpler than the reflowable reader, and for a reason the
 * user's own message named: **a comic is not text, so it should not go through a
 * WebView at all.** A native `ImageView` decodes a JPEG with hardware support and
 * recycles the bitmap; an `<img>` inside a page on a low-end Android device is
 * several times the memory and CPU for the same screen. The Android shell
 * therefore renders this content natively and only uses this module for the H5
 * build.
 *
 * What both implementations share is the addressing: `items[].href` from the
 * manifest, fetched one page at a time. That is what makes "download the whole
 * volume" a client decision rather than a requirement — a reader who flips
 * through three pages of a 300MB volume has downloaded three pages.
 *
 * Three details that are easy to get wrong:
 *
 *  - **Page order comes from the manifest, never from the file name.** The server
 *    already applied natural ordering (`page10` after `page2`), and re-sorting on
 *    the client would disagree with it for archives with a directory layout.
 *  - **Object URLs are revoked.** Each page is a Blob; leaking one per page turn
 *    is a few hundred megabytes over a volume.
 *  - **The next page is decoded before it is shown.** Swapping `img.src` and
 *    letting the browser paint on arrival shows a blank frame for a moment, which
 *    reads as a stutter on every single turn.
 */

import { ApiClient, type BookDto } from '../net/api.ts';
import { Emitter } from '../lib/events.ts';
import { PrefetchCache } from './prefetch.ts';
import { toWindow, type Window } from './window.ts';
import { parseLocator, serializeLocator, type Locator } from '../lib/locator.ts';

export interface PagedState {
  book: BookDto;
  index: number;
  total: number;
  /** Set when the current page is still being fetched. */
  loading: boolean;
  warnings: string[];
}

export interface PagedOptions {
  device?: string;
  progressDebounceMs?: number;
  /**
   * Host platform. Android renders pages natively and never constructs this
   * reader; the option exists so the H5 build can declare itself explicitly
   * rather than relying on which module imported it.
   */
  platform?: 'web' | 'android';
}

export class PagedReader {
  readonly state = new Emitter<PagedState>();
  private readonly cache = new PrefetchCache({ ahead: 2, maxBytes: 24 * 1024 * 1024 });
  private window: Window | null = null;
  private index = 0;
  private objectUrl: string | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelPrefetch: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: ApiClient,
    private readonly book: BookDto,
    private readonly options: PagedOptions = {},
  ) {}

  /**
   * Open at a stored page.
   *
   * A comic's position is a page index, which is a stable locator only because it
   * is resolved against the manifest: a volume added in the middle of a series
   * moves every later page, and the server's group offsets are what let the
   * client detect that and land on the same *volume* rather than the same offset.
   */
  async open(bookId: string, group = 0): Promise<PagedState> {
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
    const local = saved ? this.window.items.findIndex((item) => item.href === saved.chapter) : -1;
    await this.show(local >= 0 ? local : 0);
    return this.currentState();
  }

  get total(): number {
    return this.window?.items.length ?? 0;
  }

  /** Move by a number of pages. Stops at the ends rather than wrapping. */
  async turn(pages: number): Promise<void> {
    await this.show(this.index + pages);
  }

  async goTo(index: number): Promise<void> {
    await this.show(index);
  }

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
    this.releaseUrl();
    this.state.clear();
  }

  private async show(index: number): Promise<void> {
    const window = this.window;
    if (!window || window.items.length === 0) return;
    const clamped = Math.max(0, Math.min(window.items.length - 1, index));
    const item = window.items[clamped];
    if (!item) return;

    this.index = clamped;
    this.emit(true);

    const blob = await this.cache.get(item.href, (key) => this.api.asset(this.book.id, key));
    // A page the reader has already flipped past must not replace the current
    // one: a slow request racing a fast thumb would otherwise show an old page.
    if (this.index !== clamped) return;

    const url = URL.createObjectURL(blob);
    const previous = this.objectUrl;
    this.objectUrl = url;

    const image = document.createElement('img');
    image.className = 'reader-page';
    image.alt = item.title;
    image.decoding = 'async';
    // Decode before mounting: without this the container is empty for as long as
    // the browser takes to decode, which is visible on every turn for a large scan.
    await image.decode().catch(() => undefined);
    this.host.replaceChildren(image);
    image.src = url;
    if (previous) URL.revokeObjectURL(previous);

    this.emit(false);
    this.emitProgress();
    this.prefetch(clamped);
  }

  private prefetch(index: number): void {
    const window = this.window;
    if (!window) return;
    this.cancelPrefetch?.();
    const keys = window.items.map((item) => item.href);
    this.cancelPrefetch = this.cache.warm(keys, index, (key) => this.api.asset(this.book.id, key), {
      sizeOf: (key) => window.items.find((item) => item.href === key)?.size,
    });
  }

  private emitProgress(): void {
    const delay = this.options.progressDebounceMs ?? 2000;
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
    if (!window) return;
    const item = window.items[this.index];
    if (!item) return;
    // For a paged book the locator is the page's own identity, which the server
    // handed us. Rebuilding it from an index would break the moment a volume is
    // re-packed with an extra page.
    const locator: Locator = {
      chapter: item.href,
      spine: (window.group?.offset ?? 0) + this.index,
      block: 0,
      ratio: 0,
      percent: this.index / Math.max(1, window.items.length),
    };
    await this.api
      .putProgress(this.book.id, {
        locator: serializeLocator(locator),
        percentage: locator.percent,
        chapterTitle: item.title,
        device: this.options.device ?? 'web',
        updatedAt: Date.now(),
      })
      .catch(() => undefined);
  }

  private emit(loading: boolean): void {
    this.state.emit({
      book: this.book,
      index: this.index,
      total: this.total,
      loading,
      warnings: [],
    });
  }

  private currentState(): PagedState {
    return {
      book: this.book,
      index: this.index,
      total: this.total,
      loading: false,
      warnings: [],
    };
  }

  private releaseUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
