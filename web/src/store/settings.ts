import type { KeyValueStore } from '../core/platform.ts';
import type { ViewSettings } from '../ui/reader-view.ts';

/**
 * Reader preferences, persisted per device.
 *
 * Per *device*, not per account: text size and theme are properties of the
 * screen and the lighting you are reading in, not of who you are. Syncing them
 * would push a phone's text size onto a tablet, which is worse than not syncing.
 */

const KEY = 'reader.settings.v1';
const SERVER_KEY = 'reader.server.v1';

/** How densely the shelf lays its covers out. */
export type ShelfDensity = 'compact' | 'cozy' | 'comfortable';
/** The shelf's default ordering, per device like the rest of the settings. */
export type ShelfSort = 'updated' | 'added' | 'title' | 'author';

export interface AppSettings extends ViewSettings {
  /** UTF-8 by default; a reader can force another for an odd TXT file. */
  txtEncoding: string;
  /** Only meaningful for fixed-layout books. */
  comicDirection: 'ltr' | 'rtl';
  /** Read-aloud preferences. The voice itself is per device, like the rest. */
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  ttsVoice: string;
  /** Keep reading into the next chapter when the current one runs out. */
  ttsAutoAdvance: boolean;
  /**
   * Which engine speaks.
   *
   * `auto` rather than a concrete engine, because the right answer depends on the
   * host and the reader has no way to know: the native engine does not exist in a
   * browser, the HTTP engine does not exist on a server with no `TTS_URL`, and a
   * phone that had one engine yesterday may have another today. `auto` resolves
   * per session against what is actually there (see `speechAvailability`), and
   * pinning a specific engine is offered for the reader who wants it — usually to
   * escape a bad voice on the system engine.
   */
  ttsEngine: 'auto' | 'system' | 'http' | 'native';

  // ---- shelf ----
  /**
   * Covers per row, i.e. how much of the title is readable.
   *
   * A per-device setting for the same reason the font size is: a phone with a
   * 6-inch screen and a desktop monitor want different numbers of covers, and a
   * synced value would be wrong on one of them.
   */
  shelfDensity: ShelfDensity;
  /** What the shelf sorts by when the reader has not picked this session. */
  shelfSort: ShelfSort;
  /** Show the author under each cover. Off makes the grid much quieter. */
  shelfShowAuthor: boolean;
  /** Show the progress bar under a cover that has been started. */
  shelfShowProgress: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mode: 'scroll',
  fontScale: 1,
  lineHeight: 'inherit',
  theme: 'light',
  fit: 'contain',
  direction: 'ltr',
  fontFamily: 'inherit',
  pageMargin: 1.5,
  textAlign: 'inherit',
  brightness: 1,
  pageAnimation: 'slide',
  tapZone: 'standard',
  txtEncoding: '',
  comicDirection: 'ltr',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsVoice: '',
  ttsAutoAdvance: true,
  ttsEngine: 'auto',
  shelfDensity: 'cozy',
  shelfSort: 'updated',
  shelfShowAuthor: true,
  shelfShowProgress: true,
};

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  private loaded = false;

  constructor(private readonly kv: KeyValueStore) {}

  async load(): Promise<AppSettings> {
    if (this.loaded) return this.settings;
    const raw = await this.kv.get(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        this.settings = { ...DEFAULT_APP_SETTINGS, ...parsed };
      } catch {
        this.settings = { ...DEFAULT_APP_SETTINGS };
      }
    }
    this.loaded = true;
    return this.settings;
  }

  get current(): AppSettings {
    return this.settings;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...patch };
    await this.kv.set(KEY, JSON.stringify(this.settings));
    return this.settings;
  }

  async serverUrl(): Promise<string> {
    // An Android build ships with a baked-in default and an empty stored value
    // must not shadow it, so the fallback lives in the caller.
    return (await this.kv.get(SERVER_KEY)) ?? '';
  }

  async setServerUrl(url: string): Promise<void> {
    await this.kv.set(SERVER_KEY, url.replace(/\/+$/, ''));
  }
}
