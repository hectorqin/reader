import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { PlayModeCycle, PlayModeSegments } from '../src/features/media/components/play-mode.tsx';
import { SleepTimerOptions } from '../src/features/media/components/sleep-timer.tsx';
import { PlaybackControls } from '../src/features/media/components/playback-controls.tsx';
import type { MediaApi, Detail } from '../src/features/media/api/media-api.ts';
import type { MediaPlayer } from '../src/features/media/services/player.ts';
const root = document.createElement('div'); document.body.append(root);
afterEach(() => act(() => render(null, root)));
const as = (value: object) => value as unknown as MediaPlayer;
const work = (id: string, kind: string): Detail => ({ id, kind, title: id, libraryId: 'lib', parentId: null, metadata: {}, overrides: {}, editions: [], children: [] });
const open = async (kind: string, extra: object = {}) => {
  const setPlayMode = vi.fn(), setSleepAfterPart = vi.fn();
  const api = { detail: vi.fn().mockResolvedValue(work('item', kind)), request: vi.fn().mockResolvedValue({ favorite: false }) } as unknown as MediaApi;
  const player = as({ active: true, currentItemId: 'item', title: '播放中', currentPlaylist: [], playMode: 'sequential', canChoosePlayMode: true, canSleepAfterPart: true, setPlayMode, setSleepAfterPart, ...extra });
  await act(async () => render(<PlaybackControls api={api} player={player} />, root));
  await vi.waitFor(() => expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe(kind === 'track' ? 'music' : 'audiobook'));
  return { setPlayMode, setSleepAfterPart };
};

it('stops after the current entry from the sleep timer, shows it as chosen and reports what will happen', () => {
  const setSleepAfterPart = vi.fn(), onSelected = vi.fn();
  const player = { sleep: vi.fn(), setSleepAfterPart, sleepAt: 0, sleepAfterPart: false, canSleepAfterPart: true, sleepRemainingMinutes: 0 };
  act(() => render(<SleepTimerOptions player={as(player)} partLabel="本章" onSelected={onSelected} />, root));
  const part = root.querySelector<HTMLButtonElement>('.media-sleep-part')!;
  expect(part.textContent).toBe('播完本章'); expect(part.getAttribute('aria-pressed')).toBe('false');
  expect(root.querySelector('.media-sleep-off')!.getAttribute('aria-pressed')).toBe('true');
  act(() => part.click()); expect(setSleepAfterPart).toHaveBeenCalledWith(true); expect(onSelected).toHaveBeenCalledTimes(1);
  act(() => render(<SleepTimerOptions player={as({ ...player, sleepAfterPart: true })} partLabel="本章" />, root));
  expect(root.querySelector('.media-sleep-part')!.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelector('.media-sleep-off')!.getAttribute('aria-pressed')).toBe('false');
  expect(root.querySelector('[role=status]')!.textContent).toBe('播完本章后自动暂停，并保留当前进度。');
});

it('offers no stop-after-entry without a label, and disables it where the player cannot honour it', () => {
  act(() => render(<SleepTimerOptions player={as({ sleep: vi.fn(), sleepAt: 0, canSleepAfterPart: true })} />, root));
  expect(root.querySelector('.media-sleep-part')).toBeNull(); expect(root.querySelector('.media-sleep-note')).toBeNull();
  act(() => render(<SleepTimerOptions player={as({ sleep: vi.fn(), sleepAt: 0, canSleepAfterPart: false })} partLabel="本曲" />, root));
  expect(root.querySelector<HTMLButtonElement>('.media-sleep-part')!.disabled).toBe(true);
  expect(root.querySelector('.media-sleep-note')!.textContent).toBe('当前播放器不支持播完后暂停。');
});

it('lets the queue panel pick how playback advances', () => {
  const setPlayMode = vi.fn();
  act(() => render(<PlayModeSegments player={as({ playMode: 'shuffle', setPlayMode })} />, root));
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.media-play-mode button')];
  expect(buttons.map(button => button.textContent)).toEqual(['顺序播放', '随机', '单曲循环']);
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  act(() => buttons[2]!.click()); expect(setPlayMode).toHaveBeenCalledWith('repeat-one');
});

it('cycles the mode from the transport row and is disabled where the player cannot honour one', () => {
  const setPlayMode = vi.fn(), icons: string[] = [];
  const player = (mode: string, can = true) => as({ playMode: mode, canChoosePlayMode: can, setPlayMode });
  for (const [mode, next] of [['sequential', 'shuffle'], ['shuffle', 'repeat-one'], ['repeat-one', 'sequential']] as const) {
    act(() => render(<PlayModeCycle player={player(mode)} />, root));
    const button = root.querySelector<HTMLButtonElement>('.media-play-mode-cycle')!;
    expect(button.getAttribute('data-mode')).toBe(mode); icons.push(button.querySelector('svg')!.getAttribute('class')!);
    act(() => button.click()); expect(setPlayMode).toHaveBeenLastCalledWith(next);
  }
  expect(new Set(icons).size).toBe(3); // each mode has its own icon
  act(() => render(<PlayModeCycle player={player('sequential', false)} />, root));
  const unsupported = root.querySelector<HTMLButtonElement>('.media-play-mode-cycle')!;
  expect(unsupported.disabled).toBe(true); expect(unsupported.title).toBe('当前播放器不支持切换播放模式');
});

it('puts the mode cycle and queue entry on the music transport row, and the mode choice in the queue panel', async () => {
  const { setPlayMode } = await open('track');
  const transport = root.querySelector('.media-transport')!;
  expect(transport.querySelector('.media-play-mode-cycle')).not.toBeNull();
  expect(transport.querySelector('[aria-label="播放队列"]')).not.toBeNull();
  expect(root.querySelector('.media-playback-options [aria-label="播放队列"]')).toBeNull();
  act(() => transport.querySelector<HTMLButtonElement>('[aria-label="播放队列"]')!.click());
  expect(root.querySelector('.media-current-playlist')).not.toBeNull();
  act(() => [...root.querySelectorAll<HTMLButtonElement>('.media-play-mode button')].find(button => button.textContent === '随机')!.click());
  expect(setPlayMode).toHaveBeenCalledWith('shuffle');
});

it('hides the mode choice in the queue panel when the player cannot honour one', async () => {
  await open('track', { canChoosePlayMode: false });
  act(() => root.querySelector<HTMLButtonElement>('.media-transport [aria-label="播放队列"]')!.click());
  expect(root.querySelector('.media-current-playlist')).not.toBeNull();
  expect(root.querySelector('.media-play-mode')).toBeNull();
});

it('keeps the chapter entry in the options row and offers no play mode for audiobooks', async () => {
  await open('audiobook');
  expect(root.querySelector('.media-play-mode-cycle')).toBeNull();
  expect(root.querySelector('.media-transport [aria-label="播放队列"]')).toBeNull();
  expect(root.querySelector('.media-playback-options [aria-label="全部章节"]')).not.toBeNull();
});

it('names the pending stop on the timer button with the word for the content', async () => {
  await open('track', { sleepAfterPart: true });
  expect(root.querySelector('[aria-label="睡眠定时"]')!.textContent).toBe('播完本曲');
  act(() => render(null, root));
  await open('audiobook', { sleepAfterPart: true });
  expect(root.querySelector('[aria-label="睡眠定时"]')!.textContent).toBe('播完本章');
});
