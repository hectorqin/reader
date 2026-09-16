/**
 * Locator tests.
 *
 * A reading position is the one piece of state a reader notices being wrong. It
 * has to survive a font change, a rotation, and another device — and it has to be
 * readable when a previous version of the client wrote it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bookPercent, parseLocator, serializeLocator } from '../src/lib/locator.ts';

describe('locators', () => {
  test('a locator survives a round trip', () => {
    const original = { chapter: 'xhtml:OEBPS/ch7.xhtml', spine: 6, block: 3, ratio: 0.42, percent: 0.31 };
    const parsed = parseLocator(serializeLocator(original));
    assert.deepEqual(parsed, original);
  });

  test('a bare chapter reference from an older build still resolves', () => {
    // Three lines of tolerance, in exchange for not losing the position of every
    // reader who had one stored under the old format.
    const parsed = parseLocator('xhtml:OEBPS/ch7.xhtml');
    assert.equal(parsed?.chapter, 'xhtml:OEBPS/ch7.xhtml');
    assert.equal(parsed?.spine, 0);
  });

  test('nonsense resolves to nothing rather than to the start of the book', () => {
    // Returning a zeroed locator here would silently move a reader to page one.
    // Null lets the caller treat it as "no position", which is different.
    assert.equal(parseLocator(''), null);
    assert.equal(parseLocator('{}'), null);
    assert.equal(parseLocator('{"chapter":42}'), null);
    assert.equal(parseLocator('not json at all'), null);
  });

  test('out-of-range fractions are clamped rather than trusted', () => {
    const parsed = parseLocator(JSON.stringify({ chapter: 'a', spine: 1, block: 0, ratio: 9, percent: -3 }));
    assert.equal(parsed?.ratio, 1);
    assert.equal(parsed?.percent, 0);
  });

  test('book progress weights the chapter, so mid-book reads mid-book', () => {
    // A reader halfway through chapter 50 of 100 is 50% through the book, not
    // 0%. Weighting by character count would be better and is unavailable: the
    // server honestly reports no per-chapter length, and inventing one would put
    // a wrong number under the reader's thumb.
    assert.equal(bookPercent(50, 100, 0.5), 0.505);
    assert.equal(bookPercent(0, 100, 0), 0);
    assert.equal(bookPercent(99, 100, 1), 1);
    // Never beyond 1, however the caller's arithmetic went.
    assert.equal(bookPercent(200, 100, 0.5), 1);
  });

  test('a book with no chapters reports no progress instead of dividing by zero', () => {
    assert.equal(bookPercent(0, 0, 0.5), 0);
  });
});
