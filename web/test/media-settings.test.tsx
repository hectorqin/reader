import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaAccountPanel,MediaBrowseSettings} from '../src/features/media/components/settings.tsx';
import {PlaybackSettings} from '../src/features/media/components/playback-settings.tsx';
import {defaultMediaPreferences,readMediaPreferences,saveMediaPreferences} from '../src/features/media/services/preferences.ts';
import type {MediaPlayer} from '../src/features/media/services/player.ts';
import {MediaApi} from '../src/features/media/api/media-api.ts';
import type {ReaderApi} from '../src/api/client.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));localStorage.clear();vi.restoreAllMocks();});
it('isolates device preferences by server/account and leaves reading storage untouched',()=>{
  localStorage.setItem('reader.settings','unchanged');
  const first='["server-a","user"]',second='["server-b","user"]';
  saveMediaPreferences(first,{density:'comfortable',showContinue:false,showLibraryName:false});
  expect(readMediaPreferences(first).density).toBe('comfortable');expect(readMediaPreferences(second)).toEqual(defaultMediaPreferences);
  expect(localStorage.getItem('reader.settings')).toBe('unchanged');
  localStorage.setItem('reader.media.preferences.v1:'+first,'broken');expect(readMediaPreferences(first)).toEqual(defaultMediaPreferences);
});
const change=(select:HTMLSelectElement,value:string)=>act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});
it('applies browse preferences as they change, and keeps the stored value when storage fails',async()=>{
  await act(async()=>render(<MediaBrowseSettings scope="test"/>,root));
  change(root.querySelector('select')!,'comfortable');
  expect(readMediaPreferences('test').density).toBe('comfortable');
  act(()=>root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(readMediaPreferences('test').showContinue).toBe(false);
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  change(root.querySelector('select')!,'compact');
  expect(root.querySelector('[role=alert]')?.textContent).toContain('无法保存');
  expect(root.querySelector('select')!.value).toBe('comfortable');
  expect(readMediaPreferences('test').density).toBe('comfortable');
});
it('uses the active player for live playback options',async()=>{
  const speed=vi.fn(),sleep=vi.fn(),onPlayback=vi.fn();
  await act(async()=>render(<PlaybackSettings scope="test" player={{active:true,title:'正在播放',playbackRate:1,sleepAt:0,speed,sleep} as unknown as MediaPlayer} onPlayback={onPlayback}/>,root));
  expect(root.querySelector('[aria-label="默认倍速"]')).not.toBeNull();expect(root.textContent).toContain('连续播放');
  const current=root.querySelector<HTMLSelectElement>('[aria-label="播放倍速"]')!;
  act(()=>{current.value='1.5';current.dispatchEvent(new Event('change',{bubbles:true}));Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='30分钟')!.click();});
  expect(speed).toHaveBeenCalledWith(1.5);expect(sleep).toHaveBeenCalledWith(30);
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='打开播放器')!.click());expect(onPlayback).toHaveBeenCalled();
});
it('shows account identity without exposing credentials',async()=>{
  const api=new MediaApi({baseUrl:'https://reader.example',currentSession:()=>({user:{username:'lin',displayName:'林间',role:'member'},accessToken:'secret-access',refreshToken:'secret-refresh'})} as unknown as ReaderApi);
  expect(api.accountInfo()).toEqual({username:'lin',displayName:'林间',role:'member',server:'https://reader.example'});
  await act(async()=>render(<MediaAccountPanel account={api.accountInfo()!}/>,root));
  expect(root.textContent).toContain('@lin');expect(root.textContent).toContain('https://reader.example');expect(root.textContent).not.toContain('secret');
});
