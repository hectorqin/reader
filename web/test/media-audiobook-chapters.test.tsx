import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {PlaybackControls} from '../src/features/media/components/playback-controls.tsx';
import type {MediaApi,Detail,Part} from '../src/features/media/api/media-api.ts';
import type {MediaPlayer} from '../src/features/media/services/player.ts';

const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const chapter=(id:string,available=true):Part=>({id,title:id,assetId:id,start:30,end:130,available});
const book:Detail={id:'book',libraryId:'lib',kind:'audiobook',title:'作品',parentId:null,metadata:{},overrides:{},children:[],editions:[{id:'other',label:'其它版',parts:[chapter('x')]},{id:'current',label:'当前版',parts:[chapter('a'),chapter('missing',false),chapter('b')]}]};
it('opens the complete playing edition, keeps missing chapters visible and plays only available parts',async()=>{
  const detail=vi.fn().mockResolvedValue(book),request=vi.fn().mockResolvedValue({}),play=vi.fn().mockResolvedValue(undefined);
  const api={detail,request} as unknown as MediaApi,player={active:true,currentItemId:'book',currentPartId:'b',play} as unknown as MediaPlayer;
  await act(async()=>render(<PlaybackControls api={api} player={player} panel="chapters"/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-row')).toHaveLength(3));
  expect(root.querySelector<HTMLSelectElement>('[aria-label="章节版本"]')?.value).toBe('current');
  expect(root.querySelector<HTMLButtonElement>('[aria-label="资源缺失"]')?.disabled).toBe(true);
  expect(root.querySelector('[aria-current=true]')?.textContent).toContain('b');
  await act(async()=>root.querySelector<HTMLButtonElement>('.media-primary')!.click());
  expect(play.mock.calls[0]![0].map((entry:{part:Part})=>entry.part.id)).toEqual(['a','b']);expect(play.mock.calls[0]![1]).toBe(1);
  await act(async()=>{const select=root.querySelector<HTMLSelectElement>('[aria-label="章节版本"]')!;select.value='other';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(root.querySelectorAll('.media-row')).toHaveLength(1);expect(root.querySelector('[aria-current=true]')).toBeNull();
  await act(async()=>root.querySelector<HTMLButtonElement>('.media-primary')!.click());expect(play.mock.calls[1]![0][0].part.id).toBe('x');
});
it('retries chapter reads without stopping the current session and aborts reads on leaving',async()=>{
  const detail=vi.fn().mockRejectedValueOnce(new Error('暂不可用')).mockResolvedValue(book),play=vi.fn();
  const player={active:true,currentItemId:'book',currentPartId:'b',play} as unknown as MediaPlayer;
  await act(async()=>render(<PlaybackControls api={{detail} as unknown as MediaApi} player={player} panel="chapters"/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('暂不可用'));
  await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-row')).toHaveLength(3));expect(play).not.toHaveBeenCalled();
  const signal=detail.mock.calls[1]![1] as AbortSignal;act(()=>render(null,root));expect(signal.aborted).toBe(true);
});
it('clears hidden search conditions and retains the real chapter index while filtering',async()=>{
  const parts=Array.from({length:61},(_,i)=>chapter('chapter-'+String(i).padStart(2,'0'))),detail=vi.fn().mockResolvedValue({...book,editions:[{id:'full',label:'完整版',parts}]}),play=vi.fn().mockResolvedValue(undefined);
  const player={active:true,currentItemId:'book',currentPartId:'chapter-03',play} as unknown as MediaPlayer;
  await act(async()=>render(<PlaybackControls api={{detail} as unknown as MediaApi} player={player} panel="chapters"/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-row')).toHaveLength(50));expect(root.querySelector('input')).toBeNull();
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="展开章节查找"]')!.click());
  act(()=>{const input=root.querySelector('input')!;input.value='chapter-60';input.dispatchEvent(new Event('input',{bubbles:true}));});expect(root.querySelectorAll('.media-row')).toHaveLength(1);
  await act(async()=>root.querySelector<HTMLButtonElement>('.media-part-copy')!.click());expect(play.mock.calls[0]![1]).toBe(60);
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="收起章节查找"]')!.click());expect(root.querySelector('input')).toBeNull();expect(root.querySelectorAll('.media-row')).toHaveLength(50);
});
