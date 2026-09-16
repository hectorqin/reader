import type { AndroidBridge } from '../android-bridge.ts';
import { FetchTransport } from './fetch-transport.ts';
import type { Connectivity, Platform } from './platform.ts';
import { createStores } from '../store/idb.ts';

/**
 * The Android platform.
 *
 * A thin override over the web one, not a reimplementation. What the native
 * shell is asked for is exactly the set of things a WebView genuinely cannot do
 * or does badly:
 *
 *  - **Connectivity.** `navigator.onLine` in an Android WebView reports "true"
 *    whenever a network interface exists, including a Wi-Fi network with no
 *    route to the server. The platform ConnectivityManager knows better, and
 *    getting this wrong is what makes the offline path feel broken.
 *  - **A stable device label.** The UA-derived one changes when Chrome updates.
 *  - **Native feedback.** A toast for "已下载" is one line of Kotlin and avoids
 *    building a notification UI in the web layer.
 *
 * Everything else — storage, transport, the sync engine — is shared, which is
 * the entire point of building the client this way.
 */
export async function createAndroidPlatform(baseUrl: string, bridge: AndroidBridge): Promise<Platform> {
  const stores = await createStores();
  const listeners = new Set<(state: Connectivity) => void>();
  let last: Connectivity = normalise(bridge.connectivity());

  bridge.watchConnectivity((state) => {
    const next = normalise(state);
    if (next === last) return;
    last = next;
    for (const listener of listeners) listener(next);
  });

  return {
    name: 'android',
    deviceLabel: safeDeviceLabel(bridge),
    transport: new FetchTransport(() => baseUrl),
    kv: stores.kv,
    blobs: stores.blobs,
    async connectivity(): Promise<Connectivity> {
      try {
        return normalise(bridge.connectivity());
      } catch {
        // A bridge that throws must not take the reader down with it.
        return 'online';
      }
    },
    onConnectivityChange(listener: (state: Connectivity) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportError(error) {
      // Offline is an expected state, reported in the status bar, not an event
      // worth interrupting the reader for.
      if (error.isConnectivity) return;
      void error;
    },
  };
}

function normalise(state: string): Connectivity {
  return state === 'offline' ? 'offline' : 'online';
}

function safeDeviceLabel(bridge: AndroidBridge): string {
  try {
    const label = bridge.deviceLabel();
    if (label && label.trim().length > 0) return label.trim().slice(0, 60);
  } catch {
    // Fall through to the generic label.
  }
  return 'android';
}

/**
 * Feature detection for the native shell.
 *
 * Requires a minimum shell version: an old APK whose bridge is missing a method
 * this client relies on would otherwise fail in a way that looks like a bug in
 * the reader.
 */
export const MIN_SHELL_VERSION = 1;

export function detectAndroidBridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.ReaderAndroid;
  if (!bridge || typeof bridge.shellVersion !== 'function') return null;
  try {
    return bridge.shellVersion() >= MIN_SHELL_VERSION ? bridge : null;
  } catch {
    return null;
  }
}
