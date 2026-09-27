// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {MediaThemeController,readMediaTheme,saveMediaTheme} from '../src/media/theme.ts';
import {MediaThemeSettings} from '../src/media/theme-settings.tsx';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.removeAttribute('data-media-theme');document.body.removeAttribute('style');});
it('keeps theme choices separate by server/account and handles old or invalid storage',()=>{
  localStorage.setItem('reader.settings','keep');
  localStorage.setItem('reader.media.preferences.v1:a','{"density":"comfortable"}');
  saveMediaTheme('a','midnight');saveMediaTheme('b','sand');
  expect(readMediaTheme('a')).toBe('midnight');expect(readMediaTheme('b')).toBe('sand');expect(readMediaTheme('new')).toBe('system');
  localStorage.setItem('reader.media.theme.v1:a','unknown');expect(readMediaTheme('a')).toBe('system');
  expect(localStorage.getItem('reader.settings')).toBe('keep');expect(localStorage.getItem('reader.media.preferences.v1:a')).toBe('{"density":"comfortable"}');
});
it('applies a saved choice and does not apply changes when persistence fails',async()=>{
  const onChange=vi.fn();
  await act(async()=>render(<MediaThemeSettings scope="a" selected="forest" onChange={onChange}/>,root));
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="深海"]')!.click());
  expect(readMediaTheme('a')).toBe('midnight');expect(onChange).toHaveBeenCalledWith('midnight');
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="暖砂"]')!.click());
  expect(onChange).toHaveBeenCalledTimes(1);expect(root.querySelector('[role=alert]')?.textContent).toContain('无法保存主题');
});
it('responds to system appearance, honors a fixed choice, and removes listeners and media variables on exit',()=>{
  const events=new EventTarget(),changed=vi.fn();let dark=false;
  vi.stubGlobal('matchMedia',()=>({get matches(){return dark;},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)}));
  document.body.style.setProperty('--reader-ink','red');document.documentElement.dataset.theme='light';
  const controller=new MediaThemeController('a',changed);
  expect(document.body.style.getPropertyValue('--media-theme-scheme')).toBe('light');
  dark=true;events.dispatchEvent(new Event('change'));expect(document.body.style.getPropertyValue('--media-theme-scheme')).toBe('dark');
  controller.set('ocean');events.dispatchEvent(new Event('change'));expect(document.body.style.getPropertyValue('--media-theme-scheme')).toBe('light');
  controller.dispose();changed.mockClear();events.dispatchEvent(new Event('change'));
  expect(changed).not.toHaveBeenCalled();expect(document.body.dataset.mediaTheme).toBeUndefined();expect(document.body.style.getPropertyValue('--media-theme-text')).toBe('');
  expect(document.body.style.getPropertyValue('--reader-ink')).toBe('red');expect(document.documentElement.dataset.theme).toBe('light');delete document.documentElement.dataset.theme;
});
it('refreshes only the active account theme when another tab saves a choice',()=>{
  const controller=new MediaThemeController('a',vi.fn());
  saveMediaTheme('b','rose');window.dispatchEvent(new StorageEvent('storage',{key:'reader.media.theme.v1:b'}));expect(controller.current).toBe('system');
  saveMediaTheme('a','sand');window.dispatchEvent(new StorageEvent('storage',{key:'reader.media.theme.v1:a'}));expect(controller.current).toBe('sand');
  localStorage.clear();window.dispatchEvent(new StorageEvent('storage',{key:null}));expect(controller.current).toBe('system');controller.dispose();
});
