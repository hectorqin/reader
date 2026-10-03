import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { MediaLibraryList, type LibraryListPosition } from '../src/features/media/components/library-list.tsx';
import type { Library, MediaApi } from '../src/features/media/api/media-api.ts';

const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const libraries:Library[]=[{id:'films',name:'电影',kind:'video',access:'all'},{id:'music',name:'唱片',kind:'music',access:'restricted'},{id:'books',name:'故事',kind:'audiobook',access:'all'}];
const summaries=libraries.map((library,index)=>({id:library.id,root:'C:/Media/'+library.name,counts:{movie:6,series:1,album:6,track:12,audiobook:3},chapters:12,missingFiles:index}));
const button=(label:string)=>[...root.querySelectorAll('button')].find(node=>node.textContent===label)!;

it('reports real summaries, retains management when reading fails, and retries only GET',async()=>{
  const request=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({items:summaries}),edit=vi.fn();
  await act(async()=>render(<MediaLibraryList api={{request} as unknown as MediaApi} libraries={libraries} busy={false} position={{query:'',page:0}} onPosition={()=>{}} onEdit={edit} onScan={()=>{}} onJobs={()=>{}} onPermissions={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')).not.toBeNull());
  expect(root.textContent).not.toContain('0 部电影');
  await act(async()=>button('编辑媒体库').click());expect(edit).toHaveBeenCalledWith(libraries[0]);
  await act(async()=>button('重试读取摘要').click());
  await vi.waitFor(()=>expect(root.textContent).toContain('6 部电影 · 1 部剧集'));
  expect(root.textContent).toContain('6 张专辑 · 12 首曲目');expect(root.textContent).toContain('3 部作品 · 12 章（全部版本）');expect(root.querySelectorAll('.media-library-footer')[2]?.textContent).toContain('2 个文件缺失');
  expect(root.querySelector('.media-library-directory')?.getAttribute('title')).toBe('C:/Media/电影');
  expect(request.mock.calls.map(call=>call[1])).toEqual(['GET','GET']);
});

it('filters by actual directory, paginates many libraries and ignores results after unmount',async()=>{
  const many=Array.from({length:65},(_,i)=>({...libraries[0]!,id:String(i),name:'电影 '+i}));
  const request=vi.fn().mockResolvedValue({items:many.map(lib=>({id:lib.id,root:'C:/Media/'+lib.id,counts:{},chapters:0,missingFiles:0}))});
  const api={request} as unknown as MediaApi;let position:LibraryListPosition={query:'',page:0};
  const draw=()=>render(<MediaLibraryList api={api} libraries={many} busy={false} position={position} onPosition={next=>{position=next;draw();}} onEdit={()=>{}} onScan={()=>{}} onJobs={()=>{}} onPermissions={()=>{}}/>,root);
  await act(async()=>draw());await vi.waitFor(()=>expect(root.textContent).toContain('C:/Media/0'));
  expect(root.querySelectorAll('.media-library-row')).toHaveLength(30);
  await act(async()=>button('下一页').click());expect(root.textContent).toContain('电影 30');expect(root.textContent).not.toContain('电影 0');
  await act(async()=>{const input=root.querySelector('input')!;input.value='C:/Media/64';input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(root.querySelectorAll('.media-library-row')).toHaveLength(1);expect(root.textContent).toContain('电影 64');expect(position.page).toBe(0);
  const signal=request.mock.calls[0]![3] as AbortSignal;await act(async()=>render(null,root));expect(signal.aborted).toBe(true);
});
