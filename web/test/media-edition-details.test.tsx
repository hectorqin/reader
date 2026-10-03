import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { EditionDetails } from '../src/features/media/components/edition-details.tsx';
import type { Detail, Edition, MediaApi } from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('previews three chapters around the current chapter but plays the full available edition and exposes the complete list',async()=>{
  const edition:Edition={id:'book-edition',label:'演播版',parts:Array.from({length:18},(_,i)=>({id:String(i),assetId:String(i),title:'章节 '+i,start:0,end:100,available:i!==1}))};
  const onPlay=vi.fn(),onShowAll=vi.fn();
  await act(async()=>render(<EditionDetails api={{} as MediaApi} item={{kind:'audiobook'} as Detail} edition={edition} busy={false} onPlay={onPlay} onQueue={vi.fn()} onShowAll={onShowAll} showTools={false} currentPartId="2"/>,root));
  expect(root.querySelectorAll('.media-row')).toHaveLength(3);expect(root.querySelector('input')).toBeNull();expect(root.querySelector('.media-edition-tools')).toBeNull();
  expect(root.querySelector('[aria-current=true]')?.textContent).toContain('章节 2');
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-current=true]')!.click());
  expect(onPlay.mock.calls[0]![0]).toHaveLength(17);expect(onPlay.mock.calls[0]![1]).toBe(1);
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="全部章节"]')!.click());expect(onShowAll).toHaveBeenCalledOnce();
});
it('explains missing resources and refreshes without exposing administration or playing missing parts',async()=>{
  const edition:Edition={id:'e',label:'版本',parts:[{id:'p',assetId:'a',title:'缺失章节',start:0,end:60,available:false}]};
  const onRefresh=vi.fn(),onPlay=vi.fn(),onQueue=vi.fn();
  const draw=(busy=false)=>render(<EditionDetails api={{} as MediaApi} edition={edition} busy={busy} onPlay={onPlay} onQueue={onQueue} onRefresh={onRefresh}/>,root);
  await act(async()=>draw());expect(root.textContent).toContain('作品和播放进度仍保留');
  const buttons=[...root.querySelectorAll('button')];
  expect(buttons.find(b=>b.getAttribute('aria-label')==='资源缺失')?.disabled).toBe(true);
  expect(buttons.find(b=>b.textContent==='加入队列')?.disabled).toBe(true);
  expect(root.textContent).not.toContain('修改版本名称');
  await act(async()=>buttons.find(b=>b.textContent==='刷新资源状态')!.click());expect(onRefresh).toHaveBeenCalledTimes(1);
  await act(async()=>draw(true));expect([...root.querySelectorAll('button')].find(b=>b.textContent==='刷新资源状态')?.disabled).toBe(true);
  expect(onPlay).not.toHaveBeenCalled();expect(onQueue).not.toHaveBeenCalled();
});
it('renames an edition without changing its chapter list and retains errors for retry',async()=>{
  const edition:Edition={id:'version',label:'原始版本',parts:[]},onRename=vi.fn(),request=vi.fn().mockRejectedValueOnce(new Error('版本名称已被修改')).mockResolvedValue({label:'国语版'});
  await act(async()=>render(<EditionDetails api={{request} as unknown as MediaApi} edition={edition} busy={false} onPlay={()=>{}} onQueue={()=>{}} onRename={onRename}/>,root));
  const button=(text:string)=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent===text)!;
  act(()=>button('修改版本名称').click());act(()=>{const input=root.querySelector('input')!;input.value=' 国语版 ';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(root.querySelector('[role=alert]')?.textContent).toContain('版本名称已被修改');expect(onRename).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith('editions/version','PATCH',{label:'国语版',expectedLabel:'原始版本'});
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(onRename).toHaveBeenCalledWith('国语版');expect(root.querySelector('form')).toBeNull();expect(edition.parts).toEqual([]);
});
it('pages and searches a long work while playing the full available edition in order',async()=>{
  const edition:Edition={id:'e',label:'演播版本',parts:Array.from({length:123},(_,i)=>({id:String(i),assetId:String(i),title:`章节 ${String(i+1).padStart(3,'0')}`,start:60,end:3721,available:i!==2}))};
  const onPlay=vi.fn(),onQueue=vi.fn(),request=vi.fn();
  await act(async()=>render(<EditionDetails api={{request} as unknown as MediaApi} edition={edition} busy={false} onPlay={onPlay} onQueue={onQueue}/>,root));
  expect(root.querySelectorAll('.media-row')).toHaveLength(50);
  expect(root.textContent).toContain('1:01:01');
  expect(root.querySelectorAll('.media-resource-info')).toHaveLength(0);
  expect(request).not.toHaveBeenCalled();
  const button=(text:string)=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===text||b.getAttribute('aria-label')===text)!;
  await act(async()=>button('下一页').click());
  expect(root.querySelector('.media-row')!.textContent).toContain('章节 051');
  await act(async()=>{const input=root.querySelector('input')!;input.value='章节 100';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.querySelectorAll('.media-row')).toHaveLength(1);
  await act(async()=>button('播放').click());
  expect(onPlay.mock.calls[0]![0]).toHaveLength(122);
  expect(onPlay.mock.calls[0]![0][onPlay.mock.calls[0]![1]].id).toBe('99');
  expect(onPlay.mock.calls[0]![0].some((part:{id:string})=>part.id==='2')).toBe(false);
  await act(async()=>button('加入队列').click());
  expect(onQueue.mock.calls[0]![0]).toHaveLength(122);
});
