import { useCallback, useSyncExternalStore } from 'react';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import { mediaPreferencesSnapshot, subscribeMediaPreferences, type MediaPreferences } from '../services/preferences.ts';

/**
 * The 影音浏览 preferences (我的 › 偏好设置) for the signed-in account on this server.
 * Read from storage on every render and re-rendered when they are saved, so a change on
 * the settings page is what the catalog shows next.
 */
export function useMediaPreferences(): MediaPreferences {
  const scope = useRuntime().mediaApi.preferenceScope();
  const snapshot = useCallback(() => mediaPreferencesSnapshot(scope), [scope]);
  return useSyncExternalStore(subscribeMediaPreferences, snapshot, snapshot);
}
