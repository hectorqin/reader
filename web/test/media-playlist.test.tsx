import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest';
import { act } from 'react';

import { PlaybackControls } from '../src/features/media/components/playback-controls.tsx';
import type { MediaPlayer } from '../src/features/media/services/player.ts';
import type { MediaApi } from '../src/features/media/api/media-api.ts';
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
  const menu=(item:string)=>{act(()=>host.querySelector<HTMLButtonElement>('[aria-label="队列操作"]')!.click());act(()=>Array.from(host.querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find(button=>button.textContent===item)!.click());};
  menu('编辑队列');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="移除 章节 101"]')!.disabled).toBe(true);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="上移 章节 123"]')!.click());
  expect(editPlaylist).toHaveBeenCalledWith(122,-1);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="移除 章节 123"]')!.click());
  expect(editPlaylist).toHaveBeenCalledWith(122,0);
  act(()=>{input.value='123';input.dispatchEvent(new Event('input',{bubbles:true}));});
  menu('收起查找');
  expect(host.querySelector('input[type=search]')).toBeNull();
  expect(host.querySelectorAll('.media-current-playlist li')).toHaveLength(50);
});
it('re-renders the current queue when the player edits it',()=>{
  class FakePlayer extends EventTarget {
    active=true;title='专辑';currentItemId='';canSelectPlaylist=true;canEditPlaylist=true;
    entries=['一','二','三'];selectPlaylist=vi.fn();
    get currentPlaylist(){return this.entries.map((title,index)=>({index,title,current:index===0}));}
    editPlaylist(index:number,direction:-1|0|1){
      const next=this.entries.slice();
      if(direction===0)next.splice(index,1);else[next[index],next[index+direction]]=[next[index+direction]!,next[index]!];
      this.entries=next;this.dispatchEvent(new Event('change'));
    }
  }
  const player=new FakePlayer();
  act(()=>render(<PlaybackControls player={player as unknown as MediaPlayer} api={{} as MediaApi} panel="queue"/>,host));
  const titles=()=>Array.from(host.querySelectorAll('.media-current-playlist li strong')).map(node=>node.textContent);
  expect(titles()).toEqual(['一','二','三']);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="队列操作"]')!.click());
  act(()=>Array.from(host.querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find(button=>button.textContent==='编辑队列')!.click());
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="上移 三"]')!.click());
  expect(titles()).toEqual(['一','三','二']);
  act(()=>host.querySelector<HTMLButtonElement>('[aria-label="移除 二"]')!.click());
  expect(titles()).toEqual(['一','三']);
  expect(host.querySelector('.media-playlist-toolbar small')!.textContent).toContain('2 首');
});
