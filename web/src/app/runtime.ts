import { ReaderApi, type SessionStore } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import type { Book, Session } from '../api/types.ts';
import { createWebPlatform } from '../core/web-platform.ts';
import { androidPageHost, androidSpeechBridge, createAndroidPlatform, detectAndroidBridge } from '../core/android-platform.ts';
import { SyncEngine } from '../core/sync.ts';
import { OfflineStore } from '../store/offline.ts';
import { SettingsStore, type AppSettings } from '../store/settings.ts';
import { publicationScope } from '../store/publications.ts';
import { MediaApi } from '../features/media/api/media-api.ts';
import { MediaPlayer } from '../features/media/services/player.ts';
import { createAppQueryClient } from '../shared/query/query-client.ts';
import { useAuthStore } from '../shared/stores/auth.store.ts';
import { useSettingsStore } from '../shared/stores/settings.store.ts';
import { useSyncStore } from '../shared/stores/sync.store.ts';
import { PlaybackService } from '../features/media/services/PlaybackService.ts';

export function validServerUrl(value?: string): string {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== 'appassets.androidplatform.net' ? value.trim() : '';
  } catch { return ''; }
}
export function inferDefaultUrl(): string {
  if (typeof location === 'undefined' || location.protocol === 'file:') return '';
  if (location.hostname === 'appassets.androidplatform.net') {
    try { return validServerUrl(window.ReaderAndroid?.configuredServerUrl?.()); } catch { return ''; }
  }
  return location.origin;
}

/** Resources shared across routes. This module neither renders nor chooses pages. */
export async function createAppRuntime(defaultServerUrl = '') {
  let api: ReaderApi;
  const bridge = detectAndroidBridge();
  const baseUrl = () => api?.baseUrl ?? defaultServerUrl;
  const platform = await (bridge ? createAndroidPlatform(baseUrl, bridge) : createWebPlatform(baseUrl));
  const sessions: SessionStore = {
    async load() {
      try {
        const value = JSON.parse(await platform.kv.get('reader.session.v1') ?? 'null') as Session | null;
        return value?.accessToken && value.refreshToken ? value : null;
      } catch { return null; }
    },
    save: session => platform.kv.set('reader.session.v1', JSON.stringify(session)),
    clear: () => platform.kv.remove('reader.session.v1'),
  };
  api = new ReaderApi(platform, sessions);
  const mediaApi = new MediaApi(api);
  const player = new MediaPlayer(mediaApi);
  const playback = new PlaybackService(player, mediaApi);
  const settings = new SettingsStore(platform.kv);
  const offline = new OfflineStore(platform.kv);
  const sync = new SyncEngine(api, offline, platform);
  const queryClient = createAppQueryClient();
  const loadedSettings = await settings.load();
  useSettingsStore.getState().replace(loadedSettings);
  api.setBaseUrl(validServerUrl(await settings.serverUrl()) || validServerUrl(defaultServerUrl) || inferDefaultUrl());
  const restored = await api.restore();
  useAuthStore.getState().setSession(restored);
  if (restored) {
    await offline.setScope(publicationScope(api.baseUrl, restored.user.id), { claimLegacy: true });
    try {
      useAuthStore.getState().verify(await api.me());
    } catch (error) {
      if (!(error instanceof ApiError) || (!error.isConnectivity && error.kind !== 'server')) {
        await sessions.clear();
        useAuthStore.getState().setSession(null);
      }
    }
    if (useAuthStore.getState().session) sync.start();
  }
  let currentBook: Book | null = null;
  let readerFlush: (() => Promise<void>) | null = null;
  return {
    api, mediaApi, player, playback, settings, offline, sync, queryClient, platform,
    pageHost: bridge ? androidPageHost(bridge) : null,
    speechBridge: bridge ? androidSpeechBridge(bridge) : null,
    async authenticated() {
      const session = api.currentSession();
      useAuthStore.getState().setSession(session);
      if (!session) return;
      await offline.setScope(publicationScope(api.baseUrl, session.user.id));
      useAuthStore.getState().verify(await api.me());
      queryClient.clear();
      sync.start();
      player.reconnectNative();
    },
    async updateSettings(patch: Partial<AppSettings>) {
      await settings.update(patch);
      useSettingsStore.getState().update(patch);
    },
    registerReader(book: Book, flush: () => Promise<void>) {
      currentBook = book; readerFlush = flush;
      return () => { if (readerFlush === flush) { currentBook = null; readerFlush = null; } };
    },
    currentBook: () => currentBook,
    syncStatus: () => sync.status(),
    settingsSnapshot: () => settings.load(),
    async saveBeforeUpdate() {
      await readerFlush?.(); await offline.flush(); await player.flush();
    },
    async flush() {
      await Promise.allSettled([player.flush(), (async () => { await readerFlush?.(); await offline.flush(); await sync.flush(); })()]);
    },
    connect() {
      const stopSession = api.onSessionChange(session => {
        useAuthStore.getState().setSession(session);
        queryClient.clear();
        if (!session) { sync.stop(); void player.stop(); }
      });
      const stopSync = sync.onStatus(useSyncStore.getState().update);
      useSyncStore.getState().update(sync.status());
      return () => { stopSession(); stopSync(); };
    },
  };
}
export type AppRuntime = Awaited<ReturnType<typeof createAppRuntime>>;
