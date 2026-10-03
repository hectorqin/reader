import { create } from 'zustand';
import type { SyncStatus } from '../../core/sync.ts';

export const useSyncStore = create<{ status: SyncStatus; update(status: SyncStatus): void }>(set => ({
  status: { state: 'idle', lastSyncAt: null, pending: false, message: '' },
  update: status => set({ status }),
}));
