import { queryOptions, useQuery } from '@tanstack/react-query';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
export function shelfQuery(runtime: ReturnType<typeof useRuntime>, page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '') {
  const apiSort = sort === 'recent' ? 'updated' : sort;
  return queryOptions({ queryKey: ['shelf', runtime.api.baseUrl, runtime.api.currentSession()?.user.id, page, sort, search], queryFn: ({ signal }) => runtime.api.listBooks({ scope: 'shelf', page, pageSize: 60, sort: apiSort, order: sort === 'title' || sort === 'author' ? 'asc' : 'desc', search: search.trim() }, { signal }) });
}
export function useShelf(page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '') { return useQuery(shelfQuery(useRuntime(), page, sort, search)); }

