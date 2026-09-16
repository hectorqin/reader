/**
 * Column-based pagination for reflowable content.
 *
 * ## Why not `scroll` mode
 *
 * Continuous scrolling is what every web reader does, and it is the wrong model
 * for a book. A reader's position is measured in pages: the progress indicator,
 * "12 pages left in this chapter", turning back to re-read a paragraph — all of
 * it assumes a fixed page. Scroll position is a pixel offset that changes meaning
 * when the font size, viewport or column width changes, which is exactly the set
 * of things a reader adjusts.
 *
 * ## Why CSS multi-column instead of measuring by hand
 *
 * The alternative is to wrap every word in a span and do a binary search for the
 * page break. That rewrites the publisher's markup, which this product refuses to
 * do, and it is slow enough to be felt on a chapter with images. Multi-column
 * layout is the browser's own implementation of the same thing: the content is
 * laid out once, columns are created, and a page is a horizontal scroll offset.
 *
 * The cost is that pagination is done by the layout engine, so page boundaries
 * land wherever the engine puts them. That is acceptable — and it is what every
 * commercial reader does too — as long as a *position* survives a repagination,
 * which the anchor tolerance below handles.
 */

/** A position inside a chapter, anchored to a DOM node so it survives repagination. */
export interface ChapterPosition {
  /** Index of the top-level block the reader was in. */
  blockIndex: number;
  /** How far into that block, as a fraction of its height. */
  offsetRatio: number;
}

export interface PaginatorOptions {
  /** Gap between columns, in CSS pixels. Must match the stylesheet. */
  columnGap?: number;
  /** Extra page padding, in CSS pixels, on each side. */
  pagePadding?: number;
}

/**
 * Drive a single chapter's viewport.
 *
 * Deliberately owns no DOM: it is handed the scrolling element and reports
 * positions. Keeping it free of element creation means the same class can be
 * unit tested without a browser, which matters because pagination bugs (a
 * position that drifts one page forward on every resize) are only reproducible
 * against a real layout engine and are otherwise very hard to pin down.
 */
export class Paginator {
  private readonly columnGap: number;
  private readonly pagePadding: number;
  /** Column stride: the exact distance between two page origins. */
  private stride = 0;
  private pageCount = 1;
  private current = 0;

  constructor(private readonly viewport: HTMLElement, options: PaginatorOptions = {}) {
    this.columnGap = options.columnGap ?? 32;
    this.pagePadding = options.pagePadding ?? 24;
  }

  /** Recompute the column geometry. Call after a resize or a font change. */
  layout(pageWidth = this.viewport.clientWidth): { pageCount: number; stride: number } {
    const usable = Math.max(1, pageWidth - this.pagePadding * 2);
    this.stride = Math.max(1, usable + this.columnGap);
    // `scrollWidth` is the browser's answer to "how much content is there", and
    // dividing it by the stride is the only way to learn the page count without
    // duplicating the layout engine's work.
    const scrollWidth = this.viewport.scrollWidth;
    this.pageCount = Math.max(1, Math.round((scrollWidth + this.columnGap) / this.stride));
    return { pageCount: this.pageCount, stride: this.stride };
  }

  get total(): number {
    return this.pageCount;
  }

  get index(): number {
    return this.current;
  }

  /** Move to a page, clamped to the chapter. Returns true if the page changed. */
  goTo(page: number): boolean {
    const next = Math.max(0, Math.min(this.pageCount - 1, Math.floor(page)));
    if (next === this.current) return false;
    this.current = next;
    this.viewport.scrollLeft = next * this.stride;
    return true;
  }

  /** Move by a relative number of pages. Returns the leftover for chapter turns. */
  turn(pages: number): { changed: boolean; spill: number } {
    const target = this.current + pages;
    if (target < 0) return { changed: this.goTo(0), spill: target };
    if (target > this.pageCount - 1) {
      const changed = this.goTo(this.pageCount - 1);
      return { changed, spill: target - (this.pageCount - 1) };
    }
    return { changed: this.goTo(target), spill: 0 };
  }

  /** Forget the current page; used when a different chapter is loaded. */
  reset(): void {
    this.current = 0;
    this.pageCount = 1;
    this.viewport.scrollLeft = 0;
  }

  /** Page index for a horizontal scroll offset (e.g. after a user swipe). */
  pageAt(offset: number): number {
    if (this.stride <= 0) return 0;
    return Math.max(0, Math.min(this.pageCount - 1, Math.round(offset / this.stride)));
  }
}

/**
 * Fraction of the chapter read, from a page index.
 *
 * Reported as a fraction of the chapter rather than of the book: the server
 * cannot know a chapter's length in characters for most books, and inventing one
 * would put a wrong percentage under the reader's thumb. The reader combines this
 * with the chapter's position in the spine, which it does know exactly.
 */
export function pageFraction(page: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.max(0, Math.min(1, page / (pageCount - 1)));
}

/**
 * Capture a position that survives repagination.
 *
 * The page index does not: the same page index means a different part of the
 * text after a font size change. Anchoring to the top-level block at the page's
 * leading edge (plus how far into it) means a reader who resizes the text stays
 * on the sentence they were reading, which is the entire reason readers tolerate
 * changing the font size at all.
 */
export function capturePosition(viewport: HTMLElement, page: number, stride: number): ChapterPosition {
  const blocks = topLevelBlocks(viewport);
  if (blocks.length === 0) return { blockIndex: 0, offsetRatio: 0 };

  const origin = page * stride;
  let index = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const left = block.offsetLeft;
    if (left <= origin + 1) index = i;
    else break;
  }

  const block = blocks[index]!;
  const height = block.offsetHeight || 1;
  const ratio = Math.max(0, Math.min(1, (origin - block.offsetLeft) / height));
  return { blockIndex: index, offsetRatio: ratio };
}

/** Restore a captured position. Returns the page to land on, or 0 if unmatchable. */
export function restorePosition(viewport: HTMLElement, position: ChapterPosition, stride: number): number {
  const blocks = topLevelBlocks(viewport);
  const block = blocks[Math.min(position.blockIndex, blocks.length - 1)];
  if (!block) return 0;
  const left = block.offsetLeft + position.offsetRatio * (block.offsetHeight || 0);
  return stride > 0 ? Math.max(0, Math.round(left / stride)) : 0;
}

/**
 * The blocks a position can anchor to.
 *
 * Only the viewport's direct children are considered. Going deeper would anchor
 * to a `<span>` whose offset would change the moment the publisher's CSS nests
 * differently, and the anchors have to be stable across the client's own style
 * tweaks — those changes must not move the reader's place in the book.
 */
function topLevelBlocks(viewport: HTMLElement): HTMLElement[] {
  const root = (viewport.querySelector('.reader-chapter') ?? viewport) as HTMLElement;
  return Array.from(root.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
}
