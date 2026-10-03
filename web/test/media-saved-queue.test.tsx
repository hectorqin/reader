import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { SavedQueue, type SavedQueueEntry } from '../src/media/saved-queue.tsx';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const button=(name:string)=>root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
function setup(count=65){
  const entries:SavedQueueEntry[]=Array.from({length:count},(_,index)=>({id:'entry'+index,itemId:'work'+index,title:'标题'+index,partTitle:'章节'+index,editionLabel:'原版',start:60,end:index===0?null:125,available:index===0?0:1}));
  const props={entries,busy:false,onPlay:vi.fn(),onMove:vi.fn(),onRemove:vi.fn(),onDetail:vi.fn(),onClear:vi.fn()};
  act(()=>render(<SavedQueue {...props}/>,root));return props;
}
it('uses original queue indexes for filtered playback and moving, including unavailable neighbors',()=>{
  const props=setup();
  act(()=>button('查找队列').click());
  act(()=>{const input=root.querySelector('input')!;input.value='标题64';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.querySelectorAll('li')).toHaveLength(1);
  act(()=>button('播放 标题64').click());expect(props.onPlay).toHaveBeenCalledWith(64);
  act(()=>button('编辑队列').click());
  expect(button('下移 标题64').disabled).toBe(true);
  act(()=>button('上移 标题64').click());expect(props.onMove).toHaveBeenCalledWith(64,'up');
  act(()=>button('移除 标题64').click());expect(props.onRemove).toHaveBeenCalledWith('entry64');
  act(()=>button('查找队列').click());expect(root.querySelector('input')).toBeNull();expect(root.querySelectorAll('li')).toHaveLength(50);
  expect(button('播放 标题0').disabled).toBe(true);expect(button('上移 标题0').disabled).toBe(true);
  act(()=>button('上移 标题1').click());expect(props.onMove).toHaveBeenLastCalledWith(1,'up');
});
it('keeps editing controls hidden initially and adapts the last page after removal',()=>{
  const props=setup(51);
  expect(button('移除 标题0')).toBeNull();
  expect(root.querySelector('.media-saved-queue-duration')!.textContent).toBe('');
  expect(root.querySelectorAll('.media-saved-queue-duration')[1].textContent).toBe('1:05');
  act(()=>[...root.querySelectorAll('button')].find(value=>value.textContent==='下一页')!.click());
  expect(root.querySelectorAll('li')).toHaveLength(1);
  act(()=>button('查看 标题50 详情').click());expect(props.onDetail).toHaveBeenCalledWith('work50');
  act(()=>button('清空当前频道队列').click());expect(props.onClear).toHaveBeenCalledTimes(1);
  act(()=>render(<SavedQueue {...props} entries={props.entries.slice(0,50)} busy/>,root));
  expect(root.querySelectorAll('li')).toHaveLength(50);expect(button('播放 标题1').disabled).toBe(true);expect(button('清空当前频道队列').disabled).toBe(true);
  act(()=>button('编辑队列').click());expect(button('移除 标题0').disabled).toBe(true);
});
