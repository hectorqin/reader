import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaThemeController,mediaThemePalette,readMediaTheme,readSystemThemePair,saveMediaTheme,saveSystemThemePair} from '../src/features/media/services/theme.ts';
import {MediaThemeSettings} from '../src/features/media/components/theme-settings.tsx';
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
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="深夜"]')!.click());
  expect(readMediaTheme('a')).toBe('midnight');expect(onChange).toHaveBeenCalledWith('midnight');
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="暖纸"]')!.click());
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

it('follow-system uses the chosen light and dark theme, per account, and ignores a theme of the wrong kind',()=>{
  expect(readSystemThemePair('a')).toEqual({light:'sand',dark:'midnight'});
  saveSystemThemePair('a',{light:'rose'});saveSystemThemePair('a',{dark:'graphite'});
  expect(readSystemThemePair('a')).toEqual({light:'rose',dark:'graphite'});expect(readSystemThemePair('b')).toEqual({light:'sand',dark:'midnight'});
  localStorage.setItem('reader.media.theme.system.v1:a',JSON.stringify({light:'midnight',dark:'ocean'}));
  expect(readSystemThemePair('a')).toEqual({light:'sand',dark:'midnight'});
  localStorage.setItem('reader.media.theme.system.v1:a','{not json');expect(readSystemThemePair('a')).toEqual({light:'sand',dark:'midnight'});
  expect(mediaThemePalette('system',false,{light:'ocean',dark:'graphite'}).id).toBe('ocean');expect(mediaThemePalette('system',true,{light:'ocean',dark:'graphite'}).id).toBe('graphite');
  expect(mediaThemePalette('forest',true,{light:'ocean',dark:'graphite'}).id).toBe('forest');
});
it('re-applies the palette when the system pair changes, here or in another tab',()=>{
  const events=new EventTarget();let dark=true;
  vi.stubGlobal('matchMedia',()=>({get matches(){return dark;},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)}));
  const controller=new MediaThemeController('a',vi.fn());
  expect(document.body.style.getPropertyValue('--media-theme-background')).toBe('#14130f');
  saveSystemThemePair('a',{dark:'graphite'});expect(document.body.style.getPropertyValue('--media-theme-background')).toBe('#0f1216');
  dark=false;events.dispatchEvent(new Event('change'));expect(document.body.style.getPropertyValue('--media-theme-background')).toBe('#f6f4ef');
  localStorage.setItem('reader.media.theme.system.v1:a',JSON.stringify({light:'rose',dark:'graphite'}));
  window.dispatchEvent(new StorageEvent('storage',{key:'reader.media.theme.system.v1:a'}));expect(document.body.style.getPropertyValue('--media-theme-background')).toBe('#faf3f4');
  controller.dispose();
});
it('lets the person pick the light and the dark theme that follow-system uses',async()=>{
  const onChange=vi.fn();
  await act(async()=>render(<MediaThemeSettings scope="a" selected="system" onChange={onChange}/>,root));
  expect(root.querySelector('[aria-label="浅色时使用 暖纸"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelector('[aria-label="深色时使用 深夜"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelector('[aria-label="浅色时使用 深夜"]')).toBeNull();
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="浅色时使用 雾蓝"]')!.click());
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="深色时使用 石墨"]')!.click());
  expect(readSystemThemePair('a')).toEqual({light:'ocean',dark:'graphite'});
  expect(root.querySelector('[aria-label="浅色时使用 雾蓝"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(readMediaTheme('a')).toBe('system');expect(onChange).not.toHaveBeenCalled();
});