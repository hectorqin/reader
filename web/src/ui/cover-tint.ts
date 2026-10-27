import type { CSSProperties } from 'react';

/**
 * A stable hue for a cover that has no art.
 *
 * A shelf of TXT files used to be a wall of identical panels, so the only way to find
 * a book was to read every placeholder. The hue comes from the title, so the same book
 * keeps its colour across screens and reloads; twelve steps 30° apart keep neighbours
 * distinguishable. The stylesheet mixes the hue into the theme's own surface at a low
 * strength (ui.md §2.7), so it tints rather than paints and follows light/dark.
 */
export function coverHue(title: string): number {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return (hash % 12) * 30;
}

export const coverTint = (title: string): CSSProperties => ({ '--cover-hue': coverHue(title) });
