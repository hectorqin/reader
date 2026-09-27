// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { ReaderScreen } from '../src/ui/reader-screen.tsx';

it('publishes asynchronous voice changes without reopening the existing settings panel', () => {
  const context = {
    voices: [], lastSpeechQueue: [], chrome: { tts: {} }, speechQueueIndex: () => 0,
    patch: vi.fn(), setStatus: vi.fn(), view: null,
  };
  const voice = { id: 'zh', name: '中文', lang: 'zh-CN', default: true };
  Reflect.apply(ReaderScreen.prototype['renderSpeechState'], context, [{
    state: 'idle', voices: [voice], total: 0, index: -1, chunk: '', error: '',
  }]);
  expect(context.voices).toEqual([voice]);
  expect(context.patch).toHaveBeenCalled();
});
