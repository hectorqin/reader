import { describe, expect, it } from 'vitest';
import { shelfOrder, shelfSortKey, sortBooks } from '../src/ui/shelf-order.ts';
import type { Book } from '../src/api/types.ts';

/**
 * Shelf ordering.
 *
 * The rule has to match the server's, because the client sorts its own cache and
 * the server sorts the real list. A mismatch shows up as a library that reorders
 * itself when a phone goes offline — which reads as the reader's setting having
 * been ignored.
 */

function book(partial: Partial<Book> & { id: string }): Book {
  return {
    title: '',
    author: '',
    publisher: '',
    language: '',
    isbn: '',
    description: '',
    series: '',
    seriesIndex: null,
    tags: [],
    pubdate: '',
    format: 'epub',
    coverUrl: null,
    fileSize: 0,
    pageCount: null,
    source: '',
    manualFields: [],
    updatedAt: 0,
    ...partial,
  };
}

describe('shelfOrder', () => {
  it('ascends for name keys and descends for dates', () => {
    // A reader who asks for "by title" means A→Z; "recent" means newest first.
    expect(shelfOrder('title')).toBe('asc');
    expect(shelfOrder('author')).toBe('asc');
    expect(shelfOrder('updated')).toBe('desc');
    expect(shelfOrder('added')).toBe('desc');
  });
});

describe('sortBooks', () => {
  it('sorts Chinese chapter titles numerically', () => {
    const books = [
      book({ id: 'a', title: '第10章' }),
      book({ id: 'b', title: '第9章' }),
      book({ id: 'c', title: '第2章' }),
    ];
    // Plain string comparison would give 第10章 < 第2章 < 第9章, which is the bug
    // `numeric: true` exists to prevent.
    expect(sortBooks(books, 'title').map((entry) => entry.title)).toEqual(['第2章', '第9章', '第10章']);
  });

  it('puts the newest first for a date sort', () => {
    const books = [
      book({ id: 'old', title: 'Old', updatedAt: 100 }),
      book({ id: 'new', title: 'New', updatedAt: 300 }),
      book({ id: 'mid', title: 'Mid', updatedAt: 200 }),
    ];
    expect(sortBooks(books, 'updated').map((entry) => entry.id)).toEqual(['new', 'mid', 'old']);
  });

  it('uses addedAt for the acquisition sort, not the file mtime', () => {
    const books = [
      // A book acquired yesterday whose file was replaced today.
      book({ id: 'replaced', addedAt: 100, updatedAt: 900 }),
      book({ id: 'acquired', addedAt: 500, updatedAt: 500 }),
    ];
    // "最近入库" asks about acquisition, "最近更新" asks about the file. Collapsing
    // them would answer neither question.
    expect(sortBooks(books, 'added').map((entry) => entry.id)).toEqual(['acquired', 'replaced']);
    expect(sortBooks(books, 'updated').map((entry) => entry.id)).toEqual(['replaced', 'acquired']);
  });

  it('falls back to updatedAt when the server does not send addedAt', () => {
    const older = book({ id: 'older', updatedAt: 100 });
    const newer = book({ id: 'newer', updatedAt: 200 });
    // An older server omits the field; the shelf must still order, not throw.
    expect(sortBooks([older, newer], 'added').map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  it('is stable for books that tie, so the grid does not shuffle between renders', () => {
    const books = [
      book({ id: 'z', title: 'Same', updatedAt: 100 }),
      book({ id: 'a', title: 'Same', updatedAt: 100 }),
    ];
    const first = sortBooks(books, 'title').map((entry) => entry.id);
    const second = sortBooks([...books].reverse(), 'title').map((entry) => entry.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['a', 'z']);
  });

  it('does not mutate the array it is given', () => {
    const books = [book({ id: 'b', title: 'B' }), book({ id: 'a', title: 'A' })];
    sortBooks(books, 'title');
    expect(books.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('has a key for every sort', () => {
    const sample = book({ id: 'x', title: 'T', author: 'A', addedAt: 5, updatedAt: 7 });
    for (const sort of ['title', 'author', 'added', 'updated'] as const) {
      expect(shelfSortKey(sample, sort)).toBeTruthy();
    }
  });
});
