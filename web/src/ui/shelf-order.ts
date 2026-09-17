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

/** A book's sortable key, as a string so every branch compares the same way. */
export function shelfSortKey(book: Book, sort: ShelfSort): string {
  switch (sort) {
    case 'title':
      return book.title ?? '';
    case 'author':
      return book.author ?? '';
    case 'added':
      // `addedAt` is when this account first saw the book; `updatedAt` moves when
      // a file changes on disk. They are different questions and the shelf offers
      // both.
      return String(book.addedAt ?? book.updatedAt ?? 0).padStart(20, '0');
    default:
      return String(book.updatedAt ?? 0).padStart(20, '0');
  }
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

export function sortBooks(books: Book[], sort: ShelfSort): Book[] {
  return [...books].sort((left, right) => compareBooks(left, right, sort));
}
