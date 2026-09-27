// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '../src/ui/vendor/preact.ts';
import { Narrators, type NarratorLocation } from '../src/media/narrators.tsx';
import type { MediaApi } from '../src/media/api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const button=(text:string)=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent?.includes(text))!;
const parts=[{id:'p',assetId:'a',title:'第一章',start:0,end:90,available:true}];
const work={id:'book',title:'作品',kind:'audiobook',libraryId:'lib',parentId:null,metadata:{},overrides:{},children:[],editions:[{id:'edition',label:'甲版',parts}]};
it('treats an empty narrator route parameter as the directory and keeps its library filter',async()=>{
  const narrators=vi.fn().mockResolvedValue({items:[{name:'甲',works:1,editions:1}],total:1}),narratorWorks=vi.fn();
  await act(async()=>render(<Narrators api={{narrators,narratorWorks} as unknown as MediaApi} libraryId="lib" initialLocation={{libraryId:'lib',name:'',search:'',offset:0,workId:'',editionId:''}} libraryControl={<select aria-label="媒体库"><option>全部媒体库</option></select>} onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  expect(root.querySelector('.media-narrators')?.getAttribute('data-view')).toBe('directory');
  expect(root.querySelector('[aria-label="媒体库"]')).not.toBeNull();
  await vi.waitFor(()=>expect(root.querySelector('.media-person-tile')?.textContent).toContain('甲'));
  expect(narratorWorks).not.toHaveBeenCalled();
});
it('restores the selected credited version after leaving and fetches fresh files before playback',async()=>{
  let location:NarratorLocation={libraryId:'lib',name:'甲',search:'',offset:0,workId:'book',editionId:'alternate'};
  const alternate={id:'alternate',label:'甲修订版',parts:[{...parts[0]!,id:'alternate-part'}]};
  const narratorWorks=vi.fn().mockResolvedValue({items:[{...work,editions:[...work.editions,alternate]}],total:1});
  const api={narratorWorks} as unknown as MediaApi,onPlay=vi.fn().mockResolvedValue(undefined);
  const mount=()=>render(<Narrators api={api} libraryId="lib" initialLocation={location} onLocationChange={value=>{location=value;}} onPlay={onPlay} onQueue={vi.fn()} onDetail={vi.fn()}/>,root);
  await act(async()=>mount());await vi.waitFor(()=>expect(root.querySelector('.media-edition h2')?.textContent).toBe('甲修订版'));
  expect(root.querySelectorAll('.media-edition')).toHaveLength(1);
  await act(async()=>button('播放此版本').click());expect(onPlay.mock.calls[0]![0].map((part:{id:string})=>part.id)).toEqual(['alternate-part']);
  await act(async()=>render(null,root));
  narratorWorks.mockResolvedValue({items:[{...work,editions:[{...alternate,parts:[{...alternate.parts[0]!,id:'rescanned-part'}]}]}],total:1});
  await act(async()=>mount());await vi.waitFor(()=>expect(root.querySelector('.media-edition h2')?.textContent).toBe('甲修订版'));
  await act(async()=>button('播放此版本').click());expect(onPlay.mock.calls[1]![0].map((part:{id:string})=>part.id)).toEqual(['rescanned-part']);
  expect(narratorWorks).toHaveBeenCalledTimes(2);
});

it('ignores a saved person location belonging to another library',async()=>{
  const narrators=vi.fn().mockResolvedValue({items:[],total:0}),narratorWorks=vi.fn();
  await act(async()=>render(<Narrators api={{narrators,narratorWorks} as unknown as MediaApi} libraryId="other" initialLocation={{libraryId:'lib',name:'甲',search:'',offset:60,workId:'book',editionId:'edition'}} onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(narrators).toHaveBeenCalledWith('other','',0,expect.any(AbortSignal)));expect(narratorWorks).not.toHaveBeenCalled();
});
it('browses credited works and plays only the returned edition',async()=>{
  const narrators=vi.fn().mockResolvedValue({items:[{name:'甲',works:1,editions:1}],total:1});
  const narratorWorks=vi.fn().mockResolvedValue({items:[work],total:1}),onPlay=vi.fn().mockResolvedValue(undefined),onQueue=vi.fn().mockResolvedValue(undefined);
  const api={narrators,narratorWorks,cover:async()=>null} as unknown as MediaApi;
  await act(async()=>render(<Narrators api={api} libraryId="lib" onPlay={onPlay} onQueue={onQueue} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('甲')).toBeDefined());
  await act(async()=>button('甲').click());
  await vi.waitFor(()=>expect(root.querySelector('.media-tile')).not.toBeNull());
  expect(narratorWorks).toHaveBeenCalledWith('lib','甲',0,expect.any(AbortSignal));
  await act(async()=>root.querySelector<HTMLButtonElement>('.media-tile')!.click());
  await act(async()=>button('播放').click());expect(onPlay).toHaveBeenCalledWith(parts,0,'作品');
  await act(async()=>button('加入队列').click());expect(onQueue).toHaveBeenCalledWith(['p']);
  await act(async()=>button('返回作品').click());expect(root.querySelector('.media-tile')).not.toBeNull();
});
it('retries a failed directory and cancels its request when leaving',async()=>{
  const narrators=vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue({items:[],total:0});
  const api={narrators} as unknown as MediaApi;
  await act(async()=>render(<Narrators api={api} libraryId="lib" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('连接失败'));
  await act(async()=>button('重新加载').click());await vi.waitFor(()=>expect(root.textContent).toContain('重新扫描'));
  const signal=narrators.mock.calls[1]![3] as AbortSignal;
  act(()=>render(null,root));expect(signal.aborted).toBe(true);
});
it('replaces the selected work with current versions when reloading after a playback failure',async()=>{
  const narrators=vi.fn().mockResolvedValue({items:[{name:'甲',works:1,editions:1}],total:1});
  const changed={...work,editions:[{id:'new-edition',label:'更新版本',parts:[{...parts[0]!,id:'new-part'}]}]};
  const narratorWorks=vi.fn().mockResolvedValueOnce({items:[work],total:1}).mockResolvedValueOnce({items:[changed],total:1}).mockResolvedValue({items:[],total:0});
  const onPlay=vi.fn().mockRejectedValue(new Error('授权已变化'));
  const api={narrators,narratorWorks} as unknown as MediaApi;
  await act(async()=>render(<Narrators api={api} libraryId="lib" onPlay={onPlay} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('甲')).toBeDefined());
  await act(async()=>button('甲').click());
  await vi.waitFor(()=>expect(root.querySelector('.media-tile')).not.toBeNull());
  await act(async()=>root.querySelector<HTMLButtonElement>('.media-tile')!.click());
  await act(async()=>button('播放').click());
  await act(async()=>button('重新加载').click());
  await vi.waitFor(()=>expect(root.textContent).toContain('更新版本'));expect(root.textContent).not.toContain('甲版');
  await act(async()=>button('播放').click());
  expect(onPlay.mock.calls[1]![0][0].id).toBe('new-part');
  await act(async()=>button('重新加载').click());
  await vi.waitFor(()=>expect(root.textContent).toContain('此演播者暂无关联作品'));
  expect(root.querySelector('.media-edition')).toBeNull();
});
it('paginates the directory without a separate search control',async()=>{
  const narrators=vi.fn().mockResolvedValue({items:[{name:'甲',works:1,editions:1}],total:61});
  const api={narrators} as unknown as MediaApi;
  await act(async()=>render(<Narrators api={api} libraryId="lib" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('下一页')).toBeDefined());
  await act(async()=>button('下一页').click());
  await vi.waitFor(()=>expect(narrators).toHaveBeenLastCalledWith('lib','',60,expect.any(AbortSignal)));
  expect(root.querySelector('input')).toBeNull();
  expect(button('查找演播者')).toBeUndefined();
});
it.each(['directory','works'])('returns to a valid page when the %s list shrinks',async scope=>{
  const person={name:'甲',works:61,editions:61};
  const response=scope==='directory'?{items:[person],total:61}:{items:[work],total:61};
  const changing=vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce({items:[],total:0}).mockResolvedValue({items:[],total:0});
  const narrators=scope==='directory'?changing:vi.fn().mockResolvedValue({items:[person],total:1});
  const narratorWorks=scope==='works'?changing:vi.fn();
  const api={narrators,narratorWorks} as unknown as MediaApi;
  await act(async()=>render(<Narrators api={api} libraryId="lib" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('甲')).toBeDefined());
  if(scope==='works'){await act(async()=>button('甲').click());}
  await vi.waitFor(()=>expect(button('下一页')).toBeDefined());
  await act(async()=>button('下一页').click());
  await vi.waitFor(()=>expect(changing).toHaveBeenCalledTimes(3));
  expect(changing.mock.calls.map(args=>args[2])).toEqual([0,60,0]);
  await vi.waitFor(()=>expect(root.querySelector('.media-empty')).not.toBeNull());
  expect(root.querySelector('[aria-label="演播者分页"]')).toBeNull();
});
