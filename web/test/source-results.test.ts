import { expect, it } from 'vitest';
import { groupSourceResults } from '../src/ui/source-results.ts';

it('groups normalized titles and author sets but preserves each unique reference', () => {
  const entries = [
    { ref: 'a', title: 'Ａ书', authors: ['作者甲', '作者乙'] },
    { ref: 'b', title: 'A 书', authors: ['作者乙', '作者甲'] },
    { ref: 'c', title: 'A书', authors: ['另一作者'] },
    { ref: 'd', title: 'A书' }, { ref: 'e', title: 'A书', authors: [' '] },
  ];
  const groups = groupSourceResults([...entries, entries[0]!], true);
  expect(groups).toHaveLength(4);
  expect(groups[0]!.entries.map(entry => entry.ref)).toEqual(['a', 'b']);
  expect(groupSourceResults(entries, false)).toHaveLength(5);
});
