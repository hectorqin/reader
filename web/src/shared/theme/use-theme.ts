import { useMemo, useSyncExternalStore } from 'react';
import { readThemePreference, resolveAppTheme, subscribeTheme, systemPrefersDark, type ThemePreference } from './theme.ts';

/**
 * The stored theme preference and the device's light/dark state, kept live across
 * same-tab saves, other tabs and OS changes. The snapshot is a string so React sees
 * a stable value between changes.
 */
export function useThemeState(scope: string): { preference: ThemePreference; systemDark: boolean } {
  const raw = useSyncExternalStore(
    notify => subscribeTheme(scope, notify),
    () => JSON.stringify({ preference: readThemePreference(scope), systemDark: systemPrefersDark() }),
    () => JSON.stringify({ preference: readThemePreference(scope), systemDark: false }),
  );
  return useMemo(() => JSON.parse(raw) as { preference: ThemePreference; systemDark: boolean }, [raw]);
}

/** Whether the app currently wears a dark palette (Mantine's colour scheme follows it). */
export function useAppThemeDark(scope: string): boolean {
  const { preference, systemDark } = useThemeState(scope);
  return resolveAppTheme(preference, systemDark).mode === 'dark';
}
