// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { LegacySettingsRedirect, SettingsPage } from '../src/features/account/pages/SettingsPage.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { readMediaPreferences } from '../src/features/media/services/preferences.ts';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';

const root = document.createElement('div');
document.body.append(root);
const updateSettings = vi.fn(async () => undefined);
const runtime = {
  mediaApi: { preferenceScope: () => 'settings-test' },
  player: { active: false },
  updateSettings,
} as any;
function Where() { const location = useLocation(); return <p data-where={location.pathname + location.search} />; }
const paint = (entry: string) => act(() => render(
  <RuntimeContext.Provider value={runtime}>
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/me/settings" element={<><SettingsPage /><Where /></>} />
        <Route path="/me/account" element={<Where />} />
        <Route path="/me" element={<Where />} />
        <Route path="/me/:panel" element={<LegacySettingsRedirect />} />
        <Route path="/media/:channel/settings/:panel?" element={<LegacySettingsRedirect />} />
      </Routes>
    </MemoryRouter>
  </RuntimeContext.Provider>,
  root,
));
const where = () => root.querySelector('[data-where]')?.getAttribute('data-where');

beforeEach(()=>useAuthStore.setState({verifiedUser:{id:'settings-user',username:'reader',displayName:'Reader',role:'member',createdAt:0}}));
afterEach(() => { act(() => render(null, root));useAuthStore.setState({session:null,verifiedUser:null});localStorage.clear(); updateSettings.mockClear(); });

describe('偏好设置', () => {
  const tabs = () => [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const selected = () => tabs().filter(tab => tab.getAttribute('aria-selected') === 'true').map(tab => tab.textContent);

  it('pure reading hides media tabs and rejects an old playback tab selection',()=>{
    useAuthStore.setState({verifiedUser:{id:'reader',username:'reader',displayName:'Reader',role:'admin',createdAt:0,features:{media:false}}});
    paint('/me/settings?section=playback');
    expect(tabs().map(tab=>tab.textContent)).toEqual(['外观与主题','书架']);
    expect(selected()).toEqual(['外观与主题']);
    expect(root.querySelector('.playback-settings')).toBeNull();
  });

  it('shows the four kinds of preference as tabs, one panel at a time', () => {
    paint('/me/settings');
    expect(tabs().map(tab => tab.textContent)).toEqual(['外观与主题', '书架', '影音浏览', '播放']);
    expect(selected()).toEqual(['外观与主题']);
    expect(root.querySelectorAll('[role=tabpanel]')).toHaveLength(1);
    expect(root.querySelector('.theme-settings')).not.toBeNull();
    expect(root.querySelector('select[aria-label="封面密度"]')).toBeNull();
    // No save button anywhere: every control applies as it changes.
    expect([...root.querySelectorAll('button')].some(b => /保存/.test(b.textContent ?? ''))).toBe(false);
  });

  it('switches panels by tab, keeps the choice in the address, and applies changes at once', () => {
    paint('/me/settings');
    act(() => { tabs().find(tab => tab.textContent === '书架')!.click(); });
    expect(where()).toBe('/me/settings?section=shelf');
    expect(root.querySelector('.theme-settings')).toBeNull();
    act(() => { [...root.querySelectorAll<HTMLButtonElement>('.shelf-settings button')].find(b => b.textContent === '宽松')!.click(); });
    expect(updateSettings).toHaveBeenCalledWith({ shelfDensity: 'comfortable' });
    expect(root.querySelector('a.settings-link')?.getAttribute('href')).toBe('/me/opds');
    act(() => { tabs().find(tab => tab.textContent === '影音浏览')!.click(); });
    const density = root.querySelector<HTMLSelectElement>('select[aria-label="封面密度"]')!;
    act(() => { density.value = 'comfortable'; density.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(readMediaPreferences('settings-test').density).toBe('comfortable');
    act(() => { tabs().find(tab => tab.textContent === '外观与主题')!.click(); });
    expect(where()).toBe('/me/settings');
  });

  it('opens on the tab the address names, and moves between tabs with the arrow keys', () => {
    paint('/me/settings?section=playback');
    expect(selected()).toEqual(['播放']);
    const key = (name: string) => act(() => { root.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); });
    key('ArrowRight');
    expect(selected()).toEqual(['外观与主题']);
    expect(document.activeElement?.textContent).toBe('外观与主题');
    key('End');
    expect(selected()).toEqual(['播放']);
    key('ArrowLeft');
    expect(where()).toBe('/me/settings?section=browse');
  });

  it.each([
    ['/me/theme', '/me/settings?section=theme'],
    ['/me/browse', '/me/settings?section=browse'],
    ['/me/playback', '/me/settings?section=playback'],
    ['/me/account', '/me/account'],
    ['/me/nothing', '/me'],
    ['/media/music/settings', '/me/settings'],
    ['/media/music/settings/browse', '/me/settings?section=browse'],
  ])('sends the old address %s to %s', (from, to) => {
    paint(from);
    expect(where()).toBe(to);
  });
});
