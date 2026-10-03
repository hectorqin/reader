import type { MediaPlayer } from '../../../media/player.ts';
import { usePlaybackStore } from '../stores/playback.store.ts';
import type { MediaApi } from '../api/media-api.ts';

export class PlaybackService {
  private stopListening: (() => void) | null = null;
  constructor(private readonly player: MediaPlayer, private readonly api: MediaApi) {}
  snapshot() { return usePlaybackStore.getState(); }
  start(): void {
    if (this.stopListening) return;
    let lastItem = '';
    const update = () => {
      const itemId = this.player.currentItemId;
      usePlaybackStore.getState().set({
      active: this.player.active,
      title: this.player.title,
      paused: this.player.paused,
      video: this.player.isVideo,
      error: this.player.error,
      loadingStatus: this.player.loadingStatus,
      itemId, partId: this.player.currentPartId,
      ...(this.player.isVideo ? { channel: 'video' as const } : {}),
      });
      if (itemId && itemId !== lastItem && !this.player.isVideo) {
        lastItem = itemId;
        void this.api.detail(itemId).then(item => {
          if (this.player.currentItemId === itemId) usePlaybackStore.getState().set({ channel: item.kind === 'audiobook' ? 'audiobook' : 'music' });
        }).catch(() => undefined);
      }
    };
    this.player.addEventListener('change', update);
    update();
    this.stopListening = () => this.player.removeEventListener('change', update);
  }
  stop(): void { this.stopListening?.(); this.stopListening = null; }
}
