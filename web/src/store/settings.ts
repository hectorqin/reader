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
/**
 * What the shelf can be ordered by.
 *
 * Four keys, and they answer three different questions a reader actually asks:
 * *where was I* (`recent`, the default), *what did I just put in there* (`added`),
 * and *what is this book called / who wrote it* (`title`, `author`).
 *
 * `recent` is the one the shelf opens on, and it is deliberately not the same
 * question as `added`: a library that opens on "what did I add last" answers a
 * question the reader asks once a week, while "where was I" is asked every time
 * the app is opened. `updated` is kept as an alias of `added` so a stored
 * preference from an older build keeps working (see `shelf-settings.tsx`).
 */
export type ShelfSort = 'recent' | 'added' | 'title' | 'author';

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
  txtIndent: 2,
  txtParagraphGap: 0.55,
  txtEncoding: '',
  comicDirection: 'ltr',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsVoice: '',
  ttsAutoAdvance: true,
  ttsEngine: 'auto',
  shelfDensity: 'cozy',
  shelfSort: 'recent',
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
        const parsed = JSON.parse(raw) as Partial<AppSettings> & { shelfSort?: string };
        this.settings = { ...DEFAULT_APP_SETTINGS, ...parsed };
        /*
         * Two stored values are folded forward, and both are the same repair.
         *
         * `updated` used to be the shelf's only date sort and it meant "the file
         * changed" — which for a library imported once is very nearly "when I added
         * it". It is now *named* `added`, which is what it always was in practice,
         * and `updated` no longer exists as a choice; left folded, a reader who had
         * picked it would open the shelf on a key the sort sheet cannot show and the
         * server would receive an unknown `sort`.
         *
         * `title` and `author` are untouched: they still mean what they meant.
         */
        if (this.settings.shelfSort === ('updated' as string)) this.settings.shelfSort = 'added';
        if (!['recent', 'added', 'title', 'author'].includes(this.settings.shelfSort)) {
          this.settings.shelfSort = DEFAULT_APP_SETTINGS.shelfSort;
        }
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
