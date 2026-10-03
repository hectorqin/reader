import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {act} from 'react';

import {MediaChildList} from '../src/media/child-list.tsx';
import type {Item} from '../src/media/api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const items:Item[]=Array.from({length:125},(_,index)=>({id:String(index),libraryId:'lib',kind:'album',title:'专辑'+String(index+1).padStart(3,'0'),parentId:'artist',metadata:{},overrides:{}}));
const draw=(values:Item[])=>render(<MediaChildList items={values} label="专辑" renderItems={rows=><div>{rows.map(row=><button key={row.id} data-item={row.id}>{row.title}</button>)}</div>}/>,root);
const click=async(name:string)=>act(async()=>{Array.from(root.querySelectorAll('button')).find(button=>button.textContent===name)!.click();});
it('keeps all child items reachable and resets pagination when searching',async()=>{
  await act(async()=>draw(items));
  expect(root.querySelectorAll('[data-item]')).toHaveLength(60);
  await click('下一页');expect(root.querySelector('[data-item]')!.textContent).toBe('专辑061');
  await click('下一页');expect(root.querySelectorAll('[data-item]')).toHaveLength(5);
  await act(async()=>{const input=root.querySelector('input')!;input.value='专辑001';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.querySelectorAll('[data-item]')).toHaveLength(1);
  expect(root.querySelector('[data-item]')!.textContent).toBe('专辑001');
  expect(root.querySelector('nav')).toBeNull();
});
it('clamps a page after child removal and preserves the provided order',async()=>{
  await act(async()=>draw(items));await click('下一页');await click('下一页');
  await act(async()=>draw(items.slice(0,61).reverse()));
  expect(root.querySelectorAll('[data-item]')).toHaveLength(1);
  expect(root.querySelector('[data-item]')!.textContent).toBe('专辑001');
  await act(async()=>{const input=root.querySelector('input')!;input.value='不存在';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.textContent).toContain('没有匹配的专辑。');
});
