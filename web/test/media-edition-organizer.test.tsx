// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '../src/ui/vendor/preact.ts';
import { EditionOrganizer } from '../src/media/edition-organizer.tsx';
import type { Detail, Edition, MediaApi } from '../src/media/api.ts';
const root=document.createElement('div');document.body.append(root);
const source:Edition={id:'source',revision:'source-revision',label:'原版',parts:[0,1,2].map(i=>({id:String(i),assetId:i<2?'file-a':'file-b',title:'章节'+i,start:i,end:i+1,available:true}))};
const target:Edition={id:'target',revision:'target-revision',label:'保留版',parts:[]};
const item:Detail={id:'work',libraryId:'lib',kind:'audiobook',title:'作品',parentId:null,metadata:{},overrides:{},children:[],editions:[source,target]};
afterEach(()=>act(()=>render(null,root)));
const button=(label:string)=>[...root.querySelectorAll('button')].find(button=>button.textContent===label)!;
async function fill(element:HTMLInputElement|HTMLSelectElement,value:string,event='input'){
  await act(async()=>{element.value=value;element.dispatchEvent(new Event(event,{bubbles:true}));});
}
it('previews whole-file splitting and preserves selection after a failed save',async()=>{
  const updated=vi.fn(),request=vi.fn().mockRejectedValueOnce(new Error('版本已更新')).mockResolvedValue(item);
  await act(async()=>render(<EditionOrganizer api={{request} as unknown as MediaApi} item={item} edition={source} onUpdated={updated}/>,root));
  expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
  await fill(root.querySelector('input')!,'新版');
  await act(async()=>{(root.querySelector('input[type=checkbox]') as HTMLInputElement).click();});
  await act(async()=>button('预览整理结果').click());
  expect(root.textContent).toContain('移动 1 个文件、2 节');expect(request).not.toHaveBeenCalled();
  await act(async()=>button('确认整理').click());expect(root.textContent).toContain('版本已更新');expect(updated).not.toHaveBeenCalled();
  await act(async()=>button('确认整理').click());
  expect(request).toHaveBeenLastCalledWith('editions/source/split','POST',{expectedRevision:'source-revision',assetIds:['file-a'],label:'新版'},expect.any(AbortSignal));
  expect(updated).toHaveBeenCalledWith(item);
});
it('previews merge removal and sends both source and target snapshots',async()=>{
  const request=vi.fn().mockResolvedValue(item);
  await act(async()=>render(<EditionOrganizer api={{request} as unknown as MediaApi} item={item} edition={source} onUpdated={()=>{}}/>,root));
  await fill(root.querySelector('select')!,'merge','change');
  await fill(root.querySelectorAll('select')[1]!,'target','change');
  await act(async()=>button('预览整理结果').click());
  expect(root.textContent).toContain('原版本移除');expect(request).not.toHaveBeenCalled();
  await act(async()=>button('确认整理').click());
  expect(request).toHaveBeenCalledWith('editions/source/merge','POST',{expectedRevision:'source-revision',targetEditionId:'target',targetRevision:'target-revision'},expect.any(AbortSignal));
});
