import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest';
import { act } from 'react';

import { PlaybackControls } from '../src/media/playback-controls.tsx';
import type { MediaPlayer } from '../src/media/player.ts';
import type { MediaApi } from '../src/media/api.ts';
const host=document.createElement('div');document.body.append(host);
afterEach(()=>act(()=>render(null,host)));
it('paginates and searches the full playlist without changing jump indices',async()=>{
  const selectPlaylist=vi.fn(),editPlaylist=vi.fn();
  const player={active:true,title:'章节',currentItemId:'',currentPlaylist:Array.from({length:123},(_,index)=>({index,title:`章节 ${index+1}`,current:index===100})),canSelectPlaylist:true,canEditPlaylist:true,selectPlaylist,editPlaylist} as unknown as MediaPlayer;
  act(()=>render(<PlaybackControls player={player} api={{} as MediaApi}/>,host));
  expect(host.querySelector('.media-current-playlist')).toBeNull();
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="播放队列"]')!.click());
  expect(host.querySelectorAll('.media-current-playlist li')).toHaveLength(50);
  const input=host.querySelector<HTMLInputElement>('input[type=search]')!;
  act(()=>{input.value='123';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelectorAll('.media-current-playlist li')).toHaveLength(1);
  act(()=>host.querySelector<HTMLButtonElement>('.media-current-playlist li button')!.click());expect(selectPlaylist).toHaveBeenCalledWith(122);
  const locate=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='定位当前播放')!;
  act(()=>locate.click());expect(input.value).toBe('');expect(host.querySelectorAll('.media-current-playlist li')).toHaveLength(23);
  expect(host.querySelector<HTMLButtonElement>('[aria-current="true"]')!.disabled).toBe(true);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="编辑播放列表"]')!.click());
  expect(host.querySelector<HTMLButtonElement>('[aria-label="移除 章节 101"]')!.disabled).toBe(true);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="上移 章节 123"]')!.click());
  expect(editPlaylist).toHaveBeenCalledWith(122,-1);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="移除 章节 123"]')!.click());
  expect(editPlaylist).toHaveBeenCalledWith(122,0);
  act(()=>{input.value='123';input.dispatchEvent(new Event('input',{bubbles:true}));});
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="查找播放列表"]')!.click());
  expect(host.querySelector('input[type=search]')).toBeNull();
  expect(host.querySelectorAll('.media-current-playlist li')).toHaveLength(50);
});
