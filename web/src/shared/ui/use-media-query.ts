import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept current.
 *
 * For the rare case where a breakpoint moves an element to a different *parent*
 * — which CSS cannot do. Anything that only restyles belongs in the stylesheet.
 * Without `matchMedia` (tests, very old WebViews) it answers `false`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false);
}
