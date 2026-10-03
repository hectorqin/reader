import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';
import { useState } from 'react';
import {MediaSelect} from '../src/features/media/components/select.tsx';

const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));vi.restoreAllMocks();});
const trigger=()=>root.querySelector<HTMLButtonElement>('[role=combobox]')!;
const menu=()=>root.querySelector<HTMLElement>('[role=listbox]');
async function key(value:string){await act(async()=>{trigger().dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));});}
function Fixture({changed=()=>{}}:{changed?:(value:string)=>void}){
  const [value,setValue]=useState('video');
  return <MediaSelect aria-label="内容类型" value={value} onChange={event=>{setValue(event.currentTarget.value);changed(event.currentTarget.value);}}><option value="video">影视</option><option value="unavailable" disabled>不可用</option><option value="music">音乐</option><option value="audio">有声书</option></MediaSelect>;
}

it('opens the themed options, marks the selection and changes through the existing select event',async()=>{
  const changed=vi.fn();await act(async()=>render(<Fixture changed={changed}/>,root));
  expect(trigger().textContent).toBe('影视');expect(trigger().getAttribute('aria-expanded')).toBe('false');
  await act(async()=>trigger().click());
  expect(menu()?.getAttribute('aria-label')).toBe('内容类型');expect(root.querySelector('[role=option][aria-selected=true]')?.textContent).toBe('影视');
  await act(async()=>root.querySelectorAll<HTMLElement>('[role=option]')[2]!.click());
  expect(changed).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledWith('music');expect(trigger().textContent).toBe('音乐');expect(menu()).toBeNull();expect(document.activeElement).toBe(trigger());
});

it('uses arrows, Home, End and Enter while skipping disabled options',async()=>{
  const changed=vi.fn();await act(async()=>render(<Fixture changed={changed}/>,root));
  await key('ArrowDown');await key('ArrowDown');
  expect(root.querySelector('[data-active=true]')?.textContent).toBe('音乐');
  await key('End');expect(root.querySelector('[data-active=true]')?.textContent).toBe('有声书');
  await key('Home');expect(root.querySelector('[data-active=true]')?.textContent).toBe('影视');
  await key('ArrowDown');await key('Enter');expect(changed).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledWith('music');expect(menu()).toBeNull();
  await key('End');expect(root.querySelector('[data-active=true]')?.textContent).toBe('有声书');
  await key('Escape');await key('Home');expect(root.querySelector('[data-active=true]')?.textContent).toBe('影视');
});

it('dismisses without changing on Escape, outside pointer and focus leaving',async()=>{
  const changed=vi.fn();await act(async()=>render(<Fixture changed={changed}/>,root));
  await key('ArrowDown');await key('End');await key('Escape');expect(menu()).toBeNull();
  await act(async()=>trigger().click());await act(async()=>{document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));});expect(menu()).toBeNull();
  await act(async()=>trigger().click());await act(async()=>{document.body.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));});expect(menu()).toBeNull();
  expect(changed).not.toHaveBeenCalled();expect(trigger().textContent).toBe('影视');
});

it('supports type-ahead and never selects a disabled item',async()=>{
  const changed=vi.fn();await act(async()=>render(<MediaSelect aria-label="来源" onChange={event=>changed(event.currentTarget.value)}><option value="a">Alpha</option><option value="b" disabled>Beta</option><option value="g">Gamma</option></MediaSelect>,root));
  await key('g');expect(root.querySelector('[data-active=true]')?.textContent).toBe('Gamma');
  await act(async()=>root.querySelector<HTMLElement>('[aria-disabled=true]')!.click());expect(changed).not.toHaveBeenCalled();expect(menu()).not.toBeNull();
  await key('Enter');expect(changed).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledWith('g');
});

it('preserves native form submission, default value and reset',async()=>{
  await act(async()=>render(<form><label>访问范围<MediaSelect name="access" defaultValue="restricted"><option value="all">所有用户</option><option value="restricted">仅管理员</option></MediaSelect></label></form>,root));
  const form=root.querySelector('form')!;
  expect(trigger().getAttribute('aria-label')).toBe('访问范围');expect(new FormData(form).get('access')).toBe('restricted');
  await act(async()=>trigger().click());await key('Home');await key('Enter');expect(new FormData(form).get('access')).toBe('all');
  await act(async()=>form.reset());expect(new FormData(form).get('access')).toBe('restricted');expect(trigger().textContent).toBe('仅管理员');
});

it('redirects the wrapping label to the custom menu instead of activating the native popup',async()=>{
  await act(async()=>render(<label>媒体库<MediaSelect defaultValue="all"><option value="all">全部媒体库</option><option value="home">家庭影院</option></MediaSelect></label>,root));
  await act(async()=>root.querySelector('label')!.click());expect(menu()).not.toBeNull();expect(document.activeElement).toBe(trigger());
  await act(async()=>root.querySelectorAll<HTMLElement>('[role=option]')[1]!.click());expect(menu()).toBeNull();expect(trigger().textContent).toBe('家庭影院');
});

it('focuses the visible control and explains required validation',async()=>{
  await act(async()=>render(<form><MediaSelect aria-label="媒体库" name="library" required defaultValue=""><option value="">请选择</option><option value="library">家庭影院</option></MediaSelect></form>,root));
  await act(async()=>expect(root.querySelector('form')!.checkValidity()).toBe(false));
  expect(document.activeElement).toBe(trigger());expect(trigger().getAttribute('aria-invalid')).toBe('true');expect(root.querySelector('[role=alert]')?.textContent).not.toBe('');
  await key('ArrowDown');await key('End');await key('Enter');expect(root.querySelector('form')!.checkValidity()).toBe(true);expect(root.querySelector('[role=alert]')).toBeNull();
});

it('closes when disabled and keeps the native field out of the tab order',async()=>{
  const draw=(disabled:boolean)=>render(<MediaSelect disabled={disabled} aria-label="版本"><option value="a">原版</option></MediaSelect>,root);
  await act(async()=>draw(false));await act(async()=>trigger().click());expect(menu()).not.toBeNull();
  await act(async()=>draw(true));expect(menu()).toBeNull();expect(trigger().disabled).toBe(true);
  const select=root.querySelector('select')!;expect(select.tabIndex).toBe(-1);expect(select.getAttribute('aria-hidden')).toBe('true');
});

it('fits near a viewport edge and opens upward when there is little room below',async()=>{
  await act(async()=>render(<Fixture/>,root));
  vi.spyOn(trigger(),'getBoundingClientRect').mockReturnValue({left:930,right:1020,top:730,bottom:774,width:90,height:44,x:930,y:730,toJSON(){}});
  await act(async()=>trigger().click());
  const box=menu()!;expect(parseFloat(box.style.left)+parseFloat(box.style.width)).toBeLessThanOrEqual(window.innerWidth-8);expect(parseFloat(box.style.top)).toBeLessThan(730);expect(parseFloat(box.style.maxHeight)).toBeLessThanOrEqual(320);
});
