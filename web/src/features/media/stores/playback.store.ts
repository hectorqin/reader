import { create } from 'zustand';

export interface PlaybackState {
  active: boolean;
  title: string;
  paused: boolean;
  video: boolean;
  error: string;
  loadingStatus: string;
  itemId: string;
  partId: string;
  channel: 'video' | 'music' | 'audiobook';
  set(snapshot: Partial<PlaybackState>): void;
}

export const usePlaybackStore = create<PlaybackState>(set => ({
  active: false,
  title: '',
  paused: true,
  video: false,
  error: '',
  loadingStatus: '',
  itemId: '', partId: '', channel: 'video',
  set: snapshot => set(snapshot),
}));

/**
 * The address of the expanded player for what is playing: its channel, and the
 * item/part that let a refresh restore playback (docs/media-navigation.md).
 */
export function playerPath(state: Pick<PlaybackState, 'channel' | 'itemId' | 'partId'>, panel = ''): string {
  const query = state.itemId && state.partId ? `?item=${encodeURIComponent(state.itemId)}&part=${encodeURIComponent(state.partId)}` : '';
  return `/media/${state.channel}/player${panel ? '/' + panel : ''}${query}`;
}
