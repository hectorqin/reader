import type { BookDoc, Section, StagedBook } from '../formats/types.ts';
import type { BookContent } from '../net/api.ts';
import type { NativePageHost } from './native-page.ts';
import { ResourceResolver, hydrateResources } from './resources.ts';
import { createBookHost, extractBody, extractInlineStyles, sanitiseInjectedContent, type BookShadowHost } from './shadow.ts';
import { bookPercentage, formatLocator, parseLocator } from './locator.ts';
import { collectSpokenChunks, type SpokenChunk } from '../render/tts-text.ts';
import { adoptWindow } from '../formats/windowed.ts';

export interface ReaderViewOptions {
  container: HTMLElement;
  doc: BookDoc;
  /** Called on every position change, throttled by the caller via the view. */
  onPositionChange?: (position: Position) => void;
  onChapterChange?: (index: number, section: Section) => void;
  /**
   * Native renderer for fixed-layout pages, when the host has one.
   *
   * Absent in a browser, where the WebView *is* the only renderer. Present on
   * Android, where a comic page or a PDF is better drawn by the platform. The
   * view does not care which: it asks the host to draw a section and falls back
   * to its own DOM path whenever the host declines.
   */
  pageHost?: NativePageHost;
}

export interface Position {
  sectionIndex: number;
  sectionId: string;
  within: number;
  percentage: number;
  locator: string;
  chapterTitle: string;
  /**
   * Which page of the current chapter this is, 1-based.
   *
   * Reported as part of the position rather than measured by the caller because
   * "where am I inside this chapter" is the same measurement `within` already is
   * — one `scrollLeft` read in paged mode, one `scrollHeight` read in scroll
   * mode — and a footer that showed a page number by asking separately would be
   * a second measurement of the same thing, taken at a different moment, and
   * therefore able to disagree with the progress bar beside it.
   */
  pageInChapter: number;
  chapterPages: number;
  /** Whole-book index of the section, window offset included. */
  chapterPosition: number;
}

export type TextAlign = 'inherit' | 'start' | 'justify';
export type PageAnimation = 'none' | 'slide' | 'fade';
export type TapZone = 'standard' | 'reversed';

export interface ViewSettings {
  /** 'scroll' keeps the author's continuous flow; 'paged' paginates by column. */
  mode: 'scroll' | 'paged';
  fontScale: number;
  lineHeight: string;
  theme: 'light' | 'sepia' | 'dark';
  /** Fixed-layout only. */
  fit: 'contain' | 'width';
  direction: 'ltr' | 'rtl';
  /** A font stack offered before the book's own, for books that ship no stack. */
  fontFamily: string;
  /**
   * Horizontal padding inside the reading column, in rem.
   *
   * A number rather than a keyword because the useful range differs per device:
   * a phone wants 0.75rem to fit a sentence per line, a tablet wants 3rem to stop
   * the line becoming unreadably long.
   */
  pageMargin: number;
  /** `inherit` keeps whatever the book asked for. */
  textAlign: TextAlign;
  /** Darkens the page without changing the theme; for reading in bed. */
  brightness: number;
  pageAnimation: PageAnimation;
  /** Which side of the screen turns forward; handedness is a real preference. */
  tapZone: TapZone;
  /**
   * First-line indent for plain text, in em.
   *
   * A number rather than on/off because the useful values are a continuum: two
   * full-width characters is the Chinese convention, one is what a reader used to
   * Western books expects, and zero is what a reader who finds the indent noisy
   * wants. Only a TXT is affected — an EPUB's indent is the author's.
   */
  txtIndent: number;
  /**
   * Space between paragraphs of plain text, in em.
   *
   * The second half of the same question. With no indent, paragraph separation has
   * to come from spacing or the body becomes one undifferentiated block; with an
   * indent, a large gap reads as a scene break. The two controls together cover
   * both conventions, which is why they are separate.
   */
  txtParagraphGap: number;
}

const DEFAULT_SETTINGS: ViewSettings = {
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
  /** Set when the book is read a window at a time; see `loadWindow`. */
  private readonly staged: StagedBook | null;
  private settings: ViewSettings;
  private sectionIndex = 0;
  private sectionOffset = 0;
  private lastEmitted = '';
  private readonly options: ReaderViewOptions;
  private resizeObserver: ResizeObserver | null = null;
  private currentObjectUrl: string | null = null;
  private animationTimer: ReturnType<typeof setTimeout> | null = null;
  private spokenChunks: SpokenChunk[] = [];
  private speechHighlight: HTMLElement | null = null;

  constructor(options: ReaderViewOptions) {
    this.options = options;
    this.doc = options.doc;
    // Set by the reader screen once it has built a staged document; absent for a
    // book that is read whole.
    this.staged = (options.doc as BookDoc & { staged?: StagedBook }).staged ?? null;
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

  /**
   * The shadow host holding the book's content.
   *
   * Exposed for tests and for the host that wants to measure the reading
   * surface; the content itself stays inside the shadow root, which is the
   * point.
   */
  get elementHost(): BookShadowHost {
    return this.host;
  }

  get sectionCount(): number {
    return this.doc.sections.length;
  }

  currentSectionIndex(): number {
    return this.sectionIndex;
  }

  /**
   * The loaded window's own labels, as contents entries.
   *
   * The fallback for a book whose table of contents cannot be fetched: worse than
   * the server's list, because it names one window, and better than an empty
   * panel for a book that plainly has chapters.
   */
  chapterLabels(): Array<{ id: string; label: string; depth: number }> {
    return this.doc.sections.map((section) => ({
      id: section.id,
      label: section.label,
      depth: section.depth,
    }));
  }

  /** The identifier of the section at a local index, or null when out of range. */
  sectionIdAt(index: number): string | null {
    return this.doc.sections[index]?.id ?? null;
  }

  /**
   * The local index of a section by id, or -1 when the loaded window has none.
   *
   * The table of contents speaks in the server's references and the view speaks
   * in local indices, so every jump needs this translation. It is a linear scan
   * of at most one window — forty entries for an EPUB, one volume for a comic —
   * and it replaces the *wrong* way of doing the same thing, which was to build a
   * whole locator and ask `openLocator` to parse it back.
   */
  indexOfSection(id: string): number {
    if (!id) return -1;
    return this.doc.sections.findIndex((section) => section.id === id);
  }

  /**
   * The whole-book position of a section in the loaded window.
   *
   * Derived from the section's own index in this window plus the window's offset,
   * never from the client's idea of the window size: a comic windows by volume,
   * and a chapter count is not a volume count. Null when the window does not hold
   * the section.
   */
  windowIndexOfRef(id: string): number | null {
    const local = this.indexOfSection(id);
    if (local === -1) return null;
    return this.windowOffset + local;
  }

  /** Whole-book index of the loaded window's first section. */
  get windowOffset(): number {
    return this.staged?.windowOffset?.() ?? 0;
  }

  /**
   * Whole-book index of the chapter on screen.
   *
   * The unit the chapter buttons step in. `currentSectionIndex` is window-local
   * and must not be used for that: at the last chapter of a window it reads 39,
   * which the screen would compare against the window's length of 40 and call
   * "the last chapter" of a 120-chapter book.
   */
  get currentChapterPosition(): number {
    return this.windowOffset + this.sectionIndex;
  }

  applySettings(next?: Partial<ViewSettings>): void {
    const previous = this.settings;
    if (next) this.settings = { ...this.settings, ...next };
    document.documentElement.dataset['theme'] = this.settings.theme;
    this.host.setAttribute('data-paginated', String(this.settings.mode === 'paged'));
    this.container.style.setProperty('--reader-font-scale', String(this.settings.fontScale));
    // `inherit` is what keeps the author's line-height; only an explicit user
    // choice replaces it.
    this.container.style.setProperty('--reader-line-height', this.settings.lineHeight);
    // Same reasoning for the font stack: the default is `inherit`, so a book
    // that ships its own stack keeps it. The reader's choice is offered first so
    // a book that ships *nothing* looks like the rest of their library.
    this.container.style.setProperty('--reader-font-family', this.settings.fontFamily);
    this.container.style.setProperty('--reader-text-align', this.settings.textAlign);
    this.container.style.setProperty('--reader-page-margin', `${this.settings.pageMargin}rem`);
    this.container.style.setProperty('--reader-brightness', String(this.settings.brightness));
    // Written in `em` rather than `rem` on purpose: the indent is meant to be two
    // characters wide, and a character's width scales with the reader's font size,
    // so an indent in `rem` drifts away from the text as the reader enlarges it.
    this.container.style.setProperty('--reader-txt-indent', `${this.settings.txtIndent}em`);
    this.container.style.setProperty('--reader-txt-para-gap', `${this.settings.txtParagraphGap}em`);
    // Which typesheet applies is a property of the *book*, so it is set here rather
    // than in the render path: a chapter change and a settings change both land
    // here, and neither is a reason to state the format twice.
    this.host.setPlainText(this.doc.format === 'txt');
    this.host.style.direction = this.settings.direction;
    // Toggling pagination changes the column count, so the stored offset has to
    // be re-applied after the browser has laid out the new column box.
    requestAnimationFrame(() => this.restoreOffset());

    // A page turn is the only place an animation is wanted, and only the two
    // settings that change where a page *is* can start one.
    if (next && previous.mode !== this.settings.mode) this.animatePage('none');
  }

  /**
   * Flashes a page-turn animation.
   *
   * On the host rather than on the flow, because the flow's own transform would
   * fight the column layout in paged mode. `data-animating` is cleared by a
   * timer rather than by `animationend`: the same animation may be requested
   * twice in a row (a fast double tap), and `animationend` would then never fire
   * for the second one, leaving the host stuck in an animating state.
   */
  animatePage(direction: 'next' | 'previous' | 'none'): void {
    if (this.settings.pageAnimation === 'none' || direction === 'none') return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const value = `${this.settings.pageAnimation}-${direction}`;
    this.host.setAttribute('data-animating', value);
    if (this.animationTimer !== null) clearTimeout(this.animationTimer);
    this.animationTimer = setTimeout(() => {
      this.animationTimer = null;
      this.host.removeAttribute('data-animating');
    }, 220);
  }

  /**
   * Replace the loaded window of a staged book, and land on `spine`.
   *
   * A book read whole (the fallback when a server has no addressable structure)
   * never calls this, and answers false. So does a window that does not contain
   * `spine`, so a caller can report honestly rather than silently landing on the
   * wrong chapter.
   *
   * The swap and the landing are one operation rather than two calls from the
   * screen, because doing them apart is what allowed the bug this method's
   * comment in `windowed.ts` describes: the screen asked the document to swap
   * through a method that did not exist, got nothing, and then asked the view to
   * open a locator in the old window — which failed, silently, for a reader who
   * had just tapped a chapter in the 目录. Returns whether the reader is now
   * inside `spine`.
   */
  async loadWindow(content: BookContent, spine: number): Promise<boolean> {
    if (!this.staged) return false;
    const local = adoptWindow(this.doc, content, spine);
    if (local < 0) return false;
    // Landing on the chapter is part of swapping the window, not a second call
    // the caller has to remember. Swapping alone leaves the *old* chapter on
    // screen — the host's content is untouched, `currentSectionIndex` still
    // points into the previous window's sections, and the footer keeps naming
    // the chapter the reader just left. That is precisely the "点击章节没有反应"
    // report, one layer down.
    await this.open(local, 0);
    return true;
  }

  /**
   * The element that actually scrolls the chapter.
   *
   * Two different elements depending on the mode, and getting it wrong is silent:
   * a `scroll` event does not bubble, so a listener on the wrong one never fires;
   * `scrollTop` on the wrong one is always zero, so every measurement reads as
   * "the top of the chapter". In scroll mode the *host* scrolls and the column
   * inside it is simply taller than the viewport (`overflow-y: auto` on
   * `book-host`, which is where the reading position has to be read from). In
   * paged mode the host is `overflow: hidden` and the *column* is the horizontal
   * scroller that holds the columns.
   */
  get scroller(): HTMLElement {
    return this.settings.mode === 'paged' ? this.host.flow : this.host;
  }

  /** Opens a section by index, optionally at a fractional offset within it. */
  async open(index: number, offset = 0): Promise<void> {
    const section = this.doc.sections[index];
    if (!section) return;

    // A staged section has no body until it is asked for. Doing it here, rather
    // than in the loader, is what keeps "opening a book" and "showing a chapter"
    // from both needing to know about windows.
    if (this.staged) await this.staged.loadSection(index).catch(() => null);
    this.sectionIndex = index;
    this.sectionOffset = Math.min(1, Math.max(0, offset));
    this.releaseObjectUrl();

    if (this.doc.layout === 'fixed') {
      await this.renderFixed(section);
    } else {
      await this.renderReflowable(section);
    }
    this.options.onChapterChange?.(index, section);
    this.refreshSpokenChunks();
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
    const pages = this.chapterPaging();
    return {
      sectionIndex: this.sectionIndex,
      sectionId: section?.id ?? '',
      within,
      percentage: bookPercentage(this.doc, this.sectionIndex, within),
      locator: formatLocator(section?.id ?? '', within),
      chapterTitle: section?.label ?? '',
      pageInChapter: pages.current,
      chapterPages: pages.total,
      chapterPosition: this.windowOffset + this.sectionIndex,
    };
  }

  /**
   * The page the reader is on, and how many the chapter has.
   *
   * Both are derived from the same measurement the progress fraction uses, so
   * the two can never disagree. A fixed-layout section is atomic — one page —
   * and a chapter that fits the screen entirely is one page, which is why the
   * counts are clamped to at least one rather than reported as zero.
   */
  private chapterPaging(): { current: number; total: number } {
    if (this.doc.layout === 'fixed') return { current: 1, total: 1 };
    // The *scroll container*, not the content column inside it — and the two are
    // different elements. In scroll mode the host scrolls and the column is
    // taller than it; in paged mode the column scrolls sideways inside a host
    // that does not scroll at all. Measuring the wrong one reports every chapter
    // as a single page, which is worse than reporting nothing: a footer that
    // says "1/1" while the reader is scrolling through six screens is a footer
    // that is lying.
    if (this.settings.mode === 'paged') {
      // Both numbers from the same helpers the page turns use. A footer whose "2/3"
      // is computed one way and whose presses are counted another is a footer that
      // eventually disagrees with the reader, and the two were separate arithmetic
      // before this change.
      return { current: this.columnIndex() + 1, total: this.columnCount() };
    }
    // Deliberately *not* derived from `within`. `within` is the fraction of the
    // scroll *extent*, and mapping it back to a page count multiplies the rounding
    // error by the number of pages: at 0.83 of a six-screen chapter it gives page 5,
    // while the reader is on page 6 of 6 by the same arithmetic the page turns use,
    // so the number beside the thumb disagreed with the number of presses left.
    return { current: this.scrollPage() + 1, total: this.screenCount() };
  }

  /**
   * Advances one unit: a page when paged, a screenful when scrolling.
   *
   * Both directions go through `stepScreen`/`stepColumn`, which decide *where they
   * are* by arithmetic on the page index rather than by comparing a pixel offset
   * against a threshold. That distinction is the whole reason this method reads the
   * way it does:
   *
   * The old version asked `scrollTop < limit - 8` to decide whether there was room
   * to move, and then moved by 0.9 of a screen. Those two numbers do not agree.
   * `limit - 8` says "there is room" for any offset below `limit - 8`, while a 0.9
   * step from `scrollTop` lands at `scrollTop + 0.9 * screen`; so on a three-screen
   * chapter, from 0 the step leaves 0.9 screens (720px) and there is still room by
   * that test, and a *second* press moves to 1440 — one sliver short of the last
   * screen — and a *third* finally crosses the chapter boundary. The reader's
   * complaint was precisely this: it takes one press more than the footer says it
   * should, and pressing back does not retrace those presses, because backwards
   * used a different threshold (`> 8`) against the same offsets. Offsets landed on
   * by going forward were not recognised as boundaries by going back, so the page
   * appeared to bounce.
   *
   * A page index has neither problem: it is an integer, both directions compute it
   * from the same measurement, and a step is exactly one of it.
   */
  async next(): Promise<boolean> {
    if (this.doc.layout === 'fixed') return this.stepFixed(1);
    if (this.settings.mode === 'paged') {
      const advanced = this.stepColumn(1);
      if (advanced) return true;
      return this.stepSection(1);
    }
    const advanced = this.stepScreen(1);
    if (advanced) return true;
    return this.stepSection(1);
  }

  async previous(): Promise<boolean> {
    if (this.doc.layout === 'fixed') return this.stepFixed(-1);
    if (this.settings.mode === 'paged') {
      const moved = this.stepColumn(-1);
      if (moved) return true;
      return this.stepSection(-1, true);
    }
    const moved = this.stepScreen(-1);
    if (moved) return true;
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
    if (this.animationTimer !== null) clearTimeout(this.animationTimer);
    this.animationTimer = null;
    this.clearSpeechHighlight();
    this.releaseObjectUrl();
    this.resolver.dispose();
    this.host.remove();
  }

  // ---- rendering per layout ----

  private async renderReflowable(section: Section): Promise<void> {
    this.options.pageHost?.hide();
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
      this.refreshSpokenChunks();
      this.emitPosition();
    });
  }

  private async renderFixed(section: Section): Promise<void> {
    // A native host is offered the page first. It declines for PDF (the platform
    // viewer is a separate screen, not an embeddable view) and for anything it
    // cannot decode, and then the DOM path below runs unchanged.
    // `fit width` is a request to fill the viewport horizontally, which a
    // centred native image cannot do without cropping or scrolling. Both of
    // those are worse than the WebView path, so it is not offered.
    if (this.options.pageHost && this.settings.fit === 'contain') {
      const mode = section.render ?? this.doc.render;
      const drawn = await this.options.pageHost.show({
        sectionId: section.id,
        mode,
        ...(section.path ? { path: section.path } : {}),
        ...(section.image ? { mediaType: section.image.mediaType } : {}),
        ...(section.image ? { bytes: section.image.bytes } : {}),
        fit: this.settings.fit,
      });
      if (drawn) {
        // The native view is a sibling of the book host, not inside it, so the
        // flow has to be emptied or the previous page stays behind it.
        this.host.setContent('', []);
        this.host.flow.replaceChildren();
        return;
      }
    }

    this.options.pageHost?.hide();

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
    const scroller = this.scroller;
    if (this.settings.mode === 'paged') {
      const width = scroller.scrollWidth;
      if (width <= 0) return this.sectionOffset;
      return Math.min(1, Math.max(0, scroller.scrollLeft / Math.max(1, width - scroller.clientWidth)));
    }
    const limit = scroller.scrollHeight - scroller.clientHeight;
    if (limit <= 0) return 0;
    return Math.min(1, Math.max(0, scroller.scrollTop / limit));
  }

  private restoreOffset(): void {
    const scroller = this.scroller;
    if (this.doc.layout === 'fixed') return;
    if (this.settings.mode === 'paged') {
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollLeft = max * this.sectionOffset;
      return;
    }
    const limit = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = limit * this.sectionOffset;
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
    this.resizeObserver = new ResizeObserver(() => {
      this.restoreOffset();
      this.emitPosition();
    });
    this.resizeObserver.observe(this.host);
  }

  private async stepFixed(delta: number): Promise<boolean> {
    const next = this.sectionIndex + delta;
    if (next < 0 || next >= this.doc.sections.length) return false;
    await this.open(next, 0);
    return true;
  }

  /**
   * Crosses a chapter boundary, landing on the first screen going forwards and the
   * last going back.
   *
   * Awaited rather than fired and forgotten, and that is a fix rather than tidiness.
   * Every caller does `await view.previous()` and then acts on the result — the
   * reader screen animates the turn, and the sync layer records the new position —
   * so a chapter change that has not finished rendering when the call returns leaves
   * both of those acting on the chapter the reader just left. The visible form is a
   * page-turn animation played over the old text, and a saved position one chapter
   * behind.
   */
  private async stepSection(delta: number, toEnd = false): Promise<boolean> {
    const next = this.sectionIndex + delta;
    if (next < 0 || next >= this.doc.sections.length) return false;
    await this.open(next, toEnd ? 1 : 0);
    return true;
  }

  /**
   * Moves up or down by one screen in scroll mode.
   *
   * A *whole* screen, not 0.9 of one. The 0.9 was a "keep a line of context"
   * gesture, and it does not survive contact with a reader pressing a page-turner:
   * ten presses leave the last screen 35% unread after the chapter ends, and every
   * intermediate position is one the opposite direction cannot name. A page turn
   * shows a page.
   */
  private stepScreen(delta: number): boolean {
    const scroller = this.scroller;
    const page = this.scrollPage();
    const target = page + delta;
    if (target < 0 || target >= this.screenCount()) return false;
    scroller.scrollTop = this.screenOffset(target);
    this.emitPosition();
    return true;
  }

  /**
   * Which screen the reader is on, 0-based, in scroll mode.
   *
   * Found by asking which two page offsets the current scroll sits between, rather
   * than by dividing the scroll position by the screen height. The two agree only
   * when the chapter is a whole number of screens tall, and a chapter almost never
   * is: see `screenOffset`.
   */
  private scrollPage(): number {
    const total = this.screenCount();
    const top = this.scroller.scrollTop;
    for (let page = total - 1; page >= 0; page -= 1) {
      // A tolerance of one pixel, because the browser rounds `scrollTop` on read
      // (`722.99` is reported as `723`) and an exact comparison would then put the
      // reader on the page *before* the one they are looking at.
      if (top >= this.screenOffset(page) - 1) return page;
    }
    return 0;
  }

  /**
   * How many screens the chapter occupies, at least one.
   *
   * From the scrollable *range*, not from the content height, and the difference is
   * the bug this method exists to prevent. A chapter 2397px tall in a 723px viewport
   * can only be scrolled to `2397 - 723 = 1674`, so the reachable positions are
   * 0…1674. Dividing the *content* height gives `ceil(2397/723) = 4` pages and then
   * asks for offsets `0, 723, 1446, 2169` — and the last one clamps to 1674, which is
   * the *third* boundary. So the fourth press left the reader on page 3 by every
   * measure, the counter stuck at "3/4", and the press after that crossed into the
   * next chapter from what the footer still called page 3. A page count and a set of
   * page offsets have to be computed from the same range or they cannot agree.
   */
  private screenCount(): number {
    const range = this.scrollRange();
    if (range <= 0) return 1;
    // Ceil: the last screen is a screen even when it shows only a line, and its text
    // would otherwise be reachable only by scrolling past what the footer calls the
    // last page.
    return Math.max(1, Math.ceil(range / this.screenHeight()) + 1);
  }

  /** The top scroll offset of a page, spread across the scrollable range. */
  private screenOffset(page: number): number {
    const total = this.screenCount();
    if (total <= 1) return 0;
    return (this.scrollRange() * page) / (total - 1);
  }

  /** How far the chapter can actually scroll. */
  private scrollRange(): number {
    const scroller = this.scroller;
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  /**
   * The height of one screen.
   *
   * The scroll container's own height, which is the only value a page turn can
   * step by: a screen is what the viewport shows.
   */
  private screenHeight(): number {
    return Math.max(1, this.scroller.clientHeight);
  }

  /**
   * Moves by one CSS column, which is one screen in paged mode.
   *
   * The column *stride* comes from the measured page count rather than from
   * `clientWidth`. They differ whenever the column layout has a gap between
   * columns or a padding the browser folds into the stride: stepping by
   * `clientWidth` then walks a position that is not a column boundary, and the
   * round trip stops matching — go forward twice, back once, and the reader is not
   * where they started. Deriving the stride from `scrollWidth / pages` makes the
   * step land on the boundaries the layout actually created, which is the only
   * definition of "one column" that survives both directions.
   */
  private stepColumn(delta: number): boolean {
    const scroller = this.scroller;
    const columns = this.columnCount();
    const current = this.columnIndex();
    const target = current + delta;
    if (target < 0 || target >= columns) return false;
    scroller.scrollLeft = target * this.columnStride(columns);
    this.emitPosition();
    return true;
  }

  /** How many columns the chapter has, at least one. */
  private columnCount(): number {
    return Math.max(1, Math.round(this.scroller.scrollWidth / this.columnStrideBase()));
  }

  /** Which column the reader is on, 0-based, clamped to the chapter. */
  private columnIndex(): number {
    const columns = this.columnCount();
    const stride = this.columnStride(columns);
    return Math.min(columns - 1, Math.max(0, Math.round(this.scroller.scrollLeft / stride)));
  }

  /**
   * How far apart two column boundaries are, for a chapter of `columns` columns.
   *
   * A closed form rather than `scrollWidth / columns`, so the stride and the count
   * cannot disagree: the count is computed from the base extent, and a chapter
   * whose extent is not a whole number of columns rounds to the nearest boundary
   * instead of accumulating the difference over a chapter's worth of presses.
   */
  private columnStride(columns: number): number {
    const max = Math.max(0, this.scroller.scrollWidth - this.scroller.clientWidth);
    return columns > 1 ? max / (columns - 1) : this.columnStrideBase();
  }

  /** The layout's own idea of one column, used only to count them. */
  private columnStrideBase(): number {
    return Math.max(1, this.scroller.clientWidth);
  }

  // ---- read aloud ----

  /**
   * Refreshes the speakable sentence list for the chapter on screen.
   *
   * Called after every render rather than on demand, because the caller (the TTS
   * panel) may be opened *while* a chapter is loading, and a queue built from the
   * previous chapter would highlight the wrong paragraph.
   */
  refreshSpokenChunks(): SpokenChunk[] {
    this.spokenChunks = collectSpokenChunks(this.host.flow, (node) => this.blockIndexOf(node));
    return this.spokenChunks;
  }

  get speechChunks(): readonly SpokenChunk[] {
    return this.spokenChunks;
  }

  /**
   * Paints the sentence being spoken and scrolls it into view.
   *
   * A `Range` is used instead of wrapping the sentence in a `<span>`: wrapping
   * would rewrite the publisher's markup, and it is exactly the kind of edit that
   * makes an author's stylesheet stop applying to a phrase in the middle of a
   * paragraph. A range is painted into an overlay that sits *behind* the text, so
   * line boxes do not move and pagination does not change when playback starts.
   */
  highlightSpokenChunk(chunk: SpokenChunk | null): void {
    this.clearSpeechHighlight();
    if (!chunk || !chunk.node || !chunk.node.isConnected) return;
    const shadow = this.host.shadow;
    const range = shadow.ownerDocument.createRange();
    const end = Math.min(chunk.node.data.length, chunk.start + chunk.text.length);
    try {
      range.setStart(chunk.node, chunk.start);
      range.setEnd(chunk.node, end);
    } catch {
      return;
    }
    const rect = rangeRect(range);
    if (!rect) return;
    const hostRect = this.host.flow.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const mark = document.createElement('div');
    mark.className = 'reader-speech-highlight';
    mark.style.cssText = [
      'position:absolute',
      `left:${rect.left - hostRect.left + this.host.flow.scrollLeft}px`,
      `top:${rect.top - hostRect.top + this.host.flow.scrollTop}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
    ].join(';');
    // The overlay lives inside the shadow root's flow so it scrolls with the
    // text; `position: relative` on the flow is what anchors it.
    this.host.flow.append(mark);
    this.speechHighlight = mark;
    this.scrollIntoView(chunk);
  }

  /**
   * The first sentence inside the reader's current text selection.
   *
   * A selected paragraph is how a reader says "this bit" on a phone: tapping to
   * place a caret is not reliable over a shadow root, and long-press selection
   * already exists for copying. Reading the selection is therefore the natural
   * "read this paragraph" gesture, and it costs one call to `getSelection`.
   */
  speechAnchorFromSelection(): SpokenChunk | null {
    // `ShadowRoot.getSelection` exists on the Chromium/WebKit that ships on
    // Android but is not in the DOM typings, hence the structural check rather
    // than a direct call the type system would reject.
    const shadowSelection = (this.host.shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection;
    const selection = typeof shadowSelection === 'function' ? shadowSelection.call(this.host.shadow) : null;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    for (const chunk of this.spokenChunks) {
      if (!chunk.node) continue;
      // A sentence starts inside the selection. `intersectsNode` on the sentence
      // range would also match a sentence that merely *ends* in the selection,
      // which would make a one-word selection read the preceding sentence too.
      if (range.comparePoint(chunk.node, chunk.start) === 0 || this.rangeContains(range, chunk)) return chunk;
    }
    return null;
  }

  private rangeContains(selection: Range, chunk: SpokenChunk): boolean {
    if (!chunk.node) return false;
    const start = this.host.shadow.ownerDocument.createRange();
    try {
      start.setStart(chunk.node, chunk.start);
      start.setEnd(chunk.node, Math.min(chunk.node.data.length, chunk.start + Math.max(1, chunk.text.length)));
    } catch {
      return false;
    }
    return selection.isPointInRange(start.startContainer, start.startOffset);
  }

  /** Brings the spoken sentence back on screen, one screen at a time. */
  scrollIntoView(chunk: SpokenChunk): void {
    if (!chunk.node || !chunk.node.isConnected) return;
    const flow = this.host.flow;
    const range = this.host.shadow.ownerDocument.createRange();
    try {
      range.setStart(chunk.node, chunk.start);
      range.setEnd(chunk.node, Math.min(chunk.node.data.length, chunk.start + Math.max(1, chunk.text.length)));
    } catch {
      return;
    }
    const rect = rangeRect(range);
    if (!rect) return;
    if (this.settings.mode === 'paged') {
      // In paged mode the page is found by measurement, not by `scrollIntoView`,
      // because the browser's idea of "into view" is a horizontal jump to a
      // column boundary that ignores the chapter's own padding.
      const target = flow.scrollLeft + rect.left - flow.getBoundingClientRect().left - flow.clientWidth / 2;
      flow.scrollLeft = Math.max(0, target);
      return;
    }
    const hostRect = flow.getBoundingClientRect();
    if (rect.top < hostRect.top + 8 || rect.bottom > hostRect.bottom - 8) {
      flow.scrollTop += rect.top - hostRect.top - hostRect.height / 3;
    }
  }

  clearSpeechHighlight(): void {
    this.speechHighlight?.remove();
    this.speechHighlight = null;
  }

  /**
   * The sentence to start reading from, for "read from here".
   *
   * Found by asking the flow which block is at the top of the reading area and
   * then taking the first sentence inside it. Measuring the viewport rather than
   * scaling the position fraction matters: in paged mode the leading edge of a
   * page is a column boundary, and a fraction of the chapter maps to a sentence
   * that can be a whole paragraph away from what the reader is looking at.
   */
  speechAnchor(): SpokenChunk | null {
    if (this.spokenChunks.length === 0) return null;
    const flow = this.host.flow;
    const hostRect = flow.getBoundingClientRect();
    if (hostRect.width === 0 && hostRect.height === 0) return this.spokenChunks[0] ?? null;
    const edge = this.settings.mode === 'paged' ? hostRect.left + 4 : hostRect.top + 4;
    const first = this.spokenChunks[0] ?? null;
    for (const chunk of this.spokenChunks) {
      const rect = this.chunkRect(chunk);
      if (!rect) return first;
      const start = this.settings.mode === 'paged' ? rect.left : rect.top;
      if (start >= edge) return chunk;
    }
    return this.spokenChunks[this.spokenChunks.length - 1] ?? first;
  }

  /** Bounding box of a sentence, measured through a Range rather than a wrapper. */
  private chunkRect(chunk: SpokenChunk): DOMRect | null {
    if (!chunk.node || !chunk.node.isConnected) return null;
    const range = this.host.shadow.ownerDocument.createRange();
    try {
      range.setStart(chunk.node, chunk.start);
      range.setEnd(chunk.node, Math.min(chunk.node.data.length, chunk.start + Math.max(1, chunk.text.length)));
    } catch {
      return null;
    }
    return rangeRect(range);
  }

  /** Index of the top-level block containing a node, for sentence addressing. */
  private blockIndexOf(node: Node): number {
    const children = [...this.host.flow.children];
    let current: Node | null = node;
    while (current && current.parentNode !== this.host.flow) current = current.parentNode;
    return current ? children.indexOf(current as Element) : 0;
  }

  /**
   * Scrolls to a top-level block, used when resuming aloud after a chapter jump.
   */
  revealBlock(index: number): void {
    const block = this.host.flow.children[index];
    if (!(block instanceof HTMLElement)) return;
    if (this.settings.mode === 'paged') {
      const flow = this.host.flow;
      flow.scrollLeft = Math.max(0, block.offsetLeft - flow.clientWidth / 2);
      return;
    }
    const flow = this.host.flow;
    const target = block.offsetTop - flow.clientHeight / 3;
    flow.scrollTop = Math.max(0, target);
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

/**
 * A range's client rect, or null when the host cannot measure one.
 *
 * `Range.getBoundingClientRect` is missing in jsdom and in an embedded WebView
 * whose document has no layout box yet. Returning null rather than throwing keeps
 * read-aloud working as *audio* on such a host — the highlight is an enhancement,
 * and an enhancement that takes the feature down with it is not one.
 */
function rangeRect(range: Range): DOMRect | null {
  if (typeof range.getBoundingClientRect !== 'function') return null;
  try {
    return range.getBoundingClientRect();
  } catch {
    return null;
  }
}
