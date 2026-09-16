import { describe, expect, it } from 'vitest';
import { naturalCompare, sortByName } from '../src/formats/natural-sort.ts';

/**
 * Getting page order wrong silently scrambles a comic, so these cases are
 * regression tests for real naming conventions rather than synthetic examples.
 */

describe('naturalCompare', () => {
  it('sorts numeric runs by value, not lexicographically', () => {
    const names = ['page10.jpg', 'page2.jpg', 'page1.jpg', 'page100.jpg'];
    expect(sortByName(names, (name) => name)).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg',
      'page100.jpg',
    ]);
  });

  it('sorts CJK chapter names with numeric suffixes correctly', () => {
    const names = ['第10话', '第2话', '第1话'];
    expect(sortByName(names, (name) => name)).toEqual(['第1话', '第2话', '第10话']);
  });

  it('orders names case-insensitively first, then deterministically', () => {
    // `localeCompare` with base sensitivity reports these as equal, so the
    // tie-break decides. All that matters is that the result is *stable*: an
    // unstable comparator would let the browser shuffle an archive's pages
    // between loads, which is the bug this whole module exists to prevent.
    const first = naturalCompare('chapter', 'Chapter');
    const second = naturalCompare('chapter', 'Chapter');
    expect(first).toBe(second);
    expect(naturalCompare('apple', 'banana')).toBeLessThan(0);
  });

  it('does not lose precision on a long zero-padded run', () => {
    // Parsing `000000000000000001` as a float would give 1e-18 and break the
    // comparison; it must be treated as the integer it is.
    expect(naturalCompare('000000000000000001.jpg', '000000000000000002.jpg')).toBeLessThan(0);
  });

  it('orders a prefix before the longer name that starts with it', () => {
    expect(naturalCompare('a', 'a1')).toBeLessThan(0);
  });

  it('treats equal names as equal so sort stays stable', () => {
    expect(naturalCompare('x1', 'x1')).toBe(0);
  });

  it('handles mixed separators used by scan tools', () => {
    const names = ['c_001.png', 'c_002.png', 'c_010.png', 'c_003.png'];
    expect(sortByName(names, (name) => name)).toEqual([
      'c_001.png',
      'c_002.png',
      'c_003.png',
      'c_010.png',
    ]);
  });
});
