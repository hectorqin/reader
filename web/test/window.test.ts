/**
 * Window arithmetic tests.
 *
 * This is the highest-risk logic in the client: every translation between a
 * whole-book index and an index into the loaded array goes through it, and a
 * mistake shows up as "resume opens the wrong chapter" — which the user only
 * notices after their position has been corrupted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contains, groupForSpine, toLocalIndex, toSpineIndex, toWindow } from '../src/render/window.ts';
import type { BookContent, ContentItem } from '../src/net/api.ts';

function items(from: number, count: number): ContentItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${from + i}`,
    seq: from + i,
    title: `第 ${from + i + 1} 章`,
    kind: 'chapter' as const,
    mediaType: 'application/xhtml+xml',
    href: `xhtml:ch${from + i}.xhtml`,
  }));
}

/** A windowed manifest: chapters 40..79 of a 200-chapter book, window size 40. */
function windowedContent(): BookContent {
  return {
    kind: 'reflowable',
    total: 200,
    groups: [
      { id: 'spine:0', seq: 0, title: '1–40', count: 40, offset: 0 },
      { id: 'spine:40', seq: 1, title: '41–80', count: 40, offset: 40 },
      { id: 'spine:80', seq: 2, title: '81–120', count: 40, offset: 80 },
    ],
    items: items(40, 40),
    group: 1,
  };
}

describe('window arithmetic', () => {
  test('a windowed response reports the group it actually carries', () => {
    const window = toWindow(windowedContent());
    assert.equal(window.group?.offset, 40);
    assert.equal(window.total, 200);
    assert.equal(window.items.length, 40);
  });

  test('local index 0 maps to the window group offset, not to 0', () => {
    // The bug this pins: computing the spine index from the array position makes
    // chapter 41 look like chapter 1, so a synced position lands 40 chapters
    // early and the reader's next device resumes in the wrong place.
    const window = toWindow(windowedContent());
    assert.equal(toSpineIndex(window, 0), 40);
    assert.equal(toSpineIndex(window, 7), 47);
    assert.equal(toLocalIndex(window, 40), 0);
    assert.equal(toLocalIndex(window, 47), 7);
  });

  test('round-tripping a spine index through local and back is stable', () => {
    const window = toWindow(windowedContent());
    for (const spine of [40, 55, 79]) {
      assert.equal(toSpineIndex(window, toLocalIndex(window, spine)), spine);
    }
  });

  test('an unwindowed response has no group and identity offsets', () => {
    const content: BookContent = { kind: 'paged', total: 3, groups: [{ id: 'p', seq: 0, title: '页', count: 3, offset: 0 }], items: items(0, 3) };
    const window = toWindow(content);
    assert.equal(toSpineIndex(window, 2), 2);
    assert.equal(toLocalIndex(window, 2), 2);
  });

  test('containment is answered from the group, not from the array length', () => {
    const window = toWindow(windowedContent());
    // Chapter 5 exists in the book but not in this window: a jump to it must
    // trigger a fetch, and answering from `items.length` would wrongly claim it.
    assert.equal(contains(window, 5), false);
    assert.equal(contains(window, 40), true);
    assert.equal(contains(window, 79), true);
    // Chapter 81 belongs to a group that is not loaded.
    assert.equal(contains(window, 81), false);
    assert.equal(contains(window, 120), false);
  });

  test('a spine index resolves to the group that holds it', () => {
    const window = toWindow(windowedContent());
    assert.equal(groupForSpine(window, 0)?.seq, 0);
    assert.equal(groupForSpine(window, 39)?.seq, 0);
    assert.equal(groupForSpine(window, 40)?.seq, 1);
    // The fixture declares three windows; spine 199 is beyond all of them, so
    // the caller must treat it as unreachable rather than as the last group.
    assert.equal(groupForSpine(window, 119)?.seq, 2);
    assert.equal(groupForSpine(window, 199), null);
    assert.equal(groupForSpine(window, 500), null);
  });

  test('a manifest without content falls back to the flat fields', () => {
    // The server sends `content` plus flattened copies for older clients; a build
    // that predates `content` must still open the book.
    const window = toWindow(null, { kind: 'paged', total: 2, items: items(0, 2), groups: [] });
    assert.equal(window.kind, 'paged');
    assert.equal(window.items.length, 2);
  });
});
