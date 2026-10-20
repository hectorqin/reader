import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { channels, paperIds, readerPapers, themes, type ThemeTokens } from '../src/shared/theme/theme.ts';

/**
 * The V3.1 palettes: the stylesheet and the TypeScript mirror carry the same values,
 * and every palette meets the spec's contrast table (主题语义令牌 §5).
 */
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const cssVariables = (t: ThemeTokens): Record<string, string> => ({
  bg: t.bg, surface: t.surface, 'surface-2': t.surface2, ink: t.ink, muted: t.muted, line: t.line,
  brand: t.brand, 'brand-soft': t.brandSoft, 'on-brand': t.onBrand, 'brand-text': t.brandText,
  ...Object.fromEntries(channels.flatMap(c => [['ch-' + c, t.ch[c].fill], ['ch-' + c + '-soft', t.ch[c].soft], ['ch-' + c + '-text', t.ch[c].text]])),
  'on-ch': t.onCh, scrim: t.scrim,
});

const stylesheet = readFileSync(new URL('../src/styles/theme-tokens.css', import.meta.url), 'utf8');
function block(theme: string, mode: string): Record<string, string> {
  const selector = `[data-theme="${theme}"][data-mode="${mode}"] {`;
  const start = stylesheet.indexOf(selector);
  if (start < 0) return {};
  const body = stylesheet.slice(start + selector.length, stylesheet.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));
}

describe('theme tokens', () => {
  for (const theme of Object.values(themes)) for (const mode of ['light', 'dark'] as const) {
    const label = `${theme.name} · ${mode === 'light' ? '浅色' : '深色'}`;
    const t = theme[mode];

    it(`${label}: the stylesheet declares exactly the TypeScript values`, () => {
      expect(block(theme.id, mode)).toEqual(cssVariables(t));
    });

    it(`${label}: meets the spec's contrast pairs`, () => {
      const pairs: Array<[string, string, string]> = [
        ['ink on bg', t.ink, t.bg], ['ink on surface', t.ink, t.surface],
        ['muted on bg', t.muted, t.bg], ['muted on surface-2', t.muted, t.surface2],
        ['brand-text on brand-soft', t.brandText, t.brandSoft], ['brand-text on bg', t.brandText, t.bg],
        ['on-brand on brand', t.onBrand, t.brand],
        ...channels.flatMap((c): Array<[string, string, string]> => [
          [`ch-${c}-text on ch-${c}-soft`, t.ch[c].text, t.ch[c].soft],
          [`on-ch on ch-${c}`, t.onCh, t.ch[c].fill],
        ]),
      ];
      const failures = pairs.map(([name, fg, bg]) => ({ name, value: ratio(fg, bg) }))
        .filter(item => item.value < 4.5).map(item => `${item.name}: ${item.value.toFixed(2)} < 4.5`);
      expect(failures).toEqual([]);
    });
  }

  for (const id of paperIds) {
    const paper = readerPapers[id];
    it(`纸色 ${paper.name}: the stylesheet matches, and ink and muted text are legible`, () => {
      const match = stylesheet.match(new RegExp(`\\.reader-screen\\[data-paper="${id}"\\] \\{([^}]*)\\}`));
      const declared = Object.fromEntries([...(match?.[1] ?? '').matchAll(/--reader-([\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
      expect(declared).toEqual({ paper: paper.bg, ink: paper.ink, muted: paper.muted, line: paper.line });
      const failures = [['ink', paper.ink], ['muted', paper.muted]].map(([name, fg]) => ({ name, value: ratio(fg!, paper.bg) }))
        .filter(item => item.value < 4.5).map(item => `${item.name}: ${item.value.toFixed(2)} < 4.5`);
      expect(failures).toEqual([]);
    });
  }

  it('starts from 暖陶 before a theme is applied, in the device mode', () => {
    expect(stylesheet).toMatch(/:root,\s*\[data-theme="warm"\]\[data-mode="light"\] \{/);
    expect(stylesheet).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-mode\]\) \{\s*--color-bg: #1F1713;/);
  });
});
