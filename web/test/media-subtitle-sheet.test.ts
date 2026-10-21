// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { SubtitleControls } from '../src/features/media/components/subtitles.ts';
import { subtitleFormatOf, subtitleTextToVtt, decodeSubtitleBytes } from '../src/features/media/services/subtitle-format.ts';
import type { MediaApi } from '../src/features/media/api/media-api.ts';

/** The 字幕与音轨 sheet's view of SubtitleControls: rows, local files, delay. */
function video() {
  const element = document.createElement('video');
  const textTracks = Object.assign(new EventTarget(), { length: 0 });
  Object.defineProperty(element, 'textTracks', { value: textTracks });
  return element;
}
const api = (items: unknown[] = []) => ({ request: vi.fn(async () => ({ items })) }) as unknown as MediaApi;
const file = (name: string, text: string) => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer });
afterEach(() => { vi.unstubAllGlobals(); });

it('lists 关闭, server sidecars as 外挂 with their format, and extracted streams as 内嵌', async () => {
  const controls = new SubtitleControls(api([
    { id: 'zh', label: '中文（简体）', language: 'zh', format: 'srt', source: 'external' },
    { id: 'stream:2', label: 'English', language: 'en', format: 'vtt', source: 'embedded' },
  ]), video());
  const changed = vi.fn();
  controls.addEventListener('change', changed);
  await controls.load('asset');
  expect(controls.options).toEqual([
    { value: '', label: '关闭', note: '' },
    { value: 'zh', label: '中文（简体）', note: '外挂 · srt' },
    { value: 'stream:2', label: 'English', note: '内嵌' },
  ]);
  expect(controls.value).toBe('');
  expect(changed).toHaveBeenCalled();
  expect(controls.canDelay).toBe(false);
});

it('adds a local SRT as a session-only track, selects it, and delays its cues from the file timing', async () => {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:local', revokeObjectURL: () => undefined });
  const element = video();
  const controls = new SubtitleControls(api(), element);
  await controls.load('asset');
  await controls.addLocal(file('电影.zh.srt', '1\n00:00:01,000 --> 00:00:02,000\n你好\n'));
  expect(controls.options.at(-1)).toEqual({ value: 'local:1', label: '电影.zh', note: '本机 · srt' });
  expect(controls.value).toBe('local:1');
  expect(controls.canDelay).toBe(true);
  // Cues are shifted against their original timing, so repeated changes never drift.
  const cue = { startTime: 1, endTime: 2 } as TextTrackCue;
  const track = element.querySelector('track')!;
  Object.defineProperty(track, 'track', { value: { mode: 'showing', cues: [cue] } });
  controls.setDelay(0.5); controls.setDelay(1);
  expect([cue.startTime, cue.endTime]).toEqual([2, 3]);
  controls.setDelay(-1.5);
  expect([cue.startTime, cue.endTime]).toEqual([0, 0.5]);
  expect(controls.delay).toBe(-1.5);
  // A new video starts from the file timing again, with no local files left over.
  controls.clear();
  expect(controls.delay).toBe(0);
  expect(controls.options).toEqual([{ value: '', label: '关闭', note: '' }]);
});

it('rejects a file that is not a subtitle, without changing the selection', async () => {
  const controls = new SubtitleControls(api(), video());
  await controls.load('asset');
  await expect(controls.addLocal(file('notes.txt', 'hello'))).rejects.toThrow('SRT、VTT 或 ASS');
  await expect(controls.addLocal(file('empty.srt', 'no cues here'))).rejects.toThrow();
  expect(controls.value).toBe('');
});

it('converts SRT and ASS to text-only WebVTT, and reads GB18030 files', () => {
  expect(subtitleFormatOf('a.Chinese.ASS')).toBe('ass');
  expect(subtitleFormatOf('a.txt')).toBeNull();
  expect(subtitleTextToVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>你好</i> & 世界\r\n', 'srt'))
    .toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n你好 &amp; 世界\n');
  const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    + 'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\b1}第一,行\\N下一行\n'
    + 'Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\p1}m 0 0 l 1 1\n';
  expect(subtitleTextToVtt(ass, 'ass')).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\n第一,行\n下一行\n');
  expect(decodeSubtitleBytes(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toBe('你好');
});
