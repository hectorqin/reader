// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { TtsEngine } from '../src/render/tts.ts';
import type { SpokenChunk } from '../src/render/tts-text.ts';

/**
 * The read-aloud engine's sequencing.
 *
 * `speechSynthesis` is a fake here on purpose: the interesting behaviour is not
 * "does the browser speak" but "does the queue advance exactly once per finished
 * sentence, and does a stop really stop". Those are the two failures a reader
 * notices — a skipped sentence and a voice that keeps talking after pause.
 */

class FakeUtterance {
  text = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
}

class FakeSynthesis {
  spoken: FakeUtterance[] = [];
  cancel = vi.fn();
  pause = vi.fn();
  resume = vi.fn();
  paused = false;
  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
  }
  getVoices(): SpeechSynthesisVoice[] {
    return [
      { voiceURI: 'zh-1', name: '中文', lang: 'zh-CN', default: true },
      { voiceURI: 'en-1', name: 'English', lang: 'en-US', default: false },
    ] as unknown as SpeechSynthesisVoice[];
  }
  addEventListener(): void {}
}

function chunk(text: string, index = 0): SpokenChunk {
  return { text, node: null, start: 0, blockIndex: index };
}

function makeEngine(synthesis: FakeSynthesis, queue: SpokenChunk[][]) {
  let round = 0;
  const seen: string[] = [];
  const engine = new TtsEngine({
    synthesis: synthesis as unknown as SpeechSynthesis,
    utteranceFactory: () => new FakeUtterance() as unknown as SpeechSynthesisUtterance,
    // The watchdog is not under test and a real timer would leak between tests.
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => undefined,
    loadQueue: async () => {
      const chunks = queue[Math.min(round, queue.length - 1)] ?? [];
      round += 1;
      return { chunks, startIndex: 0 };
    },
    onChunk: (spoken) => seen.push(spoken.text),
    onState: () => undefined,
  });
  return { engine, seen };
}

describe('TtsEngine', () => {
  it('speaks one sentence at a time and advances only on the engine callback', async () => {
    const synthesis = new FakeSynthesis();
    const { engine, seen } = makeEngine(synthesis, [[chunk('第一句。'), chunk('第二句。')]]);

    await engine.play();
    expect(seen).toEqual(['第一句。']);
    expect(synthesis.spoken).toHaveLength(1);

    // Nothing advances until the engine says the sentence finished.
    expect(seen).toEqual(['第一句。']);
    synthesis.spoken[0]!.onend?.();
    expect(seen).toEqual(['第一句。', '第二句。']);
    engine.dispose();
  });

  it('reports the sentence index and total so the toolbar can show progress', async () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[chunk('一。'), chunk('二。'), chunk('三。')]]);
    await engine.play();
    expect(engine.snapshot.index).toBe(0);
    expect(engine.snapshot.total).toBe(3);
    synthesis.spoken[0]!.onend?.();
    expect(engine.snapshot.index).toBe(1);
    engine.dispose();
  });

  it('stops speaking and clears the queue on stop', async () => {
    const synthesis = new FakeSynthesis();
    const { engine, seen } = makeEngine(synthesis, [[chunk('一。'), chunk('二。')]]);
    await engine.play();
    synthesis.spoken[0]!.onend?.();
    engine.stop();
    // A late callback from a cancelled utterance must not restart playback.
    synthesis.spoken[1]?.onend?.();
    expect(seen).toEqual(['一。', '二。']);
    expect(engine.snapshot.state).toBe('idle');
    expect(engine.snapshot.total).toBe(0);
    engine.dispose();
  });

  it('does not treat a cancellation as an error', async () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[chunk('一。')]]);
    await engine.play();
    synthesis.spoken[0]!.onerror?.({ error: 'canceled' });
    expect(engine.snapshot.error).toBe('');
    expect(engine.snapshot.state).toBe('playing');
    engine.dispose();
  });

  it('surfaces a real engine error instead of playing on', async () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[chunk('一。')]]);
    await engine.play();
    synthesis.spoken[0]!.onerror?.({ error: 'synthesis-failed' });
    expect(engine.snapshot.state).toBe('idle');
    expect(engine.snapshot.error).toContain('synthesis-failed');
    engine.dispose();
  });

  it('continues into the next queue when the current one runs out', async () => {
    const synthesis = new FakeSynthesis();
    const { engine, seen } = makeEngine(synthesis, [[chunk('一。')], [chunk('二。')]]);
    await engine.play();
    synthesis.spoken[0]!.onend?.();
    // The second sentence comes from the *next* queue, which is what a chapter
    // transition looks like from the engine's point of view.
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['一。', '二。']);
    engine.dispose();
  });

  it('passes the reader’s rate, pitch and volume to each utterance', async () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[chunk('一。')]]);
    engine.setRate(1.5);
    engine.setPitch(0.8);
    engine.setVolume(0.5);
    await engine.play();
    const utterance = synthesis.spoken[synthesis.spoken.length - 1]!;
    expect(utterance.rate).toBe(1.5);
    expect(utterance.pitch).toBe(0.8);
    expect(utterance.volume).toBe(0.5);
    engine.dispose();
  });

  it('clamps out-of-range values rather than handing them to the engine', () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[]]);
    engine.setRate(99);
    engine.setVolume(-4);
    expect(engine.snapshot.rate).toBe(3);
    expect(engine.snapshot.volume).toBe(0);
    engine.dispose();
  });

  it('reports idle and an explanation when the chapter has nothing to say', async () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[]]);
    await engine.play();
    expect(engine.snapshot.state).toBe('idle');
    expect(engine.snapshot.error).toBe('这一章没有可朗读的文字');
    engine.dispose();
  });

  it('reports unsupported instead of throwing when there is no synthesis', async () => {
    const engine = new TtsEngine({
      synthesis: null,
      loadQueue: async () => ({ chunks: [chunk('一。')], startIndex: 0 }),
      onChunk: () => undefined,
      onState: () => undefined,
    });
    await engine.play();
    expect(engine.snapshot.state).toBe('unsupported');
    expect(engine.snapshot.error).toContain('不支持');
    engine.dispose();
  });

  it('exposes the device voice list, which is what a picker renders', () => {
    const synthesis = new FakeSynthesis();
    const { engine } = makeEngine(synthesis, [[]]);
    expect(engine.snapshot.voices.map((voice) => voice.id)).toEqual(['zh-1', 'en-1']);
    engine.dispose();
  });
});
