/**
 * The staged reader's two remaining silent-failure modes.
 *
 * Both of these were live on `main` and neither shows up as a crash: the first
 * makes the contents panel list the window instead of the book, the second makes
 * a jump to a chapter outside the window do nothing at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStagedDoc } from '../src/formats/windowed.ts';
import type { BookContent, ContentItem } from '../src/net/api.ts';

function item(seq: number): ContentItem {
  return {
    id: `c${seq}`,
    seq,
    title: `第 ${seq + 1} 章`,
    kind: 'chapter',
    mediaType: 'application/xhtml+xml',
    href: `xhtml:ch${seq}.xhtml`,
  };
}

function windowAt(offset: number, count: number, total: number): BookContent {
  return {
    kind: 'reflowable',
    total,
    groups: [{ id: `spine:${offset}`, seq: offset / count, title: '窗', count, offset }],
    items: Array.from({ length: count }, (_, i) => item(offset + i)),
    group: offset / count,
  };
}

describe('staged toc and window jumps', () => {
  test('a jump outside the loaded window resolves to the right local index', () => {
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: windowAt(0, 40, 1200),
      loader: { async read() { return { html: '' }; } },
    });

    // Chapter 900 lives in the window starting at 880.
    const local = doc.setWindow(windowAt(880, 40, 1200), 900);
    assert.equal(local, 20, 'local index must be spine minus the window offset');
    assert.equal(doc.sections[20]?.id, 'xhtml:ch900.xhtml');
    assert.equal(doc.windowOffset(), 880);
  });

  test('a chapter that is not in the new window reports failure rather than index 0', () => {
    // The failure this pins: a naive `findIndex` returns -1, and a caller that
    // treats -1 as "0" silently moves the reader to the wrong chapter.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: windowAt(0, 40, 1200),
      loader: { async read() { return { html: '' }; } },
    });
    const local = doc.setWindow(windowAt(0, 40, 1200), 900);
    assert.equal(local, -1);
  });

  test('the loaded window is replaced, not appended to', () => {
    // Appending is the other way this goes wrong: the reader ends up with 80
    // sections for a 40-chapter window and the progress denominator doubles.
    const doc = createStagedDoc({
      kind: 'reflowable',
      toc: [],
      content: windowAt(0, 40, 1200),
      loader: { async read() { return { html: '' }; } },
    });
    assert.equal(doc.sections.length, 40);
    doc.setWindow(windowAt(40, 40, 1200), 40);
    assert.equal(doc.sections.length, 40);
    assert.equal(doc.sections[0]?.id, 'xhtml:ch40.xhtml');
  });
});
