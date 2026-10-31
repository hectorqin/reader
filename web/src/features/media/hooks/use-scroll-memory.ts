import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Remembers how far a media list was scrolled, per account and URL, so coming back to it
 * (browser Back, Back after Forward, or the page's own back arrow, which links to the same
 * URL) lands where the reader left instead of at the top.
 *
 * The scroll container is the page's `.media-screen` (MediaPageFrame). The position is kept
 * up to date while the list is shown, so it is always the last one seen at that URL — there
 * is nothing to consume, and leaving by any route keeps it. Only lists whose page/query is in
 * the URL (docs/ui.md §3.5) can use it: the URL is the key.
 */
const positions = new Map<string, number>();
const LIMIT = 100;

function remember(key: string, top: number) {
  positions.delete(key);
  positions.set(key, top);
  if (positions.size > LIMIT) positions.delete(positions.keys().next().value!);
}

export function savedScroll(key: string): number | undefined {
  return positions.get(key);
}

/**
 * `anchor`: any element inside the page; `key`: account + URL; `ready`: the list for this key is
 * rendered (restoring before that would be clamped by a short page). Returns `skipRestore`, for
 * explicit in-page actions (new search, another page) that should not jump to an old position
 * of the URL they lead to.
 */
export function useScrollMemory(anchor: RefObject<HTMLElement | null>, key: string | undefined, ready: boolean): () => void {
  const restored = useRef<string | undefined>(undefined);
  const skip = useRef(false);
  useEffect(() => {
    if (!key || !ready) return;
    const screen = anchor.current?.closest<HTMLElement>('.media-screen');
    if (!screen) return;
    if (restored.current !== key) {
      restored.current = key;
      const top = skip.current ? undefined : positions.get(key);
      skip.current = false;
      if (top !== undefined) screen.scrollTop = top;
    }
    const record = () => remember(key, screen.scrollTop);
    screen.addEventListener('scroll', record, { passive: true });
    return () => screen.removeEventListener('scroll', record);
  }, [anchor, key, ready]);
  return useCallback(() => { skip.current = true; }, []);
}
