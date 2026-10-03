import { create } from 'zustand';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../store/settings.ts';

interface SettingsState {
  settings: AppSettings;
  replace(settings: AppSettings): void;
  update(patch: Partial<AppSettings>): void;
}
export const useSettingsStore = create<SettingsState>(set => ({
  settings: { ...DEFAULT_APP_SETTINGS },
  replace: settings => set({ settings }),
  update: patch => set(state => ({ settings: { ...state.settings, ...patch } })),
}));
