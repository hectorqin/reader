import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { EditionAssignment } from '../src/media/edition-assignment.tsx';
import type { Detail, Edition, MediaApi } from '../src/media/api.ts';
import {ApiError} from '../src/api/errors.ts';

const root=document.createElement('div');document.body.append(root);
const edition:Edition={id:'edition',label:'原版',parts:[{id:'part',assetId:'asset',title:'第一章',start:0,end:20,available:true}]};
const item:Detail={id:'source',libraryId:'library',kind:'audiobook',title:'原作品',parentId:null,metadata:{},overrides:{},children:[],editions:[edition]};
const target:Detail={...item,id:'target',title:'目标作品',editions:[]};
afterEach(()=>act(()=>render(null,root)));
it('retries failed list and target reads without writing ownership',async()=>{
  const items=vi.fn().mockRejectedValueOnce(new ApiError('offline','Failed to fetch')).mockResolvedValue({items:[target],total:1});
  const detail=vi.fn().mockRejectedValueOnce(new Error('目标读取失败')).mockResolvedValue(target),request=vi.fn();
  await act(async()=>render(<EditionAssignment api={{items,detail,request} as unknown as MediaApi} item={item} edition={edition} onAssigned={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('无法连接服务器'));expect(root.textContent).not.toContain('Failed to fetch');
  await click('重新读取作品');await click('选择此作品');
  await vi.waitFor(()=>expect(root.textContent).toContain('目标读取失败'));
  await click('重新读取作品');await vi.waitFor(()=>expect(root.querySelector('[aria-label="确认版本归属"]')).not.toBeNull());
  expect(items).toHaveBeenCalledTimes(2);expect(detail).toHaveBeenCalledTimes(2);expect(request).not.toHaveBeenCalled();
});
it('creates a new work only after preview and confirmation',async()=>{
  const assigned=vi.fn(),request=vi.fn().mockResolvedValue({...target,editions:[edition]});
  const api={items:vi.fn().mockResolvedValue({items:[],total:0}),request} as unknown as MediaApi;
  await act(async()=>render(<EditionAssignment api={api} item={item} edition={edition} onAssigned={assigned}/>,root));
  await act(async()=>{const input=root.querySelector('input')!;input.value='新作品';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('预览新建作品');expect(request).not.toHaveBeenCalled();
  expect(root.querySelector('[aria-label="确认新建作品"]')?.textContent).toContain('新作品');
  await click('取消新建');expect(request).not.toHaveBeenCalled();
  await click('预览新建作品');await click('确认新建并关联');
  expect(request).toHaveBeenCalledWith('editions/edition/new-item','POST',{title:'新作品',expectedItemId:'source'},expect.any(AbortSignal));
  expect(assigned).toHaveBeenCalledWith(expect.objectContaining({id:'target'}));
});
async function click(label:string){
  await vi.waitFor(()=>expect([...root.querySelectorAll('button')].find(button=>button.textContent===label)?.disabled).toBe(false));
  await act(async()=>{[...root.querySelectorAll('button')].find(button=>button.textContent===label)!.click();});
}

it('previews an existing work and changes ownership only after explicit confirmation, retaining failures for retry',async()=>{
  const assigned=vi.fn();
  const request=vi.fn().mockRejectedValueOnce(new Error('归属已改变，请刷新')).mockResolvedValue({...target,editions:[edition]});
  const api={items:vi.fn().mockResolvedValue({items:[item,target],total:2}),detail:vi.fn().mockResolvedValue(target),request} as unknown as MediaApi;
  await act(async()=>render(<EditionAssignment api={api} item={item} edition={edition} onAssigned={assigned}/>,root));
  await click('选择此作品');
  expect(root.querySelector('[aria-label="确认版本归属"]')?.textContent).toContain('原作品 → 目标作品');
  expect(request).not.toHaveBeenCalled();
  await click('确认修改归属');
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('归属已改变');
  expect(assigned).not.toHaveBeenCalled();
  await click('确认修改归属');
  expect(request).toHaveBeenLastCalledWith('editions/edition/item','PUT',{targetItemId:'target',expectedItemId:'source'},expect.any(AbortSignal));
  expect(assigned).toHaveBeenCalledWith(expect.objectContaining({id:'target',editions:[edition]}));
});

it('allows retrying an unchanged search and ignores a detail response after leaving',async()=>{
  let release!:(value:Detail)=>void;
  const items=vi.fn().mockRejectedValueOnce(new Error('连接中断')).mockResolvedValue({items:[target],total:1});
  const detail=vi.fn((_id:string,_signal:AbortSignal)=>new Promise<Detail>(resolve=>{release=resolve;}));
  const assigned=vi.fn(),request=vi.fn();
  const api={items,detail,request} as unknown as MediaApi;
  await act(async()=>render(<EditionAssignment api={api} item={item} edition={edition} onAssigned={assigned}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('连接中断'));
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await click('选择此作品');
  const signal=detail.mock.calls[0]![1];
  act(()=>render(null,root));expect(signal.aborted).toBe(true);
  await act(async()=>release(target));
  expect(request).not.toHaveBeenCalled();expect(assigned).not.toHaveBeenCalled();
});
