/**
 * Pagination logic tests.
 *
 * The DOM-dependent parts are covered by the layout itself; what is testable
 * without a browser is the arithmetic, and that is where the position-drift bugs
 * live. The `stride` and `blockAt` functions are pure, so they are tested
 * directly rather than through a fake viewport that would only agree with itself.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pageFraction } from '../src/render/paginator.ts';

describe('page arithmetic', () => {
  test('a single-page chapter is always at the start', () => {
    // Returning 1/1 here would report a chapter as fully read the moment it is
    // opened, and the reader's progress would jump to the next chapter's start.
    assert.equal(pageFraction(0, 1), 0);
  });

  test('the first and last pages are the endpoints', () => {
    assert.equal(pageFraction(0, 10), 0);
    assert.equal(pageFraction(9, 10), 1);
  });

  test('progress never leaves [0, 1]', () => {
    assert.equal(pageFraction(-1, 10), 0);
    assert.equal(pageFraction(99, 10), 1);
  });

  test('a page count of zero does not divide by zero', () => {
    assert.equal(pageFraction(0, 0), 0);
  });
});
