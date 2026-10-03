import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {VideoHierarchyEditor} from '../src/features/media/components/video-hierarchy-editor.tsx';
import type {Detail,MediaApi} from '../src/features/media/api/media-api.ts';
import {ApiError} from '../src/api/errors.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const button=(name:string)=>[...root.querySelectorAll('button')].find(value=>value.textContent===name)!;
it('creates a show and season only after confirmation, retaining a cancelled draft',async()=>{
  const item:Detail={id:'episode',libraryId:'lib',kind:'episode',parentId:'old',ordinal:1,title:'单集',metadata:{},overrides:{},editions:[],children:[]};
  const request=vi.fn().mockResolvedValue({...item,parentId:'created'});
  const api={items:vi.fn(async()=>({items:[],total:0})),request} as unknown as MediaApi;
  await act(async()=>render(<VideoHierarchyEditor api={api} item={item} onUpdated={()=>{}}/>,root));
  await act(async()=>button('调整归属与集号').click());
  await vi.waitFor(()=>expect(button('新建剧集并整理').disabled).toBe(false));
  await act(async()=>button('新建剧集并整理').click());
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('input[aria-label="新剧集名称"]')!;input.value=' 新剧集 ';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('预览新建归属').click());expect(request).not.toHaveBeenCalled();
  await act(async()=>button('返回选择').click());await act(async()=>button('取消新建').click());expect(request).not.toHaveBeenCalled();
  await act(async()=>button('新建剧集并整理').click());await act(async()=>button('预览新建归属').click());
  await act(async()=>button('确认季集整理').click());
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith('items/episode/hierarchy','POST',{seriesTitle:'新剧集',seasonOrdinal:1,ordinal:1,expectedParentId:'old',expectedOrdinal:1},expect.any(AbortSignal));
});
it('previews an episode move without writing and locks stale ordinal submissions until refreshed',async()=>{
  let item:Detail={id:'episode',libraryId:'lib',kind:'episode',parentId:'old',ordinal:1,title:'单集',metadata:{},overrides:{},editions:[],children:[]};
  const season={...item,id:'season',kind:'season',parentId:'show',title:'第二季',ordinal:2};
  const show={...item,id:'show',kind:'series',parentId:null,title:'目标剧集',children:[season]};
  const request=vi.fn().mockRejectedValueOnce(new ApiError('conflict','编号已变化','MEDIA_PARENT_CHANGED',409)).mockResolvedValue({...item,parentId:'season',ordinal:3});
  const api={items:vi.fn(async()=>({items:[show],total:1})),detail:vi.fn(async(id:string)=>id==='show'?show:{...item,ordinal:2}),request} as unknown as MediaApi;
  const draw=()=>render(<VideoHierarchyEditor api={api} item={item} onUpdated={value=>{item=value;draw();}}/>,root);
  await act(async()=>draw());await act(async()=>button('调整归属与集号').click());
  const choose=async()=>{
    await vi.waitFor(()=>expect(button('选择剧集')?.disabled).toBe(false));
    await act(async()=>button('选择剧集').click());
    await vi.waitFor(()=>expect(root.querySelector('select')).not.toBeNull());
    await act(async()=>{const select=root.querySelector('select')!;select.value='season';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>{const input=root.querySelector<HTMLInputElement>('input[aria-label="集号"]')!;input.value='3';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>button('预览季集整理').click());
  };
  await choose();expect(request).not.toHaveBeenCalled();expect(root.textContent).toContain('目标剧集 / 第二季');
  await act(async()=>button('返回选择').click());expect(request).not.toHaveBeenCalled();
  await act(async()=>button('预览季集整理').click());await act(async()=>button('确认季集整理').click());
  await vi.waitFor(()=>expect(button('刷新当前归属')).toBeDefined());expect(button('确认季集整理')).toBeUndefined();
  await act(async()=>button('刷新当前归属').click());await choose();
  await act(async()=>button('确认季集整理').click());
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
  expect(request).toHaveBeenLastCalledWith('items/episode/hierarchy','PUT',{targetParentId:'season',ordinal:3,expectedParentId:'old',expectedOrdinal:2},expect.any(AbortSignal));
});
