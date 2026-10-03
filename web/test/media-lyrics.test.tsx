import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {Lyrics} from '../src/media/lyrics.tsx';
import type {MediaApi} from '../src/media/api.ts';
import type {MediaPlayer} from '../src/media/player.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('highlights coincident translations, seeks a lyric and renders text without HTML',async()=>{
  const request=vi.fn().mockResolvedValue({source:'sidecar',synced:true,lines:[{time:1,text:'<img src=x onerror=alert(1)>'},{time:1,text:'翻译'},{time:3,text:'第二句'}]});
  const seek=vi.fn(),player={currentPartId:'p',position:1.5,seek} as unknown as MediaPlayer;
  await act(async()=>render(<Lyrics api={{request} as unknown as MediaApi} player={player}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('[aria-current=true]').length).toBe(2));
  expect(root.querySelector('img')).toBeNull();
  await act(async()=>root.querySelectorAll<HTMLButtonElement>('.media-lyrics-lines button')[2]!.click());
  expect(seek).toHaveBeenCalledWith(3);expect(root.querySelector('[aria-current=true]')?.textContent).toBe('第二句');
  const signal=request.mock.calls[0]![3] as AbortSignal;act(()=>render(null,root));expect(signal.aborted).toBe(true);
});
it('shows absence and supports retry without affecting playback',async()=>{
  const request=vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue({source:'none',synced:false,lines:[]});
  const player={currentPartId:'p',position:0} as MediaPlayer;
  await act(async()=>render(<Lyrics api={{request} as unknown as MediaApi} player={player}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('读取失败'));
  await act(async()=>root.querySelector<HTMLButtonElement>('button')!.click());
  await vi.waitFor(()=>expect(root.textContent).toContain('暂无歌词'));
});
it('pauses following on keyboard navigation and disables lyric seeking for an unavailable session',async()=>{
  const request=vi.fn().mockResolvedValue({source:'sidecar',synced:true,lines:[{time:0,text:'第一句'},{time:10,text:'第二句'}]});
  const player={currentPartId:'p',position:0,playbackUnavailable:true,seek:vi.fn()} as unknown as MediaPlayer;
  await act(async()=>render(<Lyrics api={{request} as unknown as MediaApi} player={player}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('.media-lyrics-lines button')).not.toBeNull());
  expect(root.querySelector<HTMLButtonElement>('.media-lyrics-lines button')!.disabled).toBe(true);
  const event=new KeyboardEvent('keydown',{key:'PageDown',bubbles:true,cancelable:true});
  await act(async()=>{root.querySelector('.media-lyrics-lines')!.dispatchEvent(event);});
  expect(event.defaultPrevented).toBe(true);
  expect(root.querySelector('[aria-label="跟随播放"]')).not.toBeNull();expect(player.seek).not.toHaveBeenCalled();
});
it('keeps the start of a tall simultaneous lyric group visible when following resumes',async()=>{
  const request=vi.fn().mockResolvedValue({source:'sidecar',synced:true,lines:[{time:0,text:'第一句'},{time:0,text:'长翻译'}]});
  const player={currentPartId:'p',position:1,seek:vi.fn()} as unknown as MediaPlayer;
  await act(async()=>render(<Lyrics api={{request} as unknown as MediaApi} player={player}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-lyrics-lines button')).toHaveLength(2));
  const host=root.querySelector<HTMLElement>('.media-lyrics-lines')!,lines=host.querySelectorAll('button');
  Object.defineProperty(host,'clientHeight',{value:300});
  Object.defineProperties(lines[0],{offsetTop:{value:500},offsetHeight:{value:100}});
  Object.defineProperties(lines[1],{offsetTop:{value:600},offsetHeight:{value:350}});
  await act(async()=>{host.dispatchEvent(new WheelEvent('wheel',{bubbles:true}));});
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="跟随播放"]')!.click());
  expect(host.scrollTop).toBe(484);
});
it('discards a late lyric response after switching tracks',async()=>{
  let release!:(value:unknown)=>void;
  const request=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue({source:'embedded',synced:false,lines:[{time:null,text:'新曲歌词'}]});
  const api={request} as unknown as MediaApi,player={currentPartId:'old',position:0} as MediaPlayer;
  await act(async()=>render(<Lyrics api={api} player={player}/>,root));
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
  Object.defineProperty(player,'currentPartId',{value:'new',configurable:true});
  await act(async()=>render(<Lyrics api={api} player={player}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('新曲歌词'));
  expect((request.mock.calls[0]![3] as AbortSignal).aborted).toBe(true);
  await act(async()=>release({source:'embedded',synced:false,lines:[{time:null,text:'旧曲歌词'}]}));
  expect(root.textContent).not.toContain('旧曲歌词');expect(root.querySelector('.media-lyrics-lines button')).toBeNull();
});
