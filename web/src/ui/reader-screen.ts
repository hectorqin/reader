import { ApiError } from '../api/errors.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Book, Manifest, Note } from '../api/types.ts';
import { loadBook, isImagePath, extensionOf, type BookDoc } from '../formats/index.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { SyncEngine } from '../core/sync.ts';
import type { Platform } from '../core/platform.ts';
import { ReaderView, type Position, type ViewSettings } from './reader-view.ts';
import { attachGestures } from './gestures.ts';
import { clear, el, percent } from './dom.ts';
import type { AppSettings } from '../store/settings.ts';

export interface ReaderScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  sync: SyncEngine;
  platform: Platform;
  settings: AppSettings;
  onBack(): void;
  onSettingsChange(patch: Partial<AppSettings>): void;
  onSignedOut(): void;
}

interface LoadedBook {
  doc: BookDoc;
  notes: string[];
}

/**
 * The reading screen: format loading, gestures, the chrome and position sync.
 *
 * Ordering here is not arbitrary. The book is loaded into memory *before* the
 * network is consulted for the reading position, because the position format is
 * defined in terms of a section id that only exists after the format loader has
 * parsed the book. Doing it the other way round was the first thing I wrote and
 * it produced a resumed position with no matching section — a silent jump to
 * page one, which is the worst possible failure for a reading app.
 */
export class ReaderScreen {
  readonly element: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly topbar: HTMLDivElement;
  private readonly footer: HTMLDivElement;
  private readonly progressFill: HTMLSpanElement;
  private readonly chapterLabel: HTMLSpanElement;
  private readonly pageLabel: HTMLSpanElement;
  private readonly statusBar: HTMLDivElement;
  private readonly statusText: HTMLSpanElement;
  private readonly tocPanel: HTMLDivElement;
  private readonly tocList: HTMLUListElement;
  private readonly settingsPanel: HTMLDivElement;

  private view: ReaderView | null = null;
  private doc: BookDoc | null = null;
  private book: Book | null = null;
  private manifest: Manifest | null = null;
  private chromeVisible = true;
  private detachGestures: (() => void) | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPosition: Position | null = null;
  private readonly settings: AppSettings;
  private readonly listeners: Array<() => void> = [];
  private loadingToken = 0;

  constructor(private readonly options: ReaderScreenOptions) {
    this.settings = { ...options.settings };

    this.stage = el('div', { className: 'stage' });
    this.progressFill = el('span');
    this.chapterLabel = el('span', { className: 'chapter' });
    this.pageLabel = el('span', { text: '0%' });
    this.statusText = el('span');
    this.statusBar = el('div', {
      className: 'status-bar',
      attrs: { hidden: true },
      dataset: { state: 'idle' },
      children: [el('span', { className: 'status-dot' }), this.statusText],
    }) as HTMLDivElement;

    this.topbar = this.buildTopbar();
    this.footer = el('div', {
      className: 'footer',
      children: [
        el('div', { className: 'progress-bar', children: [this.progressFill] }),
        el('div', {
          className: 'footer-row',
          children: [
            el('button', {
              className: 'icon-button',
              text: '☰',
              attrs: { type: 'button', 'aria-label': '目录' },
              on: { click: () => this.toggleToc() },
            }),
            this.chapterLabel,
            el('button', {
              className: 'icon-button',
              text: '⚙',
              attrs: { type: 'button', 'aria-label': '阅读设置' },
              on: { click: () => this.toggleSettings() },
            }),
          ],
        }),
        el('div', { className: 'footer-row', children: [el('span', { text: '' }), this.pageLabel, el('span', { text: '' })] }),
      ],
    }) as HTMLDivElement;

    this.tocList = el('ul', { className: 'toc-list' });
    this.tocPanel = el('div', {
      className: 'panel',
      attrs: { hidden: true },
      children: [this.buildPanelHeader('目录', () => this.toggleToc()), el('div', { className: 'panel-body', children: [this.tocList] })],
    }) as HTMLDivElement;

    this.settingsPanel = this.buildSettingsPanel();

    this.element = el('div', {
      className: 'reader-screen',
      children: [this.topbar, this.statusBar, this.stage, this.footer, this.tocPanel, this.settingsPanel],
    }) as HTMLDivElement;
    this.element.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative;';

    this.bindSyncStatus();
  }

  /** Opens a book: fetch bytes, parse, restore position, start reporting. */
  async open(book: Book): Promise<void> {
    const token = ++this.loadingToken;
    this.book = book;
    this.showTitle(book.title, book.author);
    this.setStatus('loading', '正在载入…');
    this.setChromeVisible(true);

    try {
      this.manifest = await this.options.api.manifest(book.id);
      const bytes = await this.fetchBookBytes(book, this.manifest);
      if (token !== this.loadingToken) return;

      const loaded = await this.loadDoc(book, this.manifest, bytes);
      if (token !== this.loadingToken) return;

      this.doc = loaded.doc;
      this.buildView();
      if (loaded.notes.length > 0) this.setStatus('idle', loaded.notes.join(' · '));
      else this.hideStatus();

      await this.restorePosition(book, token);
    } catch (err) {
      if (token !== this.loadingToken) return;
      this.handleLoadError(err);
    }
  }

  dispose(): void {
    this.loadingToken += 1;
    this.flushProgress();
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.detachGestures?.();
    this.detachGestures = null;
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.view?.dispose();
    this.view = null;
    this.doc = null;
    this.manifest = null;
    this.element.remove();
  }

  // ---- loading ----

  private async fetchBookBytes(book: Book, manifest: Manifest): Promise<Uint8Array> {
    const cacheKey = `book:${book.id}`;
    // Offline first, always. A cached book must open with no network at all —
    // that is the whole point of the按书粒度 download.
    const cached = await this.options.platform.blobs.get(cacheKey);
    if (cached && cached.byteLength > 0) {
      // Refresh in the background only when the file has not been superseded.
      // Book bytes are immutable per hash, so this is genuinely optional.
      return cached;
    }
    const bytes = await this.options.api.bookBytes(book.id);
    await this.options.platform.blobs.put(cacheKey, bytes);
    void manifest;
    return bytes;
  }

  private async loadDoc(book: Book, manifest: Manifest, bytes: Uint8Array): Promise<LoadedBook> {
    const primary = manifest.files.find((file) => file.missing === 0) ?? manifest.files[0];
    const fileName = primary?.rel_path?.split('/').pop() ?? book.title;
    const extension = extensionOf(fileName).toLowerCase();

    // A comic stored as a folder of images has no single file to stream, so the
    // manifest's file list *is* the book. Detect it before dispatching, because
    // the format layer needs the page list rather than the bytes.
    const imageFiles = manifest.files.filter((file) => file.missing === 0 && isImagePath(file.rel_path));
    if (imageFiles.length > 1 && !['epub', 'pdf', 'cbz', 'txt'].includes(extension)) {
      return loadBook(
        { bytes, fileName, bookId: book.id },
        {
          fileName,
          comicPages: imageFiles.map((file) => file.rel_path),
          resolvePage: (path) => this.fetchResourceBytes(book, path),
        },
      );
    }

    return loadBook(
      { bytes, fileName, bookId: book.id },
      {
        fileName,
        ...(this.settings.txtEncoding ? { encoding: this.settings.txtEncoding } : {}),
      },
    );
  }

  /**
   * Fetches one page of a directory comic.
   *
   * Each page is cached individually, so a partially read comic is still
   * partially readable offline, and re-opening it does not re-download pages
   * the reader has already seen.
   */
  private async fetchResourceBytes(book: Book, relPath: string): Promise<Uint8Array> {
    const key = `page:${book.id}:${relPath}`;
    const cached = await this.options.platform.blobs.get(key);
    if (cached) return cached;
    const response = await this.options.platform.transport.send({
      url: `/api/v1/books/${encodeURIComponent(book.id)}/file?path=${encodeURIComponent(relPath)}`,
      method: 'GET',
      headers: await this.authHeaders(),
      binary: true,
    });
    const bytes = response.bytes ?? new Uint8Array();
    await this.options.platform.blobs.put(key, bytes);
    return bytes;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const session = this.options.api.currentSession();
    return session ? { authorization: `Bearer ${session.accessToken}`, accept: '*/*' } : { accept: '*/*' };
  }

  private buildView(): void {
    this.view?.dispose();
    if (!this.doc) return;
    const doc = this.doc;
    this.view = new ReaderView({
      container: this.stage,
      doc,
      onPositionChange: (position) => this.onPosition(position),
      onChapterChange: (_index, section) => {
        this.chapterLabel.textContent = section.label;
        this.highlightToc(section.id);
      },
    });
    this.view.applySettings(this.viewSettings());

    if (doc.layout === 'reflowable') {
      const scrollTarget = this.stage;
      this.listeners.push(
        addDebouncedListener(scrollTarget, 'scroll', () => this.onPosition(this.view?.position() ?? null), 250),
      );
    }

    this.detachGestures = attachGestures(this.stage, {
      onTapZone: (zone) => {
        if (zone === 'toggle-chrome') this.setChromeVisible(!this.chromeVisible);
        else if (zone === 'next') void this.view?.next();
        else void this.view?.previous();
      },
      onSwipe: (direction) => {
        // Swiping is only a page turn in fixed layout or paged mode. In scroll
        // mode a horizontal swipe has no meaning and hijacking it would fight
        // the reader's own scrolling.
        if (doc.layout !== 'fixed' && this.settings.mode !== 'paged') return;
        if (direction === 'left') void this.view?.next();
        else if (direction === 'right') void this.view?.previous();
      },
      onDragDelta: () => undefined,
      onLongPress: () => this.setChromeVisible(true),
      hasSelection: () => hasTextSelection(this.stage),
    });

    void this.renderToc();
  }

  private viewSettings(): Partial<ViewSettings> {
    return {
      mode: this.settings.mode,
      fontScale: this.settings.fontScale,
      lineHeight: this.settings.lineHeight,
      theme: this.settings.theme,
      fit: this.settings.fit,
      direction: this.doc?.layout === 'fixed' ? this.settings.comicDirection : (this.doc?.direction ?? 'ltr'),
    };
  }

  private async restorePosition(book: Book, token: number): Promise<void> {
    const local = await this.options.offline.getProgress(book.id);
    let locator = local?.locator ?? '';

    // Ask the server only when there is nothing local: the local value is what
    // this device last showed, and a server value from another device would
    // yank the reader backwards on every open.
    if (!locator) {
      try {
        const remote = await this.options.api.getProgress(book.id);
        locator = remote?.locator ?? '';
      } catch (err) {
        if (err instanceof ApiError && err.isAuthFailure) this.options.onSignedOut();
        // Anything else (offline, server error) leaves us on the local value.
      }
    }

    if (token !== this.loadingToken) return;
    if (locator && this.view) {
      const restored = await this.view.openLocator(locator);
      if (restored) {
        this.setStatus('idle', '已恢复到上次阅读位置');
        window.setTimeout(() => this.hideStatus(), 2400);
        return;
      }
      // A locator that cannot be resolved means the book changed on disk under
      // the reader's feet. Say so rather than jumping to page one silently.
      this.setStatus('idle', '原阅读位置已失效，从开头开始');
      window.setTimeout(() => this.hideStatus(), 3200);
    }
    await this.view?.open(0, 0);
  }

  // ---- position and progress ----

  private onPosition(position: Position | null): void {
    if (!position || !this.book) return;
    this.progressFill.style.width = percent(position.percentage);
    this.pageLabel.textContent = percent(position.percentage);
    if (position.chapterTitle) this.chapterLabel.textContent = position.chapterTitle;
    this.pendingPosition = position;

    // Debounced: a scroll produces a position per frame, and each one would
    // otherwise become a write to IndexedDB and a network sync.
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(() => this.flushProgress(), 1500);
  }

  private flushProgress(): void {
    const position = this.pendingPosition;
    const book = this.book;
    if (!position || !book) return;
    this.pendingPosition = null;
    const now = Date.now();
    void this.options.offline
      .setProgress({
        bookId: book.id,
        locator: position.locator,
        percentage: position.percentage,
        chapterTitle: position.chapterTitle,
        device: this.options.platform.deviceLabel,
        updatedAt: now,
      })
      .then(() => this.options.sync.syncNow())
      .catch(() => undefined);
  }

  // ---- chrome ----

  private setChromeVisible(visible: boolean): void {
    this.chromeVisible = visible;
    this.topbar.hidden = !visible;
    this.footer.hidden = !visible;
    if (!visible) {
      this.tocPanel.hidden = true;
      this.settingsPanel.hidden = true;
    }
  }

  private buildTopbar(): HTMLDivElement {
    const title = el('div', { className: 'title-block' });
    title.style.cssText = 'flex:1 1 auto;min-width:0;';
    return el('div', {
      className: 'topbar',
      children: [
        el('button', {
          className: 'icon-button',
          text: '‹',
          attrs: { type: 'button', 'aria-label': '返回书架' },
          on: { click: () => this.options.onBack() },
        }),
        title,
        el('button', {
          className: 'icon-button',
          text: '☰',
          attrs: { type: 'button', 'aria-label': '目录' },
          on: { click: () => this.toggleToc() },
        }),
      ],
    }) as HTMLDivElement;
  }

  private showTitle(title: string, author: string): void {
    const block = this.topbar.querySelector('.title-block');
    if (!block) return;
    clear(block);
    block.append(el('h1', { text: title }));
    if (author) block.append(el('span', { className: 'subtitle', text: author }));
  }

  private buildPanelHeader(title: string, onClose: () => void): HTMLDivElement {
    return el('div', {
      className: 'panel-header',
      children: [
        el('h2', { text: title }),
        el('button', {
          className: 'icon-button',
          text: '✕',
          attrs: { type: 'button', 'aria-label': '关闭' },
          on: { click: onClose },
        }),
      ],
    }) as HTMLDivElement;
  }

  private toggleToc(): void {
    this.tocPanel.hidden = !this.tocPanel.hidden;
    if (!this.tocPanel.hidden) this.settingsPanel.hidden = true;
  }

  private toggleSettings(): void {
    this.settingsPanel.hidden = !this.settingsPanel.hidden;
    if (!this.settingsPanel.hidden) this.tocPanel.hidden = true;
  }

  private async renderToc(): Promise<void> {
    clear(this.tocList);
    const entries = this.view?.chapterLabels() ?? [];
    for (const entry of entries) {
      const button = el('button', {
        text: entry.label,
        attrs: { type: 'button', 'data-section': entry.id },
        on: {
          click: () => {
            void this.view?.openLocator(`${entry.id}:0`);
            this.tocPanel.hidden = true;
            this.setChromeVisible(false);
          },
        },
      });
      if (entry.depth > 0) button.style.paddingInlineStart = `${0.4 + entry.depth * 0.9}rem`;
      const item = el('li', { children: [button] });
      item.dataset['section'] = entry.id;
      this.tocList.append(item);
    }
    if (entries.length === 0) {
      this.tocList.append(el('li', { children: [el('div', { className: 'empty-state', text: '这本书没有目录' })] }));
    }
  }

  private highlightToc(sectionId: string): void {
    for (const item of this.tocList.querySelectorAll('li')) {
      const matches = item.dataset['section'] === sectionId;
      const button = item.querySelector('button');
      if (button) button.setAttribute('aria-current', String(matches));
    }
  }

  private buildSettingsPanel(): HTMLDivElement {
    const body = el('div', { className: 'panel-body' });

    body.append(
      this.settingsRow('翻页方式', ['scroll', 'paged'], this.settings.mode, (value) =>
        this.updateSetting({ mode: value as 'scroll' | 'paged' }), (value) => (value === 'scroll' ? '滚动' : '翻页')),
    );

    const scaleRow = el('div', { className: 'field' });
    const scaleValue = el('label', { text: `字号 ${Math.round(this.settings.fontScale * 100)}%` });
    const scaleInput = el('input', {
      attrs: { type: 'range', min: '0.8', max: '2.2', step: '0.05', value: String(this.settings.fontScale) },
      on: {
        input: (event) => {
          const value = Number((event.target as HTMLInputElement).value);
          scaleValue.textContent = `字号 ${Math.round(value * 100)}%`;
          void this.updateSetting({ fontScale: value });
        },
      },
    });
    scaleRow.append(scaleValue, scaleInput);
    body.append(scaleRow);

    body.append(
      this.settingsRow('行距', ['inherit', '1.5', '1.8', '2.1'], this.settings.lineHeight, (value) =>
        this.updateSetting({ lineHeight: value }), (value) => (value === 'inherit' ? '原书' : value)),
    );

    body.append(
      this.settingsRow('主题', ['light', 'sepia', 'dark'], this.settings.theme, (value) =>
        this.updateSetting({ theme: value as 'light' | 'sepia' | 'dark' }), (value) =>
        value === 'light' ? '白' : value === 'sepia' ? '米黄' : '夜间'),
    );

    const fitRow = this.settingsRow('图片适配', ['contain', 'width'], this.settings.fit, (value) =>
      this.updateSetting({ fit: value as 'contain' | 'width' }), (value) => (value === 'contain' ? '完整' : '适宽'));
    fitRow.dataset['only'] = 'fixed';
    body.append(fitRow);

    const directionRow = this.settingsRow('翻页方向', ['ltr', 'rtl'], this.settings.comicDirection, (value) =>
      this.updateSetting({ comicDirection: value as 'ltr' | 'rtl' }), (value) => (value === 'ltr' ? '左→右' : '右→左'));
    directionRow.dataset['only'] = 'fixed';
    body.append(directionRow);

    const encodingRow = this.settingsRow('TXT 编码', ['', 'utf-8', 'gb18030', 'big5', 'utf-16le'], this.settings.txtEncoding, (value) =>
      this.updateSetting({ txtEncoding: value }), (value) => (value === '' ? '自动' : value));
    encodingRow.dataset['only'] = 'txt';
    body.append(encodingRow);

    return el('div', {
      className: 'panel',
      attrs: { hidden: true },
      children: [this.buildPanelHeader('阅读设置', () => this.toggleSettings()), body],
    }) as HTMLDivElement;
  }

  private settingsRow(
    label: string,
    values: string[],
    current: string,
    onChange: (value: string) => void,
    labelFor: (value: string) => string,
  ): HTMLDivElement {
    const buttons = values.map((value) =>
      el('button', {
        text: labelFor(value),
        attrs: { type: 'button', 'aria-pressed': String(value === current) },
        on: {
          click: (event) => {
            const group = (event.currentTarget as HTMLElement).parentElement;
            for (const sibling of group?.children ?? []) sibling.setAttribute('aria-pressed', 'false');
            (event.currentTarget as HTMLElement).setAttribute('aria-pressed', 'true');
            onChange(value);
          },
        },
      }),
    );
    return el('div', {
      className: 'field',
      children: [
        el('label', { text: label }),
        el('div', { className: 'segmented', children: buttons }),
      ],
    }) as HTMLDivElement;
  }

  private async updateSetting(patch: Partial<AppSettings>): Promise<void> {
    this.options.onSettingsChange(patch);
    Object.assign(this.settings, patch);
    this.view?.applySettings(this.viewSettings());
    // Fixed-layout fit and direction changes are structural, so the current page
    // has to be re-rendered rather than merely re-styled.
    if (
      this.doc?.layout === 'fixed' &&
      ('fit' in patch || 'comicDirection' in patch)
    ) {
      const index = this.view?.currentSectionIndex() ?? 0;
      await this.view?.open(index, 0);
    }
  }

  // ---- status ----

  private bindSyncStatus(): void {
    const update = (): void => {
      const status = this.options.sync.status();
      if (status.state === 'syncing') {
        this.setStatus('syncing', '同步中…');
      } else if (status.state === 'offline') {
        this.setStatus('offline', status.pending ? '离线 · 进度待同步' : '离线 · 阅读进度存在本机');
      } else if (status.state === 'error') {
        this.setStatus('error', status.message || '同步失败');
      } else if (status.state === 'signed-out') {
        this.options.onSignedOut();
      } else if (this.statusBar.dataset['state'] !== 'loading') {
        this.hideStatus();
      }
    };
    this.listeners.push(this.options.sync.onStatus(update));
    update();
  }

  private setStatus(state: string, text: string): void {
    this.statusBar.hidden = false;
    this.statusBar.dataset['state'] = state;
    this.statusText.textContent = text;
  }

  private hideStatus(): void {
    if (this.statusBar.dataset['state'] === 'loading') return;
    this.statusBar.hidden = true;
  }

  private handleLoadError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.isAuthFailure) {
        this.options.onSignedOut();
        return;
      }
      if (err.isConnectivity) {
        this.setStatus('offline', '这本书还没有下载，连上服务端后可读');
        return;
      }
      this.setStatus('error', err.message);
      return;
    }
    this.setStatus('error', err instanceof Error ? err.message : '无法打开这本书');
  }
}

function addDebouncedListener(
  target: EventTarget,
  event: string,
  handler: () => void,
  wait: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(handler, wait);
  };
  target.addEventListener(event, wrapped, { passive: true });
  return () => {
    if (timer) clearTimeout(timer);
    target.removeEventListener(event, wrapped);
  };
}

function hasTextSelection(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode;
  return anchor !== null && root.contains(anchor);
}

export type { Note };
