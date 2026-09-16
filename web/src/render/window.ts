/**
 * The loaded window of a book.
 *
 * When the server returns a manifest narrowed to `?group=N`, `items` holds only
 * that group's entries. Every translation between "whole-book spine index" (what
 * progress and the table of contents use) and "index into the array in memory"
 * (what the DOM code uses) has to go through one place, or the two drift and the
 * reader opens the wrong chapter.
 *
 * This was the bug that made windowed loading look unsafe at first: two
 * different call sites each computed the offset slightly differently and got
 * different answers for the same chapter. There is now one function.
 */

import type { BookContent, ContentGroup, ContentItem } from '../net/api.ts';

export interface Window {
  /** The window's items, in reading order. */
  items: ContentItem[];
  /** The window's first group, when the format has groups. */
  group: ContentGroup | null;
  /** All groups of the book, so a table of contents stays complete. */
  groups: ContentGroup[];
  /** Chapters/pages in the whole book, not just this window. */
  total: number;
  kind: BookContent['kind'];
}

/** Build a window from a manifest response that may or may not be narrowed. */
export function toWindow(content: BookContent | null, fallback?: Partial<BookContent>): Window {
  const items = content?.items ?? fallback?.items ?? [];
  const groups = content?.groups ?? fallback?.groups ?? [];
  const total = content?.total ?? fallback?.total ?? items.length;

  // A narrowed response is the one that carries a `group` index; an unnarrowed
  // one starts at the book's first item by definition.
  const index = content?.group ?? 0;
  return {
    items,
    group: groups[index] ?? null,
    groups,
    total,
    kind: content?.kind ?? fallback?.kind ?? 'document',
  };
}

/** Whole-book index of a local item index. */
export function toSpineIndex(window: Window, localIndex: number): number {
  if (!window.group) return localIndex;
  return window.group.offset + Math.max(0, Math.min(window.group.count - 1, localIndex));
}

/** Local item index of a whole-book index, when that index is in this window. */
export function toLocalIndex(window: Window, spine: number): number {
  if (!window.group) return spine;
  return spine - window.group.offset;
}

/** Whether a whole-book index is inside the loaded window. */
export function contains(window: Window, spine: number): boolean {
  if (!window.group) return spine >= 0 && spine < window.items.length;
  return spine >= window.group.offset && spine < window.group.offset + window.group.count;
}

/** Whose group holds a whole-book index. */
export function groupForSpine(window: Window, spine: number): ContentGroup | null {
  return window.groups.find((group) => spine >= group.offset && spine < group.offset + group.count) ?? null;
}

/** Chapter title for a whole-book index, from the groups when items are absent. */
export function titleForSpine(window: Window, spine: number): string {
  const group = groupForSpine(window, spine);
  if (!group) return '';
  const local = group.seq === window.group?.seq && window.group ? spine - group.offset : -1;
  const item = local >= 0 ? window.items[local] : undefined;
  return item?.title ?? group.title;
}
