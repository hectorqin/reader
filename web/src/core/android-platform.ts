import type { AndroidBridge, SpeechBridge } from '../android-bridge.ts';
import { FetchTransport } from './fetch-transport.ts';
import type { Connectivity, Platform } from './platform.ts';
import { createStores } from '../store/idb.ts';
import type { NativePageHost, NativePageRequest } from '../ui/native-page.ts';

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
 *
 * The one thing this file knows that the web platform does not is the native
 * page renderer: on Android a comic page is drawn by the platform, not by the
 * WebView. `createNativePageHost` below is the whole of that special case, and
 * it is written so that a refusal from the shell is indistinguishable from a
 * browser with no native path at all.
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

/**
 * First shell version with a native page renderer (`renderPage`/`hidePage`).
 *
 * Separate from `MIN_SHELL_VERSION` on purpose. The minimum is what the client
 * cannot work without; this is an optimisation it can live without, so an older
 * APK keeps working and simply draws every page in the WebView. Refusing to run
 * on an old shell would be the wrong trade for a speed-up.
 */
export const NATIVE_PAGE_SHELL_VERSION = 2;

/**
 * First shell version with a native `TextToSpeech` surface.
 *
 * A feature rather than a capability, like the native page renderer: a shell
 * below 3 simply reads with the WebView's own synthesizer. Declared separately so
 * the failure mode is understood — an old APK is not refused, it just does not
 * appear in the朗读 engine list.
 */
export const NATIVE_SPEECH_SHELL_VERSION = 3;

export function detectAndroidBridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.ReaderAndroid;
  if (!bridge || typeof bridge.shellVersion !== 'function') return null;
  try {
    if (bridge.shellVersion() < MIN_SHELL_VERSION) return null;
    return promoteSpeechInterface(bridge);
  } catch {
    return null;
  }
}

/**
 * The native speech engine, when the shell has one.
 *
 * Gated on the shell version like the page renderer, and for the same reason: a
 * shell below 3 has no `speech` interface, and a client that called into it would
 * fail in a way that looks like a reader bug rather than an old APK.
 */
export function androidSpeechBridge(bridge: AndroidBridge): SpeechBridge | null {
  if (!shellAtLeast(bridge, NATIVE_SPEECH_SHELL_VERSION)) return null;
  const speech = bridge.speech;
  if (!speech || typeof speech.speak !== 'function') return null;
  return speech;
}

/**
 * The Android native renderer, exposed as a page host.
 *
 * Returns `null` when the shell is too old to have one, which is not an error:
 * the view then draws every page itself, exactly as the browser does. Shell
 * version 2 is the first one with `renderPage`.
 */
export function androidPageHost(bridge: AndroidBridge): NativePageHost | null {
  if (!shellAtLeast(bridge, NATIVE_PAGE_SHELL_VERSION)) return null;
  if (typeof bridge.renderPage !== 'function') return null;

  return {
    async show(request: NativePageRequest): Promise<boolean> {
      if (request.mode === 'reflowable') return false;
      // A PDF is declined for a reason worth stating: the shell's viewer is a
      // separate screen, so drawing one would take the reader out of the app and
      // lose the reading session. The WebView path stays.
      if (request.mode === 'document') return false;
      try {
        return bridge.renderPage(serialisePage(request)) === true;
      } catch {
        // A bridge that throws must degrade to the WebView path, not blank the
        // reading view. This is the only place that decides that, on purpose.
        return false;
      }
    },
    hide(): void {
      try {
        bridge.hidePage();
      } catch {
        // Nothing to undo.
      }
    },
  };
}

/**
 * JSON with bytes carried as base64, which is all a JS interface can accept.
 *
 * `mode` is passed through rather than inferred from the media type: the client
 * decided what this section *is*, and re-deriving it on the other side of the
 * bridge is how two implementations of the same rule start to disagree.
 */
export function serialisePage(request: NativePageRequest): string {
  const payload: Record<string, unknown> = {
    sectionId: request.sectionId,
    mode: request.mode,
    // Carried across so the native view honours the reader's preference rather
    // than guessing: a page drawn "contain" after the reader chose "fit width"
    // looks like the setting is broken.
    fit: request.fit,
  };
  if (request.path) payload['path'] = request.path;
  if (request.mediaType) payload['mediaType'] = request.mediaType;
  if (request.bytes && request.bytes.byteLength > 0) payload['bytes'] = toBase64(request.bytes);
  return JSON.stringify(payload);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  // Chunked: `String.fromCharCode(...bytes)` on a multi-megabyte page image
  // overflows the argument list and throws a RangeError, which would look like
  // "the native renderer does not work on big pages".
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/**
 * Re-parents the flat speech interface into the object shape the client expects.
 *
 * `addJavascriptInterface` can expose objects, not properties of one, so the
 * shell registers a second interface at `window.ReaderAndroidSpeech` (see
 * `ReaderBridge.SPEECH_NAME`). Promoting it here keeps the contract in
 * `android-bridge.d.ts` — one nested `speech` object — true from the web layer's
 * point of view, so nothing above this file knows how the bridge happens to be
 * wired on the platform side.
 *
 * Returns a new object rather than mutating the bridge: the bridge is created by
 * the shell and may be shared, and a client that writes into it would be a client
 * that can break the shell's own references.
 */
export function promoteSpeechInterface(bridge: AndroidBridge): AndroidBridge {
  const raw = window.ReaderAndroidSpeech;
  if (!raw) return bridge;
  return { ...bridge, speech: raw };
}

function shellAtLeast(bridge: AndroidBridge, version: number): boolean {
  try {
    return bridge.shellVersion() >= version;
  } catch {
    return false;
  }
}
