// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { LegacySettingsRedirect, SettingsPage } from '../src/features/account/pages/SettingsPage.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { readMediaPreferences } from '../src/features/media/services/preferences.ts';

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

afterEach(() => { act(() => render(null, root)); localStorage.clear(); updateSettings.mockClear(); });

describe('偏好设置', () => {
  it('holds every personal preference as a section of one page', () => {
    Element.prototype.scrollIntoView = vi.fn();
    paint('/me/settings');
    expect([...root.querySelectorAll('.settings-section > h2')].map(h => h.textContent)).toEqual(['外观与主题', '书架', '影音浏览', '播放']);
    // No save button anywhere: every control applies as it changes.
    expect([...root.querySelectorAll('button')].some(b => /保存/.test(b.textContent ?? ''))).toBe(false);
    act(() => { [...root.querySelectorAll<HTMLButtonElement>('.shelf-settings button')].find(b => b.textContent === '宽松')!.click(); });
    expect(updateSettings).toHaveBeenCalledWith({ shelfDensity: 'comfortable' });
    const density = root.querySelector<HTMLSelectElement>('select[aria-label="封面密度"]')!;
    act(() => { density.value = 'comfortable'; density.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(readMediaPreferences('settings-test').density).toBe('comfortable');
    expect(root.querySelector('a.settings-link')?.getAttribute('href')).toBe('/me/opds');
  });

  it('jumps to a section and keeps it in the address', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    paint('/me/settings');
    act(() => { [...root.querySelectorAll<HTMLButtonElement>('.settings-jump button')].find(b => b.textContent === '播放')!.click(); });
    expect(where()).toBe('/me/settings?section=playback');
    expect(scroll).toHaveBeenCalled();
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
    Element.prototype.scrollIntoView = vi.fn();
    paint(from);
    expect(where()).toBe(to);
  });
});
