import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { ContinuePlaying } from '../src/features/media/components/continue-playing.tsx';
import type { MediaApi } from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const row={libraryId:'books',itemId:'book',partId:'chapter2',title:'长篇作品',partTitle:'第二章',start:30,end:90,position:45,completed:0,available:1};
const parts=[{id:'chapter1',available:true},{id:'chapter2',available:true},{id:'chapter3',available:true}];
it('chooses only available unfinished history in this library and resumes its edition in order',async()=>{
  const request=vi.fn().mockResolvedValue({items:[{...row,libraryId:'films'},{...row,completed:1},{...row,available:0},row]});
  const detail=vi.fn().mockResolvedValue({title:'长篇作品',editions:[{parts}]});
  const onPlay=vi.fn().mockResolvedValue(undefined);
  await act(async()=>render(<ContinuePlaying api={{request,detail} as unknown as MediaApi} libraryId="books" onPlay={onPlay}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('progress')?.value).toBe(15));
  expect(root.querySelector('progress')?.max).toBe(60);
  await act(async()=>root.querySelector('button')!.click());
  expect(onPlay).toHaveBeenCalledWith(parts,1,'长篇作品');
});
it('takes no space when there is no partial playback',async()=>{
  await act(async()=>render(<ContinuePlaying api={{request:async()=>({items:[{...row,position:30}]})} as unknown as MediaApi} libraryId="books" onPlay={vi.fn()}/>,root));
  expect(root.textContent).toBe('');
});
it('continues only across libraries allowed in the active channel',async()=>{
  const request=vi.fn().mockResolvedValue({items:[{...row,libraryId:'films',title:'其他频道'},{...row,libraryId:'books2',title:'跨库续播'}]});
  await act(async()=>render(<ContinuePlaying api={{request} as unknown as MediaApi} libraryId="" libraryIds={['books','books2']} onPlay={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('跨库续播'));
  expect(root.textContent).not.toContain('其他频道');
});
it('does not start playback after leaving the page while details are pending',async()=>{
  let resolve!:(value:unknown)=>void;
  const detail=vi.fn(()=>new Promise(done=>{resolve=done;})),onPlay=vi.fn();
  await act(async()=>render(<ContinuePlaying api={{request:async()=>({items:[row]}),detail} as unknown as MediaApi} libraryId="books" onPlay={onPlay}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('button')).not.toBeNull());
  act(()=>root.querySelector('button')!.click());
  act(()=>render(null,root));
  await act(async()=>resolve({title:'长篇作品',editions:[{parts}]}));
  expect(onPlay).not.toHaveBeenCalled();
});
