import type { RenderMode } from '../formats/types.ts';

/**
 * The seam a native host uses to draw a fixed-layout page itself.
 *
 * Present because of a product decision with a measurable cost: in a WebView, a
 * comic page or a scanned PDF page costs a decode into the renderer process, a
 * full style/layout pass, and a bitmap that lives as long as the page does. On
 * Android the platform already has a decoded-image pipeline and a PDF renderer,
 * so the same page can be drawn without either. EPUB stays in the WebView — its
 * layout is the differentiator and cannot be reproduced natively.
 *
 * The interface is deliberately narrow and the failure mode is explicit: a host
 * either draws the page and says so, or declines and the DOM path runs. That is
 * what keeps this an optimisation rather than a second renderer with its own
 * set of bugs — there is exactly one implementation of every layout, and the
 * native path only ever replaces "show these bytes as a picture".
 */
export interface NativePageRequest {
  sectionId: string;
  /** What the section is, so the host can refuse the modes it cannot draw. */
  mode: RenderMode;
  /** Address of the section's bytes, when it has one. Preferred over `bytes`. */
  path?: string;
  /** Media type, when known. */
  mediaType?: string;
  /**
   * Bytes already resolved by the web layer.
   *
   * For a comic inside a CBZ there is no URL the native side could fetch — the
   * page lives inside an archive — so the resolved buffer is passed instead of a
   * path. It is a copy across the bridge, which still costs less than a WebView
   * layout pass, and it is the only option that works for archives.
   */
  bytes?: Uint8Array;
  /**
   * How the page should sit in the viewport: the whole page, or fitted to width.
   *
   * Passed rather than re-derived natively because it is a *reader preference*
   * (`SettingsStore.fit`), not a property of the page. A native renderer that
   * guessed would ignore the setting the reader just changed.
   *
   * Only `contain` is drawn natively. `fit width` is handled by the caller
   * declining before it asks — see `ReaderView` — because cropping a page
   * silently loses panels and a native scrolling surface would be a second
   * renderer.
   */
  fit: 'contain' | 'width';
}

export interface NativePageHost {
  /** Draws the page. Resolves false when the host declines and the caller must. */
  show(request: NativePageRequest): Promise<boolean>;
  /** Removes a previously drawn page. Safe to call when none is shown. */
  hide(): void;
}

/**
 * Wraps the Android bridge as a page host.
 *
 * Kept here rather than in `android-platform.ts` because the view is the only
 * consumer, and the translation between "section" and "native view" belongs next
 * to the code that knows what a section is.
 */
export function createNativePageHost(invoke: (request: NativePageRequest) => Promise<boolean>, onHide: () => void): NativePageHost {
  return {
    show: (request) => invoke(request),
    hide: onHide,
  };
}
