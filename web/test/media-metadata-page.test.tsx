import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaMetadataPage} from '../src/media/metadata-page.tsx';
import type {Detail,MediaApi} from '../src/media/api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const item:Detail={id:'film',libraryId:'lib',kind:'movie',title:'人工标题',parentId:null,metadata:{title:'来源标题',year:2024,sources:{title:'nfo',year:'nfo'}},overrides:{title:'人工标题'},editions:[],children:[]};
const button=(name:string)=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent===name||button.getAttribute('aria-label')===name)!;
const fill=async(name:string,value:string)=>act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="'+name+'"]')!;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));});
it('keeps unsaved fields when staying and requires a deliberate discard before leaving',async()=>{
  const onBack=vi.fn(),request=vi.fn();
  await act(async()=>render(<MediaMetadataPage api={{request} as unknown as MediaApi} item={item} initialView="edit" onUpdated={vi.fn()} onBack={onBack}/>,root));
  await fill('标题','尚未保存');await act(async()=>button('返回作品详情').click());
  expect(root.querySelector('[role=alert]')?.textContent).toContain('有未保存的修改');expect(onBack).not.toHaveBeenCalled();
  await act(async()=>button('继续编辑').click());expect(root.querySelector<HTMLInputElement>('[aria-label="标题"]')!.value).toBe('尚未保存');
  await act(async()=>button('返回作品详情').click());await act(async()=>button('放弃修改并离开').click());expect(onBack).toHaveBeenCalledOnce();expect(request).not.toHaveBeenCalled();
});
it('keeps a pending save mounted and restores only editable source fields',async()=>{
  let complete!:(item:Detail)=>void;
  const request=vi.fn(()=>new Promise<Detail>(resolve=>{complete=resolve;})),onUpdated=vi.fn(),onBack=vi.fn();
  await act(async()=>render(<MediaMetadataPage api={{request} as unknown as MediaApi} item={{...item,overrides:{title:'人工标题',year:2025,internal:'保留'}}} initialView="edit" onUpdated={onUpdated} onBack={onBack}/>,root));
  await act(async()=>button('恢复来源值').click());expect(root.querySelector<HTMLInputElement>('[aria-label="标题"]')!.value).toBe('来源标题');expect(request).not.toHaveBeenCalled();
  await act(async()=>button('保存修改').click());expect(button('返回作品详情').disabled).toBe(true);expect(button('在线匹配').disabled).toBe(true);
  expect(request.mock.calls[0]).toEqual(['items/film/metadata','PATCH',{title:null,year:null},expect.any(AbortSignal)]);
  await act(async()=>complete(item));expect(onUpdated).toHaveBeenCalledWith(item);expect(onBack).not.toHaveBeenCalled();
});
