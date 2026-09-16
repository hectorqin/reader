/**
 * The client's style intervention.
 *
 * This file is the product's core differentiator, so it is worth being explicit
 * about what it does and does not do.
 *
 * ## The rule
 *
 * **The publisher's layout wins.** The client may set defaults only for things
 * the book left unspecified, and may expose values the reader is entitled to
 * control (text size, theme, page width) through variables that a book is free
 * to ignore.
 *
 * Concretely, this stylesheet never sets: `font-family`, `line-height`,
 * `text-align`, `letter-spacing`, `margin` on content elements, `writing-mode`,
 * or anything else a typographer chose. Readium CSS does set them — its premise
 * is that a consistent, controlled reading experience beats fidelity, and that
 * premise is the opposite of this product's.
 *
 * ## How the reader's settings reach the book without overwriting it
 *
 * Through CSS custom properties with fallbacks a book can ship its own value
 * for. `font-size: var(--reader-font-size, 1em)` means: a book that set an
 * explicit size keeps it, and a book that did not inherits the reader's choice.
 * That is the whole mechanism, and it is why `!important` appears nowhere here.
 *
 * ## Root font size, not per-element font sizes
 *
 * Setting `font-size` on the container only affects text that uses relative
 * units. That is deliberate: a book that declares `font-size: 14px` on a
 * paragraph has stated an intent, and the reader's slider has no business
 * overriding it. What the slider changes is the base that everything relative
 * scales from, which is the behaviour a reader expects from a real book app and
 * the only one that can be implemented without fighting the book.
 */

export type ThemeMode = 'light' | 'sepia' | 'dark';

export interface ReaderSettings {
  /** Base font size in CSS pixels. */
  fontSize: number;
  /** Page width in CSS pixels, for the column layout. */
  pageWidth: number;
  /** Gap between columns; the paginator must be told the same number. */
  columnGap: number;
  /** Padding inside a page. */
  pagePadding: number;
  theme: ThemeMode;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  pageWidth: 720,
  columnGap: 32,
  pagePadding: 24,
  theme: 'light',
};

/**
 * Theme palettes.
 *
 * Applied as custom properties rather than as rules on the book's elements, so a
 * book that hard-codes `color: #333` keeps it. That is the correct trade: a dark
 * theme that silently defeats a print-oriented book's contrast is a bug report,
 * whereas a book whose text stays dark on a "dark" background is one the reader
 * can see and judge.
 */
export const PALETTES: Record<ThemeMode, { background: string; text: string; muted: string }> = {
  light: { background: '#ffffff', text: '#111111', muted: '#6b7280' },
  sepia: { background: '#f6f0e4', text: '#3b3121', muted: '#8a7c63' },
  dark: { background: '#14161a', text: '#c9cdd4', muted: '#7c828c' },
};

/**
 * Styles shared by every chapter, applied from the *outer* document.
 *
 * They live outside the shadow root on purpose: rules that reference a shadow
 * root's own content cannot be written from outside it, but the values can still
 * be inherited in, because custom properties cross the boundary. Keeping the
 * layout rules (column count, page size, scroll behaviour) out here means the
 * per-chapter shadow root holds only what came out of the book.
 */
export function readerCss(hostSelector: string, settings: ReaderSettings): string {
  const palette = PALETTES[settings.theme];
  return `
${hostSelector} {
  --reader-font-size: ${settings.fontSize}px;
  --reader-page-width: ${settings.pageWidth}px;
  --reader-column-gap: ${settings.columnGap}px;
  --reader-page-padding: ${settings.pagePadding}px;
  --reader-bg: ${palette.background};
  --reader-fg: ${palette.text};
  --reader-muted: ${palette.muted};
  --reader-chapter-progress: 0;

  display: flex;
  justify-content: center;
  background: var(--reader-bg);
  color: var(--reader-fg);
  /* The container is a scroll *host*, never a scroll area: pages are moved by
     scrollLeft, so a vertical scrollbar appearing here would mean the paginator
     lost track of the geometry. */
  overflow: hidden;
  font-size: var(--reader-font-size);
}

${hostSelector} .reader-viewport {
  display: block;
  width: 100%;
  max-width: var(--reader-page-width);
  /* One page wide; the pages after the first are reached by scrolling sideways.
     overflow-x: auto rather than scroll, so a chapter shorter than one page does
     not show a scrollbar it cannot use. */
  overflow-x: auto;
  overflow-y: hidden;
  /* Scroll snapping makes a swipe land on a page boundary instead of between two
     pages, which is what "turning a page" means. The paginator still sets
     scrollLeft explicitly; snapping is what makes *user* gestures agree with it. */
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

${hostSelector} .reader-viewport::-webkit-scrollbar {
  display: none;
}
`;
}

/**
 * Styles that must live inside the shadow root.
 *
 * A short, fixed list, and every rule in it is about the *container* rather than
 * the book: the column layout that creates pages, and the snap points that align
 * a page to the viewport. Nothing here selects a publisher element type.
 *
 * `direction: ltr` is set explicitly because the column model reverses when the
 * inherited direction flips, and a book with `dir="rtl"` on a footnote container
 * would otherwise silently paginate right-to-left from that point on.
 */
export function chapterCss(): string {
  return `
:host {
  display: block;
}
.reader-chapter {
  /* Columns are the pagination mechanism: the browser lays the chapter out as
     N columns of exactly one page width, and a page is a scroll offset. */
  column-width: calc(var(--reader-page-width) - var(--reader-page-padding) * 2);
  column-gap: var(--reader-column-gap);
  column-fill: auto;
  direction: ltr;
  height: 100%;
  padding: 0 var(--reader-page-padding);
  box-sizing: border-box;
  /* The reader's font size is inherited through this element, so a book's
     relative sizes scale with it and a book's absolute sizes do not. */
  font-size: var(--reader-font-size);
  color: var(--reader-fg);
}
.reader-chapter > * {
  scroll-snap-align: start;
  /* A block taller than a page must be splittable across columns; "avoid" would
     push a long paragraph to the next page and leave a gap. Only images opt out. */
  break-inside: auto;
}
.reader-chapter img,
.reader-chapter svg {
  /* Publisher images are sized in their own units and routinely overflow the
     column. Clamping them is the one place where "do not touch the book" has to
     give way: an image that breaks the column geometry makes the whole chapter
     unreadable, not just unstyled. */
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  break-inside: avoid;
  scroll-snap-align: start;
}
.reader-chapter img[data-reader-unsized='true'] {
  /* Reserve a line for an image the book gave no dimensions, so the chapter does
     not reflow under the reader when it finishes loading. */
  min-height: 1em;
}
`;
}
