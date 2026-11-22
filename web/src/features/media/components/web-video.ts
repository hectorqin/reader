import Artplayer from 'artplayer';
import '../styles/artplayer.css';

Artplayer.CONTEXTMENU = false;
Artplayer.REMOVE_SRC_WHEN_DESTROY = false;
Artplayer.DBCLICK_FULLSCREEN = false;

export function enhanceVideo(video: HTMLVideoElement, onToggle: () => void) {
  const parent = video.parentElement;
  if (!parent) return null;
  const className = video.className;
  const volume = video.volume;
  const host = document.createElement('div');
  host.className = 'artplayer-host';
  parent.insertBefore(host, video);
  try {
    const player = new Artplayer({
      container: host,
      proxy: () => video,
      url: '',
      lang: 'zh-cn',
      theme: 'var(--color-brand)',
      autoplay: false,
      mutex: false,
      hotkey: true,
      setting: false,
      playbackRate: false,
      aspectRatio: false,
      pip: false,
      screenshot: false,
      fullscreen: false,
      fullscreenWeb: false,
      subtitle: { url: '' },
      contextmenu: [],
    });
    video.volume = volume;
    const locked = () => host.closest('.media-player')?.hasAttribute('data-locked');
    const toggle = () => {
      if (!locked()) onToggle();
    };
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('video, .art-control-playAndPause, .art-state')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      player.emit('document:click', event);
      player.controls.show = true;
      toggle();
    };
    host.addEventListener('click', click, true);
    player.proxy(
      document,
      'keydown',
      (event) => {
        if (!(event instanceof KeyboardEvent)) return;
        if (
          locked() &&
          player.isFocus &&
          ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    for (const callback of [...(player.hotkey.keys.Space ?? [])]) player.hotkey.remove('Space', callback);
    player.hotkey.add('Space', toggle);
    video.controls = false;
    let destroyed = false;
    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        host.removeEventListener('click', click, true);
        parent.insertBefore(video, host);
        player.destroy();
        video.className = className;
        video.controls = true;
        host.remove();
      },
    };
  } catch (error) {
    parent.insertBefore(video, host);
    video.className = className;
    video.controls = true;
    host.remove();
    throw error;
  }
}
