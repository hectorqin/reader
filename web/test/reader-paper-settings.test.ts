import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/store/settings.ts';
import type { KeyValueStore } from '../src/core/platform.ts';

/** A KeyValueStore over a Map, for SettingsStore.load(). */
function memory(initial: Record<string, string>): KeyValueStore {
  const values = new Map(Object.entries(initial));
  return { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, remove: async (key: string) => { values.delete(key); } };
}
const load = (stored: object) => new SettingsStore(memory({ 'reader.settings.v1': JSON.stringify(stored) })).load();

describe('reading paper setting', () => {
  it('defaults to the theme, following the system dark mode', async () => {
    const settings = await new SettingsStore(memory({})).load();
    expect([settings.paper, settings.paperFollowsDark]).toEqual(['theme', true]);
  });

  it('brings the pre-V3 page theme back as the matching paper, once', async () => {
    expect((await load({ theme: 'sepia' })).paper).toBe('warm');
    expect((await load({ theme: 'green' })).paper).toBe('green');
    expect((await load({ theme: 'dark' })).paper).toBe('night');
    expect((await load({ theme: 'light' })).paper).toBe('theme');
    // A paper chosen since wins over the old value.
    expect((await load({ theme: 'dark', paper: 'white' })).paper).toBe('white');
  });

  it('ignores an unknown paper or a malformed switch', async () => {
    const settings = await load({ paper: 'sepia', paperFollowsDark: 'yes' });
    expect([settings.paper, settings.paperFollowsDark]).toEqual(['theme', true]);
  });
});
