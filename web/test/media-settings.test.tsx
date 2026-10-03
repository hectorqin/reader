import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaSettings} from '../src/media/settings.tsx';
import {defaultMediaPreferences,readMediaPreferences,saveMediaPreferences} from '../src/media/preferences.ts';
import type {MediaPlayer} from '../src/media/player.ts';
import {MediaApi} from '../src/media/api.ts';
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
it('saves explicit changes and reports storage errors without applying them',async()=>{
  const onSaved=vi.fn();
  await act(async()=>render(<MediaSettings scope="test" preferences={defaultMediaPreferences} player={{active:false} as MediaPlayer} admin={false} onSaved={onSaved} onBack={vi.fn()} onPersonal={vi.fn()} onManage={vi.fn()}/>,root));
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('浏览偏好'))!.click());
  const select=root.querySelector('select')!;
  act(()=>{select.value='comfortable';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(onSaved).not.toHaveBeenCalled();
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(onSaved).toHaveBeenCalledWith({...defaultMediaPreferences,density:'comfortable'});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(root.querySelector('[role=alert]')?.textContent).toContain('无法保存');expect(onSaved).toHaveBeenCalledTimes(1);
  expect(root.textContent).not.toContain('媒体库、权限');
});
it('uses the active player for live playback options and exposes admin management',async()=>{
  const speed=vi.fn(),sleep=vi.fn(),onManage=vi.fn();
  await act(async()=>render(<MediaSettings scope="test" preferences={defaultMediaPreferences} player={{active:true,playbackRate:1,sleepAt:0,speed,sleep} as unknown as MediaPlayer} admin onSaved={vi.fn()} onBack={vi.fn()} onPersonal={vi.fn()} onManage={onManage}/>,root));
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('播放设置'))!.click());
  const current=root.querySelector<HTMLSelectElement>('[aria-label="播放倍速"]')!;
  act(()=>{current.value='1.5';current.dispatchEvent(new Event('change',{bubbles:true}));Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='30分钟')!.click();});
  expect(speed).toHaveBeenCalledWith(1.5);expect(sleep).toHaveBeenCalledWith(30);
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回影音设置"]')!.click());
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('媒体库管理'))!.click());expect(onManage).toHaveBeenCalled();
});
it('keeps member navigation usable without exposing administrator actions',async()=>{
  const onPersonal=vi.fn(),onBack=vi.fn();
  await act(async()=>render(<MediaSettings scope="member" preferences={defaultMediaPreferences} player={{active:false} as MediaPlayer} admin={false} onSaved={vi.fn()} onBack={onBack} onPersonal={onPersonal} onManage={vi.fn()}/>,root));
  expect(root.textContent).not.toContain('媒体库管理');
  for(const [title,view] of [['我的收藏','favorites'],['播放历史','history']]){
    act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith(title!))!.click());
    expect(onPersonal).toHaveBeenLastCalledWith(view);
  }
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('播放设置'))!.click());
  expect(root.querySelector('[aria-label="默认倍速"]')).not.toBeNull();expect(root.textContent).toContain('连续播放');
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回影音设置"]')!.click());expect(onBack).not.toHaveBeenCalled();
});
it('shows account identity without exposing credentials or administrator source controls to a member',async()=>{
  const api=new MediaApi({baseUrl:'https://reader.example',currentSession:()=>({user:{username:'lin',displayName:'林间',role:'member'},accessToken:'secret-access',refreshToken:'secret-refresh'})} as unknown as ReaderApi);
  expect(api.accountInfo()).toEqual({username:'lin',displayName:'林间',role:'member',server:'https://reader.example'});
  await act(async()=>render(<MediaSettings scope="member" preferences={defaultMediaPreferences} player={{active:false} as MediaPlayer} admin={false} api={api} account={api.accountInfo()} onSaved={vi.fn()} onBack={vi.fn()} onPersonal={vi.fn()} onManage={vi.fn()}/>,root));
  expect(root.textContent).not.toContain('来源与刮削');
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('账号与连接'))!.click());
  expect(root.textContent).toContain('@lin');expect(root.textContent).toContain('https://reader.example');expect(root.textContent).not.toContain('secret');
});
it('asks before dropping an unsaved preference draft',async()=>{
  await act(async()=>render(<MediaSettings scope="draft" preferences={defaultMediaPreferences} player={{active:false} as MediaPlayer} admin={false} onSaved={vi.fn()} onBack={vi.fn()} onPersonal={vi.fn()} onManage={vi.fn()}/>,root));
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('浏览偏好'))!.click());
  act(()=>{const select=root.querySelector('select')!;select.value='comfortable';select.dispatchEvent(new Event('change',{bubbles:true}));});
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回影音设置"]')!.click());
  expect(root.querySelector('[role=alert]')?.textContent).toContain('尚未保存');
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='继续编辑')!.click());
  expect(root.querySelector('select')!.value).toBe('comfortable');
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回影音设置"]')!.click());
  act(()=>{const select=root.querySelector('select')!;select.value='compact';select.dispatchEvent(new Event('change',{bubbles:true}));});
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回影音设置"]')!.click());
  expect(root.querySelector('h1')?.textContent).toBe('影音设置');expect(root.querySelector('[role=alert]')).toBeNull();
});
it('retains an unsaved draft through route back/forward and discards it only explicitly',async()=>{
  const onPanelChange=vi.fn();let panel:'home'|'browse'='browse';
  const draw=()=>render(<MediaSettings scope="route-draft" panel={panel} onPanelChange={onPanelChange} preferences={defaultMediaPreferences} player={{active:false} as MediaPlayer} admin={false} onSaved={vi.fn()} onBack={vi.fn()} onPersonal={vi.fn()} onManage={vi.fn()}/>,root);
  await act(async()=>draw());
  act(()=>{const select=root.querySelector('select')!;select.value='comfortable';select.dispatchEvent(new Event('change',{bubbles:true}));});
  act(()=>{panel='home';draw();});
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.startsWith('浏览偏好'))!.click());
  expect(onPanelChange).toHaveBeenLastCalledWith('browse');act(()=>{panel='browse';draw();});
  expect(root.querySelector('select')!.value).toBe('comfortable');
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="返回影音设置"]')!.click());
  expect(root.querySelector('[role=alert]')?.textContent).toContain('尚未保存');
  act(()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='放弃修改')!.click());
  expect(onPanelChange).toHaveBeenLastCalledWith('home');act(()=>{panel='home';draw();});
  act(()=>{panel='browse';draw();});expect(root.querySelector('select')!.value).toBe('compact');
});
it('does not show playback settings when a member follows the provider deep link',async()=>{
  await act(async()=>render(<MediaSettings scope="member" panel="plugins" preferences={defaultMediaPreferences} player={{active:false} as MediaPlayer} admin={false} onSaved={vi.fn()} onBack={vi.fn()} onPersonal={vi.fn()} onManage={vi.fn()}/>,root));
  expect(root.querySelector('[role=alert]')?.textContent).toContain('需要管理员权限');
  expect(root.textContent).not.toContain('还没有正在播放');
});
