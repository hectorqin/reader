import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaSettings} from '../src/features/media/components/settings.tsx';
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
const player={active:false} as MediaPlayer;
const change=(select:HTMLSelectElement,value:string)=>act(()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});
const back=()=>act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回我的"]')!.click());
it('saves explicit changes and reports storage errors without applying them',async()=>{
  const onSaved=vi.fn();
  await act(async()=>render(<MediaSettings scope="test" panel="browse" preferences={defaultMediaPreferences} player={player} onSaved={onSaved} onBack={vi.fn()}/>,root));
  change(root.querySelector('select')!,'comfortable');
  expect(onSaved).not.toHaveBeenCalled();
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(onSaved).toHaveBeenCalledWith({...defaultMediaPreferences,density:'comfortable'});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(root.querySelector('[role=alert]')?.textContent).toContain('无法保存');expect(onSaved).toHaveBeenCalledTimes(1);
});
it('uses the active player for live playback options',async()=>{
  const speed=vi.fn(),sleep=vi.fn(),onBack=vi.fn();
  await act(async()=>render(<MediaSettings scope="test" panel="playback" preferences={defaultMediaPreferences} player={{active:true,playbackRate:1,sleepAt:0,speed,sleep} as unknown as MediaPlayer} onSaved={vi.fn()} onBack={onBack}/>,root));
  expect(root.querySelector('[aria-label="默认倍速"]')).not.toBeNull();expect(root.textContent).toContain('连续播放');
  const current=root.querySelector<HTMLSelectElement>('[aria-label="播放倍速"]')!;
  act(()=>{current.value='1.5';current.dispatchEvent(new Event('change',{bubbles:true}));Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='30分钟')!.click();});
  expect(speed).toHaveBeenCalledWith(1.5);expect(sleep).toHaveBeenCalledWith(30);
  back();expect(onBack).toHaveBeenCalled();
});
it('shows account identity without exposing credentials',async()=>{
  const api=new MediaApi({baseUrl:'https://reader.example',currentSession:()=>({user:{username:'lin',displayName:'林间',role:'member'},accessToken:'secret-access',refreshToken:'secret-refresh'})} as unknown as ReaderApi);
  expect(api.accountInfo()).toEqual({username:'lin',displayName:'林间',role:'member',server:'https://reader.example'});
  await act(async()=>render(<MediaSettings scope="member" panel="account" preferences={defaultMediaPreferences} player={player} account={api.accountInfo()} onSaved={vi.fn()} onBack={vi.fn()}/>,root));
  expect(root.textContent).toContain('@lin');expect(root.textContent).toContain('https://reader.example');expect(root.textContent).not.toContain('secret');
});
it('asks before dropping an unsaved preference draft',async()=>{
  const onBack=vi.fn();
  await act(async()=>render(<MediaSettings scope="draft" panel="browse" preferences={defaultMediaPreferences} player={player} onSaved={vi.fn()} onBack={onBack}/>,root));
  change(root.querySelector('select')!,'comfortable');
  back();
  expect(root.querySelector('[role=alertdialog]')?.textContent).toContain('尚未保存');expect(onBack).not.toHaveBeenCalled();
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='继续编辑')!.click());
  expect(root.querySelector('select')!.value).toBe('comfortable');
  back();
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='放弃修改')!.click());
  expect(onBack).toHaveBeenCalledTimes(1);
});
it('leaves without asking when nothing changed',async()=>{
  const onBack=vi.fn();
  await act(async()=>render(<MediaSettings scope="clean" panel="browse" preferences={defaultMediaPreferences} player={player} onSaved={vi.fn()} onBack={onBack}/>,root));
  back();
  expect(root.querySelector('[role=alertdialog]')).toBeNull();expect(onBack).toHaveBeenCalledTimes(1);
});
