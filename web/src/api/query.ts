import { QueryClient } from '@tanstack/query-core';

/**
 * Shared client-side server cache for transport-level invalidation. React pages
 * consume the same client through QueryClientProvider and React Query hooks;
 * this module only owns the API client's framework-neutral cache operations.
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

/**
 * Media item resources that carry file availability (`parts[].available`,
 * editions, tracks). Rescans, mounts coming back and other admins change them
 * without any write from this client, so a cached copy must never answer an
 * explicit refetch such as 刷新资源状态. Concurrent reads are still shared, and
 * React pages keep their own screen-level cache in the app QueryClient.
 */
export function isLiveNavigationQuery(path: string): boolean {
  return /^\/api\/v1\/media\/items\/[^/]+(?:\/(children|tracks|chapters))?$/.test(path.split('?')[0]!);
}

function queryIsMediaItem(query: string, id: string): boolean {
  return query.startsWith('/api/v1/media/items/' + id) || query.includes('/items/' + id + '/');
}

/**
 * Media writes that change nothing a cached navigation query shows: POST reads
 * (match search, recognition and queue previews) and job/grant bookkeeping.
 * Starting a scan or scrape is *not* listed: it rewrites the catalog.
 */
const MEDIA_WRITES_WITHOUT_CATALOG_CHANGES = [
  /^\/api\/v1\/media\/background-grants(?:\/|$)/,
  /^\/api\/v1\/media\/items\/[^/]+\/matches$/,
  /^\/api\/v1\/media\/libraries\/[^/]+\/recognition-preview$/,
  /^\/api\/v1\/media\/queue\/preview$/,
  /^\/api\/v1\/media\/jobs\/[^/]+\/cancel$/,
  /^\/api\/v1\/media\/(scan-jobs|scrape-jobs|ai-scan-jobs)\/[^/]+(?:\/cancel)?$/,
  /^\/api\/v1\/media\/ai-scan-jobs$/,
];

function affectedByMediaWrite(mutation: string, query: string): boolean {
  if (!query.startsWith('/api/v1/media/')) return false;
  const resource = mutation.split('?')[0]!;
  if (MEDIA_WRITES_WITHOUT_CATALOG_CHANGES.some(pattern => pattern.test(resource))) return false;
  // Playback sessions and progress heartbeats only move history and 继续播放.
  if (/^\/api\/v1\/media\/(background\/)?playback(?:\/|$)/.test(resource)) {
    return /^\/api\/v1\/media\/(history|continue)(?:\?|$)/.test(query);
  }
  if (/^\/api\/v1\/media\/queue(?:\/|$)/.test(resource)) return /^\/api\/v1\/media\/queue(?:\?|$)/.test(query);
  const favorite = resource.match(/^\/api\/v1\/media\/items\/([^/]+)\/favorite$/);
  if (favorite) return queryIsMediaItem(query, favorite[1]!) || /^\/api\/v1\/media\/favorites(?:\?|$)/.test(query);
  // A new library has no items until it is scanned.
  if (resource === '/api/v1/media/libraries') return query === '/api/v1/media/libraries';
  // Everything else rewrites catalog facts that many cached reads embed: editions
  // (rename/move/split/merge/order) live inside item details and their parents'
  // children, metadata and matches change titles in browse/search/favorites/history,
  // hierarchy edits move items between parents, and library access, recognition,
  // missing-resource cleanup and scans change what every list contains. Edition ids
  // do not name their item, so there is no narrower set that is still correct.
  return true;
}

/** Invalidate only the navigation resources a mutation can change. */
export function affectedNavigationQuery(mutation: string, query: string): boolean {
  if (/^\/api\/v1\/sync(?:\/|$)/.test(mutation)) return query.startsWith('/api/v1/library/continue');
  if (mutation.startsWith('/api/v1/media/')) return affectedByMediaWrite(mutation, query);
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
