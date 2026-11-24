import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { PlaybackControls } from '../src/features/media/components/playback-controls.tsx';
import { PlaybackFavorite } from '../src/features/media/components/audio-tools.tsx';
import type { MediaApi, Detail } from '../src/features/media/api/media-api.ts';
import type { MediaPlayer } from '../src/features/media/services/player.ts';
import { ApiError } from '../src/api/errors.ts';
const root = document.createElement('div');
document.body.append(root);
afterEach(() => act(() => render(null, root)));
const work = (id: string, kind: string): Detail => ({
  id,
  kind,
  title: id,
  libraryId: 'lib',
  parentId: null,
  metadata: {},
  overrides: {},
  editions: [],
  children: [],
});
it('renders chapter loading and permission failure without creating a playback session', async () => {
  let reject!: (reason: Error) => void;
  const detail = vi
    .fn()
    .mockImplementationOnce(() => new Promise((_resolve, no) => (reject = no)))
    .mockResolvedValue(work('book', 'audiobook'));
  const api = { detail } as unknown as MediaApi,
    player = { active: true, currentItemId: 'book', currentPlaylist: [], play: vi.fn() } as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} panel="chapters" />, root));
  expect(root.querySelector('[aria-label="正在读取章节…"]')).not.toBeNull();
  await act(async () => reject(new ApiError('forbidden', 'permission denied', 'MEDIA_FORBIDDEN', 403)));
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')?.textContent).toContain('没有访问权限'));
  await act(async () => root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await vi.waitFor(() => expect(root.querySelector('.media-audiobook-chapters')).not.toBeNull());
  expect(player.play).not.toHaveBeenCalled();
});
it('uses the playing item for tools and discards a stale metadata response after the item changes', async () => {
  let release!: (value: Detail) => void;
  const detail = vi
    .fn()
    .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    .mockResolvedValue(work('song', 'track'));
  const request = vi.fn().mockResolvedValue({ favorite: false });
  const api = { detail, request } as unknown as MediaApi,
    play = vi.fn(),
    player = {
      active: true,
      currentItemId: 'book',
      title: '播放中',
      currentPlaylist: [],
      play,
    } as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} onBack={() => {}} />, root));
  expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('unknown');
  Object.defineProperty(player, 'currentItemId', { value: 'song', configurable: true });
  await act(async () => render(<PlaybackControls api={api} player={player} onBack={() => {}} />, root));
  await vi.waitFor(() => expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('music'));
  expect(root.querySelector('[aria-label="歌词"]')).not.toBeNull();
  expect(root.querySelector('[aria-label="全部章节"]')).toBeNull();
  await act(async () => release(work('book', 'audiobook')));
  expect(root.querySelector('.media-audio-heading')?.textContent).toBe('音乐播放');
  expect(root.querySelector('[aria-label="快进 15 秒"]')).toBeNull();
  expect(play).not.toHaveBeenCalled();
  expect((detail.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
});
it('reads uncertain favorite state before allowing another write', async () => {
  let favorite = false,
    writes = 0;
  const request = vi.fn(async (_path: string, method: string, _body?: unknown, _signal?: AbortSignal) => {
    if (method === 'PUT') {
      favorite = true;
      if (++writes === 1) throw Error('response lost');
    }
    return { favorite };
  });
  const api = { request } as unknown as MediaApi;
  await act(async () => render(<PlaybackFavorite api={api} itemId="song" />, root));
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[aria-label="收藏"]')!.disabled).toBe(false));
  await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="收藏"]')!.click());
  await vi.waitFor(() => expect(root.textContent).toContain('收藏保存失败'));
  expect(root.querySelector<HTMLButtonElement>('[aria-label="收藏"]')!.disabled).toBe(true);
  expect(root.textContent).toContain('收藏保存失败');
  await act(async () =>
    [...root.querySelectorAll('button')].find((button) => button.textContent === '重读收藏状态')!.click(),
  );
  await vi.waitFor(() => expect(root.querySelector('[aria-label="取消收藏"]')).not.toBeNull());
  expect(writes).toBe(1);
  const signal = request.mock.calls.at(-1)?.[3] as unknown as AbortSignal;
  act(() => render(null, root));
  expect(signal.aborted).toBe(true);
});
it('offers one more-options entry point and keeps the book icon for chapters only', async () => {
  const detail = vi.fn().mockResolvedValue(work('song', 'track'));
  const api = { detail, request: vi.fn().mockResolvedValue({ favorite: false }) } as unknown as MediaApi,
    player = { active: true, currentItemId: 'song', title: '歌', currentPlaylist: [] } as unknown as MediaPlayer;
  for (const withBack of [true, false]) {
    await act(async () =>
      render(<PlaybackControls api={api} player={player} {...(withBack ? { onBack: () => {} } : {})} />, root),
    );
    await vi.waitFor(() => expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('music'));
    // The title-row ellipsis used to open the same sheet as the header/options ellipsis.
    expect(root.querySelectorAll('[aria-label="更多播放选项"]').length).toBe(1);
    expect(root.querySelector('[aria-label="当前内容操作"]')).toBeNull();
    expect(root.querySelector('[aria-label="歌词"] svg')?.classList.contains('lucide-mic-vocal')).toBe(true);
    await act(async () => render(null, root));
  }
});

it('groups More tools in a compact sheet and labels speed without changing its action', async () => {
  const speed = vi.fn(),
    skip = vi.fn();
  const api = {
    detail: vi.fn().mockResolvedValue(work('song', 'track')),
    request: vi.fn().mockResolvedValue({ favorite: false }),
  } as unknown as MediaApi;
  const player = {
    active: true,
    currentItemId: 'song',
    currentPlaylist: [],
    playbackRate: 1,
    speed,
    skip,
  } as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} onBack={() => {}} />, root));
  await vi.waitFor(() => expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('music'));
  await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="更多播放选项"]')!.click());
  const sheet = root.querySelector('.media-audio-sheet')!;
  expect(sheet.getAttribute('data-size')).toBe('compact');
  expect([...sheet.querySelectorAll('.media-audio-section > h3')].map((h) => h.textContent)).toEqual([
    '音量与倍速',
    '播放',
    '队列',
    '其他',
  ]);
  expect(sheet.querySelector('.media-speed-label')?.textContent).toBe('倍速');
  expect(sheet.querySelector('.media-audio-volume-only')).toBeNull();
  expect(sheet.querySelector('.media-audio-queue [aria-label="保存播放列表"]')).not.toBeNull();
  const select = sheet.querySelector<HTMLSelectElement>('select[aria-label="倍速"]')!;
  await act(async () => {
    select.value = '1.5';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(speed).toHaveBeenCalledWith(1.5);
  await act(async () => sheet.querySelector<HTMLButtonElement>('[aria-label="快退 15 秒"]')!.click());
  expect(skip).toHaveBeenCalledWith(-15);
  expect(sheet.querySelector('[aria-label="保存播放列表"] button')?.hasAttribute('disabled')).toBe(true);
});

it('keeps the audiobook chapter eyebrow with its title and speed in a dedicated tool cell', async () => {
  const book = {
    ...work('book', 'audiobook'),
    title: '夜航笔记',
    editions: [{ id: 'edition', parts: [{ id: 'part', title: '第一章' }] }],
  } as unknown as Detail;
  const api = { detail: vi.fn().mockResolvedValue(book) } as unknown as MediaApi;
  const toggle = vi.fn();
  const player = {
    active: true,
    currentItemId: 'book',
    currentPartId: 'part',
    currentPlaylist: [],
    playbackRate: 1,
    toggle,
  } as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} />, root));
  await vi.waitFor(() => expect(root.querySelector('.media-playing-chapter')).not.toBeNull());
  const title = root.querySelector('.media-playing-title')!;
  expect(title.previousElementSibling?.className).toBe('media-playing-chapter');
  expect(title.previousElementSibling?.textContent).toContain('第 1 / 1 章');
  expect(root.querySelector('.media-playing-copy')?.contains(title.previousElementSibling)).toBe(true);
  expect(root.querySelector('.media-playback-options > .media-speed-control [role="combobox"]')).not.toBeNull();
  expect(root.querySelector('.media-playback-options > .media-speed-control [role="combobox"]')?.textContent).toBe(
    '1.0×',
  );
  expect(root.querySelector('.media-playback-options > .media-speed-control > .icon')).not.toBeNull();
  await act(async () => root.querySelector<HTMLButtonElement>('.media-toggle-play')!.click());
  expect(toggle).toHaveBeenCalledTimes(1);
});

it('groups the audiobook queue actions and hides only the redundant volume caption', async () => {
  const api = { detail: vi.fn().mockResolvedValue(work('book', 'audiobook')) } as unknown as MediaApi;
  const player = {
    active: true,
    currentItemId: 'book',
    currentPlaylist: [],
    playbackRate: 1,
  } as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} />, root));
  await vi.waitFor(() => expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('audiobook'));
  await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="更多播放选项"]')!.click());
  expect(root.querySelector('.media-audio-volume-only > h3')?.textContent).toBe('音量');
  expect(root.querySelector('.media-audio-queue > [aria-label="播放队列"]')?.textContent).toBe('当前播放队列');
  expect(root.querySelector('.media-audio-queue [aria-label="保存播放列表"] > button')?.textContent).toBe(
    '保存为待播队列',
  );
});

it('updates play and pause icons from player changes without a metadata reload', async () => {
  const api = {
    detail: vi.fn().mockResolvedValue(work('song', 'track')),
    request: vi.fn().mockResolvedValue({ favorite: false }),
  } as unknown as MediaApi;
  const target = Object.assign(new EventTarget(), {
    active: true,
    currentItemId: 'song',
    currentPlaylist: [],
    paused: false,
    toggle: vi.fn(),
  });
  const player = target as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} />, root));
  await vi.waitFor(() => expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('music'));
  expect(root.querySelector('.media-toggle-play')?.getAttribute('aria-label')).toBe('暂停');
  await act(async () => {
    target.paused = true;
    target.dispatchEvent(new Event('change'));
  });
  expect(root.querySelector('.media-toggle-play')?.getAttribute('aria-label')).toBe('继续');
  expect(root.querySelector('.media-toggle-play svg')?.classList.contains('lucide-play')).toBe(true);
  await act(async () => {
    target.paused = false;
    target.dispatchEvent(new Event('change'));
  });
  expect(root.querySelector('.media-toggle-play svg')?.classList.contains('lucide-pause')).toBe(true);
  await act(async () => root.querySelector<HTMLButtonElement>('.media-toggle-play')!.click());
  expect(target.toggle).toHaveBeenCalledTimes(1);
  expect(api.detail).toHaveBeenCalledTimes(1);
});

it('keeps the active favorite in an equal tool cell alongside timer and lyrics', async () => {
  const api = {
    detail: vi.fn().mockResolvedValue(work('song', 'track')),
    request: vi.fn().mockResolvedValue({ favorite: true }),
  } as unknown as MediaApi;
  const player = { active: true, currentItemId: 'song', currentPlaylist: [] } as unknown as MediaPlayer;
  await act(async () => render(<PlaybackControls api={api} player={player} onBack={() => {}} />, root));
  await vi.waitFor(() =>
    expect(root.querySelector('.media-playback-favorite button')?.getAttribute('aria-pressed')).toBe('true'),
  );
  const options = root.querySelector('.media-playback-options')!;
  expect(options.children).toHaveLength(3);
  expect(options.querySelector('.media-playback-favorite > button')?.textContent).toBe('已收藏');
  expect(options.querySelector('.media-playback-favorite > button svg')?.getAttribute('fill')).toBe('currentColor');
});
