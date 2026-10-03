import { createAndroidPlatform, detectAndroidBridge, androidPageHost, androidSpeechBridge } from '../core/android-platform.ts';
import { createWebPlatform } from '../core/web-platform.ts';
import type { Platform } from '../core/platform.ts';
import { renderChannelLinks } from '../media/channel-navigation.tsx';
import type { AppSettings } from '../store/settings.ts';

/**
 * Compatibility-only route shape used by the old Android diagnostics/tests.
 *
 * Production routing is owned by React Router. Keeping this tiny structural
 * type here prevents the compatibility boundary from pulling the removed
 * hand-written router back into the production module graph.
 */
type LegacyRoute =
  | { name: 'media'; channel: string }
  | { name: Exclude<string, 'media'>; channel?: never };

export interface LegacyCompatOptions { root: HTMLElement; defaultServerUrl?: string }

/**
 * Compatibility boundary for old lifecycle tests and the Android diagnostic API.
 * It intentionally contains no page routing or Screen construction; production
 * startup uses `createAppRuntime` and React Router directly.
 */
export class App {
  readonly root: HTMLElement;
  readonly options: LegacyCompatOptions;
  channelEntry: HTMLElement | null = null;
  mediaPlayer: { setVisible(visible: boolean): void; flush?(): Promise<void> } | null = null;
  reader: { flushProgress?(): Promise<void> } | null = null;
  offline: { flush?(): Promise<void> } | null = null;
  sync: { flush?(): Promise<void> } | null = null;
  api: { baseUrl?: string } | null = null;
  constructor(options: LegacyCompatOptions) { this.options = options; this.root = options.root; }

  async createPlatform(): Promise<Platform> {
    const bridge = detectAndroidBridge();
    const serverUrl = () => this.api?.baseUrl ?? this.options.defaultServerUrl ?? '';
    if (!bridge) return createWebPlatform(serverUrl);
    androidPageHost(bridge);
    androidSpeechBridge(bridge);
    return createAndroidPlatform(serverUrl, bridge);
  }

  showChannelEntry(route: LegacyRoute): void {
    this.mediaPlayer?.setVisible(route.name === 'media');
    if (route.name !== 'media') {
      this.channelEntry?.remove(); this.channelEntry = null; return;
    }
    if (!this.channelEntry) {
      this.channelEntry = document.createElement('nav');
      this.channelEntry.className = 'media-channel-entry';
      this.channelEntry.setAttribute('aria-label', '内容频道');
      this.root.insertAdjacentElement('afterend', this.channelEntry);
    }
    this.channelEntry.hidden = false;
    renderChannelLinks(this.channelEntry, route.channel ?? '');
  }

  async saveBeforeUpdate(): Promise<void> {
    await this.mediaPlayer?.flush?.();
    await this.reader?.flushProgress?.();
    await this.offline?.flush?.();
  }

  async flush(): Promise<void> {
    await Promise.allSettled([
      Promise.resolve().then(() => this.mediaPlayer?.flush?.()),
      (async () => { await this.reader?.flushProgress?.(); await this.offline?.flush?.(); await this.sync?.flush?.(); })(),
    ]);
  }

  async start(): Promise<void> { /* Production startup lives in main.tsx. */ }
  currentBook(): null { return null; }
  syncStatus(): null { return null; }
  settingsSnapshot(): Promise<AppSettings | undefined> { return Promise.resolve(undefined); }
}

export function inferDefaultUrl(): string {
  if (typeof location === 'undefined' || location.protocol === 'file:') return '';
  if (location.hostname === 'appassets.androidplatform.net') {
    try { return validServerUrl(window.ReaderAndroid?.configuredServerUrl?.()); } catch { return ''; }
  }
  return location.origin;
}

export function validServerUrl(value?: string): string {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== 'appassets.androidplatform.net' ? value.trim() : '';
  } catch { return ''; }
}
