/**
 * Book identity regression tests.
 *
 * The identity rule is the single most load-bearing decision in the product
 * (design §6): get it wrong and readers lose their progress, which is the most
 * common complaint about self-hosted libraries. Every branch is pinned here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeBookId, resolveBookId } from '../src/indexer/identity.ts';

const hash = (seed: string): string => seed.padEnd(64, '0');

describe('computeBookId', () => {
  test('the same identifier and content give the same id', () => {
    assert.equal(computeBookId('urn:isbn:9787536692930', hash('a')), computeBookId('urn:isbn:9787536692930', hash('a')));
  });

  test('a different identifier separates otherwise identical content', () => {
    assert.notEqual(computeBookId('urn:isbn:1', hash('a')), computeBookId('urn:isbn:2', hash('a')));
  });

  test('a re-encoded copy is a distinct book, not an alias', () => {
    // Same book, different bytes: the design wants it kept as a separate copy
    // rather than silently merged into the existing row.
    assert.notEqual(computeBookId('urn:isbn:1', hash('a')), computeBookId('urn:isbn:1', hash('b')));
  });

  test('the identifier is case and whitespace insensitive', () => {
    assert.equal(computeBookId(' URN:ISBN:ABC ', hash('a')), computeBookId('urn:isbn:abc', hash('a')));
  });

  test('identity never depends on a path', () => {
    // Two calls with identical inputs cannot diverge, which is what makes a
    // rename/move a no-op for progress.
    const fromOld = computeBookId(null, hash('a'));
    const fromNew = computeBookId(null, hash('a'));
    assert.equal(fromOld, fromNew);
  });
});

describe('resolveBookId', () => {
  test('an in-place edit keeps the existing id', () => {
    // Appending a chapter to a txt file must not mint a second book; doing so
    // would drop the reader's progress on the first one.
    const previousId = computeBookId(null, hash('v1'));
    const next = resolveBookId({
      identifier: null,
      contentHash: hash('v2-different'),
      previousId,
      previousIdentifier: null,
    });
    assert.equal(next, previousId);
  });

  test('an edit of an epub without a dc:identifier also keeps its id', () => {
    const previousId = computeBookId(null, hash('v1'));
    assert.equal(
      resolveBookId({ identifier: null, contentHash: hash('v2'), previousId, previousIdentifier: null }),
      previousId,
    );
  });

  test('a genuinely different book at the same path gets a new id', () => {
    // The old file had an identifier and the replacement does not (or vice
    // versa): this is a different book, not an edit, so it must not inherit.
    const previousId = computeBookId('urn:isbn:old', hash('v1'));
    const next = resolveBookId({
      identifier: 'urn:isbn:brand-new',
      contentHash: hash('v2'),
      previousId,
      previousIdentifier: 'urn:isbn:old',
    });
    assert.notEqual(next, previousId);
    assert.equal(next, computeBookId('urn:isbn:brand-new', hash('v2')));
  });

  test('a replaced epub that keeps the same identifier is treated as an edit', () => {
    const identifier = 'urn:isbn:9787536692930';
    const previousId = computeBookId(identifier, hash('v1'));
    const next = resolveBookId({
      identifier,
      contentHash: hash('re-encoded'),
      previousId,
      previousIdentifier: identifier,
    });
    assert.equal(next, previousId, 'the identifier is the anchor, so the id survives re-encoding');
  });

  test('replacing a file that had an identifier with one that has none creates a new book', () => {
    const previousId = computeBookId('urn:isbn:old', hash('v1'));
    const next = resolveBookId({
      identifier: null,
      contentHash: hash('v2'),
      previousId,
      previousIdentifier: 'urn:isbn:old',
    });
    assert.notEqual(next, previousId);
  });

  test('with no previous file the content rule applies', () => {
    const expected = computeBookId(null, hash('fresh'));
    assert.equal(resolveBookId({ identifier: null, contentHash: hash('fresh') }), expected);
  });

  test('renaming still preserves identity through the content rule', () => {
    // No previousId is available under a brand-new path, so identity falls back
    // to the content hash — which is exactly why a rename keeps progress.
    const original = computeBookId(null, hash('same-bytes'));
    const afterRename = resolveBookId({ identifier: null, contentHash: hash('same-bytes') });
    assert.equal(afterRename, original);
  });
});
