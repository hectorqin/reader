import { ApiError } from '../api/errors.ts';
import type { ListQuery, ReaderApi } from '../api/client.ts';
import type { Book, ContinueReadingItem } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { Platform } from '../core/platform.ts';
import type { AppSettings, ShelfSort } from '../store/settings.ts';
import { clear, el, percent } from './dom.ts';
import { DENSITY_LABELS, buildShelfSettingsPanel } from './shelf-settings.ts';
import { sortBooks, shelfOrder } from './shelf-order.ts';

export interface ShelfScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  platform: Platform;
  /** Current shelf preferences, so the screen starts in the reader's own state. */
  settings: AppSettings;
  onOpenBook(book: Book): void;
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
 */
export class ShelfScreen {
  readonly element: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly continueRow: HTMLDivElement;
  private readonly continueSection: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;
  private readonly searchInput: HTMLInputElement;
  private readonly searchClear: HTMLButtonElement;
  private readonly countLabel: HTMLDivElement;
  private readonly sortRow: HTMLDivElement;
  private readonly refreshBar: HTMLDivElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsPanel: HTMLDivElement;
  private extraLoading: HTMLDivElement | null = null;
  private query = '';
  private offset = 0;
  private total = 0;
  private loading = false;
  /** Session sort; seeded from settings and written back when it changes. */
  private sort: ShelfSort;
  private readonly searchTimer: { id: ReturnType<typeof setTimeout> | null } = { id: null };
  private readonly coverUrls = new Map<string, string>();
  private readonly settings: AppSettings;
  private readonly scroll: HTMLDivElement;
  /** Scroll position of the previous render, so a refresh does not jump. */
  private lastScrollTop = 0;

  constructor(private readonly options: ShelfScreenOptions) {
    this.settings = { ...options.settings };
    this.sort = options.settings.shelfSort;

    this.searchInput = el('input', {
      attrs: {
        type: 'search',
        placeholder: '搜索书名、作者、系列',
        'aria-label': '搜索书库',
        enterkeyhint: 'search',
      },
      on: {
        input: () => this.onSearchInput(),
        keydown: (event) => {
          // `search` inputs fire a non-standard `search` event on clear, but only
          // in some browsers; Enter is the one that is reliable everywhere and it
          // also means "stop waiting for the debounce".
          if ((event as KeyboardEvent).key === 'Enter') {
            if (this.searchTimer.id !== null) clearTimeout(this.searchTimer.id);
            this.searchTimer.id = null;
            this.query = this.searchInput.value.trim();
            void this.refresh();
          }
        },
      },
    }) as HTMLInputElement;

    this.searchClear = el('button', {
      className: 'search-clear',
      text: '✕',
      attrs: { type: 'button', 'aria-label': '清除搜索', hidden: true },
      on: {
        click: () => {
          this.searchInput.value = '';
          this.query = '';
          this.searchClear.hidden = true;
          if (this.searchTimer.id !== null) clearTimeout(this.searchTimer.id);
          this.searchTimer.id = null;
          void this.refresh();
        },
      },
    }) as HTMLButtonElement;

    this.continueRow = el('div', { className: 'continue-row' });
    this.continueSection = el('div', { attrs: { hidden: true } }) as HTMLDivElement;
    const continueTitle = el('div', { className: 'shelf-section-title', text: '继续阅读' });
    this.continueSection.append(continueTitle, this.continueRow);

    this.countLabel = el('div', { className: 'shelf-count muted' }) as HTMLDivElement;
    this.sortRow = el('div', { className: 'shelf-sort' }) as HTMLDivElement;
    this.buildSortRow();

    this.settingsButton = el('button', {
      className: 'icon-button shelf-settings-button',
      text: '⚙',
      attrs: { type: 'button', 'aria-label': '书架设置' },
      on: { click: () => this.toggleSettings() },
    }) as HTMLButtonElement;

    const toolbar = el('div', {
      className: 'shelf-toolbar',
      children: [this.countLabel, this.sortRow, this.settingsButton],
    });

    this.settingsPanel = buildShelfSettingsPanel({
      settings: this.settings,
      onPatch: (patch) => {
        Object.assign(this.settings, patch);
        this.options.onSettingsChange(patch);
        this.applyDensity();
        this.applyAppearance();
      },
      onClose: () => {
        this.settingsPanel.hidden = true;
      },
    });

    this.grid = el('div', { className: 'book-grid' });
    this.statusLine = el('div', { className: 'shelf-status muted' });
    this.refreshBar = el('div', { className: 'shelf-refresh', attrs: { hidden: true } }) as HTMLDivElement;

    const shelf = el('div', { className: 'shelf' });
    shelf.append(
      el('div', { className: 'shelf-search', children: [this.searchInput, this.searchClear] }),
      this.continueSection,
      toolbar,
      this.refreshBar,
      this.grid,
      this.statusLine,
      this.settingsPanel,
    );
    (shelf as HTMLDivElement).id = 'shelf-scroll';
    this.scroll = shelf as HTMLDivElement;

    this.element = el('div', { className: 'shelf-screen', children: [shelf] }) as HTMLDivElement;
    this.element.style.cssText = 'flex:1 1 auto; min-height:0; display:flex; flex-direction:column;';
    this.applyDensity();

    this.scroll.addEventListener('scroll', () => this.onScroll());
  }

  async show(): Promise<void> {
    await this.options.offline.load();
    const cached = this.options.offline.books();
    if (cached.length > 0) this.renderItems(this.sorted(cached), true);
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
      this.offset = page.items.length;
      this.total = page.total;
      await this.options.offline.replaceBooks(page.items);
      this.renderItems(this.sorted(page.items), true);
      this.renderContinue(continueItems);
      this.renderCount();
      this.setStatus('');
      this.scroll.scrollTop = this.lastScrollTop;
    } catch (err) {
      this.handleError(err);
    }
  }

  private listQuery(page: number): ListQuery {
    return {
      ...(this.query ? { search: this.query } : {}),
      sort: this.sort,
      order: shelfOrder(this.sort),
      page,
      pageSize: 60,
    };
  }

  /**
   * Orders the cached shelf the same way the server would.
   *
   * The offline path has to answer the same question the online one does, so the
   * rule lives in `shelf-order.ts` and is shared by both.
   */
  private sorted(books: Book[]): Book[] {
    return sortBooks(books, this.sort);
  }

  private onSearchInput(): void {
    this.query = this.searchInput.value.trim();
    this.searchClear.hidden = this.query.length === 0;
    if (this.searchTimer.id !== null) clearTimeout(this.searchTimer.id);
    // Debounced: a shelf of 2000 books over a LAN is fine, but a mobile network
    // plus a keystroke per character is not.
    this.searchTimer.id = setTimeout(() => {
      this.searchTimer.id = null;
      void this.refresh();
    }, 250);
  }

  private onScroll(): void {
    this.lastScrollTop = this.scroll.scrollTop;
    if (this.scroll.scrollTop + this.scroll.clientHeight >= this.scroll.scrollHeight - 400) {
      void this.loadMore();
    }
    // Pull-to-refresh fires only when the reader has already overscrolled and lets
    // go — a refresh on every scroll-to-top would fire constantly on a phone.
    if (this.scroll.scrollTop < 24 && this.atTopSince !== null && Date.now() - this.atTopSince > 400) {
      this.atTopSince = null;
      void this.manualRefresh();
    }
  }

  /** Timestamp of when the shelf first reached the top, for pull-to-refresh. */
  private atTopSince: number | null = null;

  private async manualRefresh(): Promise<void> {
    this.refreshBar.hidden = false;
    this.refreshBar.textContent = '正在刷新…';
    try {
      await this.refresh();
      this.refreshBar.textContent = '已刷新';
    } catch {
      this.refreshBar.textContent = '刷新失败';
    }
    setTimeout(() => {
      this.refreshBar.hidden = true;
    }, 900);
  }

  private async loadMore(): Promise<void> {
    if (this.loading || this.offset >= this.total) return;
    this.loading = true;
    this.showLoadingMore();
    try {
      const page = Math.floor(this.offset / 60) + 1;
      const result = await this.options.api.listBooks(this.listQuery(page));
      this.offset += result.items.length;
      this.total = result.total;
      await this.options.offline.replaceBooks(result.items);
      this.appendItems(this.sorted(result.items), false);
      this.renderCount();
    } catch (err) {
      if (!(err instanceof ApiError) || !err.isConnectivity) this.setStatus('加载更多失败');
    } finally {
      this.loading = false;
      this.hideLoadingMore();
    }
  }

  private showLoadingMore(): void {
    if (this.extraLoading) return;
    this.extraLoading = el('div', { className: 'spinner' });
    this.scroll.append(this.extraLoading);
  }

  private hideLoadingMore(): void {
    this.extraLoading?.remove();
    this.extraLoading = null;
  }

  private renderCount(): void {
    if (this.query) {
      this.countLabel.textContent = `找到 ${this.total} 本`;
      return;
    }
    this.countLabel.textContent = this.total > 0 ? `共 ${this.total} 本` : '';
  }

  /**
   * The sort control.
   *
   * A row of chips rather than a `<select>`: four options is few enough to show
   * all of them, and a picker that requires opening a sheet to answer "what order
   * is this in" hides the answer at exactly the moment the reader is asking.
   */
  private buildSortRow(): void {
    clear(this.sortRow);
    const label = el('span', { className: 'shelf-sort-label muted', text: '排序' });
    this.sortRow.append(label);
    for (const option of SORTS) {
      const active = option.value === this.sort;
      this.sortRow.append(
        el('button', {
          className: 'chip',
          text: option.label,
          attrs: { type: 'button', 'aria-pressed': String(active), 'aria-label': `按${option.label}排序` },
          on: {
            click: () => {
              if (this.sort === option.value) return;
              this.sort = option.value;
              // Written back so the choice survives a restart. It is a preference
              // as much as it is a per-session intent, and the two cannot be told
              // apart — so persisting is the less surprising of the two harms.
              this.options.onSettingsChange({ shelfSort: this.sort });
              this.settings.shelfSort = this.sort;
              this.buildSortRow();
              // Ordering changes the whole result set, so a refresh rather than a
              // client-side re-sort: the server is the authority, and it is the
              // only side that can re-sort a library larger than one page.
              this.lastScrollTop = 0;
              void this.refresh();
            },
          },
        }),
      );
    }
  }

  private toggleSettings(): void {
    this.settingsPanel.hidden = !this.settingsPanel.hidden;
  }

  /** Applies the density setting to the grid, by class rather than inline style. */
  applyDensity(): void {
    this.grid.dataset['density'] = this.settings.shelfDensity;
    // The label is mirrored onto the control so the sheet does not have to be
    // reopened to see what is set.
    this.settingsButton.setAttribute('aria-label', `书架设置 · ${DENSITY_LABELS[this.settings.shelfDensity]}`);
  }

  applyAppearance(): void {
    this.grid.dataset['showAuthor'] = String(this.settings.shelfShowAuthor);
    this.grid.dataset['showProgress'] = String(this.settings.shelfShowProgress);
  }

  private renderItems(items: Book[], replace: boolean): void {
    if (replace) {
      clear(this.grid);
      // Only the search result set is authoritative; without this, a cached
      // shelf and a filtered response would merge into one confusing list.
      this.rendered.clear();
    }
    this.applyAppearance();
    this.appendItems(items, replace);
    if (this.rendered.size === 0) {
      this.grid.append(
        el('div', {
          className: 'empty-state',
          children: [
            el('p', { text: this.query ? '没有匹配的书' : '书库还是空的' }),
            el('p', { className: 'muted', text: this.query ? '换个关键词试试' : '确认已经挂载书籍目录，并在设置里触发一次扫描' }),
          ],
        }),
      );
    }
  }

  private readonly rendered = new Set<string>();

  private appendItems(items: Book[], _replace: boolean): void {
    for (const book of items) {
      if (this.rendered.has(book.id)) continue;
      this.rendered.add(book.id);
      this.grid.append(this.bookCard(book));
    }
  }

  private bookCard(book: Book): HTMLButtonElement {
    const cover = el('div', { className: 'cover' });
    void this.fillCover(cover, book);

    // The progress bar is drawn from the local mirror, which the sync engine
    // keeps current — so it is correct offline, with no extra request per card.
    const progress = this.options.offline.progressFor(book.id);
    if (progress && progress.percentage > 0.005) {
      const track = el('div', { className: 'cover-progress', children: [el('span')] });
      (track.querySelector('span') as HTMLSpanElement).style.width = percent(progress.percentage);
      cover.append(track);
    }

    return el('button', {
      className: 'book-card',
      attrs: { type: 'button', 'aria-label': `${book.title} ${book.author}`.trim() },
      on: { click: () => this.options.onOpenBook(book) },
      children: [
        cover,
        el('div', { className: 'title', text: book.title || '未命名' }),
        el('div', { className: 'author', text: book.author || '未知作者' }),
      ],
    }) as HTMLButtonElement;
  }

  private async fillCover(container: HTMLDivElement, book: Book): Promise<void> {
    const badge = el('span', { className: 'format-badge', text: book.format });
    if (!book.coverUrl) {
      container.append(el('div', { className: 'placeholder', text: book.title.slice(0, 12) || '无封面' }));
      container.append(badge);
      return;
    }
    const cached = this.coverUrls.get(book.id);
    if (cached) {
      container.append(el('img', { attrs: { src: cached, alt: '', loading: 'lazy' } }));
      container.append(badge);
      return;
    }
    try {
      const bytes = await this.options.api.coverBytes(book.coverUrl);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
      this.coverUrls.set(book.id, url);
      clear(container);
      container.append(el('img', { attrs: { src: url, alt: '', loading: 'lazy' } }));
      container.append(badge);
    } catch {
      container.append(el('div', { className: 'placeholder', text: book.title.slice(0, 12) || '无封面' }));
      container.append(badge);
    }
  }

  private renderContinue(items: ContinueReadingItem[]): void {
    clear(this.continueRow);
    if (items.length === 0) {
      this.continueSection.hidden = true;
      return;
    }
    this.continueSection.hidden = false;
    for (const item of items) {
      const cover = el('div', { className: 'cover' });
      cover.style.cssText = 'aspect-ratio:2/3;border-radius:6px;overflow:hidden;background:var(--reader-line);display:grid;place-items:center;';
      void this.options.api
        .coverBytes(item.coverUrl ?? '')
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
          clear(cover);
          const img = el('img', { attrs: { src: url, alt: '' } });
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          cover.append(img);
        })
        .catch(() => {
          cover.append(el('div', { className: 'placeholder', text: item.title.slice(0, 8) }));
        });

      const bar = el('div', { className: 'progress-track', children: [el('span')] });
      const inner = bar.querySelector('span') as HTMLSpanElement;
      inner.style.width = percent(item.percentage);

      const card = el('button', {
        className: 'continue-card',
        attrs: { type: 'button' },
        on: { click: () => this.options.onOpenBook(item) },
        children: [
          cover,
          el('div', { className: 'title', text: item.title, attrs: { style: 'font-size:.8rem;margin-top:.3rem;' } }),
          el('div', { className: 'muted', text: item.chapterTitle || percent(item.percentage), attrs: { style: 'font-size:.7rem;' } }),
          bar,
        ],
      });
      this.continueRow.append(card);
    }
  }

  private setStatus(text: string): void {
    this.statusLine.textContent = text;
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
          this.setStatus(`离线模式 · ${cached.length} 本可读`);
          this.renderItems(this.sorted(cached), true);
          this.renderCount();
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

  dispose(): void {
    for (const url of this.coverUrls.values()) URL.revokeObjectURL(url);
    this.coverUrls.clear();
    if (this.searchTimer.id !== null) clearTimeout(this.searchTimer.id);
  }
}
