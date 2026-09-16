/**
 * Reading positions.
 *
 * A position must survive three things a reader does constantly: changing the
 * font size, rotating the phone, and reading the same book on another device.
 * That rules out a page index (changes with the font) and a pixel offset
 * (changes with everything).
 *
 * What is stored instead is a small record:
 *
 *   { chapter: <archive path>, spine: <index>, block: <n>, ratio: <0..1>, percent }
 *
 *  - `chapter` is the server's own identity for a chapter (its archive path). It
 *    is stable across repagination and across devices, which is what makes the
 *    sync endpoint's `locator` field useful. It is a plain string, not an EPUB
 *    CFI: the server never has to parse it, and a CFI would only work for EPUB
 *    anyway — a comic's position is a page index, a PDF's is a page number.
 *  - `block`/`ratio` place the reader inside the chapter, tolerantly: a missing
 *    block falls back to the start of the chapter rather than to the start of
 *    the book.
 *  - `percent` is for the progress indicator, computed against the spine the
 *    client knows exactly (chapter index / chapter count), never against a
 *    character count nobody measured.
 */

export interface Locator {
  /** Format-private chapter identity; the manifest's `href`. */
  chapter: string;
  /** Index of the chapter in the spine, when the book has one. */
  spine: number;
  /** Top-level block index inside the chapter. */
  block: number;
  /** Fraction into that block. */
  ratio: number;
  /** Whole-book progress in [0, 1]. */
  percent: number;
}

/** Parse a stored locator, tolerating anything the server or an older client wrote. */
export function parseLocator(value: string): Locator | null {
  if (!value) return null;

  // Older builds wrote a bare chapter reference. Accepting it costs three lines
  // and saves every reader who had a position stored under that format — but only
  // when the value actually looks like a reference. A truncated or corrupted
  // value must fall through to null, because treating it as a chapter href would
  // send the reader to wherever that string happens to sort in the manifest.
  if (!value.startsWith('{')) {
    return /^[\w-]+:/.test(value) ? { chapter: value, spine: 0, block: 0, ratio: 0, percent: 0 } : null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<Locator>;
    if (typeof parsed.chapter !== 'string') return null;
    return {
      chapter: parsed.chapter,
      spine: numberOr(parsed.spine, 0),
      block: numberOr(parsed.block, 0),
      ratio: clampRatio(parsed.ratio),
      percent: clampRatio(parsed.percent),
    };
  } catch {
    return null;
  }
}

export function serializeLocator(locator: Locator): string {
  return JSON.stringify(locator);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Whole-book progress from a spine position.
 *
 * Within-chapter progress is weighted by the chapter's share of the spine, so a
 * reader at the middle of chapter 50 of 100 reads 50% and not 0%. Weighting by
 * character count would be more accurate and is not available — the server
 * reports a chapter count and honestly reports no length, so this uses what
 * exists rather than inventing the rest.
 */
export function bookPercent(spine: number, spineTotal: number, fractionInChapter: number): number {
  if (spineTotal <= 0) return 0;
  return Math.max(0, Math.min(1, (spine + fractionInChapter) / spineTotal));
}
