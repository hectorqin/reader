import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import {
  ThemeController, defaultThemePreference, migrateLegacyTheme, readThemePreference, resolveAppTheme,
  resolveReaderSurface, resolveReadingTheme, saveThemePreference, themeSummary,
} from '../src/shared/theme/theme.ts';
import { MediaThemeSettings } from '../src/features/media/components/theme-settings.tsx';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => {
  act(() => render(null, root));
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
});

/** A controllable prefers-color-scheme. */
function stubSystem(initial: boolean) {
  const events = new EventTarget();
  const state = { dark: initial };
  vi.stubGlobal('matchMedia', () => ({ get matches() { return state.dark; }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }));
  return { set(dark: boolean) { state.dark = dark; events.dispatchEvent(new Event('change')); } };
}
const pressed = (label: string) => root.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed');
const click = (label: string) => act(() => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());

describe('theme preference', () => {
  it('defaults to 暖陶, following the system with 暖陶 for both, and the app theme for reading', () => {
    expect(readThemePreference('new')).toEqual({ theme: 'warm', mode: 'system', system: { light: 'warm', dark: 'warm' }, reading: 'app' });
    expect(themeSummary(readThemePreference('new'))).toBe('跟随系统');
  });

  it('carries every V3 choice over as the spec table says, keeping its light/dark mode', () => {
    const migrated = (choice: string) => { const { theme, mode } = migrateLegacyTheme(choice, undefined); return [theme, mode]; };
    expect(migrated('sand')).toEqual(['warm', 'light']);
    expect(migrated('midnight')).toEqual(['warm', 'dark']);
    expect(migrated('ocean')).toEqual(['blue', 'light']);
    expect(migrated('forest')).toEqual(['green', 'light']);
    expect(migrated('graphite')).toEqual(['blue', 'dark']);
    // 蔷薇 was removed with no successor: 暖陶, still light.
    expect(migrated('rose')).toEqual(['warm', 'light']);
    // Follow-system keeps its pair, slot by slot.
    expect(migrateLegacyTheme('system', { light: 'ocean', dark: 'graphite' })).toEqual({ ...defaultThemePreference, theme: 'blue', mode: 'system', system: { light: 'blue', dark: 'blue' } });
    expect(migrateLegacyTheme('system', { light: 'forest', dark: 'midnight' }).system).toEqual({ light: 'green', dark: 'warm' });
  });

  it('reads the V3 keys only until a V3.1 choice is saved, per server and account', () => {
    localStorage.setItem('reader.media.theme.v1:a', 'graphite');
    localStorage.setItem('reader.media.preferences.v1:a', '{"density":"comfortable"}');
    expect(resolveAppTheme(readThemePreference('a'), false)).toEqual({ theme: 'blue', mode: 'dark' });
    expect(readThemePreference('b')).toEqual(defaultThemePreference);
    saveThemePreference('a', { theme: 'green', mode: 'light' });
    expect(resolveAppTheme(readThemePreference('a'), false)).toEqual({ theme: 'green', mode: 'light' });
    expect(localStorage.getItem('reader.media.preferences.v1:a')).toBe('{"density":"comfortable"}');
  });

  it('rejects unknown or reading-only values and unreadable storage', () => {
    localStorage.setItem('reader.theme.v2:a', JSON.stringify({ theme: 'gray', mode: 'dim', system: { light: 'rose', dark: 'blue' }, reading: 'sepia' }));
    expect(readThemePreference('a')).toEqual({ ...defaultThemePreference, system: { light: 'warm', dark: 'blue' } });
    localStorage.setItem('reader.theme.v2:a', '{not json');
    expect(readThemePreference('a')).toEqual(defaultThemePreference);
  });

  it('resolves the pair when following the system, and 黑白灰 for reading in the app mode', () => {
    const preference = { ...defaultThemePreference, system: { light: 'green', dark: 'blue' } as const, reading: 'gray' as const };
    expect(resolveAppTheme(preference, false)).toEqual({ theme: 'green', mode: 'light' });
    expect(resolveAppTheme(preference, true)).toEqual({ theme: 'blue', mode: 'dark' });
    expect(resolveReadingTheme(preference, true)).toEqual({ theme: 'gray', mode: 'dark' });
    expect(resolveReadingTheme({ ...preference, reading: 'app' }, true)).toEqual({ theme: 'blue', mode: 'dark' });
    expect(resolveAppTheme({ ...preference, mode: 'light', theme: 'warm' }, true)).toEqual({ theme: 'warm', mode: 'light' });
  });
});

describe('reading paper', () => {
  const light = { ...defaultThemePreference, mode: 'light' as const };
  const dark = { ...defaultThemePreference, mode: 'dark' as const };
  it('tints only light mode by default, gives way to the theme when the app is dark, and 夜间 is dark', () => {
    expect(resolveReaderSurface(light, false, 'theme', true)).toEqual({ theme: 'warm', mode: 'light', paper: null });
    expect(resolveReaderSurface(light, false, 'warm', true)).toEqual({ theme: 'warm', mode: 'light', paper: 'warm' });
    expect(resolveReaderSurface(dark, false, 'warm', true)).toEqual({ theme: 'warm', mode: 'dark', paper: null });
    // Not following the system's dark mode: the paper stays, and the reader stays light around it.
    expect(resolveReaderSurface(dark, false, 'warm', false)).toEqual({ theme: 'warm', mode: 'light', paper: 'warm' });
    expect(resolveReaderSurface(light, false, 'night', true)).toEqual({ theme: 'warm', mode: 'dark', paper: 'night' });
    expect(resolveReaderSurface({ ...light, reading: 'gray' }, false, 'green', true)).toEqual({ theme: 'gray', mode: 'light', paper: 'green' });
  });
});

describe('ThemeController', () => {
  it('writes data-theme and data-mode on <html>, follows the system, and cleans up', () => {
    const system = stubSystem(false);
    const changed = vi.fn();
    const controller = new ThemeController('a', changed);
    expect([document.documentElement.dataset.theme, document.documentElement.dataset.mode]).toEqual(['warm', 'light']);
    system.set(true);
    expect(document.documentElement.dataset.mode).toBe('dark');
    saveThemePreference('a', { system: { light: 'warm', dark: 'green' } });
    expect(document.documentElement.dataset.theme).toBe('green');
    // Another account's choice is not this page's.
    saveThemePreference('b', { theme: 'blue', mode: 'light' });
    expect(document.documentElement.dataset.theme).toBe('green');
    controller.dispose();
    changed.mockClear();
    system.set(false);
    expect(changed).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.mode).toBeUndefined();
  });

  it('applies a choice saved in another tab', () => {
    const controller = new ThemeController('a');
    localStorage.setItem('reader.theme.v2:a', JSON.stringify({ ...defaultThemePreference, theme: 'blue', mode: 'dark' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'reader.theme.v2:a' }));
    expect(controller.current).toEqual({ theme: 'blue', mode: 'dark' });
    controller.dispose();
  });
});

describe('外观与主题', () => {
  it('follows the system by default with one theme for light and one for dark', async () => {
    stubSystem(false);
    await act(async () => render(<MediaThemeSettings scope="a" />, root));
    expect(pressed('跟随系统')).toBe('true');
    expect(pressed('浅色时使用 暖陶')).toBe('true');
    expect(pressed('深色时使用 暖陶')).toBe('true');
    await click('深色时使用 雾蓝');
    expect(readThemePreference('a').system).toEqual({ light: 'warm', dark: 'blue' });
    // With a split pair, no single app-theme card describes the choice.
    expect([pressed('暖陶'), pressed('雾蓝'), pressed('青绿')]).toEqual(['false', 'false', 'false']);
    // Picking a card while following the system uses it for both.
    await click('青绿');
    expect(readThemePreference('a').system).toEqual({ light: 'green', dark: 'green' });
    expect(pressed('青绿')).toBe('true');
    expect(root.querySelector('[role=status]')?.textContent).toBe('主题已保存');
  });

  it('leaving follow-system keeps what is on screen, then offers light or dark', async () => {
    stubSystem(true);
    saveThemePreference('a', { system: { light: 'warm', dark: 'blue' } });
    await act(async () => render(<MediaThemeSettings scope="a" />, root));
    await click('跟随系统');
    expect(readThemePreference('a')).toMatchObject({ mode: 'dark', theme: 'blue' });
    expect(root.querySelector('[aria-label="浅色时使用 暖陶"]')).toBeNull();
    const light = [...root.querySelectorAll<HTMLButtonElement>('[aria-label="明暗"] button')].find(button => button.textContent === '浅色')!;
    await act(async () => light.click());
    expect(readThemePreference('a')).toMatchObject({ mode: 'light', theme: 'blue' });
  });

  it('offers 黑白灰 only as the reading theme, apart from the app theme', async () => {
    await act(async () => render(<MediaThemeSettings scope="a" />, root));
    const appCards = [...root.querySelectorAll('[aria-label="应用主题"] .theme-card')].map(card => card.getAttribute('aria-label'));
    expect(appCards).toEqual(['暖陶', '雾蓝', '青绿']);
    expect(pressed('跟随应用')).toBe('true');
    await click('黑白灰');
    expect(readThemePreference('a')).toMatchObject({ reading: 'gray', theme: 'warm' });
    expect(pressed('黑白灰')).toBe('true');
  });

  it('reports a device that refuses to store the choice', async () => {
    await act(async () => render(<MediaThemeSettings scope="a" />, root));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await click('雾蓝');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('无法保存主题');
    expect(readThemePreference('a').system.light).toBe('warm');
  });
});
