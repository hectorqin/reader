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
import { TtsEngine, type TtsSnapshot } from '../render/tts.ts';
import type { SpokenChunk } from '../render/tts-text.ts';

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
  private readonly ttsBar: HTMLDivElement;
  private readonly ttsChip: HTMLElement;
  private readonly ttsRangeInput: HTMLInputElement;
  private readonly ttsLabel: HTMLSpanElement;
  private readonly ttsPlayButton: HTMLButtonElement;
  private tts: TtsEngine | null = null;
  /** The sentence at the reader's own position, for "read from here". */
  private pendingSpeechAnchor: SpokenChunk | null = null;
  /** Chapter the current speech queue was built from. */
  private spokenSectionIndex = -1;

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

    this.ttsLabel = el('span', { className: 'tts-text', text: '' });
    this.ttsChip = el('button', {
      className: 'chip',
      text: '从头朗读',
      attrs: { type: 'button', 'aria-label': '朗读' },
      on: { click: () => void this.speakFromReaderPosition() },
    });
    this.ttsPlayButton = el('button', {
      className: 'icon-button',
      text: '▶',
      attrs: { type: 'button', 'aria-label': '播放/暂停朗读' },
      on: { click: () => this.toggleSpeech() },
    }) as HTMLButtonElement;
    this.ttsRangeInput = el('input', {
      className: 'tts-range',
      attrs: { type: 'range', min: '0', max: '0', step: '1', value: '0', 'aria-label': '朗读进度' },
      on: { input: (event) => this.onSpeechScrub(Number((event.target as HTMLInputElement).value)) },
    }) as HTMLInputElement;
    this.ttsBar = this.buildTtsBar();

    this.element = el('div', {
      className: 'reader-screen',
      children: [this.topbar, this.statusBar, this.stage, this.footer, this.ttsBar, this.tocPanel, this.settingsPanel],
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
    this.tts?.dispose();
    this.tts = null;
    this.ttsBar.hidden = true;
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
      onChapterChange: (index, section) => {
        this.chapterLabel.textContent = section.label;
        this.highlightToc(section.id);
        // The previous chapter's sentence nodes are gone the moment this fires,
        // so the engine is holding a queue that can never be spoken. It is told
        // to refill from the new chapter rather than left to speak into the void:
        // that is what makes the highlight follow the voice across a boundary
        // instead of stopping dead while the toolbar still says "playing".
        if (this.tts?.active && index !== this.spokenSectionIndex) {
          this.spokenSectionIndex = index;
          void this.tts.jump(0);
        }
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
      onTapZone: (zone) => this.onTapZone(zone),
      onSwipe: (direction) => {
        // Swiping is only a page turn in fixed layout or paged mode. In scroll
        // mode a horizontal swipe has no meaning and hijacking it would fight
        // the reader's own scrolling.
        if (doc.layout !== 'fixed' && this.settings.mode !== 'paged') return;
        if (direction === 'left') void this.turnPage('next');
        else if (direction === 'right') void this.turnPage('previous');
      },
      onDragDelta: () => undefined,
      onLongPress: () => this.setChromeVisible(true),
      hasSelection: () => hasTextSelection(this.stage),
    });

    // Hardware keys, which is how a Bluetooth page-turner and an Android volume
    // rocker reach the reader (the shell maps them to ArrowLeft/Right). Space is
    // the desktop convention and costs nothing.
    this.listeners.push(
      bindKeys(this.element, (key) => {
        if (key === 'ArrowRight' || key === 'PageDown') void this.turnPage('next');
        else if (key === 'ArrowLeft' || key === 'PageUp') void this.turnPage('previous');
        else if (key === ' ') this.toggleSpeech();
        else if (key === 'Escape') this.setChromeVisible(false);
      }),
    );

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
      fontFamily: this.settings.fontFamily,
      pageMargin: this.settings.pageMargin,
      textAlign: this.settings.textAlign,
      brightness: this.settings.brightness,
      pageAnimation: this.settings.pageAnimation,
      tapZone: this.settings.tapZone,
    };
  }

  /**
   * A page turn with the animation and the spoken-position bookkeeping.
   *
   * Every page turn in this screen goes through here. That is not tidiness: the
   * TTS engine anchors itself to a DOM node in the chapter that is on screen, so
   * a turn that bypassed this method would leave the engine speaking from a
   * detached node, which sounds exactly like the reader being ignored.
   */
  private async turnPage(direction: 'next' | 'previous'): Promise<void> {
    const view = this.view;
    if (!view) return;
    const moved = direction === 'next' ? await view.next() : await view.previous();
    if (!moved) {
      this.setStatus('idle', direction === 'next' ? '已经是最后一页' : '已经是第一页');
      window.setTimeout(() => this.hideStatus(), 1600);
      return;
    }
    view.animatePage(direction);
    this.pendingSpeechAnchor = null;
  }

  /** Tap zones, honouring the reader's handedness. */
  private onTapZone(zone: 'previous' | 'toggle-chrome' | 'next'): void {
    if (zone === 'toggle-chrome') {
      this.setChromeVisible(!this.chromeVisible);
      return;
    }
    const reversed = this.settings.tapZone === 'reversed';
    const forward = reversed ? zone === 'previous' : zone === 'next';
    void this.turnPage(forward ? 'next' : 'previous');
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
    this.recordSpeechAnchor();

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
    if (!this.settingsPanel.hidden) {
      this.tocPanel.hidden = true;
      this.filterSettingsRows();
      // Rebuild the voice list on every open: a Bluetooth headset paired while
      // the book was open adds a voice, and Chrome only reports it asynchronously.
      this.refreshVoiceOptions();
    }
  }

  /** Re-reads the engine's voice list into the settings panel's select. */
  private refreshVoiceOptions(): void {
    if (!TtsEngine.isSupported()) return;
    const engine = this.ensureTts();
    const select = this.settingsPanel.querySelector<HTMLSelectElement>('select[data-voice]');
    if (!select) return;
    const voices = engine.snapshot.voices;
    const signature = voices.map((voice) => voice.id).join('|');
    if (select.dataset['signature'] === signature) return;
    select.dataset['signature'] = signature;
    const current = this.settings.ttsVoice;
    select.replaceChildren();
    const follow = document.createElement('option');
    follow.value = '';
    follow.textContent = '跟随系统';
    select.append(follow);
    for (const voice of voices) {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = `${voice.name} · ${voice.lang}${voice.default ? ' · 默认' : ''}`;
      option.selected = voice.id === current;
      select.append(option);
    }
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

    // -- 排版 --
    body.append(this.sectionTitle('排版'));

    body.append(
      this.settingsRow('翻页方式', ['scroll', 'paged'], this.settings.mode, (value) =>
        this.updateSetting({ mode: value as 'scroll' | 'paged' }), (value) => (value === 'scroll' ? '滚动' : '翻页')),
    );

    body.append(
      this.slider('字号', this.settings.fontScale, { min: 0.8, max: 2.2, step: 0.05 }, (value) =>
        `${Math.round(value * 100)}%`, (value) => this.updateSetting({ fontScale: value })),
    );

    body.append(
      this.settingsRow('行距', ['inherit', '1.4', '1.6', '1.8', '2.1'], this.settings.lineHeight, (value) =>
        this.updateSetting({ lineHeight: value }), (value) => (value === 'inherit' ? '原书' : value)),
    );

    body.append(
      this.slider('页边距', this.settings.pageMargin, { min: 0, max: 4, step: 0.25 }, (value) =>
        `${value.toFixed(2)}rem`, (value) => this.updateSetting({ pageMargin: value })),
    );

    body.append(
      this.settingsRow('对齐', ['inherit', 'start', 'justify'], this.settings.textAlign, (value) =>
        this.updateSetting({ textAlign: value as AppSettings['textAlign'] }), (value) =>
        value === 'inherit' ? '原书' : value === 'start' ? '左对齐' : '两端对齐'),
    );

    // The stacks are the ones a Chinese reading app is expected to offer: a
    // system stack, two serif faces that are actually present on phones, and
    // "原书" which is the default and means "do not touch the book's stack".
    body.append(
      this.selectRow(
        '字体',
        [
          { value: 'inherit', label: '原书' },
          { value: 'system-ui, -apple-system, "Noto Sans SC", sans-serif', label: '系统黑体' },
          { value: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif', label: '宋体' },
          { value: '"Kaiti SC", KaiTi, "Noto Serif SC", serif', label: '楷体' },
          { value: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif', label: '苹方/雅黑' },
        ],
        this.settings.fontFamily,
        (value) => void this.updateSetting({ fontFamily: value }),
      ),
    );

    body.append(
      this.settingsRow('主题', ['light', 'sepia', 'dark'], this.settings.theme, (value) =>
        this.updateSetting({ theme: value as 'light' | 'sepia' | 'dark' }), (value) =>
        value === 'light' ? '白' : value === 'sepia' ? '米黄' : '夜间'),
    );

    body.append(
      this.slider('亮度', this.settings.brightness, { min: 0.35, max: 1, step: 0.05 }, (value) =>
        `${Math.round(value * 100)}%`, (value) => this.updateSetting({ brightness: value })),
    );

    // -- 翻页 --
    body.append(this.sectionTitle('翻页'));

    body.append(
      this.settingsRow('点击区域', ['standard', 'reversed'], this.settings.tapZone, (value) =>
        this.updateSetting({ tapZone: value as AppSettings['tapZone'] }), (value) =>
        value === 'standard' ? '左退右进' : '左进右退'),
    );

    body.append(
      this.settingsRow('翻页动画', ['slide', 'fade', 'none'], this.settings.pageAnimation, (value) =>
        this.updateSetting({ pageAnimation: value as AppSettings['pageAnimation'] }), (value) =>
        value === 'slide' ? '滑动' : value === 'fade' ? '淡入' : '无'),
    );

    const fitRow = this.settingsRow('图片适配', ['contain', 'width'], this.settings.fit, (value) =>
      this.updateSetting({ fit: value as 'contain' | 'width' }), (value) => (value === 'contain' ? '完整' : '适宽'));
    fitRow.dataset['only'] = 'fixed';
    body.append(fitRow);

    const directionRow = this.settingsRow('翻页方向', ['ltr', 'rtl'], this.settings.comicDirection, (value) =>
      this.updateSetting({ comicDirection: value as 'ltr' | 'rtl' }), (value) => (value === 'ltr' ? '左→右' : '右→左'));
    directionRow.dataset['only'] = 'fixed';
    body.append(directionRow);

    // -- 朗读 --
    body.append(this.sectionTitle('朗读'));
    body.append(this.buildSpeechSettings());

    // -- 文本 --
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

  /**
   * Shows only the rows that apply to the open book.
   *
   * A settings panel that offers "翻页方向" for a novel is a panel the reader
   * stops reading, so the rows carry a `data-only` marker and this hides the rest.
   * `txt` is the format of the file, not the layout: a TXT book is reflowable but
   * is the only thing an encoding override means anything for.
   */
  private filterSettingsRows(): void {
    const layout = this.doc?.layout ?? 'reflowable';
    const isTxt = this.doc?.format === 'txt';
    for (const row of this.settingsPanel.querySelectorAll<HTMLElement>('[data-only]')) {
      const only = row.dataset['only'];
      const relevant = only === 'fixed' ? layout === 'fixed' : only === 'txt' ? isTxt : true;
      row.hidden = !relevant;
    }
  }

  /**
   * Remembers which sentence the reader was looking at.
   *
   * Used by "read from here". It is recorded on every position change rather than
   * computed when playback starts, because at that moment the reader has already
   * dismissed the chrome and a measurement taken then would have to guess.
   */
  private recordSpeechAnchor(): void {
    const view = this.view;
    if (!view || !TtsEngine.isSupported()) return;
    // The engine owns the cursor once it is running; re-anchoring then would make
    // "read from here" jump to wherever the reader last scrolled.
    if (this.tts?.active) return;
    this.pendingSpeechAnchor = view.speechAnchor();
  }

  /**
   * The read-aloud section of the settings panel.
   *
   * The voice list is read from the engine *when the section is built*, which is
   * the first moment it can be trusted: Chrome populates `getVoices()` only after
   * `voiceschanged`, and a panel built before that would ship an empty picker.
   */
  private buildSpeechSettings(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    if (!TtsEngine.isSupported()) {
      fragment.append(
        el('div', {
          className: 'notice',
          text: '当前环境不支持系统朗读。Android 客户端会使用系统 TTS 引擎，浏览器中请使用 Chrome / Edge。',
        }),
      );
      return fragment;
    }

    fragment.append(
      this.slider('语速', this.settings.ttsRate, { min: 0.5, max: 2.5, step: 0.1 }, (value) =>
        `${value.toFixed(1)}×`, (value) => this.updateSpeechSetting({ ttsRate: value })),
    );
    fragment.append(
      this.slider('音调', this.settings.ttsPitch, { min: 0.5, max: 2, step: 0.1 }, (value) =>
        value.toFixed(1), (value) => this.updateSpeechSetting({ ttsPitch: value })),
    );
    fragment.append(
      this.slider('音量', this.settings.ttsVolume, { min: 0, max: 1, step: 0.05 }, (value) =>
        `${Math.round(value * 100)}%`, (value) => this.updateSpeechSetting({ ttsVolume: value })),
    );

    const engine = this.ensureTts();
    const voices = engine.snapshot.voices;
    const options: Array<{ value: string; label: string }> = [
      { value: '', label: '跟随系统' },
      ...voices.map((voice) => ({
        value: voice.id,
        label: `${voice.name} · ${voice.lang}${voice.default ? ' · 默认' : ''}`,
      })),
    ];
    fragment.append(
      this.selectRow('语音', options, this.settings.ttsVoice, (value) =>
        this.updateSpeechSetting({ ttsVoice: value })),
    );

    fragment.append(
      this.settingsRow('章节播完', ['auto', 'stop'], this.settings.ttsAutoAdvance ? 'auto' : 'stop', (value) =>
        this.updateSpeechSetting({ ttsAutoAdvance: value === 'auto' }), (value) =>
        value === 'auto' ? '继续下一章' : '停止'),
    );

    fragment.append(
      el('button', {
        className: 'button',
        text: '从头朗读这一章',
        attrs: { type: 'button' },
        on: { click: () => void this.speakFromReaderPosition() },
      }),
    );

    return fragment;
  }

  private sectionTitle(text: string): HTMLDivElement {
    return el('div', { className: 'section-title', text }) as HTMLDivElement;
  }

  /** A labelled range input whose value label updates as it is dragged. */
  private slider(
    label: string,
    value: number,
    range: { min: number; max: number; step: number },
    format: (value: number) => string,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const field = el('div', { className: 'field' });
    const valueLabel = el('label', { text: `${label} ${format(value)}` });
    const input = el('input', {
      attrs: {
        type: 'range',
        min: String(range.min),
        max: String(range.max),
        step: String(range.step),
        value: String(value),
      },
      on: {
        input: (event) => {
          const next = Number((event.target as HTMLInputElement).value);
          valueLabel.textContent = `${label} ${format(next)}`;
          onChange(next);
        },
      },
    });
    field.append(valueLabel, input);
    return field;
  }

  /** A labelled native select, for the lists that outgrow a segmented control. */
  private selectRow(
    label: string,
    options: Array<{ value: string; label: string }>,
    current: string,
    onChange: (value: string) => void,
  ): HTMLDivElement {
    const select = el('select', {
      attrs: label === '语音' ? { 'data-voice': 'true' } : {},
      on: { change: (event) => onChange((event.target as HTMLSelectElement).value) },
    }) as HTMLSelectElement;
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      if (option.value === current) node.selected = true;
      select.append(node);
    }
    return el('div', {
      className: 'field',
      children: [el('label', { text: label }), select],
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

  // ---- read aloud ----

  /**
   * The read-aloud bar.
   *
   * A separate strip rather than a row inside the footer, for a reason that only
   * shows up in use: the footer is toggled off with the chrome, and a reader
   * listening to a book while walking wants to keep the controls reachable
   * without the header covering the text. The bar is therefore tied to the
   * *engine's* state, not to the chrome's.
   */
  private buildTtsBar(): HTMLDivElement {
    return el('div', {
      className: 'tts-bar',
      attrs: { hidden: true },
      children: [
        el('button', {
          className: 'icon-button',
          text: '⏮',
          attrs: { type: 'button', 'aria-label': '上一句' },
          on: { click: () => void this.tts?.previous() },
        }),
        this.ttsPlayButton,
        el('button', {
          className: 'icon-button',
          text: '⏭',
          attrs: { type: 'button', 'aria-label': '下一句' },
          on: { click: () => void this.tts?.next() },
        }),
        el('div', { className: 'tts-main', children: [this.ttsLabel, this.ttsRangeInput] }),
        this.ttsChip,
        el('button', {
          className: 'icon-button',
          text: '✕',
          attrs: { type: 'button', 'aria-label': '停止朗读' },
          on: { click: () => this.stopSpeech() },
        }),
      ],
    }) as HTMLDivElement;
  }

  private ensureTts(): TtsEngine {
    if (this.tts) return this.tts;
    this.tts = new TtsEngine({
      loadQueue: (from) => this.loadSpeechQueue(from),
      onChunk: (chunk) => this.view?.highlightSpokenChunk(chunk),
      onState: (snapshot) => this.renderSpeechState(snapshot),
    });
    this.tts.setRate(this.settings.ttsRate);
    this.tts.setPitch(this.settings.ttsPitch);
    this.tts.setVolume(this.settings.ttsVolume);
    this.tts.setVoice(this.settings.ttsVoice);
    return this.tts;
  }

  /**
   * Supplies the engine with the next batch of sentences.
   *
   * When the queue runs out mid-chapter the engine keeps calling until it gets an
   * empty list, which is what makes "continue into the next chapter" work without
   * the engine knowing anything about chapters.
   */
  private async loadSpeechQueue(from: number): Promise<{ chunks: SpokenChunk[]; startIndex: number }> {
    const view = this.view;
    if (!view) return { chunks: [], startIndex: 0 };
    let chunks = view.speechChunks as SpokenChunk[];
    if (from < chunks.length && view.currentSectionIndex() === this.spokenSectionIndex) {
      return { chunks, startIndex: from };
    }
    // The queue is exhausted: look for the next chapter, but only when the reader
    // asked for it. Stopping at a chapter end is a legitimate preference — it is
    // how an audiobook's "one chapter per session" works.
    if (!this.settings.ttsAutoAdvance) return { chunks, startIndex: from };
    const next = view.currentSectionIndex() + 1;
    if (next >= view.sectionCount) return { chunks: [], startIndex: 0 };
    await view.open(next, 0);
    this.spokenSectionIndex = next;
    chunks = view.speechChunks as SpokenChunk[];
    return { chunks, startIndex: 0 };
  }

  private toggleSpeech(): void {
    if (!TtsEngine.isSupported()) {
      this.setStatus('error', '当前浏览器不支持朗读');
      window.setTimeout(() => this.hideStatus(), 2600);
      return;
    }
    const engine = this.ensureTts();
    if (engine.active) {
      if (this.ttsBar.dataset['state'] === 'playing') engine.pause();
      else engine.resume();
      return;
    }
    void this.speakFromReaderPosition();
  }

  private stopSpeech(): void {
    this.tts?.stop();
    this.ttsBar.hidden = true;
    this.view?.clearSpeechHighlight();
  }

  /**
   * Starts reading from the sentence the reader is looking at.
   *
   * The view answers that question by measuring: a selected sentence wins, then
   * the first sentence at the leading edge of the reading area. Measuring rather
   * than scaling the position fraction is what makes this work in paged mode,
   * where the leading edge is a column boundary and a fraction of the chapter
   * would land a paragraph away from what the reader is looking at.
   */
  private async speakFromReaderPosition(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const engine = this.ensureTts();
    this.ttsBar.hidden = false;
    this.spokenSectionIndex = view.currentSectionIndex();
    const chunks = view.speechChunks as SpokenChunk[];
    if (chunks.length === 0) {
      // A fixed-layout page has no text; say so instead of showing an empty bar.
      this.setStatus('idle', '这一页没有可朗读的文字');
      window.setTimeout(() => this.hideStatus(), 2400);
      this.ttsBar.hidden = true;
      return;
    }
    // A live selection wins: the reader who selected a paragraph and pressed play
    // has said exactly which paragraph they mean. Otherwise the sentence at the
    // leading edge is re-measured, because the reader may have scrolled or turned
    // a page since the anchor was recorded.
    const anchor = view.speechAnchorFromSelection() ?? view.speechAnchor() ?? this.pendingSpeechAnchor;
    const start = anchor ? chunks.indexOf(anchor) : -1;
    await engine.play(start >= 0 ? start : 0);
  }

  private onSpeechScrub(index: number): void {
    const engine = this.tts;
    if (!engine) return;
    const total = engine.snapshot.total;
    // Scrubbing to the very end means "stop", not "play the last sentence".
    if (total === 0 || index >= total) {
      this.stopSpeech();
      return;
    }
    void engine.jump(index);
  }

  private renderSpeechState(snapshot: TtsSnapshot): void {
    if (snapshot.state === 'unsupported') {
      this.setStatus('error', snapshot.error || '当前浏览器不支持朗读');
      this.ttsBar.hidden = true;
      return;
    }
    const active = snapshot.state === 'playing' || snapshot.state === 'paused';
    if (active) this.ttsBar.hidden = false;
    this.ttsBar.dataset['state'] = snapshot.state;
    this.ttsPlayButton.textContent = snapshot.state === 'playing' ? '⏸' : '▶';
    this.ttsPlayButton.setAttribute('aria-label', snapshot.state === 'playing' ? '暂停朗读' : '开始朗读');
    this.ttsLabel.textContent = snapshot.chunk || (snapshot.error ? snapshot.error : '准备朗读…');
    this.ttsLabel.title = snapshot.chunk;
    this.ttsChip.textContent = snapshot.total > 0 ? `${snapshot.index + 1}/${snapshot.total}` : '从头朗读';
    this.ttsChip.setAttribute('aria-label', snapshot.total > 0 ? '朗读句数' : '从头朗读');
    this.ttsRangeInput.max = String(Math.max(0, snapshot.total - 1));
    this.ttsRangeInput.value = String(Math.max(0, snapshot.index));
    if (snapshot.error) {
      this.setStatus('error', snapshot.error);
      window.setTimeout(() => this.hideStatus(), 3200);
    }
  }

  private updateSpeechSetting(patch: Partial<AppSettings>): void {
    Object.assign(this.settings, patch);
    this.options.onSettingsChange(patch);
    const engine = this.tts;
    if (!engine) return;
    if (patch.ttsRate !== undefined) engine.setRate(patch.ttsRate);
    if (patch.ttsPitch !== undefined) engine.setPitch(patch.ttsPitch);
    if (patch.ttsVolume !== undefined) engine.setVolume(patch.ttsVolume);
    if (patch.ttsVoice !== undefined) engine.setVoice(patch.ttsVoice);
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

/**
 * Hardware page-turn keys.
 *
 * The Android shell synthesises `ArrowRight`/`ArrowLeft` from the volume rocker
 * (see `android/contract.md` §4), which is how a phone in a pocket becomes a
 * page-turner. The same handler therefore serves a Bluetooth remote and a
 * desktop keyboard, with no per-host branching.
 */
function bindKeys(target: HTMLElement, handler: (key: string) => void): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const element = event.target as HTMLElement | null;
    const tag = element?.tagName ?? '';
    // A typing surface owns the keys: the settings panel has range inputs, and
    // space on a focused control must not also turn the page.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A panel that is open owns the keyboard: the arrow keys are how a range
    // input is adjusted, and the settings panel is a column of range inputs.
    if (target.querySelector('.panel:not([hidden])')) return;
    handler(event.key);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

function hasTextSelection(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode;
  return anchor !== null && root.contains(anchor);
}

export type { Note };
