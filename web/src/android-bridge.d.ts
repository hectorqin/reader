/**
 * The contract the Android shell exposes to the web client.
 *
 * Declared here so the shared layer can feature-detect it without `any`. The
 * Kotlin side is `ReaderBridge.kt`; keep the two in step. Every method is
 * optional at the type level because the object simply does not exist in a
 * browser, and a partial implementation (an older APK, a stubbed test double)
 * must degrade rather than throw.
 */
export interface AndroidBridge {
  /** Version of the native shell, so the client can require a minimum. */
  shellVersion(): number;
  /** Device label recorded on progress rows, e.g. `Pixel 7`. */
  deviceLabel(): string;
  /** 'online' | 'offline' from the platform connectivity manager. */
  connectivity(): string;
  /** Registers a JS function to be called when connectivity changes. */
  watchConnectivity(callback: (state: string) => void): void;
  /** Shows a native toast. */
  toast(message: string): void;
  /** Reports whether the app currently has network permission. */
  hasNetwork(): boolean;
  /** Physical pixels of the usable viewport, for fixed-layout fitting. */
  viewport(): string;
  /** Bytes used by the offline cache, for a storage screen to report honestly. */
  cacheUsage(): string;
  /**
   * Everything a bug report needs: shell version, device, Android release,
   * app version. The reader can copy this out of the app, which is the only
   * realistic way a self-hosting user can report a client bug.
   */
  diagnostics(): string;
}

declare global {
  interface Window {
    ReaderAndroid?: AndroidBridge;
  }
}

export {};
