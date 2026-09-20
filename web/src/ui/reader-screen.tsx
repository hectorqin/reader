import { ApiError } from '../api/errors.ts';
import { renditionRef } from './rendition.ts';
import type { ReaderApi } from '../api/client.ts';
import type { Book, BookContent, Manifest, Note } from '../api/types.ts';
import { loadBook, isImagePath, extensionOf } from '../formats/index.ts';
import type { OfflineStore } from '../store/offline.ts';
import type { SyncEngine, SyncStatus } from '../core/sync.ts';
import type { Platform } from '../core/platform.ts';
import { ReaderView, type Position, type ViewSettings } from './reader-view.ts';
import { makeAssetSigner } from '../net/asset-url.ts';
import { attachGestures } from './gestures.ts';
import { READOUT_FIELDS, type AppSettings } from '../store/settings.ts';
import { createStagedDoc, isStagedKind, windowIndexOf } from '../formats/windowed.ts';
import type { BookDoc } from '../formats/types.ts';
import type { TocEntry } from '../api/types.ts';
import type { NativePageHost } from './native-page.ts';
import { TtsEngine, type TtsSnapshot } from '../render/tts.ts';
import type { SpokenChunk } from '../render/tts-text.ts';
import {
  createSpeechEngine,
  speechAvailability,
  SPEECH_ENGINE_LABELS,
  type SpeechEngine,
  type SpeechEngineKind,
} from '../render/speech.ts';
import type { NativeSpeechBridge } from '../android-bridge.ts';
import { mountUI } from './mount.ts';
import { ReaderChrome, type ChromeState, type ChromeTocEntry } from './reader-chrome.tsx';
import { PublicationCache, publicationScope } from '../store/publications.ts';
import { parseLocator } from './locator.ts';

export interface ReaderScreenOptions {
  api: ReaderApi;
  offline: OfflineStore;
  sync: SyncEngine;
  platform: Platform;
  settings: AppSettings;
  /**
   * Native renderer for fixed-layout pages, when the host provides one.
   *
   * Optional because the browser has none and must not be given a stub that
   * pretends otherwise: `undefined` means "draw everything here", which is the
   * behaviour the H5 build has always had.
   */
  pageHost?: NativePageHost;
  /**
   * The Android shell's own speech engine, when it has one.
   *
   * Optional for the same reason as `pageHost`: a browser has none, and a shell
   * older than version 3 has none either. `undefined` means "the WebView's own
   * synthesizer is the best available engine", which is a perfectly good
   * outcome — it is what every browser build does today.
   */
  speechBridge?: NativeSpeechBridge;
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
 *
 * ## The boundary this screen keeps
 *
 * The *stage* — everything below the chrome: pagination, injected documents, the
 * shadow root, column measurement, the gesture surface — stays imperative DOM
 * work, and deliberately so. A virtual DOM between this code and the layout it is
 * measuring is the one layer this product cannot afford to debug through, and no
 * framework makes `getBoundingClientRect()` less necessary.
 *
 * The *chrome* — topbar, footer, contents, the settings panel, the read-aloud
 * bar, the status line — is a component. It is state and events, not
 * measurement: seventeen node fields, four builders and an entire class of
 * "rebuild the speech rows in place" hacks are now one `ChromeState` and a tree
 * that is a function of it. The stage is handed in as children.
 */
export class ReaderScreen {
  readonly element: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly ui: ReturnType<typeof mountUI>;
  /**
   * Everything the chrome draws. Written by this class, read by the tree.
   *
   * The stage is deliberately *not* in here: it is a `ReaderView`'s canvas, and
   * putting a node with its own lifetime into a tree that re-renders is how a
   * chapter's shadow root ends up detached from the element the paginator
   * measured.
   */
  private chrome: ChromeState = {
    title: '',
    author: '',
    chromeVisible: true,
    statusText: '',
    statusState: 'idle',
    progress: 0,
    chapterLabel: '',
    tocOpen: false,
    settingsOpen: false,
    toc: [],
    currentSectionId: '',
    pageInChapter: 0,
    chapterPages: 0,
    chapterIndex: 1,
    chapterCount: 0,
    navigating: false,
    // Settings rows, flattened for the panel. See `settingsView`.
    ...emptyChromeSettings(),
    tts: { active: false, state: 'idle', label: '', chip: '从头朗读', index: 0, total: 0, sentenceIndex: -1, sentenceTotal: 0 },
    layout: 'reflowable',
    format: '',
  } as ChromeState;

  /**
   * The engine currently speaking.
   *
   * Held as the `SpeechEngine` interface rather than as `TtsEngine`, because
   * there are three implementations and which one is in use depends on the host
   * (see `speechAvailability`). Everything below this point — the queue, the
   * highlight, the bar — is identical for all three.
   */
  private tts: SpeechEngine | null = null;
  /** The sentence at the reader's own position, for "read from here". */
  private pendingSpeechAnchor: SpokenChunk | null = null;
  /** Chapter the current speech queue was built from. */
  private spokenSectionIndex = -1;
  /**
   * The engine's fragment list, which is what an engine index refers to.
   *
   * It differs from the view's own sentence list for the HTTP engine: a paragraph
   * with no punctuation is split before it is sent, and the engine counts
   * fragments while the reader counts sentences. Both lists are kept so the
   * highlight can be drawn from one and the progress bar counted in the other.
   */
  private lastSpeechQueue: SpokenChunk[] = [];
  /** What the server said it can synthesise. */
  private httpTtsAvailable = false;
  /** Probed once per screen; a server's capabilities do not change mid-book. */
  private httpProbed = false;
  /** Voices the current engine reports, for the panel's select. */
  private voices: Array<{ id: string; name: string; lang: string; default: boolean }> = [];

  private view: ReaderView | null = null;
  private doc: BookDoc | null = null;
  /**
   * The windowed structure the server handed out, when the book is read in
   * windows.
   *
   * Kept beside `doc` rather than folded into it because the two answer different
   * questions: `doc` is what the *view* renders (the loaded window's sections),
   * and this is the whole book's shape — the group sizes a jump needs to compute
   * which window holds a chapter. It is the manifest's own `content`, passed to
   * `createStagedDoc` and kept here so a later jump does not have to re-fetch it.
   */
  private content: BookContent | null = null;
  private book: Book | null = null;
  private manifest: Manifest | null = null;
  private chromeVisible = true;
  /**
   * True while a window is being fetched for a chapter jump.
   *
   * A guard *and* published state, because the footer's chapter buttons have to
   * say what is happening: a tap that fetches a window over a tunnel takes a
   * visible moment, and a button that looks dead for two seconds is the
   * difference between "slow" and "broken" to the reader pressing it.
   */
  private navigating = false;
  private detachGestures: (() => void) | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPosition: Position | null = null;
  private readonly settings: AppSettings;
  private readonly listeners: Array<() => void> = [];
  private readonly viewListeners: Array<() => void> = [];
  private readonly publicationCache: PublicationCache;
  private loadingToken = 0;
  private viewEpoch = 0;

  constructor(private readonly options: ReaderScreenOptions) {
    this.settings = { ...options.settings };
    this.publicationCache = new PublicationCache(
      options.platform.kv,
      options.platform.blobs,
      publicationScope(options.api.baseUrl || (typeof location !== 'undefined' ? location.origin : ''), options.api.currentSession()?.user.id ?? ''),
    );

    // The stage is created here and never re-created: `ReaderView` attaches to it
    // on every chapter, and a container the tree replaced would take the reader's
    // scroll position and the shadow root with it.
    this.stage = document.createElement('div');
    this.stage.className = 'stage';

    this.element = document.createElement('div');
    this.element.className = 'reader-screen';
    // Whether the chrome is on screen, as an attribute rather than a class per band.
    // The topbar and the footer are one state (see the stylesheet), and one attribute
    // is what makes "cannot be half-hidden" true by construction rather than by two
    // rules that have to be kept in agreement.
    this.element.dataset['chrome'] = 'visible';
    this.element.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative;';
    this.ui = mountUI(
      this.element,
      () => (
        <ReaderChrome
          state={this.chrome}
          stage={this.stage}
          handlers={{
            onBack: () => this.options.onBack(),
            toggleToc: () => this.toggleToc(),
            toggleSettings: (tab) => this.toggleSettings(tab),
            onSetting: (patch) => void this.updateSetting(patch),
            onSpeechSetting: (patch) => this.updateSpeechSetting(patch),
            onVoice: (voice) => this.updateSpeechSetting({ ttsVoice: voice }),
            onSpeakFromHere: () => void this.speakFromReaderPosition(),
            onSwitchEngine: (kind) => this.switchSpeechEngine(kind),
            onTocEntry: (ref) => void this.goToChapterRef(ref),
            onChapter: (delta) => void this.goToChapter(delta),
            onRefresh: () => void this.refreshPublication(),
            onScrubPage: (page) => void this.scrubToPage(page),
            onTurnPage: (direction) => void this.turnPage(direction),
            onSpeechToggle: () => this.toggleSpeech(),
            onSpeechPrevious: () => void this.tts?.previous(),
            onSpeechNext: () => void this.tts?.next(),
            onSpeechScrub: (index) => this.onSpeechScrub(index),
            onStopSpeech: () => this.stopSpeech(),
          }}
        />
      ),
      this.chrome,
    );

    this.bindSyncStatus();
  }

  /** Opens a book: fetch bytes, parse, restore position, start reporting. */
  async open(book: Book): Promise<void> {
    const token = ++this.loadingToken;
    this.book = book;
    this.patch({ title: book.title, author: book.author, canRefresh: book.format === 'chapters' });
    this.setStatus('loading', '正在载入…');
    this.setChromeVisible(true);

    try {
      this.manifest = await this.loadManifest(book);
      if (token !== this.loadingToken) return;

      // A staged book is read through the windowed contract and never downloads
      // the file. That is the whole answer to "客户端需要下载完整的书籍，那消耗太大":
      // this manifest already carries the first window, so opening the book has
      // cost exactly one window of metadata.
      const staged = await this.openStaged(book, token);
      if (staged) {
        this.doc = staged.doc;
        this.afterDocLoaded();
        // Cleared *after* the position is restored, not before. `restorePosition`
        // ends in `flashStatus('已恢复到上次阅读位置')`, and clearing the line first
        // meant that message was immediately replaced by nothing — so a reader
        // returning to a book saw no confirmation at all. The other order lets the
        // restore message overwrite "正在载入…", which is what it is there for.
        await this.restorePosition(book, token);
        if (this.chrome.statusState === 'loading') this.hideStatus();
        return;
      }

      const bytes = await this.fetchBookBytes(book, this.manifest);
      if (token !== this.loadingToken) return;

      const loaded = await this.loadDoc(book, this.manifest, bytes);
      if (token !== this.loadingToken) return;

      this.doc = loaded.doc;
      this.afterDocLoaded();
      if (loaded.notes.length > 0) this.setStatus('idle', loaded.notes.join(' · '));
      else this.hideStatus();

      await this.restorePosition(book, token);
    } catch (err) {
      if (token !== this.loadingToken) return;
      this.handleLoadError(err);
    }
  }

  /**
   * Open the book through the windowed contract, when the server offers one.
   *
   * Returns null when the book has no addressable structure (an old server, a
   * format that exposes none), and the caller falls back to downloading the
   * file. That fallback is not a courtesy: it is what keeps this client working
   * against a server that predates the endpoint, which self-hosted users do not
   * upgrade on time.
   *
   * An EPUB is the case where the window is worth the most — a 1200-chapter
   * omnibus would otherwise be a 50MB download to show one page of chapter one.
   */
  private async openStaged(book: Book, token: number): Promise<{ doc: BookDoc } | null> {
    const manifest = this.manifest;
    const content = manifest?.content;
    if (!content || !isStagedKind(content.kind)) return null;

    // The manifest's own items are the fallback *and* the sanity check.
    //
    // The fallback half is the original reasoning: refusing to open a book because
    // its contents list failed is the wrong trade, and a window of chapter titles is
    // a worse table of contents and a perfectly usable one.
    //
    // The sanity check half is the part that was missing. `api.toc()` resolves to
    // `undefined` for a response shaped differently from what `docs/api.md`
    // describes — a proxy that re-wraps JSON, a server from another branch — and
    // `undefined.map(...)` is a TypeError that takes down the whole `open()`. The
    // reader then shows a raw JavaScript message where the book should be, and the
    // one thing a reader cannot do anything with is a TypeError. So the *shape* is
    // checked, not just the success, and a response that is not a list falls back
    // exactly like a failed request does.
    let toc: TocEntry[] = [];
    if (book.format !== 'chapters') {
      try {
        const fetched = await this.options.api.toc(book.id);
        if (Array.isArray(fetched)) toc = fetched;
      } catch {
        // Covered by the fallback below.
      }
    }
    if (toc.length === 0) {
      toc = (content.items ?? []).map((item) => ({
        href: item.href,
        title: item.title,
        level: 0,
        spine: item.seq,
      }));
    }
    if (token !== this.loadingToken) return null;

    this.patch({ toc: toc.map((entry) => ({
      id: entry.href, label: entry.title, depth: entry.level,
      ...(entry.spine === undefined ? {} : { spine: entry.spine }),
    })) });

    this.content = content;
    const doc = createStagedDoc({
      kind: content.kind,
      toc: toc.map((entry) => ({ id: entry.href, label: entry.title, depth: entry.level })),
      content,
      orderedByBook: true,
      loader: {
        read: (item) => this.readStagedSection(book, item),
      },
    });

    // The view drives window changes through this hook, so a jump to chapter 900
    // of a 1200-chapter book loads window 22 rather than doing nothing.
    (doc as BookDoc & { staged?: unknown }).staged = doc;
    return { doc };
  }

  /**
   * One section's bytes, by the server's own reference.
   *
   * The reference itself is opaque and passed through unchanged: the client must
   * not build it from an index, because the whole reason it is a reference is that
   * indices mean different chapters in different windows.
   *
   * What *is* derived here is which rendition to ask for. A TXT chapter has two of
   * them under one reference — plain characters and renderable markup — and the
   * reader needs the markup; a `format` the client does not recognise falls back to
   * the reference as-is, so an unknown value is a no-op rather than a failed
   * chapter.
   */
  private async readStagedSection(
    book: Book,
    item: { href: string; kind: string; mediaType: string; format?: string; resourceRef?: string },
  ): Promise<{ html?: string; image?: { mediaType: string; bytes: Uint8Array } }> {
    const ref = renditionRef(item);
    // Keyed by the rendition, not just the section: a client that read the plain
    // text before this change and the markup after it must not serve the cached
    // plain text for a chapter it is now rendering as a document.
    const legacyCacheKey = `section:${book.id}:${ref}`;
    const cached = book.format === 'chapters'
      ? await this.publicationCache.resource(book.id, ref)
      : await this.options.platform.blobs.get(legacyCacheKey);
    const blob = cached ? new Blob([toArrayBuffer(cached)]) : await this.options.api.asset(book.id, ref);
    if (!cached) {
      // Cached per section, not per book, so a partially read book is partially
      // readable offline and re-opening one does not re-fetch what was read.
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (book.format === 'chapters') {
        await this.publicationCache.putResource(book.id, ref, bytes).catch(() => undefined);
      } else {
        await this.options.platform.blobs.put(legacyCacheKey, bytes).catch(() => undefined);
      }
    }
    if (item.kind === 'page') {
      return { image: { mediaType: item.mediaType, bytes: new Uint8Array(await blob.arrayBuffer()) } };
    }
    return { html: await blob.text() };
  }

  dispose(): void {
    this.loadingToken += 1;
    this.viewEpoch += 1;
    this.tts?.dispose();
    this.tts = null;
    this.flushProgress();
    this.book = null;
    if (this.progressTimer) clearTimeout(this.progressTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.detachGestures?.();
    this.detachGestures = null;
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    for (const off of this.viewListeners) off();
    this.viewListeners.length = 0;
    this.view?.dispose();
    this.view = null;
    this.doc = null;
    this.manifest = null;
    this.ui.unmount();
    // A native page view is a sibling of the WebView's content, so it does not
    // go away with the DOM this screen owns. Leaving it would put a comic page
    // on top of the shelf.
    this.options.pageHost?.hide();
    this.element.remove();
  }

  // ---- loading ----

  private async loadManifest(book: Book): Promise<Manifest> {
    try {
      const manifest = await this.options.api.manifest(book.id);
      if (book.format === 'chapters') {
        await this.publicationCache.putManifest(book.id, manifest).catch(() => undefined);
      }
      return manifest;
    } catch (error) {
      // Authentication failures must never be hidden behind cached content.
      if (error instanceof ApiError && !error.isConnectivity && error.kind !== 'server') throw error;
      if (book.format === 'chapters') {
        const cached = await this.publicationCache.manifest(book.id);
        if (cached) return cached;
      }
      throw error;
    }
  }

  private async refreshPublication(): Promise<void> {
    const book = this.book;
    const previousManifest = this.manifest;
    if (!book || book.format !== 'chapters' || !previousManifest || this.chrome.refreshing || this.navigating) return;
    const token = this.loadingToken;
    const previousHrefs = new Set(previousManifest.content?.items.map((item) => item.href));
    this.patch({ refreshing: true });
    this.setStatus('loading', '正在刷新目录…');
    try {
      const content = await this.options.api.refreshPublication(book.id);
      if (token !== this.loadingToken) return;
      const toc = content.items.map((item) => ({ id: item.href, label: item.title, depth: 0, spine: item.seq }));
      const doc = createStagedDoc({
        kind: content.kind, content, toc, orderedByBook: true,
        loader: { read: (item) => this.readStagedSection(book, item) },
      });
      (doc as BookDoc & { staged?: unknown }).staged = doc;
      let locator = this.view?.position().locator ?? '';
      let parsed = locator ? parseLocator(locator, doc) : null;
      let index = parsed ? doc.sections.findIndex((section) => section.id === parsed?.sectionId) : 0;
      // Fetch the landing chapter before replacing the current view. A failed
      // refresh or an unavailable new resource must leave the old page readable.
      while (doc.sections.length) {
        await doc.loadSection(index);
        if (token !== this.loadingToken) return;
        // The reader may keep scrolling while the source is being refreshed,
        // or a chapter request started before refresh may finish meanwhile.
        locator = this.view?.position().locator ?? '';
        const latest = locator ? parseLocator(locator, doc) : null;
        const latestIndex = latest ? doc.sections.findIndex((section) => section.id === latest.sectionId) : 0;
        parsed = latest;
        if (index === latestIndex) break;
        index = latestIndex;
      }
      const manifest: Manifest = { ...previousManifest, ...content, content };
      if (token !== this.loadingToken) return;
      this.stopSpeech();
      this.flushProgress();
      this.manifest = manifest;
      this.content = content;
      this.doc = doc;
      void this.publicationCache.putManifest(book.id, manifest).catch(() => undefined);
      this.patch({ toc });
      this.afterDocLoaded();
      await this.view?.open(index, parsed?.offset ?? 0);
      const added = content.items.filter((item) => !previousHrefs.has(item.href)).length;
      this.flashStatus(locator && !parsed
        ? '目录已更新，原章节已移除，从开头开始'
        : added > 0 ? `目录已更新，新增 ${added} 章` : '目录已更新，暂无新章节', 3200);
    } catch (error) {
      if (token !== this.loadingToken) return;
      if (error instanceof ApiError && error.isAuthFailure) this.options.onSignedOut();
      else this.flashStatus('刷新目录失败，已保留当前章节', 3200);
    } finally {
      if (token === this.loadingToken) this.patch({ refreshing: false });
    }
  }

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

  /** Publishes what the chrome needs to know about the book that just loaded. */
  private afterDocLoaded(): void {
    this.patch({
      layout: this.doc?.layout ?? 'reflowable',
      format: this.doc?.format ?? '',
      // The window's own length is a page count for the first window and a
      // chapter count for the rest; `chapterCount` is corrected from the whole
      // book's total below, which is what the server reports and the window does
      // not.
      chapterCount: this.chapterCount,
    });
    this.buildView();
    void this.renderToc();
  }

  /**
   * Builds the view, the gestures and the key bindings against the stage.
   *
   * All of it is imperative by nature: a `ReaderView` owns a shadow root it
   * measures, `attachGestures` owns touch tracking, and neither has any markup
   * for a diff to describe.
   */
  private buildView(): void {
    const epoch = ++this.viewEpoch;
    this.detachGestures?.();
    for (const off of this.viewListeners) off();
    this.viewListeners.length = 0;
    this.view?.dispose();
    if (!this.doc) return;
    const doc = this.doc;
    // The token the browser cannot attach for itself. Built once per view rather
    // than per chapter: the reader's session does not change while a book is open,
    // and a signer that read the token lazily would have to be rebuilt whenever one
    // arrived — which is a second lifecycle to keep in step with the first.
    const token = this.options.api.currentSession()?.accessToken;
    const signAssetUrl = makeAssetSigner({
      baseUrl: this.options.api.baseUrl,
      ...(token ? { accessToken: token } : { accessToken: '' }),
    });
    this.view = new ReaderView({
      container: this.stage,
      doc,
      ...(this.options.pageHost ? { pageHost: this.options.pageHost } : {}),
      ...(signAssetUrl ? { signAssetUrl } : {}),
      onPositionChange: (position) => {
        if (epoch === this.viewEpoch) this.onPosition(position);
      },
      // A book's own table-of-contents page is a chapter like any other, and its
      // links are the same destination the 目录 panel offers. Routing them through
      // `goToChapterRef` rather than through the browser is what makes a tap on
      // "第三章" a chapter change — window fetch included — instead of a download of
      // another chapter's document.
      onChapterLink: (ref) => {
        if (epoch !== this.viewEpoch) return false;
        void this.goToChapterRef(ref);
        return true;
      },
      onChapterChange: (index, section) => {
        if (epoch !== this.viewEpoch) return;
        // One patch, and `syncTocPosition` folds its own correction into the same
        // one rather than issuing a second. A chapter change is the one moment
        // several pieces of chrome move together (label, section, progress, the
        // contents highlight), and publishing them separately means the diff runs
        // — and the sync status line repaints — once per field.
        this.patch({ chapterLabel: section.label, currentSectionId: section.id });
        this.syncTocPosition();
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
      // On the *scroll container*, which is the host element and not the stage
      // around it. A `scroll` event does not bubble, so a listener on the stage
      // sees nothing at all: the reading position never advanced past the first
      // screen, the footer's page counter stayed at 1, and — because a position
      // change is also what schedules the progress write — a reader could scroll
      // through a whole chapter and have the app believe they never moved.
      this.viewListeners.push(
        addDebouncedListener(this.view.elementHost, 'scroll', () => this.onPosition(this.view?.position() ?? null), 250),
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
    this.viewListeners.push(
      bindKeys(this.element, (key) => {
        if (key === 'ArrowRight' || key === 'PageDown') void this.turnPage('next');
        else if (key === 'ArrowLeft' || key === 'PageUp') void this.turnPage('previous');
        else if (key === ' ') this.toggleSpeech();
        else if (key === 'Escape') this.setChromeVisible(false);
      }),
    );
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
      txtIndent: this.settings.txtIndent,
      txtParagraphGap: this.settings.txtParagraphGap,
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
    if (this.chrome.refreshing) return;
    const view = this.view;
    if (!view) return;
    let moved: boolean;
    try {
      moved = direction === 'next' ? await view.next() : await view.previous();
    } catch (error) {
      this.handleLoadError(error);
      return;
    }
    if (!moved) {
      this.flashStatus(direction === 'next' ? '已经是最后一页' : '已经是第一页');
      return;
    }
    view.animatePage(direction);
    this.pendingSpeechAnchor = null;
  }

  /**
   * Tap zones, in priority order.
   *
   * The order is the whole content of this method, and getting it wrong is the
   * difference between a reader and a puzzle:
   *
   *   1. **A panel that is open owns the tap.** The contents and settings panels
   *      are half-screen sheets over the text; a tap in the strip of text still
   *      visible beside one is a tap on the panel's backdrop, and turning the page
   *      behind an open panel is the bug the reader reports as "翻页和设置抢事件".
   *      The gesture layer cannot enforce this — it sees the stage, and the panel
   *      is a sibling — so it is enforced here.
   *   2. **The middle third toggles the chrome**, in both directions.
   *   3. **The outer thirds turn the page**, and *only* that.
   *
   * The third rule is the one that changed, and the report behind it is the whole
   * of it: "在点击左右两边时只需要翻页、不需要显示工具栏，只有在中间点击时才需要切换
   * 工具栏显隐". The outer thirds used to page-turn *and* force the chrome back on
   * whenever it was hidden, on the reasoning that a hidden bar leaves the reader no
   * other way back. The reasoning was sound and the result fights the gesture: a
   * reader who tapped the right third to go forward got the next page *and* a
   * toolbar across the text they had just turned to, so the immersive state was
   * impossible to stay in — every page turn undid it. And the reader who *did* want
   * the toolbar back had a dedicated, discoverable way to ask for it: the middle
   * third.
   *
   * So the two gestures are now disjoint, one meaning each, which is the property
   * the old version lacked: 左/右 = 翻页, 中 = 显隐工具栏. Nothing is revealed by a
   * page turn, and nothing is turned by a tap that asked for the controls.
   */
  private onTapZone(zone: 'previous' | 'toggle-chrome' | 'next'): void {
    if (this.chrome.tocOpen || this.chrome.settingsOpen) return;

    if (zone === 'toggle-chrome') {
      this.setChromeVisible(!this.chromeVisible);
      return;
    }

    // The page turn, and nothing else: the chrome's visibility is the middle
    // third's business alone (see the doc comment above). `tapZone` decides which
    // physical side is *forward*, so a left-handed reader can put next-page under
    // the thumb that holds the phone.
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
        this.flashStatus('已恢复到上次阅读位置', 2400);
        return;
      }
      // A locator that cannot be resolved means the book changed on disk under
      // the reader's feet. Say so rather than jumping to page one silently.
      this.flashStatus('原阅读位置已失效，从开头开始', 3200);
    }
    await this.view?.open(0, 0);
  }

  // ---- position and progress ----

  /**
   * Publishes a new reading position to the chrome, once.
   *
   * **One** patch, not one per field. The old version called `patch()` up to three
   * times per position — once for the numbers, once for the chapter label, once for
   * the current section — and `patch` re-renders the whole chrome tree. A scroll
   * produces a position per frame (the view throttles nothing; the debounce is
   * below), so a reader dragging a finger down a chapter was re-rendering the
   * topbar, the footer and both panels sixty times a second *three times over*.
   * On a phone that is the difference between a smooth flick and a stutter, and it
   * is also what made the status line flicker: every one of those renders walked
   * the sync state machine's status text.
   *
   * The fields are merged into one object so the diff sees them arrive together,
   * which is also what makes the three of them consistent with each other — they
   * come from a single `position()` call and must not be published from three.
   *
   * Nothing here writes to the network. The position is held in `pendingPosition`
   * and the *write* is debounced below, because a scroll is a gesture in progress
   * rather than a sequence of decisions to persist.
   */
  private onPosition(position: Position | null): void {
    if (!position || !this.book) return;

    const title = position.chapterTitle;
    const sectionId = position.sectionId;
    const chapterMoved = sectionId !== this.chrome.currentSectionId;
    this.patch({
      progress: position.percentage,
      pageInChapter: position.pageInChapter,
      chapterPages: position.chapterPages,
      chapterIndex: position.chapterPosition + 1,
      // Only overwrite the label when the position carries one: a chapter with no
      // title would otherwise blank the footer on every position update.
      ...(title ? { chapterLabel: title } : {}),
      ...(chapterMoved ? { currentSectionId: sectionId } : {}),
    });

    this.pendingPosition = position;
    this.recordSpeechAnchor();

    // Debounced, and *only* the write: a scroll produces a position per frame, and
    // each one would otherwise be a write to IndexedDB plus a network round trip.
    // 1.5s of stillness is the point at which the reader has decided where they are.
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(() => this.flushProgress(), 1500);
  }

  /**
   * Persists the pending position locally, then asks sync to catch up.
   *
   * The two halves are separated on purpose, and the separation is the fix for
   * "sync 调用太过频繁": `syncNow()` used to be called unconditionally, once per
   * flush, so a reader flipping through a book produced a POST *and* a GET every
   * 1.5 seconds for as long as they kept reading — even though the only thing that
   * had changed was one row, and even while a previous round trip was still in
   * flight. `SyncEngine.syncNow` folds concurrent calls together, but a *sequence*
   * of them one per flush is not concurrency, and that is what this was.
   *
   * `SyncEngine.schedule()` debounces the push across flushes and guarantees a
   * trailing one, so the last page turn of a session still reaches the server.
   */
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
      .then(() => this.options.sync.schedule())
      .catch(() => undefined);
  }

  // ---- chrome ----

  private setChromeVisible(visible: boolean): void {
    this.chromeVisible = visible;
    this.element.dataset['chrome'] = visible ? 'visible' : 'hidden';
    this.patch({
      chromeVisible: visible,
      // Hiding the chrome closes the panels: a panel floating over a hidden
      // header is a panel the reader cannot dismiss.
      ...(visible ? {} : { tocOpen: false, settingsOpen: false }),
    });
  }

  private toggleToc(): void {
    const open = !this.chrome.tocOpen;
    this.patch({ tocOpen: open, settingsOpen: false });
  }

  private toggleSettings(tab: 'appearance' | 'behavior' | 'speech' = 'behavior'): void {
    const open = !this.chrome.settingsOpen || this.chrome.settingsTab !== tab;
    this.patch({ settingsOpen: open, settingsTab: tab, tocOpen: false });
    if (!open) return;
    // Re-read the voice list on every open: a Bluetooth headset paired while the
    // book was open adds a voice, and Chrome only reports it asynchronously.
    this.refreshVoices();
    // The server's capability answer is cached after the first probe, so this is
    // a no-op on every subsequent open.
    if (!this.httpProbed) {
      this.httpProbed = true;
      void this.probeHttpTts();
    }
  }

  private refreshVoices(): void {
    const voices = this.tts?.snapshot.voices ?? [];
    this.voices = voices.map((voice) => ({ id: voice.id, name: voice.name, lang: voice.lang, default: voice.default }));
    this.patch({});
  }

  /**
   * Probes the server for an HTTP voice engine, once per screen.
   *
   * Not awaited by the settings panel: a probe against a NAS on a slow link must
   * not delay the panel opening. The reply rebuilds the engine row when it
   * arrives, which is why `ttsEngine` defaults to `auto` — the reader never has
   * to wait for the answer to start listening.
   */
  private async probeHttpTts(): Promise<void> {
    try {
      const capabilities = await this.options.api.ttsCapabilities();
      this.httpTtsAvailable = capabilities?.http === true;
    } catch {
      this.httpTtsAvailable = false;
    }
    // Re-rendered either way: the answer decides whether the engine picker
    // appears at all, and a panel built before the probe would be missing the row
    // that the reader is looking for. (The old code rebuilt only the speech group
    // by hand to avoid losing the panel's scroll position — a diff does that for
    // free, and the reader's scroll position survives because nothing is
    // replaced.)
    this.patch({});
  }

  /**
   * The contents panel.
   *
   * Fetched from `/toc` rather than read off the manifest, because the manifest
   * is windowed and a table of contents assembled from one window lists exactly
   * that window — a 1200-chapter book showed "第 1 章 – 第 40 章". The server
   * keeps the two apart on purpose (see docs/api.md); this is the client half of
   * that arrangement.
   *
   * A book whose TOC cannot be fetched falls back to the window's own labels,
   * which is worse but not useless, and never leaves the panel empty when the
   * book does have chapters.
   */
  private async renderToc(): Promise<void> {
    const book = this.book;
    if (!book) return;
    // Fetched once per book. The panel is opened and closed constantly and the
    // TOC cannot change under a reader, so refetching it is a request per tap on
    // the ☰ button — which, on a NAS over a tunnel, is a visible pause before the
    // panel appears.
    if (this.chrome.toc.length > 0) return;

    let entries: ChromeTocEntry[] = [];
    if (book.format === 'chapters' && this.content) {
      entries = this.content.items.map((item) => ({ id: item.href, label: item.title, depth: 0, spine: item.seq }));
      this.patch({ toc: entries });
      return;
    }
    try {
      const toc = await this.options.api.toc(book.id);
      entries = toc.map((entry) => ({
        id: entry.href,
        label: entry.title,
        depth: entry.level,
        ...(entry.spine !== undefined ? { spine: entry.spine } : {}),
      }));
    } catch {
      entries = this.view?.chapterLabels() ?? [];
    }
    if (entries.length === 0) entries = this.view?.chapterLabels() ?? [];
    this.patch({ toc: entries });
  }

  /**
   * Marks the contents entry the reader is in, and points the window's own
   * labels at their whole-book position.
   *
   * The TOC and the loaded window carry different identifiers — one is the
   * server's chapter reference, the other the window's — so "which entry is
   * current" cannot be answered by comparing them, and `chapterLabels()` (built
   * from the window) has no `spine` at all. Both are resolved here, against the
   * loaded window, once per chapter change rather than once per entry in a
   * 1200-row list.
   */
  private syncTocPosition(): void {
    const view = this.view;
    const doc = this.doc;
    if (!view || !doc) return;
    const local = view.currentSectionIndex();
    const spine = view.windowIndexOfRef(view.sectionIdAt(local) ?? '') ?? local;
    const item = this.content?.items[local];
    // A window the client built itself (no manifest `content`) has no items to
    // read a reference off, and the section id is then the reference.
    const currentRef = item?.href ?? doc.sections[local]?.id ?? '';

    const toc = this.chrome.toc.map((entry) =>
      entry.spine === undefined && entry.id === currentRef ? { ...entry, spine } : entry,
    );
    if (toc.some((entry, index) => entry.spine !== this.chrome.toc[index]?.spine)) {
      this.patch({ toc });
      return;
    }
    if (currentRef !== this.chrome.currentSectionId) this.patch({ currentSectionId: currentRef });
  }

  /**
   * Jump to a contents entry, loading the window that holds it when necessary.
   *
   * A chapter inside the loaded window is a local index change; one outside it
   * means fetching that window first. Without the second half, tapping chapter
   * 900 of a 1200-chapter book does nothing at all, which is how a windowed
   * reader turns from fast into broken.
   *
   * Three things here were wrong and are the reason the 目录 felt dead:
   *
   *  - `openLocator` was awaited *after* being called for its boolean, so every
   *    tap rendered the chapter twice. On a large chapter that is two full
   *    document injections per tap, and the second one lands after the panel has
   *    closed, so the reader sees a flash and no movement.
   *  - The window fallback asked the *view* to swap windows through a method the
   *    document never had (see `adoptWindow`), so a jump outside the window was a
   *    silent no-op. It now goes through `view.loadWindow`, which owns the swap
   *    and the landing together.
   *  - The old code needed the TOC's `spine`, and a TOC entry without one (a
   *    comic whose chapter is a page, a format that only has items) returned
   *    without a word. It is derived from the loaded window's own `seq` instead.
   */
  private async goToChapterRef(ref: string): Promise<void> {
    const view = this.view;
    if (!view || this.navigating || this.chrome.refreshing) return;
    const book = this.book;
    if (!book) return;

    const local = view.indexOfSection(ref);

    // The overwhelmingly common case: the chapter is one the window already
    // holds. No network, no window, no second render.
    if (local >= 0) {
      try { await view.open(local, 0); } catch (error) { this.handleLoadError(error); }
      return;
    }
    if (!this.content) return;

    this.navigating = true;
    this.patch({ navigating: true });
    this.setStatus('loading', '正在跳到这一章…');
    try {
      const spine = view.windowIndexOfRef(ref) ?? this.tocSpineFor(ref);
      if (spine === null) {
        // A chapter the server's windowing cannot address at all — an image
        // whose reference names a page rather than a position. Saying so is the
        // whole fix: the old code was silent here, and silence is what a reader
        // reports as "点击章节没有反应".
        this.flashStatus('这一章暂时无法跳转', 2600);
        return;
      }
      const group = windowIndexOf(this.content ?? this.windowShape(), spine);
      const content = await this.options.api.items(book.id, group);
      const landed = await view.loadWindow(content, spine);
      if (!landed) this.flashStatus('这一章暂时无法跳转', 2600);
      else this.hideStatus();
    } catch {
      this.flashStatus('无法跳到这一章', 2600);
      this.setStatus('error', '无法跳到这一章');
    } finally {
      this.navigating = false;
      this.patch({ navigating: false });
    }
  }

  /**
   * A minimal group list, for a book whose manifest carried no windowed content.
   *
   * Only reached by the fallback path of a server old enough to answer a manifest
   * without `content`; the client then reads the file whole and never jumps
   * between windows, so this exists to keep the arithmetic total rather than to
   * be used. Sizing it from the loaded document is what makes the arithmetic
   * right in the one case it can be reached: sections are chapters there.
   */
  private windowShape(): BookContent {
    const count = this.doc?.sections.length ?? 0;
    return {
      kind: 'reflowable',
      total: count,
      groups: count > 0 ? [{ id: 'chapters', seq: 0, title: '章节', count, offset: 0 }] : [],
      items: [],
    };
  }

  /** Whole-book index of a contents entry, from the fetched table of contents. */
  private tocSpineFor(ref: string): number | null {
    const entry = this.chrome.toc.find((candidate) => candidate.id === ref);
    return entry?.spine ?? null;
  }

  /**
   * Jumps to a page in the current chapter, from the footer's scrubber.
   *
   * The slider is `input[type=range]`, which fires on every pixel of a drag, so
   * this is deliberately the *cheap* path: `seekPageInChapter` moves the reader
   * inside the chapter already open, and the view's own position reporting feeds
   * the numbers back through the same `onPosition` every other movement uses.
   * There is no separate "scrubbing" state to get out of sync with — the reader
   * drags, the page follows, and letting go leaves them where they let go.
   *
   * A page, not a whole-book fraction: the readout beside the thumb and the
   * positions the page turns land on are both pages *of this chapter*, and only a
   * slider in the same unit stays in agreement with them. Reaching this control
   * also no longer crosses a chapter boundary — a drag cannot silently navigate —
   * because a slider whose thumb sits at 3% while the reader watches the book
   * jump from chapter 40 to chapter 400 is a slider that answers a question
   * nobody asked.
   *
   * Position writes are untouched on purpose: `onPosition` already debounces the
   * network write by 1.5s, so a drag does not produce a request per frame.
   */
  private async scrubToPage(page: number): Promise<void> {
    if (this.chrome.refreshing) return;
    const view = this.view;
    if (!view) return;
    await view.seekPageInChapter(page - 1);
    // The drag can end between two scroll events, and a book with no reported
    // position after the seek would leave the bar showing the pre-drag value.
    this.pendingPosition = view.position();
    this.onPosition(view.position());
  }

  /**
   * Steps one chapter at a time, the way the footer's ‹ / › buttons do.
   *
   * A chapter, not a page: the two controls answer different questions ("next
   * screen" is the tap zone and the swipe, "next chapter" is this), and the one
   * this exists for is the one a reader wants at the end of a chapter — the
   * point where a page turn lands them on the next chapter's first page anyway,
   * but only after a variable number of taps.
   */
  private async goToChapter(delta: 1 | -1): Promise<void> {
    const view = this.view;
    if (!view || this.navigating || this.chrome.refreshing) return;
    // The *whole-book* position, not the window-local index: `sectionCount` is
    // the loaded window's length (forty chapters, or one comic volume), so a
    // reader at the last chapter of a window would be told "已经是最后一章" while
    // eighty chapters remained. The window's length is a transport detail and
    // has no business deciding where the book ends.
    const target = view.currentChapterPosition + delta;
    if (target < 0) {
      this.flashStatus('已经是第一章', 1800);
      return;
    }
    if (this.chapterCount > 0 && target >= this.chapterCount) {
      this.flashStatus('已经是最后一章', 1800);
      return;
    }
    // A chapter inside the loaded window is the only case this can resolve on
    // its own; one past the window's end has to fetch, and that is exactly what
    // `goToSection` does — window included, because a chapter at the boundary is
    // in the next window on one side and this one on the other.
    await this.goToSection(target);
  }

  /**
   * How many chapters the book has, from the manifest's own total.
   *
   * Not `view.sectionCount`: that is the window. A manifest with no `total` (an
   * old server) reports the window's length, which makes the › button stop at the
   * window's end rather than at the book's — the old behaviour, and the honest one
   * when the client genuinely does not know.
   */
  private get chapterCount(): number {
    return this.manifest?.total ?? this.doc?.sections.length ?? 0;
  }

  /**
   * Opens a section by whole-book position, fetching its window when it is not
   * the one loaded.
   *
   * The position is resolved through the *window's own* `seq`, never through the
   * client's idea of the window size: a comic windows by volume, and forty is a
   * chapter count, not a volume.
   */
  private async goToSection(spine: number): Promise<void> {
    const view = this.view;
    const book = this.book;
    if (!view || !book) return;
    // The local index of a whole-book position, when the loaded window holds it.
    // Resolved by arithmetic against the window's offset rather than by looking a
    // reference up: a section id is the server's, and a whole-book position is
    // not one — the two meet only through the window's own offset.
    const local = spine - view.windowOffset;
    if (local >= 0 && local < view.sectionCount) {
      try { await view.open(local, 0); } catch (error) { this.handleLoadError(error); }
      return;
    }
    this.navigating = true;
    this.patch({ navigating: true });
    this.setStatus('loading', '正在切换章节…');
    try {
      const content = await this.options.api.items(book.id, windowIndexOf(this.content ?? this.windowShape(), spine));
      const landed = await view.loadWindow(content, spine);
      if (landed) {
        // The loaded window is a new set of sections; the *shape* does not change
        // (the server's group list is complete in every response), but its own
        // group marker does, and a later jump computes its target from it.
        this.content = content;
        this.hideStatus();
      } else {
        this.flashStatus('这一章暂时无法跳转', 2600);
      }
    } catch {
      this.flashStatus('无法切换章节', 2600);
    } finally {
      this.navigating = false;
      this.patch({ navigating: false });
    }
  }

  private async updateSetting(patch: Partial<AppSettings>): Promise<void> {
    this.options.onSettingsChange(patch);
    Object.assign(this.settings, patch);
    // Reading information changes only the chrome, never the book's pagination.
    if (Object.keys(patch).some(key => !READOUT_FIELDS.some(field => field.key === key))) {
      this.view?.applySettings(this.viewSettings());
    }
    this.patch({});
    // Fixed-layout fit and direction changes are structural, so the current page
    // has to be re-rendered rather than merely re-styled.
    if (this.doc?.layout === 'fixed' && ('fit' in patch || 'comicDirection' in patch)) {
      const index = this.view?.currentSectionIndex() ?? 0;
      await this.view?.open(index, 0);
    }
  }

  // ---- read aloud ----

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
    if (!engine) {
      this.flashStatus('当前环境没有可用的朗读引擎', 2600);
      return;
    }
    this.patch({ tts: { ...this.chrome.tts, active: true } });
    this.spokenSectionIndex = view.currentSectionIndex();
    const chunks = this.rememberSpeechChunks(view);
    if (chunks.length === 0) {
      // A fixed-layout page has no text; say so instead of showing an empty bar.
      this.flashStatus('这一页没有可朗读的文字', 2400);
      this.patch({ tts: { ...this.chrome.tts, active: false } });
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

  /**
   * The engine that will speak, built on first use.
   *
   * `auto` resolves against what this host actually has, in the order
   * `speechAvailability` documents: the native engine (an Android shell), then
   * the WebView's own synthesizer, then HTTP. A pinned choice is honoured when it
   * exists and falls back silently when it does not — a reader who chose "HTTP
   * 朗读" on a server that has since lost its `TTS_URL` should still be able to
   * listen rather than be told their preference is invalid.
   */
  private ensureTts(): SpeechEngine | null {
    if (this.tts) return this.tts;
    const availability = this.speechAvailability();
    const requested = this.settings.ttsEngine;
    const kind: Exclude<SpeechEngineKind, 'auto'> | null =
      requested === 'auto' ? availability.preferred : availability[requested] ? requested : availability.preferred;
    if (!kind) return null;

    const engine = createSpeechEngine({
      kind,
      baseUrl: this.options.api.baseUrl,
      accessToken: () => this.options.api.currentSession()?.accessToken ?? null,
      nativeBridge: this.options.speechBridge ?? null,
      onError: (message) => this.flashStatus(message, 3200),
    });
    if (!engine) return null;

    engine.loadQueue = (from) => this.loadSpeechQueue(from);
    engine.onChunk = (chunk) => {
      this.view?.highlightSpokenChunk(chunk);
      this.speechCursor = chunk;
    };
    // The HTTP adapter holds the queue the engine is speaking from, so it can map
    // an engine index back to the sentence the reader can see — the two differ
    // when a long sentence had to be split. Only the screen layer knows the list,
    // which is why it is handed over rather than duplicated.
    if (engine.kind === 'http' && 'chunkSource' in engine) {
      (engine as { chunkSource: () => SpokenChunk[] }).chunkSource = () => this.lastSpeechQueue;
    }
    engine.onState = (snapshot) => this.renderSpeechState(snapshot);
    engine.setRate(this.settings.ttsRate);
    engine.setPitch(this.settings.ttsPitch);
    engine.setVolume(this.settings.ttsVolume);
    engine.setVoice(this.settings.ttsVoice);
    this.tts = engine;
    return engine;
  }

  /** The sentence last handed to the engine, so `previous` can step back from it. */
  private speechCursor: SpokenChunk | null = null;

  /** What this host can speak with. */
  private speechAvailability(): ReturnType<typeof speechAvailability> {
    return speechAvailability({
      systemSupported: TtsEngine.isSupported(),
      nativeBridge: this.options.speechBridge ?? null,
      httpConfigured: this.httpTtsAvailable,
    });
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
    let chunks = this.rememberSpeechChunks(view);
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
    chunks = this.rememberSpeechChunks(view);
    return { chunks, startIndex: 0 };
  }

  /**
   * Caches the chapter's sentence list and trims it for the engine in use.
   *
   * The trim is what makes the HTTP engine work at all: the server refuses an
   * utterance over 800 characters, and a TXT chapter with no punctuation in it
   * produces exactly one of those. Splitting a long sentence into ≤700-character
   * pieces *for the engine only* keeps the highlight anchored to the original
   * chunk, because `speechQueue` still holds the untrimmed list and the index
   * arithmetic is done against that.
   */
  private rememberSpeechChunks(view: ReaderView): SpokenChunk[] {
    const chunks = view.speechChunks as SpokenChunk[];
    this.lastSpeechQueue = chunks;
    if (this.tts?.kind !== 'http') return chunks;
    const max = 700;
    const trimmed: SpokenChunk[] = [];
    for (const chunk of chunks) {
      if (chunk.text.length <= max) {
        trimmed.push(chunk);
        continue;
      }
      for (let offset = 0; offset < chunk.text.length; offset += max) {
        trimmed.push({ ...chunk, text: chunk.text.slice(offset, offset + max), start: chunk.start + offset });
      }
    }
    return trimmed;
  }

  private toggleSpeech(): void {
    const engine = this.ensureTts();
    if (!engine) {
      this.flashStatus('当前环境没有可用的朗读引擎', 2600);
      return;
    }
    if (engine.active) {
      if (this.chrome.tts.state === 'playing') engine.pause();
      else engine.resume();
      return;
    }
    void this.speakFromReaderPosition();
  }

  private stopSpeech(): void {
    this.tts?.stop();
    this.patch({ tts: { ...this.chrome.tts, active: false, state: 'idle' } });
    this.view?.clearSpeechHighlight();
  }

  /**
   * The index of the sentence being spoken, on the *untrimmed* queue.
   *
   * The engine may be speaking a fragment of a long sentence (see
   * `rememberSpeechChunks`), and the reader's idea of "the current sentence" is
   * the whole one. Mapping back through the original chunk is what makes the
   * progress bar's denominator match the highlight.
   */
  private speechQueueIndex(): number {
    const chunk = this.speechCursor;
    if (!chunk) return -1;
    // Searched on the engine's fragment list, because that is the list the index
    // refers to; the fragment for a split sentence carries the original sentence's
    // `start`, so identity comparison against the engine's own list is exact.
    return this.lastSpeechQueue.indexOf(chunk);
  }

  private onSpeechScrub(index: number): void {
    const engine = this.tts;
    if (!engine) return;
    const total = engine.snapshot.total;
    // The engine's queue is the one being spoken, so the jump is by its index;
    // the two only differ when a sentence had to be split for the HTTP engine.
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
      this.patch({ tts: { ...this.chrome.tts, active: false, state: snapshot.state } });
      return;
    }
    // The bar follows the *engine*, not the chrome: a reader listening while
    // walking wants the controls reachable without the header covering the text.
    const active = snapshot.state === 'playing' || snapshot.state === 'paused';
    // The scrub range is expressed in *sentences*, not in engine fragments, so a
    // chapter with a 2000-character paragraph still shows one tick for it.
    const sentenceIndex = this.speechQueueIndex();
    this.patch({
      tts: {
        active,
        state: snapshot.state,
        label: snapshot.chunk || (snapshot.error ? snapshot.error : '准备朗读…'),
        chip: snapshot.total > 0 ? `${snapshot.index + 1}/${snapshot.total}` : '从头朗读',
        index: snapshot.index,
        total: snapshot.total,
        sentenceIndex,
        sentenceTotal: this.lastSpeechQueue.length || snapshot.total,
      },
    });
    if (snapshot.error) this.flashStatus(snapshot.error, 3200);
  }

  private updateSpeechSetting(patch: Partial<AppSettings>): void {
    Object.assign(this.settings, patch);
    this.options.onSettingsChange(patch);
    this.patch({});
    const engine = this.tts;
    if (!engine) return;
    if (patch.ttsRate !== undefined) engine.setRate(patch.ttsRate);
    if (patch.ttsPitch !== undefined) engine.setPitch(patch.ttsPitch);
    if (patch.ttsVolume !== undefined) engine.setVolume(patch.ttsVolume);
    if (patch.ttsVoice !== undefined) engine.setVoice(patch.ttsVoice);
  }

  /**
   * Switches engines, discarding whatever the old one was saying.
   *
   * Stopping first is not optional: an `Audio` element and `speechSynthesis` will
   * both happily keep talking, and two engines reading the same chapter in
   * different voices is the kind of bug that is reported as "朗读疯了".
   */
  private switchSpeechEngine(kind: AppSettings['ttsEngine']): void {
    this.tts?.dispose();
    this.tts = null;
    this.view?.clearSpeechHighlight();
    void this.updateSpeechSetting({ ttsEngine: kind });
    this.patch({ tts: { ...this.chrome.tts, active: false, state: 'idle' } });
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
    if (!view) return;
    // The engine owns the cursor once it is running; re-anchoring then would make
    // "read from here" jump to wherever the reader last scrolled.
    if (this.tts?.active) return;
    this.pendingSpeechAnchor = view.speechAnchor();
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
      } else if (this.chrome.statusState !== 'loading') {
        this.hideStatus();
      }
    };
    this.listeners.push(this.options.sync.onStatus(update));
    update();
  }

  /** A status line that clears itself, for messages with no lasting state. */
  private flashStatus(text: string, after = 1600): void {
    this.setStatus('idle', text);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.hideStatus(), after);
  }

  private setStatus(state: string, text: string): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.patch({ statusState: state, statusText: text });
  }

  /**
   * Clears the status line.
   *
   * No guard on `loading`, and the absence is the fix. The old version refused to
   * clear while the state was `loading` — meaning to protect a "正在载入…" line from
   * an unrelated event — and the effect was a line that could *never* be dismissed:
   * every path that would have cleared it was itself the thing the guard rejected,
   * so opening a book left "正在载入…" floating over the text for the rest of the
   * session. A guard that disables the only way out is not a guard.
   *
   * The protection it was reaching for is real, and it belongs at the *call sites*:
   * a finished load clears its own loading line (see `open`), and a later message
   * simply replaces it. `setStatus` and `flashStatus` both overwrite unconditionally,
   * which is the behaviour a status line wants.
   */
  private hideStatus(): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.patch({ statusState: 'idle', statusText: '' });
  }

  private handleLoadError(err: unknown): void {
    if (err instanceof ApiError) {
      if (err.isAuthFailure) {
        this.options.onSignedOut();
        return;
      }
      if (err.isConnectivity) {
        this.setStatus('offline', this.book?.format === 'chapters'
          ? '这一章尚未缓存，连上服务端后可读'
          : '这本书还没有下载，连上服务端后可读');
        return;
      }
      this.setStatus('error', err.message);
      return;
    }
    this.setStatus('error', err instanceof Error ? err.message : '无法打开这本书');
  }

  // ---- chrome state plumbing ----

  /**
   * Publishes one change to the chrome.
   *
   * The settings rows are folded in on every patch rather than being kept in
   * `chrome` by hand: the panel is a projection of `this.settings` (plus what the
   * host can do and what the open book is), and computing it here is what stops a
   * row from showing a value the reader has already changed.
   */
  private patch(patch: Partial<ChromeState>): void {
    this.chrome = {
      ...this.chrome,
      ...patch,
      ...settingsView(this.settings, {
        layout: this.doc?.layout ?? 'reflowable',
        format: this.doc?.format ?? '',
        // The view already answered this question for the stylesheet; asking it the
        // same way here is what keeps the panel's rows and the page's typography
        // from disagreeing about what kind of book is open.
        plainText: this.view?.isPlainText() ?? this.doc?.format === 'txt',
        availability: this.speechAvailability(),
        engine: this.effectiveEngineKind(),
        voices: this.voices,
      }),
    };
    this.ui.update(this.chrome);
  }

  /** Which engine will actually speak, for the panel's conditional rows. */
  private effectiveEngineKind(): Exclude<SpeechEngineKind, 'auto'> | null {
    if (this.tts) return this.tts.kind;
    const availability = this.speechAvailability();
    const requested = this.settings.ttsEngine;
    if (requested !== 'auto' && availability[requested]) return requested;
    return availability.preferred;
  }
}

export type { SyncStatus };

/** A blank settings projection, so the initial chrome state is well-formed. */
function emptyChromeSettings(): Partial<ChromeState> {
  return settingsView(
    {
      mode: 'scroll',
      fontScale: 1,
      lineHeight: 'inherit',
      theme: 'light',
      fit: 'contain',
      direction: 'ltr',
      fontFamily: 'inherit',
      pageMargin: 1.5,
      textAlign: 'inherit',
      brightness: 1,
      pageAnimation: 'slide',
      tapZone: 'standard',
      txtIndent: 2,
      txtParagraphGap: 0.55,
      txtEncoding: '',
      comicDirection: 'ltr',
      ttsRate: 1,
      ttsPitch: 1,
      ttsVolume: 1,
      ttsVoice: '',
      ttsAutoAdvance: true,
      ttsEngine: 'auto',
      shelfDensity: 'cozy',
      shelfSort: 'recent',
      shelfShowAuthor: true,
      shelfShowProgress: true,
      readoutTopLeft: 'chapter',
      readoutTopRight: 'none',
      readoutBottomLeft: 'progress',
      readoutBottomRight: 'time',
    },
    { layout: 'reflowable', format: '', availability: { system: false, native: false, http: false, preferred: null }, engine: null, voices: [] },
  );
}

/**
 * The settings, projected into what the panel draws.
 *
 * A projection rather than the raw object because the panel's rows are not the
 * settings: a row exists only when it can do something (pitch has no meaning for
 * synthesised audio; a voice list is empty for HTTP until the server answers),
 * and the fit/direction rows only apply to a fixed-layout book. Deciding that
 * here means the panel is a pure function of its props, and the "filter the rows
 * after the fact" pass the old code needed is gone.
 */
function settingsView(
  settings: AppSettings,
  context: {
    layout: AppSettings['mode'] extends never ? never : string;
    format: string;
    /** True when the chapter on screen is the reader's plain-text rendition. */
    plainText?: boolean;
    availability: ReturnType<typeof speechAvailability>;
    engine: Exclude<SpeechEngineKind, 'auto'> | null;
    voices: Array<{ id: string; name: string; lang: string; default: boolean }>;
  },
): Partial<ChromeState> {
  const fixedLayout = context.layout === 'fixed';
  // Plain text, as *either* a declaration or an observation.
  //
  // `format: 'txt'` is the declarative answer and the common one. The observation is
  // for a server that windows a TXT as `reflowable`: the chapter it sends is still
  // the reader's own plain-text markup with a `txt-body` wrapper, and every one of
  // the 正文 rows applies to it exactly as it would to a book that announced itself.
  // Keying the rows on the declaration alone meant the reader could see unstyled
  // paragraphs and no way to adjust them.
  const isTxt = context.format === 'txt' || context.plainText === true;
  const activeEngine = context.engine ?? context.availability.preferred;
  return {
    mode: settings.mode,
    readoutTopLeft: settings.readoutTopLeft,
    readoutTopRight: settings.readoutTopRight,
    readoutBottomLeft: settings.readoutBottomLeft,
    readoutBottomRight: settings.readoutBottomRight,
    fontScale: settings.fontScale,
    lineHeight: settings.lineHeight,
    theme: settings.theme,
    fit: settings.fit,
    fontFamily: settings.fontFamily,
    pageMargin: settings.pageMargin,
    textAlign: settings.textAlign,
    brightness: settings.brightness,
    pageAnimation: settings.pageAnimation,
    tapZone: settings.tapZone,
    txtEncoding: settings.txtEncoding,
    txtIndent: settings.txtIndent,
    txtParagraphGap: settings.txtParagraphGap,
    comicDirection: settings.comicDirection,
    ttsRate: settings.ttsRate,
    ttsPitch: settings.ttsPitch,
    ttsVolume: settings.ttsVolume,
    ttsVoice: settings.ttsVoice,
    ttsAutoAdvance: settings.ttsAutoAdvance,
    ttsEngine: settings.ttsEngine,
    showFitRow: fixedLayout,
    showDirectionRow: fixedLayout,
    showEncodingRow: isTxt,
    showTxtRows: isTxt,
    engineOptions: enginePickerOptions(context.availability),
    showEngineRow:
      [context.availability.system, context.availability.native, context.availability.http].filter(Boolean).length > 1,
    showPitchRow: activeEngine !== 'http',
    showVoiceRow: activeEngine !== 'http',
    speechUnavailable: !context.availability.preferred,
    voices: [{ value: '', label: '跟随系统' }, ...context.voices.map((voice) => ({
      value: voice.id,
      label: `${voice.name} · ${voice.lang}${voice.default ? ' · 默认' : ''}`,
    }))],
  };
}

function enginePickerOptions(
  availability: ReturnType<typeof speechAvailability>,
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: 'auto', label: '自动' }];
  if (availability.native) options.push({ value: 'native', label: SPEECH_ENGINE_LABELS.native });
  if (availability.system) options.push({ value: 'system', label: SPEECH_ENGINE_LABELS.system });
  if (availability.http) options.push({ value: 'http', label: SPEECH_ENGINE_LABELS.http });
  return options;
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

/**
 * Copies bytes into a fresh ArrayBuffer.
 *
 * `Blob` will not take a `Uint8Array` view over a larger buffer, and a fetch
 * response's bytes are exactly that — passing the view directly would store the
 * whole response behind a section-sized slice.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * True when the reader has selected text inside the reading surface.
 *
 * Two selections have to be consulted, not one. The book's markup lives in a shadow
 * root, and a selection made inside it is reported by the *shadow root's* own
 * `getSelection` — `document.getSelection()` returns a selection whose nodes are
 * relative to the shadow tree's host, so `root.contains(anchor)` is false for a
 * sentence the reader has visibly highlighted, and the gesture layer then treats the
 * release of a long-press selection as a page turn. That is precisely how a reader
 * loses a selection they just made, on the way to copying it.
 */
function hasTextSelection(root: HTMLElement): boolean {
  if (selectionInside(root, window.getSelection())) return true;
  for (const host of root.querySelectorAll('*')) {
    const shadow = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (!shadow) continue;
    // `ShadowRoot.getSelection` exists in Chromium and WebKit, which is what the H5
    // build and the Android WebView both are; the structural check keeps this
    // honest on a host that lacks it rather than crashing the gesture layer.
    const getSelection = (shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
    if (typeof getSelection === 'function' && selectionInside(root, getSelection.call(shadow))) return true;
  }
  return false;
}

/** Whether a selection's node lives under `root`, or under a shadow root it owns. */
function selectionInside(root: HTMLElement, selection: Selection | null | undefined): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  if (!anchor) return false;
  if (root.contains(anchor)) return true;
  // A node inside a shadow root is not `contains`-reachable from the light DOM, so
  // the tree is walked the other way: up from the node to whichever root it belongs
  // to, then out to the host, until the reading surface is reached.
  let node: Node | null = anchor;
  while (node) {
    const parent: Node | null = node.parentNode;
    if (!parent) {
      const host = (node as ShadowRoot).host as HTMLElement | undefined;
      if (!host) return false;
      if (host === root || root.contains(host)) return true;
      node = host;
      continue;
    }
    if (parent === root) return true;
    node = parent;
  }
  return false;
}

export type { Note };
