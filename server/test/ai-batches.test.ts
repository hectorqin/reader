import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPathBatches } from '../src/services/ai.ts';

test('no batch exceeds the configured size, even for one huge folder', () => {
  const season = Array.from({ length: 120 }, (_, i) => `Show/S01/E${String(i + 1).padStart(3, '0')}.mkv`);
  const batches = splitPathBatches(season, 50);
  assert.deepEqual(batches.map((b) => b.length), [50, 50, 20]);
  assert.deepEqual(batches.flat(), season, 'every path is kept, in order');
});

test('small folders are packed together without being split', () => {
  const paths = ['A/1.mkv', 'A/2.mkv', 'B/1.mkv', 'B/2.mkv', 'C/1.mkv'];
  assert.deepEqual(splitPathBatches(paths, 4), [['A/1.mkv', 'A/2.mkv', 'B/1.mkv', 'B/2.mkv'], ['C/1.mkv']]);
});

test('an oversized folder does not absorb the pending small batch', () => {
  const paths = ['A/1.mkv', ...Array.from({ length: 5 }, (_, i) => `Big/${i}.mkv`), 'C/1.mkv'];
  assert.deepEqual(splitPathBatches(paths, 3).map((b) => b.length), [1, 3, 2, 1]);
});

test('a non-positive size still makes progress', () => {
  assert.deepEqual(splitPathBatches(['a', 'b'], 0), [['a'], ['b']]);
});
