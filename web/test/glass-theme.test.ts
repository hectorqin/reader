// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validThemePreference, resolveAppTheme } from '../src/shared/theme/theme.ts';

const css = readFileSync(new URL('../src/styles/glass.css', import.meta.url), 'utf8');

describe('glass material', () => {
  it('scopes every style rule to glass without changing the reading paper', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) expect(selector).toContain('[data-theme="glass"]');
    expect(css).not.toMatch(/--reader-paper\s*:|::(?:before|after)/);
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
    for (const token of ['sheen', 'shadow', 'cover-shadow', 'button-sheen', 'button-shadow', 'wallpaper']) {
      expect(css.match(new RegExp('--glass-' + token + ': none', 'g'))).toHaveLength(3);
    }
    expect(css).toContain('--glass-selected: var(--color-surface)');
    expect(css).toContain('--glass-border: var(--color-ink)');
    expect(css).toContain('--glass-border: CanvasText');
    expect(css).toContain('--glass-button-base: ButtonFace');
  });

  it('layers specular materials and gives navigation safe-area-aware floating space', () => {
    expect(css).toContain('background: var(--glass-sheen), var(--glass-fill)');
    expect(css).toContain('background: var(--glass-button-sheen), var(--glass-button-base)');
    expect(css).toContain('inset 0 0 0 0.5px');
    expect(css).toContain('[data-theme="glass"][data-mode="dark"]');
    expect(css).toContain(
      '--glass-nav-clearance: calc(var(--app-nav-bar) + var(--glass-gap) * 2 + var(--safe-bottom))',
    );
    expect(css).toContain('bottom: calc(var(--glass-nav-clearance) + var(--glass-mini-gap))');
    expect(css).toContain('var(--glass-gap) + var(--safe-left)');
    expect(css).toContain('var(--glass-gap) + var(--safe-right)');
    expect(css).toContain('background: var(--glass-clear)');
    expect(css).toContain('border: var(--glass-outline)');
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

  it('shares desktop sidebar material with headers and keeps reader chrome flush', () => {
    expect(css).toContain(':is(.app-nav, .media-screen:not(.media-catalog-page) .media-heading)');
    expect(css).toContain('box-shadow: var(--glass-shadow) !important');
    const reader = css.match(/\.reader-screen \.topbar:not\(\[data-theme="gray"\] \*\)\s*\{([^}]+)\}/)?.[1];
    expect(reader).toContain('top: var(--glass-zero)');
    expect(reader).toContain('border-radius: var(--glass-zero)');
    expect(css).not.toContain('--glass-heading-hide');
  });
});
