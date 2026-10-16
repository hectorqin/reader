import { describe, expect, it } from 'vitest';
import { mediaThemes } from '../src/features/media/services/theme.ts';

// colors order: background, paper, surface, text, muted, border, accent, on-accent, selection
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground index, background index, minimum ratio, label]
const pairs: Array<[number, number, number, string]> = [
  [3, 0, 4.5, 'text on background'], [3, 1, 4.5, 'text on paper'], [3, 2, 4.5, 'text on surface'],
  [4, 0, 4.5, 'muted on background'], [4, 1, 4.5, 'muted on paper'], [4, 2, 4.5, 'muted on surface'],
  [6, 0, 4.5, 'accent on background'], [6, 1, 4.5, 'accent on paper'], [7, 6, 4.5, 'on-accent on accent'],
  [6, 8, 4.5, 'accent on selection'], [3, 8, 4.5, 'text on selection'],
];

describe('media theme contrast', () => {
  for (const theme of mediaThemes) {
    it(`${theme.name} meets WCAG AA for text pairs`, () => {
      const failures = pairs
        .map(([fg, bg, min, label]) => ({ label, value: ratio(theme.colors[fg]!, theme.colors[bg]!), min }))
        .filter(item => item.value < item.min)
        .map(item => `${item.label}: ${item.value.toFixed(2)} < ${item.min}`);
      expect(failures).toEqual([]);
    });
  }
});
