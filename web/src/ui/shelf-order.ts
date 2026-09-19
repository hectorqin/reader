/**
 * Shelf ordering, in one place.
 *
 * Extracted from the screen because it has to agree with the server: the client
 * sorts its *cached* shelf while offline and the server sorts the real one, and a
 * library that reorders itself when a phone goes through a tunnel reads as the app
 * having lost the reader's choice. Keeping both rules in one function is how they
 * stay the same rule.
 *
 * `localeCompare` with `numeric: true` is the part that matters for Chinese
 * libraries: a plain string compare puts 第10章 before 第9章, because '1' < '9'.
 */

import type { Book } from '../api/types.ts';
import type { ShelfSort } from '../store/settings.ts';

/**
 * Direction for a sort key.
 *
 * Title and author ascend — a reader who asks for "by title" means A→Z. The date
 * sorts descend, because "recent" means newest first, and nobody has ever asked
 * for their oldest book at the top of the shelf.
 */
export function shelfOrder(sort: ShelfSort): 'asc' | 'desc' {
  return sort === 'title' || sort === 'author' ? 'asc' : 'desc';
}

/**
 * The key the *server* knows this sort by.
 *
 * The client and the server do not have the same vocabulary for two reasons, and
 * neither is negotiable:
 *
 *  - **`recent` has no server equivalent.** It orders by *reading* time, and the
 *    progress rows that carry it live on the `/library/continue` endpoint rather
 *    than on the book list. The client has that data (it is the same store the
 *    shelf draws its progress bars from), so the ordering is done on this side.
 *  - **`updated` is not a server sort key.** The server offers `title`, `author`,
 *    `added` and `updated`, and `updated` there means the *file's* mtime, which is
 *    a different question from "when did I acquire this" — so the client only ever
 *    asks for `added`.
 *
 * A device-local ordering also has the property the reader wants from it: it is
 * stable while a page is turned, because it does not depend on the network.
 */
export function shelfServerSort(sort: ShelfSort): 'title' | 'author' | 'added' {
  return sort === 'title' || sort === 'author' ? sort : 'added';
}

/**
 * Whether a sort is done on the client, over the whole cached shelf.
 *
 * This decides something visible, which is why it is a named function rather than
 * a condition at one call site: a **client-side sort must fetch every book**, because
 * sorting one page of sixty and drawing it under a pager that says "page 1 of 34"
 * is a lie about the order of the other thirty-three pages. A server-side sort can
 * page, because the server is the one doing the ordering.
 */
export function isLocalSort(sort: ShelfSort): boolean {
  return sort === 'recent';
}

/** A book's sortable key, as a string so every branch compares the same way. */
export function shelfSortKey(book: Book, sort: ShelfSort): string {
  switch (sort) {
    case 'title':
      return book.title ?? '';
    case 'author':
      return book.author ?? '';
    case 'added':
      // `addedAt` is when this account first saw the book; `updatedAt` moves when
      // a file changes on disk. The shelf offers the acquisition date, so that is
      // what is compared — and `updatedAt` is only the fallback for a server that
      // predates the field.
      return String(book.addedAt ?? book.updatedAt ?? 0).padStart(20, '0');
    default:
      // `recent` is *not* a key on the book: it is the reading time, which lives on
      // the progress row. See `sortByRecency`, which takes the map the shelf keeps
      // for exactly this.
      return '0';
  }
}

/**
 * How recently each book was read, as a lookup for the `recent` sort.
 *
 * Built from the continue-reading responses rather than from the sync store: the
 * server computes `lastReadAt` across devices, so a book finished on a phone sorts
 * to the top on the tablet. The value is a *timestamp*, and a book that has never
 * been opened has none — which is the ordering's whole point, because "never
 * started" is the correct position at the bottom of "where was I".
 */
export type ReadingTimes = ReadonlyMap<string, number>;

/** Newest read first, never-opened books last, ties broken on the book id. */
export function sortByRecency(books: Book[], times: ReadingTimes): Book[] {
  return [...books].sort((left, right) => {
    const leftAt = times.get(left.id) ?? 0;
    const rightAt = times.get(right.id) ?? 0;
    if (leftAt !== rightAt) return rightAt - leftAt;
    // A stable tie-break, for the same reason `compareBooks` has one: two books
    // opened in the same second must not swap places between two renders.
    return left.id.localeCompare(right.id);
  });
}

export function compareBooks(left: Book, right: Book, sort: ShelfSort): number {
  const direction = shelfOrder(sort) === 'asc' ? 1 : -1;
  const result = shelfSortKey(left, sort).localeCompare(shelfSortKey(right, sort), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
  // A stable tie-break on id: without it, two books added in the same second
  // could swap places between two renders, which looks like the shelf shuffling
  // itself under the reader's thumb.
  if (result !== 0) return result * direction;
  return left.id.localeCompare(right.id);
}

export function sortBooks(books: Book[], sort: ShelfSort, times?: ReadingTimes): Book[] {
  // `recent` is the one key the books themselves cannot answer, so it is routed
  // rather than squeezed through `compareBooks` with an empty key.
  if (sort === 'recent') return sortByRecency(books, times ?? new Map());
  return [...books].sort((left, right) => compareBooks(left, right, sort));
}
