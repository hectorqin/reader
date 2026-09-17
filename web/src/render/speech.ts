/**
 * The reader's speech layer: three engines behind one shape.
 *
 * The reader can listen to a book in three ways, and the point of this file is
 * that the rest of the client does not need to know which one is in use:
 *
 *  - **System** (`TtsEngine` → `speechSynthesis`). Free, offline, on every
 *    Android WebView and every Chromium browser. The default.
 *  - **HTTP** (`HttpTtsEngine` → the reader's own server → whatever `TTS_URL`
 *    names). For the environments the first one does not reach: a browser with no
 *    `speechSynthesis`, a desktop with no Chinese voice installed.
 *  - **Native** (`NativeTtsEngine` → the Android shell's `TextToSpeech`). Same
 *    idea as the system engine, but reached across the bridge so it uses the
 *    platform API rather than the WebView's copy of it — which matters because a
 *    voice installed on the device does not always appear in `getVoices()`.
 *
 * ## What the abstraction is, and what it is not
 *
 * It is a queue of sentences and a snapshot of what is being spoken. It is *not*
 * a base class: the three engines have genuinely different pause semantics
 * (`speechSynthesis` pauses, `<audio>` restarts the sentence, Android stops),
 * different failure modes, and different rate behaviour — the `<audio>` engine
 * changes speed in place while the other two must re-speak the sentence. A shared
 * base would put an `if (engine === …)` in every method; a shared *interface*
 * puts them nowhere.
 *
 * The screen layer talks to `SpeechEngine`, keeps a queue of `SpokenChunk`s (so
 * the highlight can be drawn), and hands the engine plain text.
 */

import type { TtsSnapshot, TtsState, TtsVoice } from './tts.ts';
import { TtsEngine } from './tts.ts';
import { HttpTtsEngine } from './tts-http.ts';
import type { SpokenChunk } from './tts-text.ts';
import type { NativeSpeechBridge } from '../android-bridge.ts';

/**
 * The one interface the reader screen uses.
 *
 * `loadQueue` is the engine asking for more sentences, and it is the only place
 * chapters enter the picture: the screen layer answers with the next batch, which
 * is how "continue into the next chapter" is a preference of the UI rather than a
 * branch inside an engine.
 */
export interface SpeechEngine {
  readonly kind: 'system' | 'http' | 'native';
  readonly active: boolean;
  snapshot: TtsSnapshot;
  loadQueue: (from: number) => Promise<{ chunks: SpokenChunk[]; startIndex: number }>;
  /** Called with the sentence about to be spoken, for the highlight. */
  onChunk: (chunk: SpokenChunk, index: number) => void;
  onState: (snapshot: TtsSnapshot) => void;
  play(from: number): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  next(): void | Promise<void>;
  previous(): void | Promise<void>;
  jump(index: number): void | Promise<void>;
  setRate(rate: number): void;
  setPitch(pitch: number): void;
  setVolume(volume: number): void;
  setVoice(voiceId: string): void;
  dispose(): void;
}

export type SpeechEngineKind = 'auto' | 'system' | 'http' | 'native';

export interface SpeechAvailability {
  system: boolean;
  native: boolean;
  http: boolean;
  /** The engine `auto` will use, which is the best one this host actually has. */
  preferred: Exclude<SpeechEngineKind, 'auto'> | null;
}

/** The order `auto` tries, best first, and the reasoning for each position. */
const PREFERENCE_ORDER: Array<Exclude<SpeechEngineKind, 'auto'>> = [
  // Native first on Android: it is the platform API, and it sees voices the
  // WebView's `getVoices()` does not (a phone with a Chinese voice installed for
  // the OS still returns an empty list to a WebView that has not loaded one).
  'native',
  // Then the WebView's own synthesizer: online-free, instant, no round trip.
  'system',
  // HTTP last, because every sentence of it costs a request and it needs a
  // server-side engine to be configured at all.
  'http',
];

export function speechAvailability(input: {
  systemSupported: boolean;
  nativeBridge: NativeSpeechBridge | null;
  httpConfigured: boolean;
}): SpeechAvailability {
  const available: SpeechAvailability = {
    system: input.systemSupported,
    native: input.nativeBridge !== null,
    http: input.httpConfigured,
    preferred: null,
  };
  for (const kind of PREFERENCE_ORDER) {
    if (available[kind]) {
      available.preferred = kind;
      return available;
    }
  }
  return available;
}

/** Human labels, so the settings panel does not inline a switch. */
export const SPEECH_ENGINE_LABELS: Record<Exclude<SpeechEngineKind, 'auto'>, string> = {
  native: '系统语音（原生）',
  system: '系统语音（浏览器）',
  http: 'HTTP 朗读',
};

export interface SpeechFactoryOptions {
  kind: Exclude<SpeechEngineKind, 'auto'>;
  baseUrl: string;
  accessToken: () => string | null;
  nativeBridge: NativeSpeechBridge | null;
  /** System-engine injection points, forwarded for tests. */
  synthesis?: SpeechSynthesis | null;
  utteranceFactory?: () => SpeechSynthesisUtterance;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  onError?: (message: string) => void;
}

/**
 * Builds one engine.
 *
 * Returns `null` when the requested kind is unavailable rather than a stub that
 * pretends to work: a `null` makes the caller fall back visibly, and a stub makes
 * it show a play button that does nothing.
 */
export function createSpeechEngine(options: SpeechFactoryOptions): SpeechEngine | null {
  switch (options.kind) {
    case 'system':
      if (!TtsEngine.isSupported()) return null;
      return new TtsEngine({
        loadQueue: () => Promise.resolve({ chunks: [], startIndex: 0 }),
        onChunk: () => undefined,
        onState: () => undefined,
        ...(options.synthesis !== undefined ? { synthesis: options.synthesis } : {}),
        ...(options.utteranceFactory ? { utteranceFactory: options.utteranceFactory } : {}),
        ...(options.setTimeout ? { setTimeout: options.setTimeout } : {}),
        ...(options.clearTimeout ? { clearTimeout: options.clearTimeout } : {}),
      });
    case 'native':
      if (!options.nativeBridge) return null;
      return new NativeTtsEngine(options.nativeBridge, {
        ...(options.onError ? { onError: options.onError } : {}),
      });
    case 'http': {
      const engine = new HttpTtsEngine({
        baseUrl: options.baseUrl,
        accessToken: options.accessToken,
        ...(options.onError ? { onError: options.onError } : {}),
      });
      return new HttpTtsAdapter(engine);
    }
    default:
      return null;
  }
}

/**
 * Adapts the HTTP engine to the interface.
 *
 * The HTTP engine has its own state shape (it has no pitch, no voice list), so a
 * thin adapter is what keeps that difference out of the screen layer instead of
 * spreading it across every render of the朗读 bar.
 */
class HttpTtsAdapter implements SpeechEngine {
  readonly kind = 'http' as const;
  loadQueue: SpeechEngine['loadQueue'] = () => Promise.resolve({ chunks: [], startIndex: 0 });
  onChunk: SpeechEngine['onChunk'] = () => undefined;
  onState: SpeechEngine['onState'] = () => undefined;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly engine: HttpTtsEngine) {
    engine.setQueueLoader(async (from) => {
      const loaded = await this.loadQueue(from);
      return { chunks: loaded.chunks.map((chunk) => ({ text: chunk.text })), startIndex: loaded.startIndex };
    });
  }

  get active(): boolean {
    return this.engine.active;
  }

  get snapshot(): TtsSnapshot {
    return this.engine.snapshot;
  }

  async play(from: number): Promise<void> {
    // The highlight is drawn from the queue the screen layer built, so the
    // adapter reports the sentence it is about to speak for every index it
    // advances through — not just the one `play` was called with. It learns the
    // queue from `onChunk`'s own consumer via `loadQueue`, which is the only
    // place the two sides share the list.
    this.unsubscribe?.();
    this.lastIndex = -1;
    this.unsubscribe = this.engine.onState((snapshot) => {
      this.onState(snapshot);
      if (snapshot.index === this.lastIndex) return;
      this.lastIndex = snapshot.index;
      this.emitChunk(snapshot.index);
    });
    // The trailing emit was removed deliberately: the state listener above already
    // fires for the first sentence, and calling both made every chapter start with
    // the same highlight painted twice — which is visible as a flicker on a
    // low-end phone, and pointless work on any other.
    await this.engine.play(from);
  }

  /** Index of the last chunk reported, so one sentence is highlighted once. */
  private lastIndex = -1;

  /**
   * Maps an engine index back to a sentence.
   *
   * The engine indexes *fragments*, because a paragraph with no punctuation is
   * split before it is sent (the server caps an utterance at 800 characters). The
   * fragment's own `start` offset is what maps it back to the sentence the reader
   * can see, which is why the split copies the original `node` and adjusts only
   * `start`.
   */
  private emitChunk(index: number): void {
    const chunk = this.queue()[index];
    if (chunk) this.onChunk(chunk, index);
  }

  /**
   * The engine's fragment list.
   *
   * Supplied by the screen layer through `chunkSource`, because the adapter never
   * sees the queue otherwise — it hands plain text to the HTTP engine.
   */
  chunkSource: () => SpokenChunk[] = () => [];

  private queue(): SpokenChunk[] {
    return this.chunkSource();
  }

  pause(): void {
    this.engine.pause();
  }

  resume(): void {
    this.engine.resume();
  }

  stop(): void {
    this.engine.stop();
  }

  next(): void {
    this.engine.next();
  }

  previous(): void {
    this.engine.previous();
  }

  jump(index: number): void {
    this.engine.jump(index);
  }

  setRate(rate: number): void {
    this.engine.setRate(rate);
  }

  setPitch(): void {
    // Synthesised audio has no pitch control that is not a playback rate change,
    // and a shimmed one is worse than none. The settings row is hidden for this
    // engine instead of silently doing nothing here.
  }

  setVolume(volume: number): void {
    this.engine.setVolume(volume);
  }

  setVoice(voiceId: string): void {
    this.engine.setVoice(voiceId);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.engine.dispose();
  }
}

/**
 * Android's `TextToSpeech`, across the bridge.
 *
 * ## Why this exists when the WebView already has a synthesizer
 *
 * It is not the same synthesizer. A WebView's `speechSynthesis` is backed by the
 * engine the *WebView* was built against, and its `getVoices()` list is routinely
 * empty or English-only on a phone whose OS-level TTS has a Chinese voice
 * installed and working. That is the single most common "朗读没有中文声音" report,
 * and the only fix is to ask the platform directly.
 *
 * ## Why the queue is driven from here rather than from Kotlin
 *
 * The native side reports `onStart`/`onDone` per utterance, and that is all it
 * is asked to do. The cursor, the chapter boundary and the settings stay in
 * JavaScript, which is what keeps the highlight, the progress bar and "下一句"
 * identical whichever engine is speaking. Kotlin owning a queue would be a second
 * implementation of a rule that already exists.
 */
class NativeTtsEngine implements SpeechEngine {
  readonly kind = 'native' as const;
  loadQueue: SpeechEngine['loadQueue'] = () => Promise.resolve({ chunks: [], startIndex: 0 });
  onChunk: SpeechEngine['onChunk'] = () => undefined;
  onState: SpeechEngine['onState'] = () => undefined;

  private queue: SpokenChunk[] = [];
  private cursor = -1;
  private state: TtsState = 'idle';
  private error = '';
  private rate = 1;
  private pitch = 1;
  private volume = 1;
  private voiceId = '';
  private voices: TtsVoice[] = [];
  private generation = 0;
  private speaking = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Id of the utterance in flight, matched against the shell's events. */
  private utteranceId = '';

  constructor(
    private readonly bridge: NativeSpeechBridge,
    private readonly options: { onError?: (message: string) => void },
  ) {
    // The shell reports sentence completion; the callbacks are installed once and
    // dispatch through the generation counter so a cancelled utterance that
    // arrives late cannot advance the cursor.
    bridge.onSpeechEvent((event) => this.onNativeEvent(event));
    bridge.onVoices?.((voices) => {
      this.voices = voices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        lang: voice.lang,
        default: voice.default === true,
      }));
      this.emit();
    });
    try {
      bridge.init?.();
    } catch {
      // An old shell without `init` still speaks with the default engine.
    }
  }

  get active(): boolean {
    return this.state === 'playing' || this.state === 'paused';
  }

  get snapshot(): TtsSnapshot {
    return {
      state: this.state,
      chunk: this.queue[this.cursor]?.text ?? '',
      index: this.cursor,
      total: this.queue.length,
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume,
      voiceId: this.voiceId,
      voices: [...this.voices],
      error: this.error,
    };
  }

  async play(from = 0): Promise<void> {
    if (this.state === 'paused') {
      this.resume();
      return;
    }
    this.generation += 1;
    this.bridge.stop();
    const loaded = await this.loadQueue(from);
    if (loaded.chunks.length === 0) {
      this.state = 'idle';
      this.error = '这一章没有可朗读的文字';
      this.emit();
      return;
    }
    this.queue = loaded.chunks as SpokenChunk[];
    this.cursor = clamp(loaded.startIndex, 0, this.queue.length - 1) - 1;
    this.error = '';
    this.state = 'playing';
    this.speakNext();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.bridge.pause();
    this.emit();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    // `TextToSpeech` has no resume: a paused utterance has to be re-queued, and
    // re-queuing the *current* sentence is the same trade the other engines make.
    this.cursor -= 1;
    this.speakNext();
  }

  stop(): void {
    this.generation += 1;
    this.clearWatchdog();
    this.speaking = false;
    this.bridge.stop();
    this.queue = [];
    this.cursor = -1;
    this.state = 'idle';
    this.error = '';
    this.utteranceId = '';
    this.emit();
  }

  next(): void {
    if (this.queue.length === 0) return;
    this.jump(this.cursor + 1);
  }

  previous(): void {
    if (this.queue.length === 0) return;
    const index = this.state === 'playing' ? this.cursor : this.cursor - 1;
    this.jump(Math.max(0, index));
  }

  jump(index: number): void {
    if (this.queue.length === 0) return;
    this.generation += 1;
    this.clearWatchdog();
    this.speaking = false;
    this.bridge.stop();
    this.cursor = clamp(index, 0, this.queue.length - 1) - 1;
    this.state = 'playing';
    this.speakNext();
  }

  setRate(rate: number): void {
    this.rate = clamp(rate, 0.5, 3);
    this.bridge.setRate(this.rate);
    this.restartCurrentSentence();
  }

  setPitch(pitch: number): void {
    this.pitch = clamp(pitch, 0.5, 2);
    this.bridge.setPitch(this.pitch);
    this.restartCurrentSentence();
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.bridge.setVolume(this.volume);
    this.emit();
  }

  setVoice(voiceId: string): void {
    this.voiceId = voiceId;
    this.bridge.setVoice(voiceId);
    this.restartCurrentSentence();
  }

  dispose(): void {
    this.generation += 1;
    this.clearWatchdog();
    this.bridge.stop();
    // `shutdown` rather than `stop`: the screen is going away, so the bound
    // service should be released rather than left ready for a sentence that will
    // never come. The shell also does this on activity destroy, but doing it here
    // means closing a book releases the engine immediately instead of holding it
    // for the lifetime of the app.
    try {
      this.bridge.shutdown();
    } catch {
      // An older shell without `shutdown` still stops, which is the part that
      // matters for silence.
    }
    this.queue = [];
    this.cursor = -1;
    this.state = 'idle';
  }

  // ---- internals ----

  private speakNext(): void {
    if (this.state !== 'playing') return;
    const nextIndex = this.cursor + 1;
    const chunk = this.queue[nextIndex];
    if (!chunk) {
      void this.finish();
      return;
    }
    this.cursor = nextIndex;
    this.onChunk(chunk, nextIndex);
    this.emit();

    this.bridge.setRate(this.rate);
    this.bridge.setPitch(this.pitch);
    this.bridge.setVolume(this.volume);
    const generation = this.generation;
    this.speaking = true;
    // The id is minted here and echoed by the shell, which is how a `done` that
    // arrives after the reader pressed "next" is recognised as stale.
    this.utteranceId = `u${generation}-${nextIndex}`;
    try {
      this.bridge.speak(chunk.text, this.utteranceId);
    } catch (err) {
      this.speaking = false;
      this.fail(err instanceof Error ? err.message : '原生朗读失败');
      return;
    }

    // The watchdog mirrors the system engine's: an Android TTS engine that has
    // gone silent without an `onDone` is a real, observed behaviour after a long
    // screen-off period, and without this the bar would sit on "playing" forever.
    this.clearWatchdog();
    const budget = Math.max(8000, (chunk.text.length / (this.rate * 4)) * 1000 * 3);
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (generation !== this.generation || !this.speaking) return;
      this.speaking = false;
      if (this.state === 'playing') this.speakNext();
    }, budget);
  }

  private onNativeEvent(event: { type: string; id?: string; message?: string }): void {
    if (!this.active) return;
    // A late event for something the reader has moved past is not an error and
    // must not touch the cursor: it would skip a sentence, which is exactly the
    // bug the id exists to prevent.
    if (event.id !== undefined && event.id !== '' && event.id !== this.utteranceId) return;
    switch (event.type) {
      case 'done':
        if (!this.speaking) return;
        this.speaking = false;
        this.clearWatchdog();
        this.speakNext();
        break;
      case 'start':
        // Nothing to do: the cursor moved when the utterance was queued, and
        // acting here would double-advance.
        break;
      case 'error':
        this.speaking = false;
        this.clearWatchdog();
        this.fail(event.message || '原生朗读失败');
        break;
      default:
        break;
    }
  }

  private async finish(): Promise<void> {
    const generation = ++this.generation;
    this.state = 'idle';
    this.emit();
    try {
      const loaded = await this.loadQueue(this.queue.length);
      if (generation !== this.generation || loaded.chunks.length === 0) return;
      this.queue = loaded.chunks as SpokenChunk[];
      this.cursor = clamp(loaded.startIndex, 0, this.queue.length - 1) - 1;
      this.state = 'playing';
      this.speakNext();
    } catch {
      // The status bar owns the connectivity explanation.
    }
  }

  private restartCurrentSentence(): void {
    this.emit();
    if (this.state !== 'playing') return;
    const index = this.cursor;
    if (index < 0) return;
    this.generation += 1;
    this.clearWatchdog();
    this.speaking = false;
    this.utteranceId = '';
    this.bridge.stop();
    this.cursor = index - 1;
    setTimeout(() => {
      if (this.state === 'playing') this.speakNext();
    }, 0);
  }

  private fail(message: string): void {
    this.error = message;
    this.state = 'idle';
    this.bridge.stop();
    this.emit();
    this.options.onError?.(message);
  }

  private clearWatchdog(): void {
    if (this.watchdog === null) return;
    clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private emit(): void {
    this.onState(this.snapshot);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
