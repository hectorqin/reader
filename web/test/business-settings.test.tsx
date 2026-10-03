import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {BusinessSettings} from '../src/ui/business-settings.tsx';
import {dismissAllNotices} from '../src/ui/notifications.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));dismissAllNotices();});
const view={group:'tmdb',label:'TMDB',revision:3,values:{enabled:true,language:'zh-CN'},secrets:{token:true},fields:[{key:'enabled',label:'启用 TMDB',type:'checkbox'},{key:'token',label:'读取令牌',type:'password'},{key:'language',label:'资料语言',type:'text'}]};
const click=async(text:string)=>act(async()=>[...root.querySelectorAll('button')].find(button=>button.textContent===text)!.click());
it('preserves stored credentials until explicitly cleared and submits a revision',async()=>{
  const request=vi.fn().mockImplementation(async(_path,method)=>method==='PATCH'?{...view,revision:4}:{groups:[view]});
  const api={businessSettingsRequest:request,businessTtsPreview:vi.fn()};
  await act(async()=>render(<BusinessSettings api={api} group="tmdb"/>,root));
  await vi.waitFor(()=>expect(root.querySelector<HTMLInputElement>('[type=password]')?.placeholder).toBe('已保存，留空不修改'));
  await click('保存配置');
  expect(request).toHaveBeenCalledWith('tmdb','PATCH',{values:view.values,revision:3});
  await vi.waitFor(()=>expect(root.querySelector('button')?.disabled).toBe(false));
  await click('清除读取令牌');await click('保存配置');
  expect(request).toHaveBeenCalledWith('tmdb','PATCH',{values:{...view.values,token:''},revision:4});
});
it('tests unsaved values without saving and keeps inputs after a rejected save',async()=>{
  const request=vi.fn().mockImplementation(async(path,method)=>method==='PATCH'?Promise.reject(Error('配置已被其他管理员修改')):path?.endsWith('/test')?{elapsedMs:20}:{groups:[view]});
  const api={businessSettingsRequest:request,businessTtsPreview:vi.fn()};
  await act(async()=>render(<BusinessSettings api={api} group="tmdb"/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[aria-label="读取令牌"]')).not.toBeNull());
  const input=root.querySelector<HTMLInputElement>('[aria-label="读取令牌"]')!;
  act(()=>{input.value='new-secret';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('测试连接');expect(request).toHaveBeenCalledWith('tmdb/test','POST',{values:{...view.values,token:'new-secret'}});
  expect(request.mock.calls.some(call=>call[1]==='PATCH')).toBe(false);
  await click('保存配置');await vi.waitFor(()=>expect(document.querySelector('[role=alert]')?.textContent).toContain('配置已被其他管理员修改'));
  expect(input.value).toBe('new-secret');
});
