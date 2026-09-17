// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { HttpTtsEngine } from '../src/render/tts-http.ts';

/**
 * The HTTP engine's queue and its failure modes.
 *
 * Two things are worth testing here and both are the reason the engine exists at
 * all: that the queue advances on the `<audio>` element's own `ended` event rather
 * than on a timer (a timer drifts and overlaps), and that a *misconfigured* server
 * is reported rather than played as silence. The second is the failure a reader
 * cannot diagnose — an `<audio>` element that loads a web page plays nothing and
 * fires no error.
 */

/**
 * A fake `<audio>` that fires nothing until the test says so.
 *
 * `play()` resolving is not the same as playback starting, and the engine must
 * not assume otherwise: the queue has to advance on `ended`.
 */
class FakeAudio {
  src = '';
  volume = 1;
  preload = '';
  playbackRate = 1;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  private handlers = new Map<string, () => void>();

  addEventListener(type: string, handler: () => void): void {
    this.handlers.set(type, handler);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  removeAttribute(_name: string): void {
    this.src = '';
  }

  load(): void {
    // Releasing the source is what the engine does when it is done with an
    // element; nothing to simulate beyond accepting the call.
  }

  /** Fires a registered event, as the media element would. */
  fire(type: string): void {
    this.handlers.get(type)?.();
  }
}

function makeEngine(options: {
  chunks: string[][];
  baseUrl?: string;
  token?: string | null;
  playFails?: boolean;
}): { engine: HttpTtsEngine; audios: FakeAudio[]; spoken: string[]; errors: string[] } {
  const audios: FakeAudio[] = [];
  const spoken: string[] = [];
  const errors: string[] = [];
  let round = 0;

  const engine = new HttpTtsEngine({
    baseUrl: options.baseUrl ?? 'http://nas.local:8080',
    accessToken: () => options.token ?? null,
    createAudio: () => {
      const audio = new FakeAudio();
      audios.push(audio);
      // The engine builds a *fresh* element per sentence, so the last one created
      // is the one in flight; recording them lets a test fire its events.
      if (options.playFails) {
        audio.play = () => Promise.reject(new Error('blocked'));
      }
      return audio as unknown as HTMLAudioElement;
    },
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => undefined,
    onError: (message) => errors.push(message),
  });

  engine.setQueueLoader(async () => {
    const texts = options.chunks[Math.min(round, options.chunks.length - 1)] ?? [];
    round += 1;
    return { chunks: texts.map((text) => ({ text })), startIndex: 0 };
  });

  engine.onState((snapshot) => {
    if (snapshot.chunk) spoken.push(snapshot.chunk);
  });

  return { engine, audios, spoken, errors };
}

describe('HttpTtsEngine', () => {
  it('asks the server one sentence at a time, with the token in the query', async () => {
    const { engine, audios } = makeEngine({ chunks: [['第一句。', '第二句。']], token: 'tok-123' });

    await engine.play(0);
    expect(audios).toHaveLength(1);
    // The token rides in the query because an `<audio src>` cannot carry a header
    // — see the module header, and the server's `queryTokenAllowed`.
    expect(audios[0]!.src).toContain('/api/v1/tts?');
    expect(audios[0]!.src).toContain('access_token=tok-123');
    expect(audios[0]!.src).toContain(encodeURIComponent('第一句。'));
  });

  it('advances only when the audio element reports it finished', async () => {
    const { engine, audios } = makeEngine({ chunks: [['一。', '二。', '三。']] });

    await engine.play(0);
    expect(audios).toHaveLength(1);
    // Nothing has ended yet, so no second element may exist. A timer-driven queue
    // is what this asserts against.
    audios[0]!.fire('ended');
    expect(audios).toHaveLength(2);
    audios[1]!.fire('ended');
    expect(audios).toHaveLength(3);
    expect(audios[2]!.src).toContain(encodeURIComponent('三。'));
  });

  it('does not advance when a stale element reports it finished', async () => {
    const { engine, audios } = makeEngine({ chunks: [['一。', '二。', '三。']] });
    await engine.play(0);

    // The reader pressed "next", which starts a new generation. The old element's
    // `ended` arriving afterwards must be ignored, or the queue would skip a
    // sentence every time the button is used.
    engine.next();
    expect(audios).toHaveLength(2);
    audios[0]!.fire('ended');
    expect(audios).toHaveLength(2);
  });

  it('stops speaking when the reader stops, and releases the element', async () => {
    const { engine, audios } = makeEngine({ chunks: [['一。', '二。']] });
    await engine.play(0);

    engine.stop();
    expect(engine.active).toBe(false);
    expect(audios[0]!.pauseCalls).toBeGreaterThan(0);
    // Releasing matters: an element left with a `src` keeps a network buffer alive,
    // and one per sentence would leak a chapter's worth of them.
    expect(audios[0]!.src).toBe('');
  });

  it('reports a blocked autoplay instead of a bar that says "playing"', async () => {
    const { engine, errors } = makeEngine({ chunks: [['一。']], playFails: true });
    await engine.play(0);
    // The rejection is asynchronous; a microtask turn is enough for the catch.
    await Promise.resolve();
    await Promise.resolve();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('播放');
  });

  it('applies a rate change to the audio already in flight', async () => {
    const { engine, audios } = makeEngine({ chunks: [['一。', '二。']] });
    await engine.play(0);
    engine.setRate(1.5);
    // Unlike the system engine, this one does not have to restart the sentence:
    // `playbackRate` is a property of the element. That difference is why the two
    // engines are separate implementations rather than one with a flag.
    expect(audios[0]!.playbackRate).toBe(1.5);
  });

  it('asks for the next chapter when the queue runs out, when the reader allowed it', async () => {
    const { engine, audios } = makeEngine({ chunks: [['一。'], ['二。']] });
    await engine.play(0);
    audios[0]!.fire('ended');
    // The queue ran out, so the loader is consulted again — which is the same
    // handshake the system engine uses, and the place a chapter transition happens.
    await Promise.resolve();
    await Promise.resolve();
    expect(audios).toHaveLength(2);
    expect(audios[1]!.src).toContain(encodeURIComponent('二。'));
  });

  it('will not build a URL without a server, and says so rather than failing silently', async () => {
    const { engine, errors } = makeEngine({ chunks: [['一。']], baseUrl: '' });
    await engine.play(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(engine.active).toBe(false);
  });

  it('probes the server and answers null when it has no engine', async () => {
    const engine = new HttpTtsEngine({ baseUrl: 'http://nas.local:8080', accessToken: () => null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ http: false, formats: [], maxLength: 800, voices: [] }), { status: 200 }),
    );
    expect(await engine.probe()).toBeNull();

    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ http: true, formats: ['audio/mpeg'], maxLength: 800, voices: [{ id: 'v1', name: '晓晓', lang: 'zh-CN' }] }),
        { status: 200 },
      ),
    );
    const capabilities = await engine.probe();
    expect(capabilities?.http).toBe(true);
    expect(capabilities?.voices).toHaveLength(1);
    fetchSpy.mockRestore();
  });
});
