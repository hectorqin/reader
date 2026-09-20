import type { BookDoc, Section, StagedBook } from '../formats/types.ts';
import type { BookContent } from '../net/api.ts';
import type { NativePageHost } from './native-page.ts';
import { ResourceResolver, hydrateResources } from './resources.ts';
import {
  createBookHost,
  extractBody,
  extractInlineStyles,
  sanitiseInjectedContent,
  type BookShadowHost,
} from './shadow.ts';
import { escapeHtml, textToChapterHtml } from '../formats/segments.ts';
import { bookPercentage, formatLocator, parseLocator } from './locator.ts';
import { collectSpokenChunks, type SpokenChunk } from '../render/tts-text.ts';
import { adoptWindow } from '../formats/windowed.ts';
import { BOOK_RESOURCE_MARKER, chapterRefFromLink } from '../formats/book-resource.ts';

export interface ReaderViewOptions {
  container: HTMLElement;
  doc: BookDoc;
  /**
   * Makes an asset URL self-authenticating, for the requests the browser makes
   * itself.
   *
   * The chapter path is the *server's*: a windowed EPUB's document arrives with its
   * relative references rewritten to absolute URLs on the asset endpoint, and the
   * browser — not this view — fetches every `<img>` and `<link>` in it. Those
   * requests cannot carry an `Authorization` header, so without a token in the URL
   * they are refused and the reader gets a chapter of broken-image placeholders.
   *
   * Applied *after* the allow-list decides a URL may be fetched at all (see
   * `SanitiseOptions.signAssetUrl`), so a session token is never handed to an
   * address out of a book.
   */
  signAssetUrl?(url: string): string | null;
  /** Called on every position change, throttled by the caller via the view. */
  onPositionChange?: (position: Position) => void;
  onChapterChange?: (index: number, section: Section) => void;
  /**
   * A link *inside* a chapter that points at another chapter.
   *
   * The reader's own table of contents is not the only one a book has: an EPUB
   * ships a `nav`/`toc` document as a spine item like any other chapter, and a
   * reader who opens it and taps "第三章" is asking for a chapter change, not for
   * a file download. The href the tap carries has already been rewritten by the
   * server to point at the asset endpoint, so the view answers it with the
   * chapter reference (`xhtml:<path>`) the same way the 目录 panel does, and the
   * screen routes it through the same jump — window fetch included.
   *
   * Returns whether the reference was understood; a link this view cannot place
   * is left to the gesture layer rather than swallowed silently.
   */
  onChapterLink?(ref: string): boolean;
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
  theme: 'light' | 'sepia' | 'green' | 'dark';
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

/** A stand-in for the section index being out of range, so a caller need not guard. */
const EMPTY_SECTION: Section = { id: '', label: '', depth: 0 };

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
  /**
   * The chapter-link listener, bound once to the shadow root.
   *
   * Once, not per chapter: `setContent` replaces the *children* of `.book-flow`
   * and never the shadow root, so a listener on the root survives every chapter
   * change while the anchors it sees are always the current chapter's. A listener
   * added per render would be a listener per chapter, and a book of 1200 chapters
   * read end to end would end up with 1200 of them.
   */
  private detachChapterLinks: (() => void) | null = null;
  /**
   * The trim currently written to the host, so a re-measure cannot write it twice.
   *
   * Kept as a field rather than read back off the element, because reading the value
   * back is exactly what makes the loop in `syncPageTrim` possible: the write is seen
   * by the host so an observer fires, and the observer has to be able to tell that the
   * value it would write is the one already there.
   */
  private trimApplied: number | null = null;

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
    this.bindChapterLinks();
    this.applySettings();
  }

  /**
   * Routes a tap on a link inside the book.
   *
   * Captured on the shadow root rather than on each anchor, and in the *capture*
   * phase so it runs before the browser's own action. Two things have to be true
   * and only one of them is about this client:
   *
   *  - **A chapter link must be a chapter change.** The server rewrote the href to
   *    the asset endpoint, so without this the tap is a download of another
   *    chapter's *document* rendered as a file — which is what "点击目录页的章节没
   *    有跳转" looks like from the reader's side. `onChapterLink` answers whether
   *    the reference was understood, and only an understood one is consumed, so a
   *    footnote target or an image the book linked to still behaves like a link.
   *  - **Everything else must not escape the reader.** An unhandled `<a>` in a book
   *    is, by default, a navigation: a tap on an outbound link would replace the
   *    whole app with a web page, and the reader would have to find their way back
   *    to a book they were halfway through. In a WebView shell there is no way
   *    back at all. So a link this client does not recognise is prevented from
   *    navigating, which is the same rule `sanitiseInjectedContent` applies to
   *    `target="_blank"`.
   */
  private bindChapterLinks(): void {
    const onClick = (event: Event): void => {
      const target = event.target;
      const anchor = target instanceof Element ? target.closest('a[href]') : null;
      // Walked from the *event's* target, which is inside the shadow tree because
      // this listener is on the root that owns it — a `closest` on the host would
      // stop at the shadow boundary and find nothing.
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      const ref = chapterRefFromLink(href, anchor.baseURI);
      if (ref && this.options.onChapterLink?.(ref)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // A fragment-only link is the book's own footnote machinery, and the browser
      // has to perform it: scrolling to the note is exactly what the reader asked
      // for. Anything else would leave the reader, so it is refused.
      if (href.trim().startsWith('#')) return;
      const resolved = resolveWithinBook(href, anchor.baseURI);
      if (resolved === 'external') {
        event.preventDefault();
        event.stopPropagation();
      }
      // A link to a resource the book owns (an image, a stylesheet) is left alone:
      // the browser's own download/preview behaviour is the honest answer to "open
      // this picture", and it cannot leave the book.
    };
    this.host.shadow.addEventListener('click', onClick, true);
    this.detachChapterLinks = () => this.host.shadow.removeEventListener('click', onClick, true);
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
    // Capture the live position before typography changes its scroll extent.
    if (next) this.measureWithin();
    if (next) this.settings = { ...this.settings, ...next };
    document.documentElement.dataset['theme'] = this.settings.theme;
    this.host.setAttribute('data-paginated', String(this.settings.mode === 'paged'));
    this.container.style.setProperty('--reader-font-scale', String(this.settings.fontScale));
    // `inherit` is what keeps the author's line-height; only an explicit user
    // choice replaces it.
    this.container.style.setProperty('--reader-line-height', this.settings.lineHeight);
    this.container.style.setProperty('--reader-txt-line-height', this.settings.lineHeight === 'inherit' ? '1.8' : this.settings.lineHeight);
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
    // The *axis* is the mode's, and the attribute carries it.
    //
    // A page turn moves the reader along the axis the page is defined on: in paged
    // mode a page is a column, so a turn is horizontal; in scroll mode a page is a
    // screenful, so the same turn is vertical. Animating both with the horizontal
    // keyframes meant a scroll-mode reader saw the text slide sideways and land
    // where it always was — the animation described a movement that had not
    // happened, which is exactly what "翻页的样式不对" looks like.
    //
    // Fixed layout has no page *positions* to animate between (each page is a
    // different document), so it takes the horizontal pair: a comic page sliding in
    // from the direction the reader turned is the convention the format has.
    const axis = this.doc.layout === 'fixed' || this.settings.mode === 'paged' ? 'x' : 'y';
    const value = `${this.settings.pageAnimation}-${direction}-${axis}`;
    this.host.setAttribute('data-animating', value);
    if (this.animationTimer !== null) clearTimeout(this.animationTimer);
    this.animationTimer = setTimeout(() => {
      this.animationTimer = null;
      this.host.removeAttribute('data-animating');
    }, 240);
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
    if (this.staged) await this.staged.loadSection(index);
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

  /**
   * Jumps to a 0-based page *inside the current chapter*.
   *
   * This is the footer scrubber's move, and the distinction is the whole point of
   * it: a reader dragging the slider is asking "show me page 7 of this chapter",
   * not "show me 40% of the book". Those two questions are answered by two
   * different measurements, and a control that answers the wrong one moves the
   * reader to a different chapter than the one whose page number is written
   * beside its thumb — which is exactly the report this method closes. There is
   * deliberately no whole-book seek left on this view: the only caller it had was
   * the slider, and a second seek with the *wrong* semantics is a trap for the
   * next change rather than an API.
   *
   * Both modes go through the same page arithmetic the page turns use
   * (`stepColumn`/`stepScreen`), so the position a drag lands on is a position
   * the next press will move *from*, and the counter beside the slider names it.
   * A target outside the chapter is clamped rather than followed: the slider is
   * bounded by `chapterPages`, and a jump to page 900 of a 9-page chapter would
   * have to invent a destination.
   */
  async seekPageInChapter(page: number): Promise<void> {
    if (this.doc.layout === 'fixed') return;
    if (this.settings.mode === 'paged') {
      const columns = this.columnCount();
      const target = Math.min(columns - 1, Math.max(0, Math.round(page)));
      this.scroller.scrollLeft = target * this.columnStride(columns);
      this.emitPosition();
      return;
    }
    const total = this.screenCount();
    const target = Math.min(total - 1, Math.max(0, Math.round(page)));
    this.scroller.scrollTop = this.screenOffset(target);
    this.emitPosition();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.animationTimer !== null) clearTimeout(this.animationTimer);
    this.animationTimer = null;
    this.detachChapterLinks?.();
    this.detachChapterLinks = null;
    this.clearSpeechHighlight();
    this.releaseObjectUrl();
    this.resolver.dispose();
    this.host.remove();
  }

  // ---- rendering per layout ----

  /**
   * Whether a section is the reader's own plain-text rendition.
   *
   * The check is on the *body* rather than the raw document, because the reader
   * wraps its own rendition in `<div class="txt-body">` and an EPUB could
   * legitimately contain that string in its own prose; only the wrapper element
   * counts. `format: 'txt'` is honoured first — a book that declares itself is not
   * asked to prove it.
   *
   * Public because the settings panel's "正文" rows are the *same question* asked by
   * a different part of the screen, and two answers computed differently eventually
   * disagree — which is how a reader ends up looking at unstyled paragraphs with no
   * indent control beside them.
   */
  isPlainText(section: Section = this.doc.sections[this.sectionIndex] ?? EMPTY_SECTION): boolean {
    // The declaration wins outright. `format: 'txt'` is the book saying so and
    // `plainText` is the *section* saying so, which is the one that can be right when
    // a manifest windows a TXT as `reflowable` — a reasonable choice, since a TXT is
    // reflowable, and one that made the chapter-level answer differ from the
    // book-level one.
    if (this.doc.format === 'txt' || section.plainText) return true;
    // The marker is kept as the last resort, for a section that reached here from an
    // older server (or a cache written by one) which *did* wrap its chapters in
    // `<div class="txt-body">`. It is deliberately no longer the primary signal: a
    // server that sends bare characters carries no marker, so sniffing for one
    // answers "not plain text" for a chapter that is nothing but plain text.
    const html = section.html ?? '';
    return /<div[^>]*class="[^"]*\btxt-body\b/.test(html);
  }

  /**
   * Renders a chapter of a plain-text book through the reader's own split.
   *
   * The input is the *characters* of the chapter, however they arrived:
   *
   *  - a `chapter-full:<n>` body fetched by the windowed path, which is that
   *    book's text and nothing else (the server stopped typesetting — see
   *    `server/src/indexer/formats/text-html.ts`); or
   *  - a body from a server that still renders markup, which is handled by
   *    reading its blocks back as text rather than by trusting its elements.
   *
   * Both end up here because *both* are the reader's own rendering of a file that
   * has none, and the thing the reader asked for — a per-device indent, paragraph
   * spacing, the removal of a scraper's leading spaces — is a property of the
   * rendering, not of the file. Doing it server-side meant the settings could only
   * apply to the rendition the server had already produced, and it meant the two
   * transports could disagree about where a paragraph was.
   *
   * Guarded by `isPlainText`, and the guard is why an EPUB is safe: an ordinary
   * novel never carries the `txt-body` marker, so it goes through untouched (the
   * one thing in this file that must not happen is a re-typesetting pass that runs
   * on every format, because that would mangle every EPUB).
   */
  private retypePlainText(section: Section): string {
    const raw = section.html ?? '';
    if (!this.isPlainText(section)) return raw;
    // A `txt-body` wrapper means the body arrived as markup (this build no longer
    // produces one, but a window carried over from an older server or a cached
    // section might). Its blocks are read back *per block* and re-joined with a
    // blank line: `textContent` on the wrapper would concatenate them into one
    // run, and the re-split below would then see a single paragraph and destroy
    // every boundary the block structure was carrying.
    let text = raw;
    // A heading an older server promoted out of the body. It is kept, and kept
    // *first*, because it is the one piece of structure a TXT has and because
    // re-deriving it is a heuristic — running a heuristic twice is how two copies of
    // it come to disagree. Re-emitted below rather than fed back through the regex.
    let keptHeading = '';
    // Only a body that *is* markup is parsed as markup: a section the manifest
    // declared as plain text is characters all the way down, and running an HTML
    // parser over a novel whose text happens to contain `<` is how a paragraph gets
    // silently eaten.
    //
    // The test is `bodyIsMarkup`, not `!plainText`. They read alike and mean
    // different things, and using the wrong one is what made every TXT a single
    // paragraph: a TXT chapter is `plainText` *and* not markup, so `!plainText` sent
    // its server-rendered `<p>` markup down the text path — where the tags were
    // stripped and the paragraphs the server had just built were joined back into
    // one slab. The question here is about the *bytes*, and only the bytes answer it.
    if (section.bodyIsMarkup !== false && /<div[^>]*class="[^"]*\btxt-body\b/.test(raw)) {
      const container = document.createElement('div');
      container.innerHTML = raw;
      const wrapper = container.querySelector('.txt-body');
      if (wrapper) {
        const heading = wrapper.querySelector('h3, h4');
        keptHeading = heading?.textContent?.trim() ?? '';
        // Read back *per block*, not with `textContent` on the wrapper: the latter
        // concatenates the paragraphs into one run, and the re-split below would
        // then see a single paragraph and destroy every boundary the block
        // structure was carrying.
        const blocks = [...wrapper.children]
          .filter((element) => !/^H[1-6]$/.test(element.tagName))
          .map((element) => element.textContent ?? '')
          .filter((block) => block.trim().length > 0);
        text = blocks.length > 0 ? blocks.join('\n\n') : wrapper.textContent ?? '';
      }
    } else {
      // Not markup: the chapter's characters, as fetched, and nothing else. This
      // is what the server sends now (see `server/src/indexer/formats/text.ts`).
      // `extractBody` is still applied because a plain-text body can be wrapped in
      // an `<html>`/`<body>` shell by a proxy, and unwrapping that is cheaper than
      // discovering it as a stray `<html>` inside the first paragraph.
      text = extractBody(raw);
    }
    // The heading is re-derived from the text like every other boundary, by
    // `segments.ts`, when the body did not already carry one: the chapter's first
    // line is its title (that is what `splitChapters` records and why a locator
    // lands on the title). A heading the body *did* carry is re-emitted directly
    // rather than fed back through the regex — it was already promoted once, and
    // a second pass would only be a chance to disagree with the first.
    const rendered = textToChapterHtml(text);
    if (keptHeading) {
      return rendered.replace(
        '<div class="txt-body">\n',
        `<div class="txt-body">\n<h3>${escapeHtml(keptHeading)}</h3>\n`,
      );
    }
    return rendered;
  }

  private async renderReflowable(section: Section): Promise<void> {
    this.options.pageHost?.hide();
    // The client typesets what the server sent.
    //
    // Whether the server's rendition arrived with paragraphs or as one slab, this
    // is where the reader's own split runs — so the indent, the paragraph spacing
    // and the removal of a scraper's leading spaces apply to *both* of the two ways
    // a TXT reaches this view (`chapter-full:<n>` windowed, `chapter:<n>` streamed)
    // without a second request, and the settings panel's rows do something on
    // whichever one the reader happens to be looking at.
    const raw = this.retypePlainText(section);
    // Which typesheet applies is decided here rather than once per book, because the
    // answer can differ per *chapter*: a server that windows a TXT as `reflowable`
    // (a reasonable choice — it is reflowable) reports `format: 'reflowable'` while
    // sending the reader's own plain-text markup. Deciding from the format alone left
    // those paragraphs unstyled and the indent control doing nothing.
    //
    // The marker is the server's own wrapper (`text-html.ts`), so this agrees with
    // the server by construction rather than by a second convention. `format: 'txt'`
    // is still honoured first: it is the declaration, and a book that declares itself
    // is not asked to prove it.
    this.host.setPlainText(this.isPlainText(section));
    const body = extractBody(raw);
    const inlineStyles = extractInlineStyles(raw);
    // The chapter's own <style> blocks are prepended so the book's link-level
    // stylesheets (already in `doc.styles`) can still override them, matching
    // the cascade the book was authored against.
    this.host.setContent(body, [...inlineStyles, ...this.doc.styles]);
    sanitiseInjectedContent(this.host.shadow, {
      ...(this.options.signAssetUrl ? { signAssetUrl: this.options.signAssetUrl } : {}),
    });
    await hydrateResources(this.host.shadow, this.resolver);
    // The page's own geometry is decided here, once the text is in the DOM: the grid
    // the chapter is set on is how tall a page may be before its last line is cut, and
    // that is the *first* measurement a chapter render owes the reader. Images then
    // load asynchronously and change the flow height, which invalidates any offset
    // measured before they arrive — so the trim is re-synced on the same callback.
    this.syncPageTrim();
    this.waitForImages().then(() => {
      this.syncPageTrim();
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
        ...(section.document ? { bytes: section.document.bytes, mediaType: section.document.mediaType } : {}),
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
    } else if (section.document) {
      const frame = document.createElement('iframe');
      frame.className = 'pdf-frame';
      frame.title = section.label;
      frame.src = this.objectUrl(section.document.bytes, section.document.mediaType);
      wrapper.append(frame);
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
      const within = Math.min(1, Math.max(0, scroller.scrollLeft / Math.max(1, width - scroller.clientWidth)));
      this.sectionOffset = within;
      return within;
    }
    const limit = scroller.scrollHeight - scroller.clientHeight;
    if (limit <= 0) return 0;
    const within = Math.min(1, Math.max(0, scroller.scrollTop / limit));
    // ResizeObserver re-anchors after the viewport changes. Keep the latest
    // position, rather than the offset used when the chapter was opened, so a
    // chrome repaint cannot send a reader back to page one.
    this.sectionOffset = within;
    return within;
  }

  private restoreOffset(): void {
    const scroller = this.scroller;
    if (this.doc.layout === 'fixed') return;
    // Before the offset is applied, because the page's height decides which offsets
    // exist: a trim applied afterwards would move the reader by the trim.
    this.syncPageTrim();
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
      // A rotation changes the viewport, and the page's line grid with it: the trim is
      // recomputed before the offset is restored for the same reason as everywhere else.
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
    return Math.max(1, Math.ceil(range / this.pageExtent()) + 1);
  }

  /**
   * How far a page's text runs, measured from the top of the page.
   *
   * The viewport trimmed down to a *whole number of lines*, which is the second half
   * of what "a page" means and the half a page turn cannot get from the offset alone.
   *
   * A page is `clientHeight` tall and the text is set on a grid of `L`. Only when
   * `clientHeight` is a multiple of `L` does the last line of the page end exactly at
   * the bottom edge; in every other case it sticks out by the remainder, and the
   * reading surface — which is a clipped box — cuts its descender. That is the line
   * the reader reported, and no amount of choosing the right offset can prevent it:
   * the *page* has to be a whole number of lines, so the extent is the viewport
   * floored to the grid.
   *
   * `L` is read from the rendered boxes rather than from `line-height`, because the
   * setting is `inherit` by default — the book's own value, which this stylesheet
   * does not guess at. The measurement is one page's worth: see `lineBoxes`.
   *
   * A page shorter by less than one line is a page the footer still counts correctly,
   * because the page *count* and the page *offsets* are both derived from this number
   * (see `screenCount` and `screenOffset`) — the pairing the comment above is about.
   */
  private pageExtent(): number {
    const line = this.lineHeight();
    if (line <= 0) return this.pageHeight();
    const whole = Math.floor(this.pageHeight() / line) * line;
    // Never collapse the page on a pathological metric: a page has to be at least a
    // few lines, and the count is derived from this number, so a small one would make
    // a chapter unpagable rather than merely tight.
    return whole >= line * 3 ? whole : this.pageHeight();
  }

  /**
   * The height of the page *as drawn*, before the trim the grid asks for.
   *
   * Recovered by adding the trim back rather than read off the element, and that is
   * the whole reason this method exists. `clientHeight` is the height *after* the trim
   * — the trim is an inset on this very box — so computing the extent from it closes a
   * loop: a shorter box asks for a bigger trim, a bigger trim shortens the box again,
   * and the page walks down the chapter a pixel per measurement. The number this
   * returns does not move when the trim does, which is what makes it usable as the
   * input to the trim.
   */
  private pageHeight(): number {
    return Math.max(1, this.screenHeight() + this.pageTrim());
  }

  /** The trim currently applied to the host, in pixels. */
  private pageTrim(): number {
    if (this.trimApplied !== null) return this.trimApplied;
    const value = Number.parseFloat(this.host.style.getPropertyValue('--reader-page-trim'));
    return Number.isFinite(value) ? value : 0;
  }

  /**
   * Publishes the grid's remainder as the trim the stylesheet applies.
   *
   * Called wherever the page can change shape — a chapter render, a rotation, a
   * restore — and never from `pageExtent` itself, which is the read side of the same
   * number and would close the loop described in `pageHeight`.
   */
  private syncPageTrim(): void {
    const line = this.lineHeight();
    if (line <= 0) {
      this.trimApplied = null;
      this.host.style.removeProperty('--reader-page-trim');
      return;
    }
    const page = this.pageHeight();
    const trim = page - Math.floor(page / line) * line;
    // Only when it *changes*, and that is not an optimisation — it is what stops a loop.
    // The trim is applied to the host, and the host has a `ResizeObserver` on it (see
    // `attachResizeObserver`) which restores the offset; a write on every call therefore
    // re-enters this method from the observer, and the two keep re-measuring and
    // re-writing each other. Writing only a *different* value terminates: the second call
    // computes the same trim, sees it, and returns without touching the DOM.
    // Text rectangles are rounded to subpixels. Treat subpixel noise as the
    // same trim so ResizeObserver cannot oscillate on an unchanged layout.
    if (this.trimApplied !== null && Math.abs(this.trimApplied - trim) < 0.5) return;
    this.trimApplied = trim;
    this.host.style.setProperty('--reader-page-trim', `${trim}px`);
  }

  /**
   * One line's height, from the boxes that are on screen.
   *
   * The smallest gap between two neighbouring line tops, which is one line where the
   * text has no leading and never more. An underestimate is the safe direction: it
   * makes a page one line *shorter* rather than one line too long, and a page that is
   * a line short still shows whole lines.
   */
  private lineHeight(): number {
    const lines = this.lineBoxes();
    let smallest = Number.POSITIVE_INFINITY;
    for (let i = 1; i < lines.length; i += 1) {
      const gap = lines[i]!.top - lines[i - 1]!.top;
      if (gap > 0.5 && gap < smallest) smallest = gap;
    }
    return Number.isFinite(smallest) ? smallest : 0;
  }

  /**
   * The top scroll offset of a page, spread across the scrollable range and then
   * snapped to a line.
   *
   * ## Why the offset is snapped to a line
   *
   * A page turn has to land *between two lines*. The fraction of the scroll range is
   * almost never a line boundary: on a 2120px chapter in a 795px viewport it lands at
   * 663px, and the line box that happens to be there starts at 19px — fourteen of its
   * pixels above the top edge of the reading surface. The reader is looking at part of
   * a line at the top of every page after the first, which is the "翻页后，遮挡了一部分
   * 文字" in the report as much as the readouts are: the strip that covers it is only
   * what makes it *visible*, and the line is already cut before anything is drawn over
   * it.
   *
   * The two edges are answered by two different numbers, and keeping them apart is what
   * makes the turn land where it should:
   *
   *  - **where the page starts** is this method's question, and it is answered by
   *    snapping the offset *up* to the next line top (`snapToLine`);
   *  - **how much of the text a page holds** is the other half, and it is answered by
   *    `pageExtent`, which floors the viewport to the line grid so the page's last line
   *    does not overhang the bottom edge.
   *
   * Doing both by moving the offset is the mistake the first version of this made: an
   * offset that rounds down keeps the top of the page whole and lets the foot overhang,
   * and one that keeps walking until the last line fits lands the reader at the bottom
   * of the page they have already read.
   *
   * The first page is left at zero rather than snapped, because a chapter starts at its
   * own first line and moving it down by half a line would hide the heading.
   */
  private screenOffset(page: number): number {
    const total = this.screenCount();
    if (total <= 1) return 0;
    if (page === 0) return 0;
    const target = (this.scrollRange() * page) / (total - 1);
    return this.snapToLine(target);
  }

  /**
   * The first line top at or after a scroll offset.
   *
   * The *first*, and not the nearest: a page starts where the reader left off, and it is
   * the page's end that the bottom edge constrains (`pageExtent`). Rounding down to the
   * nearest boundary would keep the top whole and let the last line overhang; rounding
   * down and then walking forward until the last line fits would put the reader at the
   * foot of the page they have already read.
   *
   * Measured from the chapter's own line boxes rather than from a font metric:
   * `line-height` is `inherit` by default — the book's own value, which the reader's
   * stylesheet deliberately does not guess at — so the grid is a property of the text
   * that was actually rendered, and `getClientRects` is the only thing that knows it.
   *
   * The scan stops at the first line that starts at or after the offset, so it is a
   * handful of comparisons rather than a walk of the chapter — but the *list* is built
   * per chapter render, not per press. Moving this to a per-press scan of the visible
   * band is the obvious next step if a very long chapter ever measures slow.
   */
  private snapToLine(offset: number): number {
    for (const line of this.lineBoxes()) {
      if (line.bottom <= offset) continue;
      return line.top;
    }
    return offset;
  }

  /**
   * The chapter's line boxes, as tops and bottoms in the scroller's own space.
   *
   * Tops and bottoms both, because a page has two edges: the offset is a line *top* and
   * the page's height is bracketed by line *bottoms*. A list of tops alone cannot
   * answer the second question, which is how the last line of every turned page came to
   * be clipped by its own descender.
   *
   * `rect.top` is a *viewport* coordinate and the host's own rect says where the
   * scroller sits on screen, so the content coordinate is the rect minus the host's,
   * plus the offset the scroller is currently showing. The `scrollTop` term is not
   * optional: without it the grid is measured *relative to the page the reader is
   * looking at*, so every turn re-measures a grid that has already moved with them —
   * turn one lands, turn two snaps back a line, and the reader alternates between two
   * neighbouring pages.
   *
   * Measured from the rendered boxes rather than from a font metric, because
   * `line-height` is `inherit` by default — the book's own value, which this stylesheet
   * deliberately does not guess at — so the only thing that knows the grid the text is
   * set on is the text that was rendered.
   */
  private lineBoxes(): Array<{ top: number; bottom: number }> {
    const flow = this.host.flow;
    const hostTop = this.host.getBoundingClientRect().top;
    const scrollTop = this.host.scrollTop;
    const lines: Array<{ top: number; bottom: number }> = [];
    const root = flow.firstElementChild;
    if (!root) return lines;
    for (const block of root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, div')) {
      const range = document.createRange();
      range.selectNodeContents(block);
      // `getClientRects` is the only API that knows where a *line* is, and a test
      // environment that does not implement it (jsdom lays nothing out) returns no
      // list at all. An empty grid is the honest answer there: the page is left
      // untrimmed rather than trimmed to a number nobody measured, which is what the
      // `line <= 0` branches above and below already decide.
      const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
      for (const rect of rects) {
        lines.push({ top: rect.top - hostTop + scrollTop, bottom: rect.bottom - hostTop + scrollTop });
      }
    }
    lines.sort((a, b) => a.top - b.top);
    return lines;
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


/**
 * Whether a link in a chapter stays inside the book.
 *
 * Three answers, because the three cases are handled differently:
 *
 *  - `'internal'` — a fragment (`#note7`) or the book's own resource. The browser
 *    performs it: the note anchors have to work, and an image the book linked to
 *    is a page the reader may want to see.
 *  - `'external'` — anything else, which the click handler refuses. A book that
 *    contains a link to a website must not be able to replace the reader with one.
 *  - `'unknown'` — a URL that cannot even be parsed, which is refused the same way
 *    as external: an unparseable href has no correct destination.
 */
function resolveWithinBook(href: string, baseURI: string): 'internal' | 'external' | 'unknown' {
  const trimmed = href.trim();
  if (trimmed.startsWith('#')) return 'internal';
  let url: URL;
  try {
    url = new URL(trimmed, baseURI);
  } catch {
    return 'unknown';
  }
  if (url.protocol === 'blob:' || url.protocol === 'data:') return 'internal';
  if (url.origin !== window.location.origin) return 'external';
  // A same-origin address is not automatically the book's: the app itself is served
  // from this origin, and a link to `/` would leave the reader as surely as a link
  // to another host. The book's own resources are the ones the sanitiser kept, which
  // the marker identifies.
  return url.searchParams.has(BOOK_RESOURCE_MARKER) ? 'internal' : 'external';
}
