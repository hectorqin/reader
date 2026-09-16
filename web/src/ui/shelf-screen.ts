import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Book, ContinueReadingItem } from '../api/types.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { Platform } from '../core/platform.ts';
import { clear, el, percent } from './dom.ts';

export interface ShelfScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  platform: Platform;
  onOpenBook(book: Book): void;
  onSignedOut(): void;
}

/**
 * The shelf.
 *
 * Behaviour rule that drives the whole screen: it renders from the local mirror
 * first and only then replaces it with server data. On a LAN or with a cold
 * cache that is invisible; on a train it is the difference between the library
 * appearing instantly and an indefinite spinner (product design §8.2).
 */
export class ShelfScreen {
  readonly element: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly continueRow: HTMLDivElement;
  private readonly continueSection: HTMLDivElement;
  private readonly statusLine: HTMLDivElement;
  private readonly searchInput: HTMLInputElement;
  private extraLoading: HTMLDivElement | null = null;
  private query = '';
  private offset = 0;
  private total = 0;
  private loading = false;
  private readonly searchTimer: { id: ReturnType<typeof setTimeout> | null } = { id: null };
  private readonly coverUrls = new Map<string, string>();

  constructor(private readonly options: ShelfScreenOptions) {
    this.searchInput = el('input', {
      attrs: {
        type: 'search',
        placeholder: '搜索书名、作者、系列',
        'aria-label': '搜索书库',
        enterkeyhint: 'search',
      },
      on: {
        input: () => this.onSearchInput(),
      },
    });

    this.continueRow = el('div', { className: 'continue-row' });
    this.continueSection = el('div', { attrs: { hidden: true } }) as HTMLDivElement;
    const continueTitle = el('div', { className: 'shelf-section-title', text: '继续阅读' });
    this.continueSection.append(continueTitle, this.continueRow);

    this.grid = el('div', { className: 'book-grid' });
    this.statusLine = el('div', { className: 'shelf-status muted' });

    const shelf = el('div', { className: 'shelf' });
    shelf.append(
      el('div', { className: 'shelf-search', children: [this.searchInput] }),
      this.continueSection,
      this.grid,
      this.statusLine,
    );
    (shelf as HTMLDivElement).id = 'shelf-scroll';

    this.element = el('div', { className: 'shelf-screen', children: [shelf] }) as HTMLDivElement;
    this.element.style.cssText = 'flex:1 1 auto; min-height:0; display:flex; flex-direction:column;';

    shelf.addEventListener('scroll', () => {
      const target = shelf as HTMLDivElement;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 400) {
        void this.loadMore();
      }
    });
  }

  async show(): Promise<void> {
    await this.options.offline.load();
    const cached = this.options.offline.books();
    if (cached.length > 0) this.renderItems(cached, true);
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const [page, continueItems] = await Promise.all([
        this.options.api.listBooks(this.listQuery(1)),
        this.options.api.continueReading(10).catch(() => [] as ContinueReadingItem[]),
      ]);
      this.offset = page.items.length;
      this.total = page.total;
      await this.options.offline.replaceBooks(page.items);
      this.renderItems(page.items, true);
      this.renderContinue(continueItems);
      this.setStatus('');
    } catch (err) {
      this.handleError(err);
    }
  }

  private listQuery(page: number): { search?: string; page: number; pageSize: number } {
    return {
      ...(this.query ? { search: this.query } : {}),
      page,
      pageSize: 60,
    };
  }

  private onSearchInput(): void {
    this.query = this.searchInput.value.trim();
    if (this.searchTimer.id !== null) clearTimeout(this.searchTimer.id);
    // Debounced: a shelf of 2000 books over a LAN is fine, but a mobile network
    // plus a keystroke per character is not.
    this.searchTimer.id = setTimeout(() => {
      this.searchTimer.id = null;
      void this.refresh();
    }, 250);
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
      this.appendItems(result.items);
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
    this.element.querySelector('.shelf')?.append(this.extraLoading);
  }

  private hideLoadingMore(): void {
    this.extraLoading?.remove();
    this.extraLoading = null;
  }

  private renderItems(items: Book[], replace: boolean): void {
    if (replace) {
      clear(this.grid);
      // Only the search result set is authoritative; without this, a cached
      // shelf and a filtered response would merge into one confusing list.
      this.rendered.clear();
    }
    this.appendItems(items);
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

  private appendItems(items: Book[]): void {
    for (const book of items) {
      if (this.rendered.has(book.id)) continue;
      this.rendered.add(book.id);
      this.grid.append(this.bookCard(book));
    }
  }

  private bookCard(book: Book): HTMLButtonElement {
    const cover = el('div', { className: 'cover' });
    void this.fillCover(cover, book);

    const card = el('button', {
      className: 'book-card',
      attrs: { type: 'button', 'aria-label': `${book.title} ${book.author}`.trim() },
      on: { click: () => this.options.onOpenBook(book) },
      children: [
        cover,
        el('div', { className: 'title', text: book.title || '未命名' }),
        el('div', { className: 'author', text: book.author || '未知作者' }),
      ],
    });
    return card as HTMLButtonElement;
  }

  private async fillCover(container: HTMLDivElement, book: Book): Promise<void> {
    if (!book.coverUrl) {
      container.append(el('div', { className: 'placeholder', text: book.title.slice(0, 12) || '无封面' }));
      container.append(el('span', { className: 'format-badge', text: book.format }));
      return;
    }
    const cached = this.coverUrls.get(book.id);
    if (cached) {
      container.append(el('img', { attrs: { src: cached, alt: '', loading: 'lazy' } }));
      container.append(el('span', { className: 'format-badge', text: book.format }));
      return;
    }
    try {
      const bytes = await this.options.api.coverBytes(book.coverUrl);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
      this.coverUrls.set(book.id, url);
      clear(container);
      container.append(el('img', { attrs: { src: url, alt: '', loading: 'lazy' } }));
      container.append(el('span', { className: 'format-badge', text: book.format }));
    } catch {
      container.append(el('div', { className: 'placeholder', text: book.title.slice(0, 12) || '无封面' }));
      container.append(el('span', { className: 'format-badge', text: book.format }));
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
