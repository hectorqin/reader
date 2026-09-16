import type { BookDoc, Section } from '../formats/types.ts';
import { ResourceResolver, hydrateResources } from './resources.ts';
import { createBookHost, extractBody, extractInlineStyles, sanitiseInjectedContent, type BookShadowHost } from './shadow.ts';
import { bookPercentage, formatLocator, parseLocator } from './locator.ts';

export interface ReaderViewOptions {
  container: HTMLElement;
  doc: BookDoc;
  /** Called on every position change, throttled by the caller via the view. */
  onPositionChange?: (position: Position) => void;
  onChapterChange?: (index: number, section: Section) => void;
}

export interface Position {
  sectionIndex: number;
  sectionId: string;
  within: number;
  percentage: number;
  locator: string;
  chapterTitle: string;
}

export interface ViewSettings {
  /** 'scroll' keeps the author's continuous flow; 'paged' paginates by column. */
  mode: 'scroll' | 'paged';
  fontScale: number;
  lineHeight: string;
  theme: 'light' | 'sepia' | 'dark';
  /** Fixed-layout only. */
  fit: 'contain' | 'width';
  direction: 'ltr' | 'rtl';
}

const DEFAULT_SETTINGS: ViewSettings = {
  mode: 'scroll',
  fontScale: 1,
  lineHeight: 'inherit',
  theme: 'light',
  fit: 'contain',
  direction: 'ltr',
};

/**
 * Renders a `BookDoc` and owns everything about the current position.
 *
 * Split from the reader controller on purpose: this class knows about DOM,
 * layout and gestures and nothing about the network; the controller knows about
 * sync and history and nothing about CSS columns. The boundary is what lets the
 * same view be driven by the H5 app and by the Android shell without either one
 * duplicating layout logic.
 */
export class ReaderView {
  private readonly doc: BookDoc;
  private readonly container: HTMLElement;
  private readonly host: BookShadowHost;
  private readonly resolver: ResourceResolver;
  private settings: ViewSettings;
  private sectionIndex = 0;
  private sectionOffset = 0;
  private lastEmitted = '';
  private readonly options: ReaderViewOptions;
  private resizeObserver: ResizeObserver | null = null;
  private currentObjectUrl: string | null = null;

  constructor(options: ReaderViewOptions) {
    this.options = options;
    this.doc = options.doc;
    this.container = options.container;
    this.settings = { ...DEFAULT_SETTINGS, direction: options.doc.direction };
    this.host = createBookHost();
    this.host.setAttribute('data-layout', options.doc.layout);
    this.host.className = 'book-host';
    this.resolver = new ResourceResolver(options.doc.resources);
    this.container.append(this.host);
    this.applySettings();
  }

  get settingsSnapshot(): ViewSettings {
    return { ...this.settings };
  }

  get sectionCount(): number {
    return this.doc.sections.length;
  }

  currentSectionIndex(): number {
    return this.sectionIndex;
  }

  chapterLabels(): Array<{ id: string; label: string; depth: number }> {
    return this.doc.toc;
  }

  applySettings(next?: Partial<ViewSettings>): void {
    if (next) this.settings = { ...this.settings, ...next };
    document.documentElement.dataset['theme'] = this.settings.theme;
    this.host.setAttribute('data-paginated', String(this.settings.mode === 'paged'));
    this.container.style.setProperty('--reader-font-scale', String(this.settings.fontScale));
    // `inherit` is what keeps the author's line-height; only an explicit user
    // choice replaces it.
    this.container.style.setProperty('--reader-line-height', this.settings.lineHeight);
    this.host.style.direction = this.settings.direction;
    // Toggling pagination changes the column count, so the stored offset has to
    // be re-applied after the browser has laid out the new column box.
    requestAnimationFrame(() => this.restoreOffset());
  }

  /** Opens a section by index, optionally at a fractional offset within it. */
  async open(index: number, offset = 0): Promise<void> {
    const section = this.doc.sections[index];
    if (!section) return;
    this.sectionIndex = index;
    this.sectionOffset = Math.min(1, Math.max(0, offset));
    this.releaseObjectUrl();

    if (this.doc.layout === 'fixed') {
      await this.renderFixed(section);
    } else {
      await this.renderReflowable(section);
    }
    this.options.onChapterChange?.(index, section);
    this.restoreOffset();
    this.emitPosition();
    this.attachResizeObserver();
  }

  /** Resumes at a locator produced by `position()`, tolerating an unknown one. */
  async openLocator(locator: string): Promise<boolean> {
    const parsed = parseLocator(locator, this.doc);
    if (!parsed) return false;
    const index = this.doc.sections.findIndex((section) => section.id === parsed.sectionId);
    if (index === -1) return false;
    await this.open(index, parsed.offset);
    return true;
  }

  position(): Position {
    const section = this.doc.sections[this.sectionIndex];
    const within = this.measureWithin();
    return {
      sectionIndex: this.sectionIndex,
      sectionId: section?.id ?? '',
      within,
      percentage: bookPercentage(this.doc, this.sectionIndex, within),
      locator: formatLocator(section?.id ?? '', within),
      chapterTitle: section?.label ?? '',
    };
  }

  /** Advances one unit: a page when paged, a screenful when scrolling. */
  async next(): Promise<boolean> {
    if (this.doc.layout === 'fixed') return this.stepFixed(1);
    if (this.settings.mode === 'paged') {
      const advanced = this.stepColumn(1);
      if (advanced) return true;
      return this.stepSection(1);
    }
    const flow = this.host.flow;
    const limit = flow.scrollHeight - flow.clientHeight;
    if (flow.scrollTop < limit - 8) {
      flow.scrollTop = Math.min(limit, flow.scrollTop + flow.clientHeight * 0.9);
      return true;
    }
    return this.stepSection(1);
  }

  async previous(): Promise<boolean> {
    if (this.doc.layout === 'fixed') return this.stepFixed(-1);
    if (this.settings.mode === 'paged') {
      const moved = this.stepColumn(-1);
      if (moved) return true;
      return this.stepSection(-1, true);
    }
    const flow = this.host.flow;
    if (flow.scrollTop > 8) {
      flow.scrollTop = Math.max(0, flow.scrollTop - flow.clientHeight * 0.9);
      return true;
    }
    return this.stepSection(-1, true);
  }

  /** Jumps to a fraction of the whole book, used by the progress slider. */
  async seekPercentage(percentage: number): Promise<void> {
    const clamped = Math.min(1, Math.max(0, percentage));
    const index = Math.min(
      this.doc.sections.length - 1,
      Math.floor(clamped * this.doc.sections.length),
    );
    const remainder = clamped * this.doc.sections.length - index;
    await this.open(index, remainder);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.releaseObjectUrl();
    this.resolver.dispose();
    this.host.remove();
  }

  // ---- rendering per layout ----

  private async renderReflowable(section: Section): Promise<void> {
    const raw = section.html ?? '';
    const body = extractBody(raw);
    const inlineStyles = extractInlineStyles(raw);
    // The chapter's own <style> blocks are prepended so the book's link-level
    // stylesheets (already in `doc.styles`) can still override them, matching
    // the cascade the book was authored against.
    this.host.setContent(body, [...inlineStyles, ...this.doc.styles]);
    sanitiseInjectedContent(this.host.shadow);
    await hydrateResources(this.host.shadow, this.resolver);
    // Images load asynchronously and change the flow height, which invalidates
    // any offset measured before they arrive.
    this.waitForImages().then(() => {
      this.restoreOffset();
      this.emitPosition();
    });
  }

  private async renderFixed(section: Section): Promise<void> {
    const wrapper = document.createElement('div');
    wrapper.className = 'fixed-page';
    wrapper.setAttribute('data-fit', this.settings.fit);

    if (section.image) {
      const url = this.objectUrl(section.image.bytes, section.image.mediaType);
      const img = document.createElement('img');
      img.src = url;
      img.alt = section.label;
      // The page must be decodable before it is shown, otherwise the reader
      // sees a blank screen for a beat on every turn of a large scan.
      img.decoding = 'async';
      img.draggable = false;
      wrapper.append(img);
    } else if (section.html) {
      const frame = document.createElement('iframe');
      frame.className = 'pdf-frame';
      frame.setAttribute('title', section.label);
      wrapper.append(frame);
      // The PDF viewer owns its own rendering; the reader only supplies bytes.
      queueMicrotask(() => {
        frame.srcdoc = section.html ?? '';
      });
    }

    this.host.setContent('', []);
    this.host.flow.replaceChildren(wrapper);
  }

  // ---- position measurement ----

  /**
   * Fraction scrolled inside the current section.
   *
   * Measured against the section's own scroll extent, never against absolute
   * document pixels, so the value is portable across screen sizes.
   */
  private measureWithin(): number {
    // Fixed layout has no sub-section position: a comic page is atomic, so the
    // position is entirely expressed by the section index.
    if (this.doc.layout === 'fixed') return 0;
    const flow = this.host.flow;
    if (this.settings.mode === 'paged') {
      const width = flow.scrollWidth;
      if (width <= 0) return this.sectionOffset;
      return Math.min(1, Math.max(0, flow.scrollLeft / Math.max(1, width - flow.clientWidth)));
    }
    const limit = flow.scrollHeight - flow.clientHeight;
    if (limit <= 0) return 0;
    return Math.min(1, Math.max(0, flow.scrollTop / limit));
  }

  private restoreOffset(): void {
    const flow = this.host.flow;
    if (this.doc.layout === 'fixed') return;
    if (this.settings.mode === 'paged') {
      const max = Math.max(0, flow.scrollWidth - flow.clientWidth);
      flow.scrollLeft = max * this.sectionOffset;
      return;
    }
    const limit = Math.max(0, flow.scrollHeight - flow.clientHeight);
    flow.scrollTop = limit * this.sectionOffset;
  }

  private emitPosition(): void {
    const position = this.position();
    // Scroll events fire per frame; only report when the position meaningfully
    // moved, so a lazy reader does not generate a sync write every frame.
    const key = `${position.sectionId}:${position.within.toFixed(3)}`;
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.options.onPositionChange?.(position);
  }

  /**
   * Re-anchors the position when the viewport changes.
   *
   * Without this, rotating the device or opening the on-screen keyboard leaves
   * the reader at a scroll offset measured against the old column height, which
   * lands them a page or two away from where they were.
   */
  private attachResizeObserver(): void {
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.restoreOffset());
    this.resizeObserver.observe(this.host.flow);
  }

  private async stepFixed(delta: number): Promise<boolean> {
    const next = this.sectionIndex + delta;
    if (next < 0 || next >= this.doc.sections.length) return false;
    await this.open(next, 0);
    return true;
  }

  private stepSection(delta: number, toEnd = false): boolean {
    const next = this.sectionIndex + delta;
    if (next < 0 || next >= this.doc.sections.length) return false;
    void this.open(next, toEnd ? 1 : 0);
    return true;
  }

  /** Moves by one CSS column, which is one screen in paged mode. */
  private stepColumn(delta: number): boolean {
    const flow = this.host.flow;
    const step = Math.max(1, flow.clientWidth);
    const max = Math.max(0, flow.scrollWidth - flow.clientWidth);
    const target = flow.scrollLeft + step * delta;
    if (target < -1 || target > max + 1) return false;
    flow.scrollLeft = Math.min(max, Math.max(0, target));
    this.emitPosition();
    return true;
  }

  private objectUrl(bytes: Uint8Array, mediaType: string): string {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: mediaType }));
    this.currentObjectUrl = url;
    return url;
  }

  private releaseObjectUrl(): void {
    if (!this.currentObjectUrl) return;
    try {
      URL.revokeObjectURL(this.currentObjectUrl);
    } catch {
      // Already revoked.
    }
    this.currentObjectUrl = null;
  }

  private async waitForImages(): Promise<void> {
    const images = [...this.host.shadow.querySelectorAll('img')];
    if (images.length === 0) return;
    await Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            // Bounded: a book referencing a missing asset must not stall the
            // position restore forever.
            const timer = setTimeout(resolve, 3000);
            img.addEventListener('load', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
            img.addEventListener('error', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          }),
      ),
    );
  }
}
