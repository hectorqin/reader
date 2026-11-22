// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import Artplayer from 'artplayer';
import { enhanceVideo } from '../src/features/media/components/web-video.ts';

afterEach(() => {
  for (const player of [...Artplayer.instances]) player.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setup() {
  const parent = document.createElement('div');
  parent.className = 'media-player';
  const video = document.createElement('video');
  video.className = 'session-video';
  video.src = '/signed-stream';
  video.currentTime = 42;
  parent.append(video);
  document.body.append(parent);
  const play = vi.spyOn(video, 'play').mockResolvedValue();
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  const load = vi.spyOn(video, 'load').mockImplementation(() => {});
  const toggle = vi.fn();
  return { parent, video, play, pause, load, toggle };
}

describe('web video enhancement', () => {
  it('adopts the session video and keeps Reader in charge of every play/pause entry point', () => {
    const { parent, video, play, pause, toggle } = setup();
    const enhanced = enhanceVideo(video, toggle);
    const player = Artplayer.instances[0]!;
    expect(player.video).toBe(video);
    expect(player.template.$player.style.getPropertyValue('--art-theme')).toBe('var(--color-brand)');
    expect(video.controls).toBe(false);
    expect(video.src).toContain('/signed-stream');
    expect(video.currentTime).toBe(42);
    video.click();
    parent.querySelector<HTMLElement>('.art-control-playAndPause .art-icon')!.click();
    parent.querySelector<HTMLElement>('.art-state')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(4);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    parent.dataset.locked = 'true';
    video.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(4);
    expect(parent.querySelector('.art-control-fullscreen')).toBeNull();
    expect(parent.querySelector('.art-control-setting')).toBeNull();
    enhanced!.destroy();
  });

  it('destroys only the chrome, preserving the connected video, source, position and Reader listeners', () => {
    const { parent, video, play, pause, load, toggle } = setup();
    const changed = vi.fn();
    video.addEventListener('timeupdate', changed);
    const enhanced = enhanceVideo(video, toggle)!;
    enhanced.destroy();
    enhanced.destroy();
    expect(parent.firstElementChild).toBe(video);
    expect(parent.children).toHaveLength(1);
    expect(video.isConnected).toBe(true);
    expect(video.className).toBe('session-video');
    expect(video.controls).toBe(true);
    expect(video.src).toContain('/signed-stream');
    expect(video.currentTime).toBe(42);
    video.dispatchEvent(new Event('timeupdate'));
    video.click();
    expect(changed).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('does nothing for a detached video', () => {
    expect(enhanceVideo(document.createElement('video'), vi.fn())).toBeNull();
    expect(Artplayer.instances).toHaveLength(0);
  });

  it('restores native controls and the session node if initialization fails', () => {
    const { parent, video, toggle } = setup();
    vi.spyOn(Node.prototype, 'replaceChild').mockImplementationOnce(() => {
      throw new Error('player failed');
    });
    expect(() => enhanceVideo(video, toggle)).toThrow('player failed');
    expect(parent.firstElementChild).toBe(video);
    expect(parent.children).toHaveLength(1);
    expect(video.controls).toBe(true);
    expect(video.className).toBe('session-video');
    expect(video.src).toContain('/signed-stream');
  });
});
