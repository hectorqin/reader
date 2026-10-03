import { describe, expect, it } from 'vitest';
import { mergePages } from '../src/features/sources/pages/SourceCatalogPage.tsx';

describe('source catalog page helpers', () => {
  it('merges streamed result batches by ref and keeps pagination metadata', () => {
    const first = mergePages(undefined, { items: [{ ref: 'a', title: 'A' }], nextCursor: 'next-1' });
    const second = mergePages(first, { items: [{ ref: 'a', title: 'A updated', latestChapter: '第 2 章' }, { ref: 'b', title: 'B' }], nextCursor: 'next-2', batch: { completed: 2, total: 3 } });
    expect(second.items).toEqual([{ ref: 'a', title: 'A updated', latestChapter: '第 2 章' }, { ref: 'b', title: 'B' }]);
    expect(second.nextCursor).toBe('next-2');
    expect(second.batch?.completed).toBe(2);
  });
});
