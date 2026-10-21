import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppRuntime } from '../../../app/runtime.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import type { ReadingState } from '../../../api/types.ts';

/**
 * What narrows the shelf besides the search: 在读 / 想读 / 已读, and one 分组 — a
 * series or a tag, the two groupings the books themselves carry.
 */
export interface ShelfFilters { status?: ReadingState; series?: string; tag?: string }

export function shelfQuery(runtime: AppRuntime, page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '', filters: ShelfFilters = {}) {
  const apiSort = sort === 'recent' ? 'updated' : sort;
  return queryOptions({
    queryKey: ['shelf', runtime.api.baseUrl, runtime.api.currentSession()?.user.id, page, sort, search, filters.status ?? '', filters.series ?? '', filters.tag ?? ''],
    queryFn: ({ signal }) => runtime.api.listBooks({
      scope: 'shelf', page, pageSize: 60, sort: apiSort, order: sort === 'title' || sort === 'author' ? 'asc' : 'desc', search: search.trim(),
      ...(filters.status ? { status: filters.status } : {}), ...(filters.series ? { series: filters.series } : {}), ...(filters.tag ? { tag: filters.tag } : {}),
    }, { signal }),
  });
}

export function useShelf(page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '', filters: ShelfFilters = {}) {
  return useQuery(shelfQuery(useRuntime(), page, sort, search, filters));
}

/** Series and tags on this account's shelf: the choices behind 分组. */
export function useShelfGroups(enabled: boolean) {
  const runtime = useRuntime();
  return useQuery({
    queryKey: ['shelf-groups', runtime.api.baseUrl, runtime.api.currentSession()?.user.id],
    queryFn: ({ signal }) => runtime.api.facets({ signal }),
    enabled,
  });
}
