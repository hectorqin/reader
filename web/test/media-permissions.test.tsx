import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { MediaPermissions } from '../src/features/media/components/permissions.tsx';
import type { MediaApi } from '../src/features/media/api/media-api.ts';
import {ApiError} from '../src/api/errors.ts';

const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('preserves grants across user pages, filtering and a failed save',async()=>{
  const users=Array.from({length:65},(_,i)=>({id:'user'+i,username:'user'+i,displayName:'用户 '+i,role:'member',disabled:false}));
  const request=vi.fn(async(_path:string,method:string)=>{if(method==='PUT')throw new ApiError('offline','Failed to fetch');return {access:'restricted',userIds:['user0']};});
  const api={request,users:async()=>({users})} as unknown as MediaApi;
  await act(async()=>render(<MediaPermissions api={api} library={{id:'lib',name:'音乐',kind:'music',access:'restricted'}} onSaved={vi.fn()} onCancel={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('[type=checkbox]')).toHaveLength(30));
  const next=()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='下一页')!;
  await act(async()=>next().click());await act(async()=>next().click());expect(root.querySelectorAll('[type=checkbox]')).toHaveLength(5);
  await act(async()=>root.querySelector<HTMLInputElement>('[type=checkbox]')!.click());
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="查找用户"]')!;input.value='user64';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>root.querySelector<HTMLInputElement>('[type=checkbox]')!.click());expect(root.querySelector('[aria-label="用户分页"]')).toBeNull();
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(request).toHaveBeenLastCalledWith('libraries/lib/access','PUT',{access:'restricted',userIds:['user0','user60','user64']},expect.any(AbortSignal));
  expect(root.querySelector('[role=alert]')?.textContent).toContain('当前选择已保留');expect(root.textContent).not.toContain('Failed to fetch');expect(root.querySelector<HTMLInputElement>('[type=checkbox]')!.checked).toBe(true);
});
it('uses a read-only retry on permission failure and keeps the form hidden until both reads succeed',async()=>{
  let reject!:(error:Error)=>void;const request=vi.fn().mockImplementationOnce(()=>new Promise((_resolve,no)=>reject=no)).mockResolvedValue({access:'restricted',userIds:[]});
  const api={request,users:async()=>({users:[]})} as unknown as MediaApi;
  await act(async()=>render(<MediaPermissions api={api} library={{id:'lib',name:'电影',kind:'video',access:'restricted'}} onSaved={vi.fn()} onCancel={vi.fn()}/>,root));
  expect(root.querySelector('[aria-busy=true]')).not.toBeNull();expect(root.querySelector('[aria-label="访问范围"]')).toBeNull();
  await act(async()=>reject(new ApiError('forbidden','admin role required','ADMIN_REQUIRED',403)));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('需要管理员权限'));expect(root.querySelector('fieldset')).toBeNull();
  await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await vi.waitFor(()=>expect(root.querySelector('fieldset')).not.toBeNull());expect(request.mock.calls.every(call=>call[1]==='GET')).toBe(true);
});
it('shows administrators as always authorized and ignores a save result after leaving',async()=>{
  let finish!:()=>void;const saved=vi.fn();
  const request=vi.fn(async(_path,method)=>method==='PUT'?new Promise<void>(resolve=>{finish=resolve;}):{access:'restricted',userIds:[]});
  const api={request,users:async()=>({users:[{id:'admin',username:'admin',displayName:'管理员',role:'admin',disabled:false},{id:'bob',username:'bob',displayName:'乙',role:'member',disabled:false}]})} as unknown as MediaApi;
  await act(async()=>render(<MediaPermissions api={api} library={{id:'lib',name:'音乐',kind:'music',access:'restricted'}} onSaved={saved} onCancel={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('[type=checkbox]')).toHaveLength(2));
  const admin=root.querySelector<HTMLInputElement>('[type=checkbox]')!;expect(admin.checked).toBe(true);expect(admin.disabled).toBe(true);
  await act(async()=>{root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  const signal=(request.mock.calls.at(-1) as unknown as unknown[])[3] as AbortSignal;
  act(()=>render(null,root));expect(signal.aborted).toBe(true);await act(async()=>finish());expect(saved).not.toHaveBeenCalled();
});
it('explains all-user access separately from a restricted empty list and preserves preselection',async()=>{
  const request=vi.fn(async()=>({access:'all',userIds:[]}));
  const api={request,users:async()=>({users:[{id:'bob',username:'bob',displayName:'乙',role:'member',disabled:false}]})} as unknown as MediaApi;
  await act(async()=>render(<MediaPermissions api={api} library={{id:'lib',name:'音乐',kind:'music',access:'all'}} onSaved={()=>{}} onCancel={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('保存后所有已启用用户均可访问'));
  expect(root.textContent).not.toContain('仅管理员可以访问');
  const scope=root.querySelector<HTMLSelectElement>('select')!;
  const setScope=async(value:string)=>act(async()=>{scope.value=value;scope.dispatchEvent(new Event('change',{bubbles:true}));});
  await setScope('restricted');expect(root.textContent).toContain('保存后仅管理员可以访问');
  await act(async()=>root.querySelector<HTMLInputElement>('[type=checkbox]')!.click());
  expect(root.textContent).toContain('保存后管理员和名单中已启用的用户可以访问');
  await setScope('all');expect(root.textContent).toContain('已预选 1 位用户');
  const filter=root.querySelector<HTMLInputElement>('input:not([type=checkbox])')!;
  await act(async()=>{filter.value='missing';filter.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.textContent).toContain('没有匹配的用户，已选名单保留');
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(request).toHaveBeenLastCalledWith('libraries/lib/access','PUT',{access:'all',userIds:['bob']},expect.any(AbortSignal));
});
it('preserves hidden selections and disabled existing grants while editing by username',async()=>{
  const request=vi.fn(async (_path,method)=>method==='PUT'?undefined:{access:'restricted',userIds:['alice','old']});
  const api={request,users:async()=>({users:[
    {id:'alice',username:'alice',displayName:'甲',role:'member',disabled:false},
    {id:'bob',username:'bob',displayName:'乙',role:'member',disabled:false},
    {id:'old',username:'old',displayName:'已停用账号',role:'member',disabled:true},
  ]})} as unknown as MediaApi;
  const saved=vi.fn();
  await act(async()=>render(<MediaPermissions api={api} library={{id:'lib',name:'音乐',kind:'music',access:'restricted'}} onSaved={saved} onCancel={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[aria-label="查找用户"]')).not.toBeNull());
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('input:not([type=checkbox])')!;input.value='bob';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.querySelectorAll('[type=checkbox]').length).toBe(1);
  await act(async()=>root.querySelector<HTMLInputElement>('[type=checkbox]')!.click());
  await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(request).toHaveBeenLastCalledWith('libraries/lib/access','PUT',{access:'restricted',userIds:['alice','old','bob']},expect.any(AbortSignal));
  expect(saved).toHaveBeenCalledWith('restricted');
});
