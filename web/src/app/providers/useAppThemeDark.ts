import { useSyncExternalStore } from 'react';
import { mediaThemeChangeEvent, mediaThemePalette, readMediaTheme } from '../../features/media/services/theme.ts';

/** Whether the app theme currently resolves to a dark palette (follow-system included). */
export function useAppThemeDark(scope: string): boolean {
  const subscribe = (notify: () => void) => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    window.addEventListener(mediaThemeChangeEvent, notify);
    window.addEventListener('storage', notify);
    query?.addEventListener('change', notify);
    return () => {
      window.removeEventListener(mediaThemeChangeEvent, notify);
      window.removeEventListener('storage', notify);
      query?.removeEventListener('change', notify);
    };
  };
  const snapshot = () => mediaThemePalette(readMediaTheme(scope), window.matchMedia?.('(prefers-color-scheme: dark)').matches === true).dark;
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
