/**
 * 最近搜索: the last few queries this account ran on this device.
 *
 * A per-device convenience, not data: it is never synced, a private window or a
 * full disk simply has none, and every access is guarded for that reason.
 */
const LIMIT = 8;
const key = (scope: string) => `reader.search.recent:${scope}`;

export function readRecentSearches(scope: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(scope)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, LIMIT) : [];
  } catch { return []; }
}

/** Most recent first; a repeated query moves to the front instead of appearing twice. */
export function rememberSearch(scope: string, query: string): string[] {
  const q = query.trim();
  if (!q) return readRecentSearches(scope);
  const next = [q, ...readRecentSearches(scope).filter(item => item !== q)].slice(0, LIMIT);
  try { localStorage.setItem(key(scope), JSON.stringify(next)); } catch { /* no storage: nothing to remember */ }
  return next;
}

export function clearRecentSearches(scope: string): void {
  try { localStorage.removeItem(key(scope)); } catch { /* nothing stored */ }
}
