import { describe, expect, it } from 'vitest';
import { isLocalSort, shelfOrder, shelfServerSort, shelfSortKey, sortBooks, sortByRecency } from '../src/ui/shelf-order.ts';
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
    expect(shelfOrder('recent')).toBe('desc');
    expect(shelfOrder('added')).toBe('desc');
  });
});

describe('the client/server sort split', () => {
  it('translates every client sort into one the server knows', () => {
    // `recent` is a reading-time order and the server has no equivalent, so it
    // rides on an `added` page the client is about to re-sort. Sending the client's
    // own vocabulary would be a 400 the day the server validates the parameter.
    expect(shelfServerSort('recent')).toBe('added');
    expect(shelfServerSort('added')).toBe('added');
    expect(shelfServerSort('title')).toBe('title');
    expect(shelfServerSort('author')).toBe('author');
  });

  it('says which sorts must be done over the whole shelf', () => {
    // A client-side sort cannot page: sorting one page and drawing it under a pager
    // that says "page 1 of 34" is a lie about the other thirty-three.
    expect(isLocalSort('recent')).toBe(true);
    expect(isLocalSort('added')).toBe(false);
    expect(isLocalSort('title')).toBe(false);
    expect(isLocalSort('author')).toBe(false);
  });
});

describe('sortByRecency', () => {
  it('puts the most recently read first and never-opened books last', () => {
    const books = [
      book({ id: 'never' }),
      book({ id: 'yesterday' }),
      book({ id: 'today' }),
    ];
    const times = new Map([
      ['today', 900],
      ['yesterday', 500],
    ]);
    // "Never opened" is not "read at time zero" — it is absent, and absent belongs at
    // the bottom, which is what `?? 0` produces.
    expect(sortByRecency(books, times).map((entry) => entry.id)).toEqual(['today', 'yesterday', 'never']);
  });

  it('is stable for two books read in the same second', () => {
    const books = [book({ id: 'z' }), book({ id: 'a' })];
    const times = new Map([
      ['z', 100],
      ['a', 100],
    ]);
    expect(sortByRecency(books, times).map((entry) => entry.id)).toEqual(['a', 'z']);
  });

  it('is what `sortBooks` routes `recent` to', () => {
    const books = [book({ id: 'old', updatedAt: 900 }), book({ id: 'new', updatedAt: 1 })];
    const times = new Map([['new', 999]]);
    // The book that was *updated* most recently is not the one that was *read* most
    // recently, and `recent` asks the second question.
    expect(sortBooks(books, 'recent', times).map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(sortBooks(books, 'added').map((entry) => entry.id)).toEqual(['old', 'new']);
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

  it('puts the newest acquisition first', () => {
    const books = [
      book({ id: 'old', title: 'Old', addedAt: 100 }),
      book({ id: 'new', title: 'New', addedAt: 300 }),
      book({ id: 'mid', title: 'Mid', addedAt: 200 }),
    ];
    expect(sortBooks(books, 'added').map((entry) => entry.id)).toEqual(['new', 'mid', 'old']);
  });

  it('uses addedAt for the acquisition sort, not the file mtime', () => {
    const books = [
      // A book acquired yesterday whose file was replaced today.
      book({ id: 'replaced', addedAt: 100, updatedAt: 900 }),
      book({ id: 'acquired', addedAt: 500, updatedAt: 500 }),
    ];
    // "最近入库" asks about acquisition, not about when the file last changed. The
    // two are different questions, and `updated` is not a sort the shelf offers —
    // the acquisition date is what a reader means by "最近".
    expect(sortBooks(books, 'added').map((entry) => entry.id)).toEqual(['acquired', 'replaced']);
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
    for (const sort of ['title', 'author', 'added', 'recent'] as const) {
      expect(shelfSortKey(sample, sort)).toBeTruthy();
    }
  });
});
