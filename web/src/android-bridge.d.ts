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

  /**
   * The native speech surface, if this shell has one.
   *
   * A nested object rather than more top-level methods because it is a *feature*
   * rather than a capability: a shell without it is a perfectly good shell, and
   * the client falls back to `speechSynthesis` (which is present in every
   * Android WebView). Keeping it nested also means the feature check is one
   * property read rather than seven `typeof` checks.
   *
   * Added in shell version 3. Note that on the platform side this is a *separate*
   * registered interface (`window.ReaderAndroidSpeech`) — `addJavascriptInterface`
   * can expose objects, not properties of one — and the web layer re-parents it
   * onto this key in `android-platform.ts`. Declaring it here as a property is
   * therefore the contract the client sees, not the shape Kotlin registers.
   */
  speech?: SpeechBridge;
}

/**
 * Android's `TextToSpeech`, exposed to the client.
 *
 * This exists because a WebView's own `speechSynthesis` is a *different*
 * synthesizer from the one the operating system uses, and on a phone it is
 * frequently the worse of the two: Chinese voices installed for the OS are
 * routinely absent from `getVoices()`, which is why "朗读没有中文声音" is the most
 * common complaint about browser-based TTS on Android.
 *
 * The queue, the cursor and the chapter boundary stay in JavaScript. This is only
 * "say this sentence" and "tell me when you have said it" — a native queue would
 * be a second implementation of rules that already exist in one place.
 */
export interface SpeechBridge {
  /** Whether the platform engine initialised successfully. */
  available(): boolean;
  /** Creates the engine and loads voices. Idempotent. */
  init(): void;
  /**
   * Registers the callback invoked for `start` / `done` / `error` events.
   *
   * `id` is the utterance the event is about, and it is not decoration: a `done`
   * for a sentence the reader has already moved past must not advance the client's
   * cursor, and without an id there is no way to tell the two apart. The id is
   * chosen by the client and echoed back by the shell (see `speak`).
   */
  onSpeechEvent(callback: (event: { type: string; id?: string; message?: string }) => void): void;
  /** Registers the callback that receives the voice list, JSON-encoded. */
  onVoices(callback: (voices: Array<{ id: string; name: string; lang: string; default?: boolean }>) => void): void;
  /**
   * Speaks one utterance. Replaces anything already in flight.
   *
   * The id is the client's, not the shell's: the client knows which sentence it
   * asked for, and it is the only side that can decide whether a late event still
   * belongs to the sentence on screen.
   */
  speak(text: string, utteranceId: string): void;
  pause(): void;
  stop(): void;
  setRate(rate: number): void;
  setPitch(pitch: number): void;
  setVolume(volume: number): void;
  setVoice(voiceId: string): void;
  /**
   * Releases the engine and unbinds the platform service.
   *
   * Not "stop": stopping leaves the engine ready for the next sentence, and this
   * is what the shell calls when the activity is destroyed. On Android it is the
   * difference between a bound service being released and being leaked.
   */
  shutdown(): void;
}

/**
 * The subset of `SpeechBridge` the shared layer depends on.
 *
 * Declared as an alias so `speech.ts` can take one as a parameter without
 * importing the whole bridge contract, and so a test double only has to
 * implement the sentence-at-a-time part.
 */
export type NativeSpeechBridge = SpeechBridge;

declare global {
  interface Window {
    ReaderAndroid?: AndroidBridge;
    /**
     * The speech interface, registered separately by the shell.
     *
     * Present only on shell version 3 and above. Read by
     * `promoteSpeechInterface`, which is the one place that knows about it.
     */
    ReaderAndroidSpeech?: SpeechBridge;
  }
}

export {};
