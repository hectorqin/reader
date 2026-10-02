import { QueryClient } from '@tanstack/query-core';

/**
 * Shared client-side server cache. The UI is intentionally framework agnostic
 * (Preact screens are class based), so the QueryClient is used as a small data
 * cache rather than through a React adapter.
 */
export const createReaderQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 10 * 60_000,
      // ReaderApi owns auth refresh and transport retry semantics. Query retry
      // would retry 401s and account-change aborts with the new credentials.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export const readerQueryKey = (baseUrl: string, userId: string | undefined, scope: number, path: string) =>
  ['reader', baseUrl, userId ?? 'anonymous', scope, path] as const;

/** Only navigation data is cached; auth, sync, jobs and playback stay live. */
export function isNavigationQuery(path: string): boolean {
  const resource = path.split('?')[0]!;
  return /^\/api\/v1\/(books|books\/[^/]+|sources|sources\/types|plugins|subscriptions|library\/(browse|facets|continue))$/.test(resource)
    || /^\/api\/v1\/sources\/[^/]+\/(browse|entries|search-filters)$/.test(resource)
    || /^\/api\/v1\/media\/(libraries|browse|search|narrators|favorites|history|queue|continue)$/.test(resource)
    || /^\/api\/v1\/media\/libraries\/[^/]+\/(items|narrators|folders)$/.test(resource)
    || /^\/api\/v1\/media\/items\/[^/]+(?:\/(children|favorite|tracks|chapters))?$/.test(resource);
}

function mediaItemId(path: string): string | null {
  return path.match(/^\/api\/v1\/media\/items\/([^/]+)/)?.[1] ?? null;
}

function queryIsMediaItem(query: string, id: string): boolean {
  return query.startsWith('/api/v1/media/items/' + id) || query.includes('/items/' + id + '/');
}

/** Invalidate only the navigation resources a mutation can change. */
export function affectedNavigationQuery(mutation: string, query: string): boolean {
  if (/^\/api\/v1\/sync(?:\/|$)/.test(mutation)) return query.startsWith('/api/v1/library/continue');
  if (mutation.startsWith('/api/v1/media/playback')) {
    return /^\/api\/v1\/media\/(history|continue)(?:\?|$)/.test(query);
  }
  if (mutation.startsWith('/api/v1/media/queue')) return query.startsWith('/api/v1/media/queue');
  if (mutation.startsWith('/api/v1/media/items/')) {
    const id = mediaItemId(mutation);
    if (!id) return false;
    if (mutation.includes('/favorite')) return queryIsMediaItem(query, id) || /^\/api\/v1\/media\/favorites(?:\?|$)/.test(query);
    return queryIsMediaItem(query, id);
  }
  if (mutation.startsWith('/api/v1/media/libraries/')) {
    const id = mutation.match(/^\/api\/v1\/media\/libraries\/([^/]+)/)?.[1];
    return query === '/api/v1/media/libraries' || (!!id && query.startsWith('/api/v1/media/libraries/' + id + '/'));
  }
  if (mutation.startsWith('/api/v1/media/libraries')) return query === '/api/v1/media/libraries';
  if (/^\/api\/v1\/(notes|tts|ai|auth)(?:\/|$)/.test(mutation)) return false;
  if (mutation === '/api/v1/library/upload') return query.startsWith('/api/v1/books') || query.startsWith('/api/v1/library/browse');
  if (mutation === '/api/v1/library/browse/shelf') return query.startsWith('/api/v1/books') || query.startsWith('/api/v1/library/continue');
  if (/^\/api\/v1\/library\/browse\//.test(mutation)) return query.startsWith('/api/v1/library/browse') || query.startsWith('/api/v1/books');
  if (/^\/api\/v1\/books\//.test(mutation)) {
    const id = mutation.match(/^\/api\/v1\/books\/([^/]+)/)?.[1];
    return query.startsWith('/api/v1/books') && (!id || query.includes('/books/' + id));
  }
  if (/^\/api\/v1\/sources(?:\/|$)/.test(mutation) || /^\/api\/v1\/plugins/.test(mutation)) return query.startsWith('/api/v1/sources') || query.startsWith('/api/v1/plugins') || query.startsWith('/api/v1/subscriptions');
  return false;
}
