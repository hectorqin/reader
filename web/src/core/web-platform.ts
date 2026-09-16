import { FetchTransport } from './fetch-transport.ts';
import type { Connectivity, Platform } from './platform.ts';
import { createStores } from '../store/idb.ts';

/**
 * The browser/H5 platform.
 *
 * Also the base class for the Android platform, which reuses everything here
 * and overrides only the parts a native shell can do better.
 */
export async function createWebPlatform(baseUrl: string): Promise<Platform> {
  const stores = await createStores();
  const listeners = new Set<(state: Connectivity) => void>();
  let last: Connectivity = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';

  const emit = (): void => {
    const next: Connectivity = navigator.onLine === false ? 'offline' : 'online';
    if (next === last) return;
    last = next;
    for (const listener of listeners) listener(next);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', emit);
    window.addEventListener('offline', emit);
  }

  return {
    name: 'web',
    deviceLabel: deviceLabelFromNavigator(),
    transport: new FetchTransport(() => baseUrl),
    kv: stores.kv,
    blobs: stores.blobs,
    async connectivity(): Promise<Connectivity> {
      return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
    },
    onConnectivityChange(listener: (state: Connectivity) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function deviceLabelFromNavigator(): string {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android-web';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-web';
  return 'web';
}
