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
