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
  /**
   * Draws one fixed-layout page natively and returns whether it was drawn.
   *
   * The client asks for this only for pages whose content is a picture (comic
   * page, scanned PDF page). A `false` return is the host declining — an
   * unsupported mode, an undecodable image — and the caller draws the page in
   * the WebView as it would anywhere else. There is no third outcome: a failure
   * must not leave a blank screen where a page should be.
   *
   * The request is JSON, because a JavaScript interface method can only take
   * primitives, and a page is not one. Bytes travel base64-encoded inside it,
   * which is the cost of the shortcut and still cheaper than a WebView layout
   * pass for a full-page image.
   */
  renderPage(request: string): boolean;
  /** Removes the native page view, restoring the WebView underneath it. */
  hidePage(): void;
  /**
   * Reports whether a document of this media type can be handed to the platform
   * viewer. Used for PDF, where the shell must decline: its viewer is a separate
   * screen, not a view that can sit inside the reader, and opening one would
   * take the reader out of the app.
   */
  canOpenDocument(mediaType: string): boolean;
}

declare global {
  interface Window {
    ReaderAndroid?: AndroidBridge;
  }
}

export {};
