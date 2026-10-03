import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { PlaybackControls } from '../src/features/media/components/playback-controls.tsx';
import { PlaybackFavorite } from '../src/features/media/components/audio-tools.tsx';
import type { MediaApi, Detail } from '../src/features/media/api/media-api.ts';
import type { MediaPlayer } from '../src/features/media/services/player.ts';
import {ApiError} from '../src/api/errors.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const work=(id:string,kind:string):Detail=>({id,kind,title:id,libraryId:'lib',parentId:null,metadata:{},overrides:{},editions:[],children:[]});
it('renders chapter loading and permission failure without creating a playback session',async()=>{
  let reject!:(reason:Error)=>void;
  const detail=vi.fn().mockImplementationOnce(()=>new Promise((_resolve,no)=>reject=no)).mockResolvedValue(work('book','audiobook'));
  const api={detail} as unknown as MediaApi,player={active:true,currentItemId:'book',currentPlaylist:[],play:vi.fn()} as unknown as MediaPlayer;
  await act(async()=>render(<PlaybackControls api={api} player={player} panel="chapters"/>,root));
  expect(root.querySelector('[aria-label="正在读取章节…"]')).not.toBeNull();
  await act(async()=>reject(new ApiError('forbidden','permission denied','MEDIA_FORBIDDEN',403)));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('没有访问权限'));
  await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await vi.waitFor(()=>expect(root.querySelector('.media-audiobook-chapters')).not.toBeNull());expect(player.play).not.toHaveBeenCalled();
});
it('uses the playing item for tools and discards a stale metadata response after the item changes',async()=>{
  let release!:(value:Detail)=>void;
  const detail=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>release=resolve)).mockResolvedValue(work('song','track'));
  const request=vi.fn().mockResolvedValue({favorite:false});
  const api={detail,request} as unknown as MediaApi,play=vi.fn(),player={active:true,currentItemId:'book',title:'播放中',currentPlaylist:[],play} as unknown as MediaPlayer;
  await act(async()=>render(<PlaybackControls api={api} player={player} onBack={()=>{}}/>,root));
  expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('unknown');
  Object.defineProperty(player,'currentItemId',{value:'song',configurable:true});
  await act(async()=>render(<PlaybackControls api={api} player={player} onBack={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[data-channel]')?.getAttribute('data-channel')).toBe('music'));
  expect(root.querySelector('[aria-label="歌词"]')).not.toBeNull();expect(root.querySelector('[aria-label="全部章节"]')).toBeNull();
  await act(async()=>release(work('book','audiobook')));
  expect(root.querySelector('.media-audio-heading')?.textContent).toBe('音乐播放');expect(root.querySelector('[aria-label="快进 15 秒"]')).toBeNull();expect(play).not.toHaveBeenCalled();
  expect((detail.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
});
it('reads uncertain favorite state before allowing another write',async()=>{
  let favorite=false,writes=0;
  const request=vi.fn(async(_path:string,method:string,_body?:unknown,_signal?:AbortSignal)=>{if(method==='PUT'){favorite=true;if(++writes===1)throw Error('response lost');}return {favorite};});
  const api={request} as unknown as MediaApi;
  await act(async()=>render(<PlaybackFavorite api={api} itemId="song"/>,root));
  await vi.waitFor(()=>expect(root.querySelector<HTMLButtonElement>('[aria-label="收藏"]')!.disabled).toBe(false));
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="收藏"]')!.click());
  await vi.waitFor(()=>expect(root.textContent).toContain('收藏保存失败'));
  expect(root.querySelector<HTMLButtonElement>('[aria-label="收藏"]')!.disabled).toBe(true);
  expect(root.textContent).toContain('收藏保存失败');
  await act(async()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='重读收藏状态')!.click());
  await vi.waitFor(()=>expect(root.querySelector('[aria-label="取消收藏"]')).not.toBeNull());expect(writes).toBe(1);
  const signal=request.mock.calls.at(-1)?.[3] as unknown as AbortSignal;act(()=>render(null,root));expect(signal.aborted).toBe(true);
});
