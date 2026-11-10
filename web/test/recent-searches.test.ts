// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRecentSearches, readRecentSearches, rememberSearch } from '../src/features/search/recent.ts';

describe('最近搜索', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the latest first and a repeated query once', () => {
    rememberSearch('s', '剑来'); rememberSearch('s', ' 雪中 '); rememberSearch('s', '剑来');
    expect(readRecentSearches('s')).toEqual(['剑来', '雪中']);
  });

  it('keeps eight, per account scope, and ignores blanks and broken storage', () => {
    for (let i = 0; i < 10; i++) rememberSearch('s', `q${i}`);
    rememberSearch('s', '   ');
    expect(readRecentSearches('s')).toHaveLength(8);
    expect(readRecentSearches('s')[0]).toBe('q9');
    expect(readRecentSearches('other')).toEqual([]);
    localStorage.setItem('reader.search.recent:s', '{not json');
    expect(readRecentSearches('s')).toEqual([]);
  });

  it('clears', () => {
    rememberSearch('s', '剑来'); clearRecentSearches('s');
    expect(readRecentSearches('s')).toEqual([]);
  });
});
