import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {AlbumPlayback,albumQueue,type AlbumTrack} from '../src/media/album-playback.tsx';
import type {MediaApi} from '../src/media/api.ts';
const track=(id:string,versions=1,available=true):AlbumTrack=>({id,title:id,disc:1,track:1,editions:Array.from({length:versions},(_,i)=>({id:id+i,label:'版本'+i,parts:[{id:id+'p'+i,assetId:id,title:id,start:0,end:10,available}]}))});
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('keeps selected order, requires explicit ambiguous versions and stops at missing tracks',()=>{
  const tracks=[track('a'),track('b',2),track('c')];
  expect(albumQueue(tracks,0,{}).count).toBe(1);
  expect(albumQueue(tracks,0,{}).notice).toContain('选择版本');
  const queue=albumQueue(tracks,1,{b:'b1'});expect(queue.entries.map(e=>e.part.id)).toEqual(['bp1','cp0']);expect(queue.entries.every(e=>!e.video)).toBe(true);
  expect(albumQueue([track('a'),track('b',1,false),track('c')],0,{}).count).toBe(1);
  expect(albumQueue(tracks,0,{b:'stale'}).count).toBe(1);
});
it('plays a later unambiguous track even when the first track needs a version choice',async()=>{
  const request=vi.fn().mockResolvedValue({tracks:[track('ambiguous',2),track('later')]}),onPlay=vi.fn().mockResolvedValue(undefined),onDetail=vi.fn();
  await act(async()=>render(<AlbumPlayback api={{request} as unknown as MediaApi} id="album" onPlay={onPlay} onQueue={vi.fn()} onDetail={onDetail}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-album-track-link')).toHaveLength(2));
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="从 ambiguous 开始播放"]')!.click());
  expect(onPlay).not.toHaveBeenCalled();expect(root.textContent?.match(/ambiguous需要选择版本/g)).toHaveLength(1);
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="从 later 开始播放"]')!.click());
  expect(onPlay.mock.calls[0]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(['laterp0']);
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="查看 later 详情"]')!.click());
  expect(onDetail).toHaveBeenCalledWith('later');expect(onPlay).toHaveBeenCalledTimes(1);
});
it('shows disc boundaries and duration only for the selected complete version',async()=>{
  const first=track('first',2),second=track('second');second.disc=2;second.track=null;
  first.editions[1]!.parts[0]!.end=125;second.editions[0]!.parts[0]!.end=null;
  const request=vi.fn().mockResolvedValue({tracks:[first,second]});
  await act(async()=>render(<AlbumPlayback api={{request} as unknown as MediaApi} id="album" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-album-disc')).toHaveLength(2));
  expect([...root.querySelectorAll('.media-album-disc')].map(node=>node.textContent)).toEqual(['第 1 碟','第 2 碟']);
  expect(root.querySelector('.media-album-duration')).toBeNull();
  const version=root.querySelector<HTMLSelectElement>('select')!;
  await act(async()=>{version.value='first1';version.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(root.querySelectorAll('.media-album-duration')).toHaveLength(1);
  expect(root.querySelector('.media-album-duration')!.textContent).toBe('2:05');
  expect(root.querySelectorAll('.media-album-number')[1]!.textContent).toBe('02');
});
it('selects a starting track, plays remaining tracks and enqueues the same order',async()=>{
  const request=vi.fn().mockResolvedValue({tracks:[track('a'),track('b'),track('c')]}),onPlay=vi.fn().mockResolvedValue(undefined),onQueue=vi.fn().mockResolvedValue(undefined);
  await act(async()=>render(<AlbumPlayback api={{request} as unknown as MediaApi} id="album" onPlay={onPlay} onQueue={onQueue} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-album-track-link').length).toBe(3));
  await act(async()=>root.querySelector<HTMLInputElement>('[aria-label="从 b 开始播放"]')!.click());
  const buttons=()=>Array.from(root.querySelectorAll('button'));
  await act(async()=>buttons().find(b=>b.textContent==='从此曲播放')!.click());
  expect(onPlay.mock.calls[0]![0].map((e:{part:{id:string}})=>e.part.id)).toEqual(['bp0','cp0']);
  await act(async()=>buttons().find(b=>b.getAttribute('aria-label')==='加入队列')!.click());expect(onQueue).toHaveBeenCalledWith(['bp0','cp0']);
  const signal=request.mock.calls[0]![3] as AbortSignal;act(()=>render(null,root));expect(signal.aborted).toBe(true);
});
it('retries loading and retains the real starting index when filtering a later page',async()=>{
  const request=vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue({tracks:Array.from({length:61},(_,i)=>track('曲'+String(i).padStart(2,'0')))}),onPlay=vi.fn().mockResolvedValue(undefined);
  await act(async()=>render(<AlbumPlayback api={{request} as unknown as MediaApi} id="album" onPlay={onPlay} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('读取失败'));
  expect(root.textContent).not.toContain('没有匹配的曲目');
  expect(root.textContent).not.toContain('0 首');
  await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await vi.waitFor(()=>expect(root.querySelector('input[type=search]')).not.toBeNull());
  const input=root.querySelector<HTMLInputElement>('input[type=search]')!;
  act(()=>{input.value='曲60';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>root.querySelector<HTMLButtonElement>('.media-album-track-link')!.click());
  await act(async()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='从此曲播放')!.click());
  expect(onPlay.mock.calls[0]![0].map((e:{part:{id:string}})=>e.part.id)).toEqual(['曲60p0']);
});
it('keeps the chosen starting track on playback retry and never retries an uncertain queue write automatically',async()=>{
  const request=vi.fn().mockResolvedValue({tracks:[track('a'),track('b')]}),onPlay=vi.fn().mockRejectedValueOnce(new Error('播放失败')).mockResolvedValue(undefined),onQueue=vi.fn().mockRejectedValue(new Error('响应丢失'));
  await act(async()=>render(<AlbumPlayback api={{request} as unknown as MediaApi} id="album" onPlay={onPlay} onQueue={onQueue} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-album-track-link')).toHaveLength(2));
  const click=async(label:string)=>act(async()=>{Array.from(root.querySelectorAll('button')).find(button=>(button.getAttribute('aria-label')||button.textContent)===label)!.click();});
  await act(async()=>root.querySelector<HTMLInputElement>('[aria-label="从 b 开始播放"]')!.click());
  await click('重试播放');
  expect(onPlay.mock.calls[1]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(['bp0']);
  expect(request).toHaveBeenCalledTimes(1);
  await click('加入队列');expect(onQueue).toHaveBeenCalledTimes(1);
  expect(root.querySelector('[role=alert]')!.textContent).toContain('先到播放队列核对');
  expect(root.querySelector('[role=alert] button')).toBeNull();
  expect(root.querySelector('[data-selected=true] .media-album-track-title')?.textContent).toContain('b');
});
