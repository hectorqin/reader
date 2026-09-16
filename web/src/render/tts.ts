/**
 * Read-aloud, on the Web Speech API.
 *
 * A self-hosted reader cannot ship a TTS engine: bundling a neural model would
 * multiply the container size, and a server-side synthesizer would mean streaming
 * audio for every sentence, on the reader's own CPU budget, over their own
 * network. `speechSynthesis` is already on the device, is free, works offline,
 * and is the same engine the OS screen-reader uses — which is exactly the quality
 * the reader already tolerates.
 *
 * ## Why the queue is driven sentence by sentence instead of `speak(chapter)`
 *
 * Three things are impossible otherwise:
 *
 *  1. **Highlighting.** The `boundary` event that would give word positions is
 *     not implemented on Android's WebView or reliably on Chrome. Advancing one
 *     utterance at a time makes the highlight exact at sentence granularity, with
 *     no dependence on an event that may never fire.
 *  2. **Chapter transitions.** The utterance callback is the only moment the
 *     engine tells us a sentence *finished* rather than was cancelled, so it is
 *     the only safe place to fetch the next chapter.
 *  3. **Rate changes.** Changing `rate` mid-utterance either does nothing or
 *     restarts the sentence on most implementations. Splitting the queue means a
 *     rate change takes effect on the next sentence, which is what a reader
 *     expects and never repeats text.
 *
 * ## Voices
 *
 * `getVoices()` is empty on first call in Chrome until the `voiceschanged` event
 * fires, which is the single most common reason a "voice picker" ships empty. The
 * engine therefore declares voices as loadable state and re-emits when the list
 * arrives, rather than reading it once at construction.
 */

import type { SpokenChunk } from './tts-text.ts';

export type TtsState = 'idle' | 'playing' | 'paused' | 'unsupported';

export interface TtsVoice {
  /** Stable key: `voiceURI` when present, else `name|lang`. */
  id: string;
  name: string;
  lang: string;
  default: boolean;
}

export interface TtsSnapshot {
  state: TtsState;
  /** Text of the sentence being spoken. */
  chunk: string;
  /** Where the current sentence sits in the queue. */
  index: number;
  total: number;
  rate: number;
  pitch: number;
  volume: number;
  voiceId: string;
  voices: TtsVoice[];
  /** Human-readable reason the engine is idle when it was asked to play. */
  error: string;
}

export interface TtsCallbacks {
  /**
   * Provide the queue. Called on play, and again when the queue runs out, so a
   * chapter transition is a normal part of the loop instead of a special case.
   * Returning an empty array means "nothing more to read".
   */
  loadQueue(fromIndex: number): Promise<{ chunks: SpokenChunk[]; startIndex: number }>;
  /** A sentence started: highlight it and keep it on screen. */
  onChunk(chunk: SpokenChunk, index: number): void;
  onState(snapshot: TtsSnapshot): void;
}

export interface TtsOptions extends TtsCallbacks {
  /** Injected for tests; defaults to `window.speechSynthesis`. */
  synthesis?: SpeechSynthesis | null;
  utteranceFactory?: () => SpeechSynthesisUtterance;
  /** Injected clock so tests do not wait for real speech. */
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_RATE = 1;
const DEFAULT_PITCH = 1;
const DEFAULT_VOLUME = 1;

export class TtsEngine {
  private readonly options: TtsOptions;
  private readonly voices: TtsVoice[] = [];
  private queue: SpokenChunk[] = [];
  private cursor = -1;
  private status: TtsState = 'idle';
  private error = '';
  private voiceId = '';
  private rate = DEFAULT_RATE;
  private pitch = DEFAULT_PITCH;
  private volume = DEFAULT_VOLUME;
  /** Generation counter: bumped on every stop, so stale callbacks are ignored. */
  private generation = 0;
  /** True between `speak()` and its terminal event, so a stuck engine is visible. */
  private speaking = false;
  /** Watchdog: some Android builds never fire `onend` for a cancelled utterance. */
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly noop = (): void => undefined;

  constructor(options: TtsOptions) {
    this.options = options;
    this.rate = DEFAULT_RATE;
    this.loadVoices();
    // Chrome fires this after the voice list is populated, which on a cold start
    // is *after* the first `getVoices()` returned nothing.
    this.synthesis?.addEventListener?.('voiceschanged', () => this.loadVoices());
    this.emit();
  }

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  }

  private get synthesis(): SpeechSynthesis | null {
    if (this.options.synthesis !== undefined) return this.options.synthesis;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    return window.speechSynthesis;
  }

  get snapshot(): TtsSnapshot {
    return {
      state: this.status,
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

  /** True when the engine is holding a queue, whatever its playback state. */
  get active(): boolean {
    return this.status === 'playing' || this.status === 'paused';
  }

  async play(from = 0): Promise<void> {
    const synthesis = this.synthesis;
    if (!synthesis) {
      this.status = 'unsupported';
      this.error = '当前浏览器不支持朗读';
      this.emit();
      return;
    }
    if (this.status === 'paused') {
      this.resume();
      return;
    }
    this.generation += 1;
    synthesis.cancel();
    const loaded = await this.options.loadQueue(from);
    if (loaded.chunks.length === 0) {
      this.status = 'idle';
      this.error = '这一章没有可朗读的文字';
      this.emit();
      return;
    }
    this.queue = loaded.chunks;
    this.cursor = clamp(loaded.startIndex, 0, loaded.chunks.length - 1) - 1;
    this.error = '';
    this.status = 'playing';
    this.speakNext();
  }

  pause(): void {
    const synthesis = this.synthesis;
    if (!synthesis || this.status !== 'playing') return;
    this.status = 'paused';
    // Android's WebView pauses an utterance reliably; Chrome on the desktop
    // sometimes keeps going, which is why the cursor is not advanced here and
    // `speakNext` is idempotent for the current sentence.
    synthesis.pause();
    this.emit();
  }

  resume(): void {
    const synthesis = this.synthesis;
    if (!synthesis || this.status !== 'paused') return;
    this.status = 'playing';
    if (synthesis.paused) synthesis.resume();
    else this.speakNext();
    this.emit();
  }

  stop(): void {
    this.generation += 1;
    this.clearWatchdog();
    this.speaking = false;
    this.synthesis?.cancel();
    this.queue = [];
    this.cursor = -1;
    this.status = 'idle';
    this.error = '';
    this.emit();
  }

  async next(): Promise<void> {
    if (this.queue.length === 0) return;
    await this.jump(this.cursor + 1);
  }

  async previous(): Promise<void> {
    if (this.queue.length === 0) return;
    // A press during playback restarts the *current* sentence; a press from a
    // paused or idle state steps back one, because then the reader is looking at
    // the sentence list rather than listening. This is what every phone player
    // does, and getting it wrong makes re-reading a sentence impossible.
    const index = this.status === 'playing' ? this.cursor : this.cursor - 1;
    await this.jump(Math.max(0, index));
  }

  /** Jump to a sentence by index, continuing playback. */
  async jump(index: number): Promise<void> {
    if (this.queue.length === 0) return;
    this.generation += 1;
    this.clearWatchdog();
    this.speaking = false;
    this.synthesis?.cancel();
    this.cursor = clamp(index, 0, this.queue.length - 1) - 1;
    this.status = 'playing';
    this.speakNext();
  }

  setRate(rate: number): void {
    this.rate = clamp(rate, 0.5, 3);
    this.restartCurrentSentence();
  }

  setPitch(pitch: number): void {
    this.pitch = clamp(pitch, 0.5, 2);
    this.restartCurrentSentence();
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.restartCurrentSentence();
  }

  setVoice(voiceId: string): void {
    this.voiceId = voiceId;
    this.emit();
  }

  dispose(): void {
    this.generation += 1;
    this.clearWatchdog();
    this.synthesis?.cancel();
    this.queue = [];
    this.cursor = -1;
    this.status = 'idle';
  }

  // ---- internals ----

  /**
   * Speaks the sentence after the cursor, or finishes.
   *
   * Everything terminal funnels through here: the utterance's `onend`, the
   * watchdog, and the queue-exhausted path. That is deliberate — the one thing
   * that must not happen is two of them advancing the cursor.
   */
  private speakNext(): void {
    const synthesis = this.synthesis;
    if (!synthesis) return;
    if (this.status !== 'playing') return;

    const nextIndex = this.cursor + 1;
    const chunk = this.queue[nextIndex];
    if (!chunk) {
      this.finish();
      return;
    }

    this.cursor = nextIndex;
    this.options.onChunk(chunk, nextIndex);
    this.emit();

    const utterance = this.options.utteranceFactory
      ? this.options.utteranceFactory()
      : new SpeechSynthesisUtterance(chunk.text);
    utterance.text = chunk.text;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    utterance.volume = this.volume;
    const voice = this.voices.find((candidate) => candidate.id === this.voiceId);
    const raw = voice ? findRawVoice(synthesis, voice) : null;
    if (raw) {
      utterance.voice = raw;
      utterance.lang = raw.lang;
    }

    const generation = this.generation;
    this.speaking = true;
    utterance.onend = () => {
      if (generation !== this.generation) return;
      this.speaking = false;
      this.clearWatchdog();
      this.speakNext();
    };
    utterance.onerror = (event) => {
      if (generation !== this.generation) return;
      this.speaking = false;
      this.clearWatchdog();
      const reason = (event as SpeechSynthesisErrorEvent).error;
      // `canceled`/`interrupted` are our own cancel() calls coming back; they are
      // not failures and must not surface as an error message.
      if (reason === 'canceled' || reason === 'interrupted') return;
      this.error = `朗读失败：${reason || '未知原因'}`;
      this.status = 'idle';
      this.emit();
    };

    // The engine is asked to stop anything still queued so the new utterance
    // starts immediately; without this, a chapter transition queues behind the
    // previous chapter on some Android builds.
    try {
      synthesis.speak(utterance);
    } catch (err) {
      this.speaking = false;
      this.error = err instanceof Error ? err.message : '朗读启动失败';
      this.status = 'idle';
      this.emit();
      return;
    }

    // A watchdog, not a timeout on speech: it only fires when the engine has
    // gone silent without telling us, which is a real Android WebView behaviour
    // after a long screen-off period. The bound is generous because a long
    // sentence at 0.5× genuinely takes a while.
    this.clearWatchdog();
    const budget = Math.max(6000, (chunk.text.length / (this.rate * 4)) * 1000 * 3);
    const schedule = this.options.setTimeout ?? setTimeout;
    this.watchdog = schedule(() => {
      this.watchdog = null;
      if (generation !== this.generation || !this.speaking) return;
      this.speaking = false;
      if (this.status === 'playing') this.speakNext();
    }, budget);
  }

  /** No more sentences: the reader controller decides whether to load a chapter. */
  private finish(): void {
    const generation = ++this.generation;
    this.status = 'idle';
    this.emit();
    // The queue is intentionally left in place so a rewind works, but the
    // controller is told playback ran out so it can continue into the next
    // chapter instead of stopping at every chapter boundary.
    void this.options
      .loadQueue(this.queue.length)
      .then((loaded) => {
        if (generation !== this.generation || !loaded.chunks.length) return;
        this.queue = loaded.chunks;
        this.cursor = clamp(loaded.startIndex, 0, loaded.chunks.length - 1) - 1;
        this.status = 'playing';
        this.speakNext();
      })
      .catch(() => undefined);
  }

  /**
   * Applies a rate/pitch/volume change to the sentence in flight.
   *
   * Restarting the current sentence is the only reliable way to change rate on
   * the engines that ignore it mid-utterance, and restarting a *sentence* is a
   * small enough repeat to be acceptable; restarting a chapter would not be.
   */
  private restartCurrentSentence(): void {
    this.emit();
    if (this.status !== 'playing') return;
    const index = this.cursor;
    if (index < 0) return;
    this.generation += 1;
    this.clearWatchdog();
    this.speaking = false;
    this.synthesis?.cancel();
    this.cursor = index - 1;
    // Restart asynchronously: cancel() and speak() in the same task is ignored by
    // Chrome, which is why this goes through a macrotask.
    const schedule = this.options.setTimeout ?? setTimeout;
    schedule(() => {
      if (this.status === 'playing') this.speakNext();
    }, 0);
  }

  private clearWatchdog(): void {
    if (this.watchdog === null) return;
    (this.options.clearTimeout ?? clearTimeout)(this.watchdog);
    this.watchdog = null;
  }

  private loadVoices(): void {
    const synthesis = this.synthesis;
    if (!synthesis) return;
    let voices: SpeechSynthesisVoice[] = [];
    try {
      voices = synthesis.getVoices() ?? [];
    } catch {
      voices = [];
    }
    this.voices.length = 0;
    for (const voice of voices) {
      this.voices.push({
        id: voice.voiceURI || `${voice.name}|${voice.lang}`,
        name: voice.name,
        lang: voice.lang,
        default: voice.default,
      });
    }
    // A stored voice that this device does not have (settings are per device, the
    // voice list is per platform) silently falls back to the engine's default
    // rather than muting the reader.
    if (this.voiceId && !this.voices.some((voice) => voice.id === this.voiceId)) {
      this.voiceId = '';
    }
    this.emit();
  }

  private emit(): void {
    (this.options.onState ?? this.noop)(this.snapshot);
  }
}

function findRawVoice(synthesis: SpeechSynthesis, voice: TtsVoice): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = synthesis.getVoices() ?? [];
  } catch {
    return null;
  }
  return (
    voices.find((candidate) => (candidate.voiceURI || `${candidate.name}|${candidate.lang}`) === voice.id) ?? null
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
