// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSpeechEngine, speechAvailability, SPEECH_ENGINE_LABELS } from '../src/render/speech.ts';
import type { NativeSpeechBridge } from '../src/android-bridge.ts';
import type { TtsSnapshot } from '../src/render/tts.ts';

/**
 * Engine selection and the native engine's queue.
 *
 * The selection order is what makes this testable rather than a `if` chain in the
 * screen: given what a host has, which engine speaks? Getting that wrong shows up
 * as a reader on an Android phone being read to in English by the WebView engine
 * while the OS has a perfectly good Chinese voice installed — the exact bug the
 * native engine exists to fix.
 */

function fakeNativeBridge(): {
  bridge: NativeSpeechBridge;
  events: Array<{ type: string; message?: string }>;
  spoken: string[];
  /** Fires an event for the utterance the bridge was last asked to speak. */
  fire(type: string, message?: string): void;
  /** Fires an event for an utterance the reader has already moved past. */
  fireStale(type: string, message?: string): void;
} {
  const events: Array<{ type: string; message?: string }> = [];
  const spoken: string[] = [];
  let handler: ((event: { type: string; id?: string; message?: string }) => void) | null = null;
  let lastId = '';
  let previousId = '';
  const bridge: NativeSpeechBridge = {
    available: () => true,
    init: () => undefined,
    onSpeechEvent: (callback) => {
      handler = callback;
    },
    onVoices: () => undefined,
    speak: (text, id) => {
      spoken.push(text);
      // The id of the utterance before this one, so a test can simulate the
      // platform's late `done` for a sentence the reader already left behind.
      previousId = lastId;
      lastId = id;
    },
    pause: () => undefined,
    stop: () => undefined,
    setRate: () => undefined,
    setPitch: () => undefined,
    setVolume: () => undefined,
    setVoice: () => undefined,
    shutdown: () => undefined,
  };
  return {
    bridge,
    events,
    spoken,
    fire: (type, message) => {
      events.push({ type, ...(message ? { message } : {}) });
      handler?.({ type, id: lastId, ...(message ? { message } : {}) });
    },
    fireStale: (type, message) => {
      events.push({ type, stale: true, ...(message ? { message } : {}) } as never);
      handler?.({ type, id: previousId, ...(message ? { message } : {}) });
    },
  };
}

describe('speechAvailability', () => {
  it('prefers the native engine on an Android shell', () => {
    const availability = speechAvailability({ systemSupported: true, nativeBridge: fakeNativeBridge().bridge, httpConfigured: true });
    // Native wins even though the WebView synthesizer is also there, because the
    // WebView's voice list is the one that is routinely missing Chinese voices.
    expect(availability.preferred).toBe('native');
  });

  it('falls back to the WebView engine when the shell is too old to have one', () => {
    const availability = speechAvailability({ systemSupported: true, nativeBridge: null, httpConfigured: true });
    expect(availability.preferred).toBe('system');
  });

  it('uses HTTP only when there is nothing local, which is the whole point of it', () => {
    const availability = speechAvailability({ systemSupported: false, nativeBridge: null, httpConfigured: true });
    expect(availability.preferred).toBe('http');
  });

  it('reports no engine at all rather than pretending one exists', () => {
    const availability = speechAvailability({ systemSupported: false, nativeBridge: null, httpConfigured: false });
    expect(availability.preferred).toBeNull();
  });

  it('names every engine it can return', () => {
    // A label missing here would render as "undefined" in the picker.
    expect(Object.keys(SPEECH_ENGINE_LABELS).sort()).toEqual(['http', 'native', 'system']);
  });
});

describe('createSpeechEngine', () => {
  it('returns null for an engine this host does not have, rather than a silent stub', () => {
    expect(
      createSpeechEngine({
        kind: 'native',
        baseUrl: '',
        accessToken: () => null,
        nativeBridge: null,
      }),
    ).toBeNull();
  });

  it('drives the native queue from the done event, not from a timer', async () => {
    const native = fakeNativeBridge();
    const engine = createSpeechEngine({
      kind: 'native',
      baseUrl: '',
      accessToken: () => null,
      nativeBridge: native.bridge,
    });
    expect(engine).not.toBeNull();

    const snapshots: TtsSnapshot[] = [];
    engine!.onState = (snapshot) => snapshots.push(snapshot);
    engine!.loadQueue = async () => ({
      chunks: [
        { text: '一。', node: null, start: 0, blockIndex: 0 },
        { text: '二。', node: null, start: 2, blockIndex: 0 },
      ],
      startIndex: 0,
    });

    await engine!.play(0);
    expect(native.spoken).toEqual(['一。']);
    // No second sentence until the platform says the first is done. A timer-driven
    // queue would speak two at once on a slow engine.
    native.fire('done');
    expect(native.spoken).toEqual(['一。', '二。']);
  });

  it('ignores a late done event from a sentence the reader moved past', async () => {
    const native = fakeNativeBridge();
    const engine = createSpeechEngine({
      kind: 'native',
      baseUrl: '',
      accessToken: () => null,
      nativeBridge: native.bridge,
    })!;
    engine.loadQueue = async () => ({
      chunks: [
        { text: '一。', node: null, start: 0, blockIndex: 0 },
        { text: '二。', node: null, start: 2, blockIndex: 0 },
        { text: '三。', node: null, start: 4, blockIndex: 0 },
      ],
      startIndex: 0,
    });

    await engine.play(0);
    engine.next();
    expect(native.spoken).toEqual(['一。', '二。']);
    // A late `done` for the *first* sentence must not advance the cursor again,
    // which would skip 三。 The id is what makes that decidable; without it the
    // engine cannot tell "the sentence I am on finished" from "the sentence the
    // reader left behind finished".
    native.fireStale('done');
    expect(native.spoken).toEqual(['一。', '二。']);
  });

  it('never reports the same sentence twice, even when the engine re-emits state', async () => {
    const native = fakeNativeBridge();
    const engine = createSpeechEngine({
      kind: 'native',
      baseUrl: '',
      accessToken: () => null,
      nativeBridge: native.bridge,
    })!;
    const highlighted: string[] = [];
    engine.onChunk = (chunk) => highlighted.push(chunk.text);
    engine.loadQueue = async () => ({
      chunks: [
        { text: '一。', node: null, start: 0, blockIndex: 0 },
        { text: '二。', node: null, start: 2, blockIndex: 0 },
      ],
      startIndex: 0,
    });

    await engine.play(0);
    // `onState` fires on every emit — a volume change, a pause, a rate change —
    // and the highlight must be driven by the *sentence changing*, not by the
    // state event. Otherwise moving a slider repaints the same highlight, and a
    // render-heavy highlight is what makes the reading view stutter.
    native.fire('done');
    engine.setVolume(0.5);
    engine.setRate(1.5);
    expect(highlighted).toEqual(['一。', '二。']);
  });

  it('reports a native error as a message rather than going quiet', async () => {
    const native = fakeNativeBridge();
    const errors: string[] = [];
    const engine = createSpeechEngine({
      kind: 'native',
      baseUrl: '',
      accessToken: () => null,
      nativeBridge: native.bridge,
      onError: (message) => errors.push(message),
    })!;
    engine.loadQueue = async () => ({
      chunks: [{ text: '一。', node: null, start: 0, blockIndex: 0 }],
      startIndex: 0,
    });

    await engine.play(0);
    native.fire('error', '语音服务不可用');
    expect(errors).toEqual(['语音服务不可用']);
    expect(engine.active).toBe(false);
  });
});

describe('the HTTP engine behind the shared interface', () => {
  /**
   * The adapter's job is to keep the engine's own quirks out of the screen layer:
   * it maps an engine *fragment* index back to the sentence the reader can see,
   * and it reports that sentence for every step the engine takes.
   *
   * `fetch` and `Audio` are stubbed here rather than in `tts-http.test.ts`
   * because what is under test is the adapter, not the transport.
   */
  class StubAudio {
    src = '';
    volume = 1;
    preload = '';
    playbackRate = 1;
    private handlers = new Map<string, () => void>();
    addEventListener(type: string, handler: () => void): void {
      this.handlers.set(type, handler);
    }
    play(): Promise<void> {
      return Promise.resolve();
    }
    pause(): void {}
    removeAttribute(): void {}
    load(): void {}
    fire(type: string): void {
      this.handlers.get(type)?.();
    }
  }

  it('reports the sentence a fragment belongs to, not the fragment', async () => {
    const audios: StubAudio[] = [];
    const engine = createSpeechEngine({
      kind: 'http',
      baseUrl: 'http://nas.local:8080',
      accessToken: () => 'tok',
      nativeBridge: null,
    })!;
    // The screen layer hands over its queue through `loadQueue`, and the adapter
    // reads it back to resolve an index — the two are the same list by design.
    const queue = [
      { text: '前半', node: null, start: 0, blockIndex: 0 },
      { text: '后半', node: null, start: 2, blockIndex: 0 },
    ];
    engine.loadQueue = async () => ({ chunks: queue, startIndex: 0 });
    (engine as unknown as { chunkSource: () => typeof queue }).chunkSource = () => queue;

    const highlighted: string[] = [];
    engine.onChunk = (chunk) => highlighted.push(chunk.text);

    // The audio element is created inside the engine; the stub stands in for it.
    const originalAudio = globalThis.Audio;
    (globalThis as { Audio: unknown }).Audio = function Stub() {
      const audio = new StubAudio();
      audios.push(audio);
      return audio;
    };
    try {
      await engine.play(0);
      expect(highlighted).toEqual(['前半']);
      audios[0]!.fire('ended');
      expect(highlighted).toEqual(['前半', '后半']);
    } finally {
      (globalThis as { Audio: unknown }).Audio = originalAudio;
      engine.dispose();
    }
  });

  it('hides the pitch row rather than shipping a slider that does nothing', () => {
    const engine = createSpeechEngine({
      kind: 'http',
      baseUrl: 'http://nas.local:8080',
      accessToken: () => 'tok',
      nativeBridge: null,
    })!;
    // `setPitch` exists so the interface is uniform, but it is a no-op: synthesised
    // audio's only pitch control is its playback rate. The settings panel hides the
    // row for this engine, and this asserts the method does not pretend otherwise.
    expect(() => engine.setPitch(1.8)).not.toThrow();
    expect(engine.snapshot.pitch).toBe(1);
  });
});
