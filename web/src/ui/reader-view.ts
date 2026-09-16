/**
 * The reading surface, shared by the H5 build and the Android shell.
 *
 * Format routing lives here and is the answer to the second half of the user's
 * question: **EPUB (and TXT) render through the WebView; everything else does
 * not render here at all on Android.**
 *
 * The reasoning, because it drove the structure of this file:
 *
 *  - **Reflowable text belongs in a WebView.** It is the only engine on the
 *    device that implements CSS multi-column, embedded fonts, vertical writing
 *    and ruby — the typography features this product is built on. A native text
 *    stack would have to reimplement all of it worse.
 *  - **Images do not.** A comic page is a JPEG: a native `ImageView` decodes it
 *    with hardware acceleration and recycles the bitmap, while a WebView holds a
 *    full compositing layer per page and decodes on the main thread. The user's
 *    own note — 「其他类型的书籍需要使用原生来渲染，提升性能」 — is correct, and
 *    the reason is memory rather than raw speed: a 300MB volume read in a WebView
 *    is an OOM on a mid-range phone, and the same volume read natively is fine.
 *  - **PDF has a viewer already.** On Android that is the platform's, on the H5
 *    build it is the browser's. Neither needs this client in between.
 *
 * So this view owns the *reflowable* path plus the H5 fallbacks, and the shell
 * decides whether it is ever reached for paged/document content. `capabilities()`
 * below is what the two builds negotiate with, so the split is declared in one
 * place instead of being implied by which renderer happens to be imported.
 */

import { ApiClient, type BookDto } from '../net/api.ts';
import { BookReader } from '../render/reader.ts';
import { PagedReader } from '../render/paged.ts';
import { TextReader } from '../render/text.ts';
import { PdfReader } from '../render/pdf.ts';
import { applyTheme, loadSettings, saveSettings, type ReaderSettings } from './settings.ts';
import type { ReaderStyle } from '../render/container.ts';
import { PALETTES } from '../render/theme.ts';

/**
 * Which renderer handles what, per platform.
 *
 * Declared rather than hardcoded because the Android shell overrides it: the
 * shell answers 'native' for paged and document content and never mounts those
 * renderers, so the same book opened on the phone takes the native path and the
 * same book opened in a browser takes the H5 fallback.
 */
export interface RendererCapabilities {
  /** Reflowable text always goes through the WebView. */
  reflowable: 'webview';
  /** Paged images: native on Android, H5 elsewhere. */
  paged: 'native' | 'webview';
  /** PDF: the platform viewer on Android, an iframe elsewhere. */
  document: 'native' | 'iframe';
}

export function capabilities(platform: 'web' | 'android'): RendererCapabilities {
  return platform === 'android'
    ? { reflowable: 'webview', paged: 'native', document: 'native' }
    : { reflowable: 'webview', paged: 'webview', document: 'iframe' };
}

export interface ReaderHost {
  /** Called when the user swipes or taps past the last page of a book. */
  onExit?: () => void;
  platform?: 'web' | 'android';
  device?: string;
}

/**
 * A reading session for one book.
 *
 * Owns whichever renderer the book's `kind` calls for, plus the chrome around it:
 * the toolbar, the footer progress, the table of contents. Kept as a class because
 * the four renderers share no base class on purpose — they have almost nothing in
 * common beyond `turn` and `flush`, and a common interface would have to be wide
 * enough to be meaningless.
 */
export class ReaderView {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly pageLabel: HTMLElement;
  private readonly warning: HTMLElement;
  private reader: BookReader | PagedReader | TextReader | PdfReader | null = null;
  private state: { index: number; total: number; title: string; percent: number } = {
    index: 0,
    total: 0,
    title: '',
    percent: 0,
  };
  private settings: ReaderSettings;
  private disposers: Array<() => void> = [];
  private tocDialog: HTMLElement | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: ApiClient,
    private readonly book: BookDto,
    private readonly options: ReaderHost = {},
  ) {
    this.settings = loadSettings();
    this.root = document.createElement('div');
    this.root.className = 'reader';

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'reader__toolbar';
    this.stage = document.createElement('div');
    this.stage.className = 'reader__stage';
    this.warning = document.createElement('div');
    this.warning.className = 'reader__warning';
    this.warning.hidden = true;

    const footer = document.createElement('div');
    footer.className = 'reader__footer';
    this.progressFill = document.createElement('div');
    this.progressFill.className = 'reader__progress-fill';
    const progressTrack = document.createElement('div');
    progressTrack.className = 'reader__progress';
    progressTrack.append(this.progressFill);
    this.pageLabel = document.createElement('span');
    footer.append(progressTrack, this.pageLabel);

    this.root.append(this.toolbar, this.warning, this.stage, footer);
    host.replaceChildren(this.root);
    this.buildToolbar();
    this.bindGestures();
  }

  /** Open the book with whichever renderer its `kind` calls for. */
  async open(): Promise<void> {
    const platform = this.options.platform ?? 'web';
    // One request to learn the shape of the book, then one renderer is built.
    const manifest = await this.api.manifest(this.book.id);
    const kind = manifest.content?.kind ?? manifest.kind ?? 'reflowable';
    const caps = capabilities(platform);

    if (kind === 'reflowable') {
      const reader = new BookReader(this.containerFor('webview'), this.api, this.book, {
        platform,
        style: this.readerStyle(),
        ...(this.options.device !== undefined ? { device: this.options.device } : {}),
      });
      this.reader = reader;
      this.disposers.push(reader.state.on((state) => this.onReflowable(state)));
      const initial = await reader.open(this.book.id);
      this.stage.classList.remove('is-paged');
      this.applySettings();
      void initial;
      return;
    }

    if (kind === 'text') {
      const reader = new TextReader(this.stage, this.api, this.book, {
        ...(this.options.device !== undefined ? { device: this.options.device } : {}),
      });
      this.reader = reader;
      await reader.open(this.book.id);
      this.pageLabel.textContent = '流式';
      return;
    }

    // A PDF is a `document`: an opaque file the client does not interpret. It
    // must be routed BEFORE the paged branch, or a `.pdf` lands in the image
    // pager and the reader sees a broken image instead of the viewer.
    if (kind === 'document') {
      const pdf = new PdfReader(this.stage, this.api, this.book, {
        ...(this.options.device !== undefined ? { device: this.options.device } : {}),
      });
      this.reader = pdf;
      this.stage.classList.add('is-paged');
      const state = await pdf.open(this.book.id);
      this.pageLabel.textContent = `${this.book.format.toUpperCase()} · 第 ${state.page} 页`;
      return;
    }

    // Comics and single images: paged content. On Android the shell takes this
    // over (see `capabilities`), because a native pager decodes and recycles a
    // bitmap where a WebView holds a compositing layer per page.
    if (caps.paged === 'native') {
      this.host.dispatchEvent(
        new CustomEvent('reader:native-page', { detail: { bookId: this.book.id, kind } }),
      );
      return;
    }

    const paged = new PagedReader(this.stage, this.api, this.book, {
      platform: 'web',
      ...(this.options.device !== undefined ? { device: this.options.device } : {}),
    });
    this.reader = paged;
    this.disposers.push(paged.state.on((state) => this.onPaged(state)));
    await paged.open(this.book.id);
    this.stage.classList.add('is-paged');
    return;
  }

  /** Persist the position before the surface goes away. */
  async close(): Promise<void> {
    const reader = this.reader;
    if (reader instanceof BookReader || reader instanceof PagedReader) {
      await reader.flush().catch(() => undefined);
    } else if (reader instanceof TextReader || reader instanceof PdfReader) {
      await reader.flush(this.book.id).catch(() => undefined);
    }
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.reader?.destroy();
    this.reader = null;
    this.host.replaceChildren();
  }

  /** Turn pages from a hardware key or an external control (the shell's). */
  async turn(pages: number): Promise<void> {
    if (this.reader instanceof BookReader || this.reader instanceof PagedReader) {
      await this.reader.turn(pages);
    }
  }

  /**
   * Re-apply the reader's settings.
   *
   * A type-size change is not a CSS variable update: the chapter document was
   * styled when it loaded, so it has to be rendered again. That is why this
   * awaits — but the chapter comes out of the prefetch cache, so it is a
   * re-layout rather than a network round trip. A page-width change is the same,
   * because the column geometry lives in that document too.
   */
  applySettings(): void {
    applyTheme(document.documentElement, this.settings.theme);
    if (this.reader instanceof BookReader) void this.reader.restyle(this.readerStyle());
  }

  /** The type settings a chapter document is rendered with. */
  private readerStyle(): ReaderStyle {
    return {
      fontSize: this.settings.fontSize,
      pageWidth: this.settings.pageWidth,
      columnGap: this.settings.columnGap,
      pagePadding: this.settings.pagePadding,
      ...PALETTES[this.settings.theme],
    };
  }

  updateSettings(patch: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    applyTheme(document.documentElement, this.settings.theme);
    this.applySettings();
    if (this.tocDialog) this.closeDialog();
    this.openSettings();
  }

  // ---------------------------------------------------------------- chrome

  private buildToolbar(): void {
    const back = document.createElement('button');
    back.className = 'reader__button';
    back.textContent = '←';
    back.setAttribute('aria-label', '返回');
    back.addEventListener('click', () => void this.exit());

    const title = document.createElement('div');
    title.className = 'reader__toolbar-title';
    title.textContent = this.book.title;

    const toc = document.createElement('button');
    toc.className = 'reader__button';
    toc.textContent = '目录';
    toc.addEventListener('click', () => void this.openToc());

    const settings = document.createElement('button');
    settings.className = 'reader__button';
    settings.textContent = 'Aa';
    settings.setAttribute('aria-label', '阅读设置');
    settings.addEventListener('click', () => this.openSettings());

    this.toolbar.append(back, title, toc, settings);
  }

  /**
   * Swipe and tap gestures.
   *
   * The reflowable reader's viewport scrolls natively, so only the *ends* of a
   * chapter need intervention: a swipe that arrives there should turn the chapter,
   * not rubber-band. Paged content is different — there is no scroll surface at
   * all — so its horizontal swipes are read directly.
   */
  private bindGestures(): void {
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let tracking = false;

    const down = (event: PointerEvent): void => {
      startX = event.clientX;
      startY = event.clientY;
      startAt = event.timeStamp;
      tracking = true;
    };

    const up = (event: PointerEvent): void => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const elapsed = event.timeStamp - startAt;
      // A swipe needs both distance and speed: a slow drag across half the screen
      // is usually a text selection, not a page turn.
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (elapsed > 800) return;
      void this.turn(dx < 0 ? 1 : -1);
    };

    this.stage.addEventListener('pointerdown', down);
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', () => {
      tracking = false;
    });

    const key = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        void this.turn(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        void this.turn(-1);
      } else if (event.key === 'Escape') {
        void this.exit();
      }
    };
    window.addEventListener('keydown', key);
    this.disposers.push(() => window.removeEventListener('keydown', key));

    // A locked phone or a backgrounded tab may never run another timer, so the
    // debounced progress write has to be flushed on the transition itself.
    const flush = (): void => {
      const reader = this.reader;
      if (reader instanceof BookReader || reader instanceof PagedReader) void reader.flush();
      else if (reader instanceof TextReader) void reader.flush(this.book.id);
      else if (reader instanceof PdfReader) void reader.flush(this.book.id);
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    this.disposers.push(() => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    });
  }

  private async exit(): Promise<void> {
    await this.close();
    this.options.onExit?.();
  }

  private containerFor(_mode: 'webview'): HTMLElement {
    const holder = document.createElement('div');
    holder.style.height = '100%';
    this.stage.replaceChildren(holder);
    return holder;
  }

  /**
   * The book's own table of contents.
   *
   * Fetched from `/toc`, not derived from the manifest's groups. The manifest is
   * windowed, so its groups are a transfer boundary: showing them gave the reader
   * 「第 1 章 – 第 40 章」 where a chapter list belongs.
   */
  private async openToc(): Promise<void> {
    const entries = await this.api.toc(this.book.id).catch(() => []);

    const list = document.createElement('ul');
    list.className = 'toc';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'toc__empty';
      empty.textContent = '这本书没有可跳转的章节';
      list.append(empty);
    } else {
      entries.forEach((entry) => {
        const item = document.createElement('li');
        item.className = 'toc__item';
        item.textContent = entry.title;
        item.style.paddingLeft = `${4 + entry.level * 14}px`;
        item.addEventListener('click', () => {
          this.closeDialog();
          void this.jumpTo(entry);
        });
        list.append(item);
      });
    }
    this.showDialog(`目录 · ${this.book.title}`, list);
  }

  /** Jump to a table-of-contents entry with whichever reader is loaded. */
  private async jumpTo(entry: { href: string; spine?: number }): Promise<void> {
    const reader = this.reader;
    if (reader instanceof BookReader) {
      // `spine` is the whole-book index the server computed, so a jump lands on
      // the right chapter even when the window holding it has not been fetched.
      if (entry.spine !== undefined) await reader.goToSpine(entry.spine);
      else await reader.goToSpineOfHref(entry.href);
      return;
    }
    if (reader instanceof PagedReader) {
      await reader.goTo(entry.spine ?? 0);
      return;
    }
    if (reader instanceof TextReader) {
      const index = Number.parseInt(entry.href.replace('chapter:', ''), 10);
      await reader.goToChapter(Number.isFinite(index) ? index : 0, this.book.id);
      return;
    }
    void reader?.setPage(this.book.id, (entry.spine ?? 0) + 1);
  }

  private openSettings(): void {
    const form = document.createElement('div');

    const fontSize = this.slider('字号', this.settings.fontSize, 12, 32, 1, (value) => {
      this.settings = { ...this.settings, fontSize: value };
      this.applySettings();
    });
    // Committed on release rather than on every input event: repaginating a
    // chapter on every pixel of slider travel makes the slider itself unusable.
    fontSize.input.addEventListener('change', () => this.commitSettings());

    const width = this.slider('页宽', this.settings.pageWidth, 360, 1200, 20, (value) => {
      this.settings = { ...this.settings, pageWidth: value };
      this.applySettings();
    });
    width.input.addEventListener('change', () => this.commitSettings());

    const theme = document.createElement('select');
    for (const [value, label] of [
      ['light', '浅色'],
      ['sepia', '羊皮纸'],
      ['dark', '深色'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = this.settings.theme === value;
      theme.append(option);
    }
    theme.addEventListener('change', () => {
      this.settings = { ...this.settings, theme: theme.value as ReaderSettings['theme'] };
      this.commitSettings();
    });
    const themeRow = document.createElement('label');
    themeRow.className = 'dialog__row';
    themeRow.append('主题', theme);

    form.append(fontSize.row, width.row, themeRow);
    this.showDialog('阅读设置', form);
  }

  private commitSettings(): void {
    saveSettings(this.settings);
    applyTheme(document.documentElement, this.settings.theme);
    this.applySettings();
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('label');
    row.className = 'dialog__row';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => onChange(Number(input.value)));
    row.append(label, input);
    return { row, input };
  }

  private showDialog(title: string, body: HTMLElement): void {
    this.closeDialog();
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    const panel = document.createElement('div');
    panel.className = 'dialog__panel';
    const heading = document.createElement('h2');
    heading.className = 'dialog__title';
    heading.textContent = title;
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const close = document.createElement('button');
    close.className = 'dialog__button dialog__button--primary';
    close.textContent = '关闭';
    close.addEventListener('click', () => this.closeDialog());
    actions.append(close);
    panel.append(heading, body, actions);
    dialog.append(panel);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.closeDialog();
    });
    this.root.append(dialog);
    this.tocDialog = dialog;
  }

  private closeDialog(): void {
    this.tocDialog?.remove();
    this.tocDialog = null;
  }

  // ---------------------------------------------------------------- state

  private onReflowable(state: {
    page: number;
    pageCount: number;
    index: number;
    items: Array<{ title: string }>;
    total: number;
    warnings: string[];
  }): void {
    this.state = {
      index: state.index,
      total: state.total,
      title: state.items[state.index]?.title ?? '',
      percent: (state.index + (state.pageCount > 1 ? state.page / state.pageCount : 0)) / Math.max(1, state.total),
    };
    this.renderProgress();
    if (state.warnings.length > 0) {
      this.warning.hidden = false;
      // Surfaced rather than swallowed: a chapter that failed to parse renders as
      // something, and the reader deserves to know it is not what the book said.
      this.warning.textContent = `本章有 ${state.warnings.length} 处问题，可能显示不完整`;
    }
  }

  private onPaged(state: { index: number; total: number; loading: boolean }): void {
    this.state = {
      index: state.index,
      total: state.total,
      title: '',
      percent: state.index / Math.max(1, state.total),
    };
    this.renderProgress();
  }

  private renderProgress(): void {
    this.progressFill.style.width = `${Math.round(this.state.percent * 100)}%`;
    this.pageLabel.textContent =
      this.state.index >= 0 ? `${this.state.percent * 100 < 1 ? 0 : Math.round(this.state.percent * 100)}%` : '';
    this.toolbar.querySelector('.reader__toolbar-title')!.textContent =
      this.state.title ? `${this.book.title} · ${this.state.title}` : this.book.title;
  }
}
