import { describe, expect, it } from 'vitest';
import { bookPercentage, formatLocator, parseLocator } from '../src/ui/locator.ts';
import type { BookDoc, Section } from '../src/formats/types.ts';

function doc(sections: Array<Partial<Section>>): BookDoc {
  return {
    format: 'epub',
    layout: 'reflowable',
    render: 'reflowable',
    direction: 'ltr',
    sections: sections.map((section, index) => ({
      id: section.id ?? `s${index}`,
      label: section.label ?? `第 ${index} 章`,
      html: section.html ?? '<p>' + 'x'.repeat(500) + '</p>',
      depth: 0,
    })),
    toc: [],
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

describe('locator format', () => {
  it('round-trips a position', () => {
    const book = doc([{ id: 'ch1' }, { id: 'ch2' }]);
    const locator = formatLocator('ch2', 0.42);
    const parsed = parseLocator(locator, book);
    expect(parsed?.sectionId).toBe('ch2');
    expect(parsed?.offset).toBeCloseTo(0.42, 3);
  });

  it('clamps an out-of-range offset instead of trusting it', () => {
    const book = doc([{ id: 'ch1' }]);
    expect(parseLocator(formatLocator('ch1', 5), book)?.offset).toBe(1);
    expect(parseLocator(formatLocator('ch1', -3), book)?.offset).toBe(0);
  });

  it('rejects a locator for a section that no longer exists', () => {
    // The book changed on disk under the reader. Returning null lets the reader
    // say so instead of silently pretending page one is where they left off.
    const book = doc([{ id: 'ch1' }]);
    expect(parseLocator('gone:0.5', book)).toBeNull();
  });

  it('does not treat an EPUB CFI from another client as a position it understands', () => {
    // The server stores locators opaquely, so a CFI written by a different
    // client can arrive here. It must be refused, not misparsed as a section id.
    const book = doc([{ id: 'ch1' }]);
    expect(parseLocator('epubcfi(/6/4!/4/2)', book)).toBeNull();
  });

  it('accepts a bare section id as the start of that section', () => {
    const book = doc([{ id: 's0' }, { id: 'ch2' }]);
    const parsed = parseLocator('ch2', book);
    expect(parsed?.offset).toBe(0);
    expect(parsed?.percentage).toBeCloseTo(0.5, 3);
  });

  it('rejects an empty locator', () => {
    expect(parseLocator('', doc([{ id: 'a' }]))).toBeNull();
  });

  it('treats a non-numeric offset as the start of the section', () => {
    // A corrupt offset must not cost the reader the *chapter* as well: the
    // section id is still good information.
    const book = doc([{ id: 'ch1' }]);
    expect(parseLocator('r1:not-a-number:ch1', book)?.offset).toBe(0);
  });

  it('keeps a section id that itself contains a colon', () => {
    // Windows-authored EPUBs produce hrefs like `OEBPS\text:ch1.xhtml`, and a
    // naive split would truncate the id and lose the position entirely.
    const book = doc([{ id: 'OEBPS/text:ch1.xhtml' }]);
    const parsed = parseLocator(formatLocator('OEBPS/text:ch1.xhtml', 0.5), book);
    expect(parsed?.sectionId).toBe('OEBPS/text:ch1.xhtml');
    expect(parsed?.offset).toBeCloseTo(0.5, 3);
  });

  it('refuses a versioned locator with no section id', () => {
    const book = doc([{ id: 'ch1' }]);
    expect(parseLocator('r1:0.5:', book)).toBeNull();
  });

  it('reads a legacy unversioned locator so an upgrade does not lose the place', () => {
    const book = doc([{ id: 'ch1' }, { id: 'ch2' }]);
    const parsed = parseLocator('ch2:0.25', book);
    expect(parsed?.sectionId).toBe('ch2');
    expect(parsed?.offset).toBeCloseTo(0.25, 3);
  });

  it('treats a bare page number as that page', () => {
    const book = doc([{ id: 'p1' }, { id: 'p2' }]);
    expect(parseLocator('1', book)?.sectionId).toBe('p2');
  });
});

describe('book percentage', () => {
  it('is 0 at the start and approaches 1 at the end', () => {
    const book = doc([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(bookPercentage(book, 0, 0)).toBe(0);
    expect(bookPercentage(book, 2, 1)).toBeCloseTo(1, 5);
  });

  it('weights sections by length so an uneven book does not lie about progress', () => {
    // Three short chapters and one enormous one. At the start of the big chapter
    // a naive index/count calculation would claim two thirds done.
    const short = { html: '<p>' + 'x'.repeat(400) + '</p>' };
    const book = doc([
      short,
      short,
      short,
      { html: '<p>' + 'x'.repeat(40_000) + '</p>' },
    ]);
    const atStartOfBig = bookPercentage(book, 3, 0);
    const naive = 3 / 4;
    expect(atStartOfBig).toBeLessThan(naive);
    expect(atStartOfBig).toBeLessThan(0.2);
    expect(bookPercentage(book, 3, 1)).toBeCloseTo(1, 5);
  });

  it('gives every page equal weight in a fixed-layout book', () => {
    const book: BookDoc = { ...doc([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }]), layout: 'fixed' };
    expect(bookPercentage(book, 2, 0)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for a book with no sections rather than NaN', () => {
    expect(bookPercentage(doc([]), 0, 0)).toBe(0);
  });

  it('is monotonic across a full traversal', () => {
    const book = doc([{ id: 'a' }, { id: 'b', html: '<p>' + 'y'.repeat(5000) + '</p>' }]);
    let previous = -1;
    for (let index = 0; index < book.sections.length; index += 1) {
      for (const within of [0, 0.5, 1]) {
        const value = bookPercentage(book, index, within);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });
});
