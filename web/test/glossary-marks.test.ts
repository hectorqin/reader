import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGlossaryMatchSpans, type GlossaryTermRef } from '../src/ui/glossary-marks.ts';

test('findGlossaryMatchSpans prefers longest needles, avoids overlaps, and caps occurrences', () => {
  const terms: GlossaryTermRef[] = [
    { key: 'item:青云玉佩', label: '青云玉佩', category: 'item', needles: ['青云玉佩', '玉佩'] },
    { key: 'character:林默', label: '林默', category: 'character', needles: ['林默', '默'] },
  ];
  const text = '林默拿起青云玉佩仔细端详，这枚玉佩冰凉刺骨。林默又看了一眼林默自己的玉佩。';
  const spans = findGlossaryMatchSpans(text, terms, 2, 10);

  // Single-char alias '默' is ignored; '青云玉佩' matches as a whole without overlapping '玉佩'
  assert.deepEqual(
    spans.map((s) => [s.term.label, text.slice(s.start, s.end)]),
    [
      ['林默', '林默'],
      ['青云玉佩', '青云玉佩'],
      ['青云玉佩', '玉佩'],
      ['林默', '林默'],
    ],
  );
  // Each term is capped at maxPerTerm = 2
  assert.equal(spans.filter((s) => s.term.label === '林默').length, 2);
  assert.equal(spans.filter((s) => s.term.label === '青云玉佩').length, 2);
});
