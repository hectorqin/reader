// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validThemePreference, resolveAppTheme } from '../src/shared/theme/theme.ts';

const css = readFileSync(new URL('../src/styles/glass.css', import.meta.url), 'utf8');

describe('glass material', () => {
  it('scopes every style rule to glass without changing layout or the reading paper', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) expect(selector).toContain('[data-theme="glass"]');
    expect(css).not.toMatch(/(?:width|height|position|padding|margin|display|--reader-paper)\s*:/);
    expect(css).toContain(':not([data-theme="gray"] *)');
    expect(css).toContain('-webkit-backdrop-filter: var(--glass-blur)');
  });

  it('has opaque fallbacks for unsupported blur, transparency, contrast and forced colors', () => {
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(css).toContain('(prefers-reduced-transparency: reduce)');
    expect(css).toContain('(prefers-contrast: more)');
    expect(css).toContain('(forced-colors: active)');
    expect(css.match(/--glass-fill: var\(--color-surface\)/g)).toHaveLength(2);
    expect(css).toContain('--glass-fill: Canvas');
    expect(css.match(/--glass-blur: none/g)).toHaveLength(3);
  });

  it('accepts glass in fixed and system slots and safely rejects an unknown theme', () => {
    const preference = validThemePreference({
      theme: 'glass',
      mode: 'system',
      system: { light: 'glass', dark: 'glass' },
      reading: 'app',
    });
    expect(resolveAppTheme(preference, false)).toEqual({ theme: 'glass', mode: 'light' });
    expect(resolveAppTheme(preference, true)).toEqual({ theme: 'glass', mode: 'dark' });
    expect(resolveAppTheme({ ...preference, mode: 'dark' }, false)).toEqual({ theme: 'glass', mode: 'dark' });
    expect(validThemePreference({ theme: 'unknown' }).theme).toBe('warm');
  });
});
