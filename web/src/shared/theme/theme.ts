/**
 * Reader V3.1 themes (docs/prototypes/Reader V3 主题语义令牌.md).
 *
 * A theme is one set of semantic token values. Components only read the tokens
 * (`--color-*`, declared per theme and mode in styles/theme-tokens.css); switching
 * theme only switches attributes:
 *
 *   <html data-theme="warm|blue|green" data-mode="light|dark">
 *   <div class="reader-screen" data-theme="gray" data-mode="…">   (reading theme only)
 *
 * The values below are the same as the stylesheet's; test/theme-tokens.test.ts keeps
 * the two in step and holds every palette to the spec's contrast pairs.
 */

export const channels = ['read', 'video', 'music', 'audio'] as const;
export type ThemeChannel = typeof channels[number];

export interface ChannelTokens { fill: string; soft: string; text: string }
export interface ThemeTokens {
  bg: string; surface: string; surface2: string; ink: string; muted: string; line: string;
  brand: string; brandSoft: string; onBrand: string; brandText: string; onCh: string; scrim: string;
  ch: Record<ThemeChannel, ChannelTokens>;
}

/** Order of the spec's tables: [fill, soft, text] for read, video, music, audio. */
type ChannelRows = readonly [readonly [string, string, string], readonly [string, string, string], readonly [string, string, string], readonly [string, string, string]];
function palette(
  [bg, surface, surface2, ink, muted, line, brand, brandSoft, onBrand, brandText, onCh, scrim]: readonly string[],
  rows: ChannelRows,
): ThemeTokens {
  const ch = Object.fromEntries(channels.map((name, index) => {
    const [fill, soft, text] = rows[index]!;
    return [name, { fill, soft, text }];
  })) as Record<ThemeChannel, ChannelTokens>;
  return { bg: bg!, surface: surface!, surface2: surface2!, ink: ink!, muted: muted!, line: line!, brand: brand!, brandSoft: brandSoft!, onBrand: onBrand!, brandText: brandText!, onCh: onCh!, scrim: scrim!, ch };
}

export const themes = {
  warm: {
    id: 'warm', name: '暖陶', readingOnly: false,
    light: palette(['#FDF9F6', '#FFFFFF', '#F8EFE8', '#3A2A22', '#82685B', '#F0E3DA', '#F2B79F', '#FBE9E0', '#2B1810', '#A8482A', '#2B1810', 'rgba(58,42,34,.40)'],
      [['#F2B79F', '#FBE9E0', '#A8482A'], ['#F6CA97', '#FCF0DD', '#8A5200'], ['#EFA9A3', '#FAE4E1', '#A8343E'], ['#E6BE9E', '#F7EBDD', '#7A5232']]),
    dark: palette(['#1F1713', '#2A201A', '#352A23', '#F7EDE6', '#BBA79B', '#43342B', '#E88F73', '#3F2A21', '#1A100C', '#F0987C', '#1A100C', 'rgba(0,0,0,.60)'],
      [['#E88F73', '#3F2A21', '#E88F73'], ['#E9AA6E', '#3A2E1E', '#E9AA6E'], ['#E58A8A', '#3D2526', '#E58A8A'], ['#D9A07F', '#36291F', '#D9A07F']]),
  },
  blue: {
    id: 'blue', name: '雾蓝', readingOnly: false,
    light: palette(['#F8FAFE', '#FFFFFF', '#EDF2FA', '#1F3250', '#5A6C8C', '#E4EBF6', '#9DC0F2', '#E6EFFC', '#0F1D36', '#2F63B0', '#0F1D36', 'rgba(31,50,80,.40)'],
      [['#9DC0F2', '#E6EFFC', '#2F63B0'], ['#9FD2EE', '#E3F2FA', '#1F6F93'], ['#B2B8F2', '#ECEEFC', '#4A52B0'], ['#90CBD8', '#E0F2F5', '#1F6F7C']]),
    dark: palette(['#0F1722', '#172131', '#202C40', '#E8EEF7', '#9FB0C8', '#2A3850', '#7FB1F0', '#1C3050', '#0A1220', '#8DB8F0', '#0A1220', 'rgba(0,0,0,.60)'],
      [['#7FB1F0', '#1C3050', '#7FB1F0'], ['#7CC3E8', '#1A3347', '#7CC3E8'], ['#9AA3F0', '#25274D', '#9AA3F0'], ['#70C1CF', '#17353A', '#70C1CF']]),
  },
  green: {
    id: 'green', name: '青绿', readingOnly: false,
    light: palette(['#F7FBF8', '#FFFFFF', '#EAF4EE', '#1B3329', '#52705F', '#E0EEE5', '#8AD6B1', '#E1F4EA', '#0F2A1E', '#1F6B4F', '#0F2A1E', 'rgba(27,51,41,.40)'],
      [['#8AD6B1', '#E1F4EA', '#1F6B4F'], ['#A9DB9B', '#EBF6E2', '#3F6E1F'], ['#8CD2CF', '#E1F3F2', '#1F6B68'], ['#B6D98E', '#F0F5E0', '#5B6B1F']]),
    dark: palette(['#0E1914', '#15251E', '#1E3229', '#E6F2EC', '#98B3A7', '#28403A', '#6ED6A8', '#1A3B2E', '#07130E', '#7FDDB4', '#07130E', 'rgba(0,0,0,.60)'],
      [['#6ED6A8', '#1A3B2E', '#6ED6A8'], ['#8ED67A', '#243A1E', '#8ED67A'], ['#6CCBC6', '#173A38', '#6CCBC6'], ['#A6CF72', '#2C3818', '#A6CF72']]),
  },
  gray: {
    id: 'gray', name: '黑白灰', readingOnly: true,
    light: palette(['#F5F5F5', '#FFFFFF', '#EBEBEB', '#1A1A1A', '#666666', '#E0E0E0', '#3D3D3D', '#EDEDED', '#FFFFFF', '#3D3D3D', '#FFFFFF', 'rgba(26,26,26,.40)'],
      [['#3D3D3D', '#EDEDED', '#3D3D3D'], ['#4A4A4A', '#EDEDED', '#4A4A4A'], ['#575757', '#EDEDED', '#575757'], ['#666666', '#EDEDED', '#666666']]),
    dark: palette(['#121212', '#1B1B1B', '#262626', '#E6E6E6', '#9E9E9E', '#2E2E2E', '#E6E6E6', '#2A2A2A', '#121212', '#E6E6E6', '#121212', 'rgba(0,0,0,.60)'],
      [['#CFCFCF', '#2A2A2A', '#CFCFCF'], ['#BDBDBD', '#2A2A2A', '#BDBDBD'], ['#ABABAB', '#2A2A2A', '#ABABAB'], ['#999999', '#2A2A2A', '#999999']]),
  },
} as const satisfies Record<string, { id: string; name: string; readingOnly: boolean; light: ThemeTokens; dark: ThemeTokens }>;

export type ThemeId = keyof typeof themes;
/** The themes the whole app can wear. 黑白灰 is for the reader only. */
export type AppThemeId = Exclude<ThemeId, 'gray'>;
export type ThemeMode = 'light' | 'dark';
export type ModePreference = 'system' | ThemeMode;
/** 跟随应用, or the reading-only 黑白灰. */
export type ReadingTheme = 'app' | 'gray';

export const appThemeIds: readonly AppThemeId[] = ['warm', 'blue', 'green'];
export const appThemes = appThemeIds.map(id => themes[id]);
export const themeName = (id: ThemeId) => themes[id].name;

export interface ThemePreference {
  theme: AppThemeId;
  mode: ModePreference;
  /** 跟随系统: the theme used while the device is light, and the one while it is dark. */
  system: { light: AppThemeId; dark: AppThemeId };
  reading: ReadingTheme;
}
export interface ResolvedTheme { theme: ThemeId; mode: ThemeMode }

export const defaultThemePreference: ThemePreference = { theme: 'warm', mode: 'system', system: { light: 'warm', dark: 'warm' }, reading: 'app' };
const defaults = (): ThemePreference => ({ ...defaultThemePreference, system: { ...defaultThemePreference.system } });

const isAppTheme = (value: unknown): value is AppThemeId => appThemeIds.includes(value as AppThemeId);
const preferenceKey = (scope: string) => 'reader.theme.v2:' + scope;
/** V3 storage, read once to carry an existing choice over (spec §8). */
const legacyThemeKey = (scope: string) => 'reader.media.theme.v1:' + scope;
const legacyPairKey = (scope: string) => 'reader.media.theme.system.v1:' + scope;

export const themeChangeEvent = 'reader-theme-change';

export function validThemePreference(value: unknown): ThemePreference {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ThemePreference, unknown>>;
  const system = (raw.system && typeof raw.system === 'object' ? raw.system : {}) as { light?: unknown; dark?: unknown };
  return {
    theme: isAppTheme(raw.theme) ? raw.theme : defaultThemePreference.theme,
    mode: raw.mode === 'light' || raw.mode === 'dark' || raw.mode === 'system' ? raw.mode : defaultThemePreference.mode,
    system: {
      light: isAppTheme(system.light) ? system.light : defaultThemePreference.system.light,
      dark: isAppTheme(system.dark) ? system.dark : defaultThemePreference.system.dark,
    },
    reading: raw.reading === 'gray' ? 'gray' : 'app',
  };
}

/**
 * The six V3 themes, mapped as the spec's table says: 暖纸/深夜 become 暖陶 light/dark,
 * 雾蓝 stays 雾蓝, 原野 becomes 青绿 light, 石墨 becomes 雾蓝 dark, and 蔷薇 (removed with
 * no successor) falls back to 暖陶 keeping its light mode.
 */
const legacyThemes: Record<string, { theme: AppThemeId; mode: ThemeMode }> = {
  sand: { theme: 'warm', mode: 'light' },
  midnight: { theme: 'warm', mode: 'dark' },
  ocean: { theme: 'blue', mode: 'light' },
  rose: { theme: 'warm', mode: 'light' },
  forest: { theme: 'green', mode: 'light' },
  graphite: { theme: 'blue', mode: 'dark' },
};

export function migrateLegacyTheme(choice: string | null, pair: unknown): ThemePreference {
  const oldPair = (pair && typeof pair === 'object' ? pair : {}) as { light?: unknown; dark?: unknown };
  const slot = (value: unknown) => legacyThemes[String(value)]?.theme ?? 'warm';
  const system = { light: slot(oldPair.light), dark: slot(oldPair.dark) };
  const chosen = choice ? legacyThemes[choice] : undefined;
  if (chosen) return { ...defaults(), theme: chosen.theme, mode: chosen.mode, system };
  return { ...defaults(), theme: system.light, mode: 'system', system };
}

export function readThemePreference(scope: string): ThemePreference {
  try {
    const stored = localStorage.getItem(preferenceKey(scope));
    if (stored !== null) return validThemePreference(JSON.parse(stored));
    const choice = localStorage.getItem(legacyThemeKey(scope));
    const pair = localStorage.getItem(legacyPairKey(scope));
    if (choice === null && pair === null) return defaults();
    let oldPair: unknown;
    try { oldPair = pair ? JSON.parse(pair) : undefined; } catch { oldPair = undefined; }
    return migrateLegacyTheme(choice, oldPair);
  } catch {
    return defaults();
  }
}

export function saveThemePreference(scope: string, patch: Partial<ThemePreference>): ThemePreference {
  const current = readThemePreference(scope);
  const next = validThemePreference({ ...current, ...patch, system: { ...current.system, ...patch.system } });
  try { localStorage.setItem(preferenceKey(scope), JSON.stringify(next)); } catch { throw new Error('设备无法保存主题，请检查浏览器存储空间或隐私设置。'); }
  // Storage events do not fire in the tab that made the change; tell this tab directly.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(themeChangeEvent, { detail: { scope } }));
  return next;
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** What the app wears: the pair when following the system, otherwise the one theme and mode. */
export function resolveAppTheme(preference: ThemePreference, systemDark: boolean): { theme: AppThemeId; mode: ThemeMode } {
  if (preference.mode === 'system') return systemDark ? { theme: preference.system.dark, mode: 'dark' } : { theme: preference.system.light, mode: 'light' };
  return { theme: preference.theme, mode: preference.mode };
}

/** What the book wears: the app's theme, or 黑白灰 in the app's current light/dark mode. */
export function resolveReadingTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  const app = resolveAppTheme(preference, systemDark);
  return preference.reading === 'gray' ? { theme: 'gray', mode: app.mode } : app;
}

export const themeTokens = ({ theme, mode }: ResolvedTheme): ThemeTokens => themes[theme][mode];

/** One subscription for every place that shows the theme: same-tab saves, other tabs, the OS. */
export function subscribeTheme(scope: string, notify: () => void): () => void {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  const keys = [preferenceKey(scope), legacyThemeKey(scope), legacyPairKey(scope)];
  const onStorage = (event: StorageEvent) => { if (event.key === null || keys.includes(event.key)) notify(); };
  const onChange = (event: Event) => { if ((event as CustomEvent<{ scope?: unknown }>).detail?.scope === scope) notify(); };
  query?.addEventListener('change', notify);
  window.addEventListener('storage', onStorage);
  window.addEventListener(themeChangeEvent, onChange);
  return () => {
    query?.removeEventListener('change', notify);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(themeChangeEvent, onChange);
  };
}

/** Writes the app theme onto <html>; the stylesheet does the rest. */
export class ThemeController {
  current: { theme: AppThemeId; mode: ThemeMode };
  private readonly scope: string;
  private readonly unsubscribe: () => void;
  constructor(scope: string, onChanged: () => void = () => undefined) {
    this.scope = scope;
    this.current = this.apply();
    this.unsubscribe = subscribeTheme(scope, () => { this.current = this.apply(); onChanged(); });
  }
  private apply() {
    const resolved = resolveAppTheme(readThemePreference(this.scope), systemPrefersDark());
    const root = document.documentElement;
    root.dataset.theme = resolved.theme;
    root.dataset.mode = resolved.mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeTokens(resolved).bg);
    return resolved;
  }
  dispose() {
    this.unsubscribe();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.mode;
  }
}

/** The summary shown on 我的 and the settings home: "跟随系统", or "雾蓝 · 深色". */
export function themeSummary(preference: ThemePreference): string {
  if (preference.mode === 'system') return '跟随系统';
  return themeName(preference.theme) + ' · ' + (preference.mode === 'dark' ? '深色' : '浅色');
}
