/**
 * The bookshelf.
 *
 * A grid of covers, which is the only browse surface a personal library needs.
 * Two choices worth naming:
 *
 *  - **Covers are loaded eagerly and lazily at the same time.** The first screen
 *    of covers is requested immediately so the shelf is not a wall of grey; the
 *    rest are `loading="lazy"`, so scrolling a 2000-book library does not open
 *    2000 requests on the way down.
 *  - **Search is debounced and server-side.** Filtering 2000 books in the client
 *    would mean holding all of them in memory, and the server already indexes
 *    title, author, series and ISBN — a client-side filter would silently miss
 *    fields the user expects to match.
 */

import { ApiClient, type BookDto } from '../net/api.ts';

export interface ShelfHost {
  onOpenBook?: (book: BookDto) => void;
  onSignOut?: () => void;
}

export class ShelfView {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  /** Built once, mounted on demand. */
  private built = false;
  private search = '';
  private page = 1;
  private total = 0;
  private loading = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: ApiClient,
    private readonly options: ShelfHost = {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'shelf';

    const header = document.createElement('div');
    header.className = 'shelf__header';
    const title = document.createElement('h1');
    title.className = 'shelf__title';
    title.textContent = '书库';
    const signOut = document.createElement('button');
    signOut.className = 'reader__button';
    signOut.textContent = '退出';
    signOut.addEventListener('click', () => this.options.onSignOut?.());
    header.append(title, signOut);

    const input = document.createElement('input');
    input.className = 'shelf__search';
    input.type = 'search';
    input.placeholder = '搜索书名、作者、系列';
    input.addEventListener('input', () => {
      this.search = input.value.trim();
      // Debounced: a request per keystroke against a self-hosted server on a NAS
      // is a request per keystroke against a spinning disk.
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.page = 1;
        void this.load(true);
      }, 250);
    });

    this.grid = document.createElement('div');
    this.grid.className = 'shelf__grid';

    this.root.append(header, input, this.grid);

    // Infinite scroll: a library is browsed by scrolling, and paging controls on
    // a phone are a tax on every visit.
    this.root.addEventListener('scroll', () => {
      if (this.loading || this.grid.childElementCount >= this.total) return;
      const remaining = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight;
      if (remaining < 600) void this.load(false);
    });
  }

  /**
   * Take over the host element.
   *
   * Mounting is separate from construction because the view is built once, at
   * startup, while the auth screen may still own the host. Replacing the host's
   * children in the constructor meant the shelf's markup was installed and then
   * covered by the dialog that mounted after it — so a successful sign-in left
   * the login form on screen with the loaded shelf hidden underneath.
   */
  mount(): void {
    this.host.replaceChildren(this.root);
    this.built = true;
  }

  get mounted(): boolean {
    return this.built;
  }

  async load(reset: boolean): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    if (reset) this.grid.replaceChildren();
    try {
      const result = await this.api.shelf({ page: this.page, pageSize: 60, ...(this.search ? { search: this.search } : {}) });
      this.total = result.total;
      if (result.items.length === 0 && reset) {
        const empty = document.createElement('div');
        empty.className = 'shelf__empty';
        empty.textContent = this.search ? '没有匹配的书' : '书库是空的，检查挂载目录';
        this.grid.append(empty);
      }
      for (const book of result.items) this.grid.append(this.card(book));
      this.page += 1;
    } catch (error) {
      const message = document.createElement('div');
      message.className = 'shelf__empty';
      message.textContent = error instanceof Error ? error.message : '加载失败';
      this.grid.replaceChildren(message);
    } finally {
      this.loading = false;
    }
  }

  private card(book: BookDto): HTMLElement {
    const card = document.createElement('button');
    card.className = 'book-card';
    card.type = 'button';
    // The whole card is the hit target: on a phone a tap on a 108px cover is
    // already at the edge of the 44px recommendation, and a separate title link
    // would be worse.
    card.addEventListener('click', () => this.options.onOpenBook?.(book));

    const cover = document.createElement('img');
    cover.className = 'book-card__cover';
    cover.alt = '';
    // `loading=lazy` plus an explicit aspect ratio means the browser reserves the
    // space before the image arrives, so the grid does not reflow under a thumb
    // that is already scrolling.
    cover.loading = 'lazy';
    cover.decoding = 'async';
    // The DTO carries the server's own path; the token has to come from the
    // client, because an `<img src>` cannot send an Authorization header.
    if (book.coverUrl) cover.src = this.api.coverUrl(book.id);
    cover.addEventListener('error', () => {
      cover.removeAttribute('src');
    });

    const title = document.createElement('div');
    title.className = 'book-card__title';
    title.textContent = book.title;

    const meta = document.createElement('div');
    meta.className = 'book-card__meta';
    meta.textContent = [book.author, formatLabel(book.format)].filter(Boolean).join(' · ');

    card.append(cover, title, meta);
    return card;
  }
}

function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    epub: 'EPUB',
    pdf: 'PDF',
    cbz: '漫画',
    'comic-dir': '漫画',
    txt: 'TXT',
    image: '图片',
  };
  return labels[format] ?? format.toUpperCase();
}
