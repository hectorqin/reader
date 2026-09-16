/**
 * Reader settings, persisted per device.
 *
 * Deliberately local rather than synced. Font size and theme are properties of
 * the screen the reader is holding — a phone and a tablet want different values —
 * whereas the reading position is a property of the reader. Syncing the first
 * would mean opening a book on the tablet in the phone's font size, which is the
 * one behaviour nobody wants.
 *
 * The palette is mirrored into the reader's own theme module so the shell's
 * chrome and the book's page never disagree about whether the reader chose dark.
 */

import type { ReaderSettings, ThemeMode } from '../render/theme.ts';
import { DEFAULT_SETTINGS } from '../render/theme.ts';

const KEY = 'reader.settings';

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      fontSize: clamp(parsed.fontSize, 12, 32, DEFAULT_SETTINGS.fontSize),
      pageWidth: clamp(parsed.pageWidth, 360, 1200, DEFAULT_SETTINGS.pageWidth),
      columnGap: DEFAULT_SETTINGS.columnGap,
      pagePadding: DEFAULT_SETTINGS.pagePadding,
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private browsing modes throw on write. The settings still apply for this
    // session, which is better than failing the interaction.
  }
}

/** Set the theme on the root element, where the shell's own variables live. */
export function applyTheme(root: HTMLElement, theme: ThemeMode): void {
  root.dataset.theme = theme;
  const colors: Record<ThemeMode, string> = { light: '#ffffff', sepia: '#f6f0e4', dark: '#14161a' };
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme]);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isTheme(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'sepia' || value === 'dark';
}

export type { ReaderSettings };
