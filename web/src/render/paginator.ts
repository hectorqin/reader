/**
 * Column-based pagination for reflowable content.
 *
 * ## Why not `scroll` mode
 *
 * Continuous scrolling is what every web reader does, and it is the wrong model
 * for a book. A reader's position is measured in pages: the progress indicator,
 * turning back to re-read a paragraph, "3 pages left in this chapter" — all of it
 * assumes a fixed page. A scroll offset is a pixel number that changes meaning
 * when the font size, viewport or column width changes, which is exactly the set
 * of things a reader adjusts.
 *
 * ## Why CSS multi-column instead of measuring by hand
 *
 * The alternative is to wrap every word in a span and binary-search the page
 * break. That rewrites the publisher's markup, which this product refuses to do,
 * and it is slow enough to feel on a chapter with images. Multi-column layout is
 * the browser's own implementation of the same thing: the content is laid out
 * once, columns are created, and a page is a horizontal scroll offset.
 *
 * The cost is that page boundaries land wherever the layout engine puts them.
 * That is acceptable — and it is what every commercial reader does — as long as a
 * *position* survives repagination, which is what the anchor functions below are
 * for.
 *
 * ## Why the scroller is a parameter
 *
 * The chapter lives in an iframe (see `container.ts`), so the element being
 * scrolled belongs to another document. Taking it as a parameter rather than
 * reaching for a global keeps this class testable and keeps the frame's existence
 * out of the pagination arithmetic.
 */

/** A position inside a chapter, anchored to a DOM node so it survives repagination. */
export interface ChapterPosition {
  /** Index of the top-level block the reader was in. */
  blockIndex: number;
  /** How far into that block, as a fraction of its height. */
  offsetRatio: number;
}

export interface PaginatorOptions {
  /** Gap between columns, in CSS pixels. Must match the injected stylesheet. */
  columnGap?: number;
  /** Page padding, in CSS pixels, on each side. Must match the stylesheet. */
  pagePadding?: number;
}

/**
 * Drive a chapter's scrolling element.
 */
export class Paginator {
  private readonly columnGap: number;
  /** Column stride: the exact distance between two page origins. */
  private stride = 0;
  private pageCount = 1;
  private current = 0;

  constructor(private scroller: HTMLElement | null, options: PaginatorOptions = {}) {
    this.columnGap = options.columnGap ?? 32;
    void options.pagePadding;
  }

  /** Point the paginator at a (new) chapter document. */
  attach(scroller: HTMLElement | null): void {
    this.scroller = scroller;
    this.reset();
  }

  /**
   * Recompute the column geometry.
   *
   * `scrollWidth` is the layout engine's answer to "how much content is there",
   * and dividing it by the stride is the only way to learn the page count without
   * duplicating the engine's work. The gap is added back because `scrollWidth`
   * omits the trailing gap that separates the last column from the edge.
   */
  layout(pageWidth?: number): { pageCount: number; stride: number } {
    const scroller = this.scroller;
    if (!scroller) {
      this.stride = 0;
      this.pageCount = 1;
      return { pageCount: 1, stride: 0 };
    }
    const usable = pageWidth ?? scroller.clientWidth;
    // The stride is the distance between two page origins. Deriving it from the
    // *viewport* rather than from the columns keeps it independent of
    // `column-width`, which the publisher's own CSS could influence.
    this.stride = Math.max(1, usable + this.columnGap);

    // The page count comes from the content's real width rather than from a
    // division: `scrollWidth` includes the leading page padding and the column
    // gutters, so dividing it by the stride loses the remainder and drops the
    // last page of a chapter whose content does not fill it exactly. Rounding the
    // division up against the *padded* width is what keeps that page reachable.
    const padded = usable + this.columnGap;
    this.pageCount = Math.max(1, Math.ceil((scroller.scrollWidth - this.columnGap) / padded));
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
    if (this.scroller) this.scroller.scrollLeft = next * this.stride;
    return true;
  }

  /**
   * Move by a relative number of pages.
   *
   * `spill` is the number of pages that did not fit; the caller turns it into a
   * chapter turn. Returning it rather than swallowing it is what makes "the next
   * page past the end of this chapter" a chapter turn instead of a dead gesture.
   */
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
    if (this.scroller) this.scroller.scrollLeft = 0;
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
 * The page index does not: the same index means a different part of the text
 * after a font-size change. Anchoring to the top-level block at the page's
 * leading edge, plus how far into that block, means a reader who resizes the
 * text stays on the sentence they were reading — which is the entire reason
 * readers tolerate changing the font size at all.
 */
export function capturePosition(scroller: HTMLElement | null, page: number, stride: number): ChapterPosition {
  const blocks = topLevelBlocks(scroller);
  if (blocks.length === 0) return { blockIndex: 0, offsetRatio: 0 };

  const origin = page * stride;
  let index = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    // `offsetLeft` is relative to the offsetParent, which for a chapter's blocks
    // is the nearest positioned ancestor. That is stable within a document and
    // the only thing that matters here, since capture and restore both happen
    // against the same document.
    if (block.offsetLeft <= origin + 1) index = i;
    else break;
  }

  const block = blocks[index]!;
  const height = block.offsetHeight || 1;
  const ratio = Math.max(0, Math.min(1, (origin - block.offsetLeft) / height));
  return { blockIndex: index, offsetRatio: ratio };
}

/** Restore a captured position. Returns the page to land on. */
export function restorePosition(scroller: HTMLElement | null, position: ChapterPosition, stride: number): number {
  const blocks = topLevelBlocks(scroller);
  if (blocks.length === 0) return 0;
  const block = blocks[Math.min(position.blockIndex, blocks.length - 1)];
  if (!block) return 0;
  const left = block.offsetLeft + position.offsetRatio * (block.offsetHeight || 0);
  return stride > 0 ? Math.max(0, Math.round(left / stride)) : 0;
}

/**
 * The blocks a position can anchor to.
 *
 * Only the body's direct children are considered. Going deeper would anchor to a
 * `<span>` whose offset changes the moment the publisher's CSS nests differently,
 * and anchors have to be stable across the client's own style tweaks — those
 * changes must not move the reader's place in the book.
 */
function topLevelBlocks(scroller: HTMLElement | null): HTMLElement[] {
  const body = scroller?.ownerDocument?.body;
  if (!body) return [];
  return Array.from(body.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
}
