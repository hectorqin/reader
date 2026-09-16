/**
 * The Android shell's interface.
 *
 * The bridge is a plain object on `window`, written by the shell before this
 * bundle runs. No JavaScript is evaluated from the native side and no message is
 * passed as a string to be re-parsed: the shell is same-process, so a plain
 * object is both simpler and harder to get wrong than a postMessage protocol.
 *
 * What the shell owns, and why it is not done in JavaScript:
 *
 *  - **Gestures on paged content.** The shell renders comic pages in a native
 *    pager because a WebView's per-page memory is what kills a 300MB volume on a
 *    mid-range phone. A native pager handles its own swipes; the H5 layer is not
 *    involved.
 *  - **The offline cache.** A book downloaded for offline reading lives in the
 *    shell's file cache, which is what lets it be read with the server unreachable.
 *  - **The account.** Tokens live in the shell's encrypted storage, so the H5
 *    layer never writes a refresh token into a WebView's localStorage where any
 *    injected script could read it.
 *
 * What the H5 layer owns: reflowable rendering, the shelf, and settings. Those
 * are the parts that benefit from being the same code in both builds.
 */

export interface ReaderBridge {
  /** Server origin, e.g. `http://192.168.1.10:8080`. */
  serverUrl?: string;
  platform: 'android';
  /** Device name recorded with each progress update. */
  deviceName?: string;
  /** Called when a book is opened, so the shell can take over input. */
  onBookOpened?(bookId: string): void;
  /** The shell hands back a page-turn function for hardware keys and gestures. */
  onTurnPage?(turn: (pages: number) => void): void;
  /** Ask the shell to cache a book for offline reading. */
  cacheBook?(bookId: string): void;
}

declare global {
  interface Window {
    readerBridge?: ReaderBridge;
  }
}

/**
 * Read the bridge, or undefined when running as a plain web page.
 *
 * A missing bridge is the normal case for the H5 deployment, not an error.
 */
export function installBridge(): ReaderBridge | undefined {
  const bridge = window.readerBridge;
  if (!bridge) return undefined;
  return { ...bridge, platform: 'android' };
}
