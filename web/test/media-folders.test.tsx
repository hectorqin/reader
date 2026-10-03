import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaFolders,type FolderLocation} from '../src/media/folders.tsx';
import type {MediaApi} from '../src/media/api.ts';
import {ApiError} from '../src/api/errors.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const button=(text:string)=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent?.includes(text))!;
it('parent directory navigation stays in folders even when a global history callback is provided',async()=>{
  const request=vi.fn().mockResolvedValue({total:0,items:[]}),onBack=vi.fn(),onLocationChange=vi.fn();
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" initialLocation={{path:'动画/剧集/第一季',offset:60,assetId:null,editions:{},chapters:{}}} onLocationChange={onLocationChange} onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await act(async()=>button('上级目录').click());
  await vi.waitFor(()=>expect(onLocationChange).toHaveBeenLastCalledWith(expect.objectContaining({path:'动画/剧集',offset:0,assetId:null})));
  expect(onBack).not.toHaveBeenCalled();
});
it('only administrators see directory cleanup',async()=>{
  const request=vi.fn().mockResolvedValue({total:0,items:[]});
  const props={api:{request} as unknown as MediaApi,libraryId:'lib',onPlay:vi.fn(),onQueue:vi.fn(),onDetail:vi.fn()};
  await act(async()=>render(<MediaFolders {...props}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('暂无已扫描'));
  expect(button('清理失效资源')).toBeUndefined();
  await act(async()=>render(<MediaFolders {...props} admin/>,root));
  expect(button('清理失效资源')).toBeDefined();
});
it('opens a folder and file, plays its chapters and returns to the same directory',async()=>{
  const parts=[{id:'p',assetId:'a',title:'第一章',start:0,end:10,available:true}];
  const request=vi.fn(async(path:string)=>path.startsWith('assets/')?{assetId:'a',path:'Book/one.m4b',available:true,items:[{id:'item',title:'作品',editions:[{id:'e',label:'版本',parts}]}]}:new URLSearchParams(path.split('?')[1]).get('path')==='Book'?{total:1,items:[{name:'one.m4b',path:'Book/one.m4b',kind:'file',assetId:'a',files:1,availableFiles:1,size:100}]}:{total:1,items:[{name:'Book',path:'Book',kind:'folder',files:1,availableFiles:1,size:100}]});
  const onPlay=vi.fn().mockResolvedValue(undefined),onQueue=vi.fn().mockResolvedValue(undefined);
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" onPlay={onPlay} onQueue={onQueue} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('Book')).toBeDefined());await act(async()=>button('Book').click());
  await vi.waitFor(()=>expect(button('one.m4b')).toBeDefined());await act(async()=>button('one.m4b').click());
  await vi.waitFor(()=>expect(root.querySelector('[aria-label="播放"]')).not.toBeNull());await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="播放"]')!.click());
  expect(onPlay).toHaveBeenCalledWith(parts,0,'作品');
  await act(async()=>button('加入队列').click());expect(onQueue).toHaveBeenCalledWith(['p']);
  await act(async()=>button('返回文件列表').click());await vi.waitFor(()=>expect(button('one.m4b')).toBeDefined());
});
it('selects only one file edition and keeps it visible after an uncertain queue write',async()=>{
  const parts=[{id:'p',assetId:'a',title:'第一章',start:0,end:10,available:true}],alternate=[{...parts[0]!,id:'alt',title:'修订章'}];
  const entry={name:'one.m4b',path:'one.m4b',kind:'file',assetId:'a',files:1,availableFiles:1,size:100};
  const request=vi.fn(async(path:string)=>path.startsWith('assets/')?{assetId:'a',path:entry.path,available:true,items:[{id:'item',title:'作品',kind:'audiobook',editions:[{id:'e',label:'原版',parts},{id:'alt',label:'修订版',parts:alternate}]}]}:{total:1,items:[entry]});
  const onPlay=vi.fn().mockResolvedValue(undefined),onQueue=vi.fn().mockRejectedValue(new ApiError('offline','Failed to fetch'));
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" onPlay={onPlay} onQueue={onQueue} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('one.m4b')).toBeDefined());await act(async()=>button('one.m4b').click());
  await vi.waitFor(()=>expect(root.querySelector('select')).not.toBeNull());
  await act(async()=>{const select=root.querySelector('select')!;select.value='alt';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(root.querySelectorAll('.media-edition')).toHaveLength(1);expect(root.querySelectorAll('.media-resource-info')).toHaveLength(1);
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="播放"]')!.click());expect(onPlay).toHaveBeenCalledWith(alternate,0,'作品');
  await act(async()=>button('加入队列').click());expect(onQueue).toHaveBeenCalledOnce();expect(onQueue).toHaveBeenCalledWith(['alt']);expect(request).toHaveBeenCalledTimes(2);
  expect(root.querySelector('[role=alert]')?.textContent).toContain('先到待播队列核对');expect(root.textContent).not.toContain('Failed to fetch');
  expect(root.querySelector('select')!.value).toBe('alt');expect(root.querySelector('[role=alert] button')).toBeNull();expect(root.querySelector('.media-folder-file-layout')).not.toBeNull();
});
it('keeps the file route after a denied read and returns to the clamped directory page if its contents shrink',async()=>{
  const entry={name:'last.mp3',path:'last.mp3',kind:'file',assetId:'last',files:1,availableFiles:1,size:100};let failFile=true,shrink=false;
  const request=vi.fn(async(path:string)=>{if(path.startsWith('assets/')){if(failFile)throw new ApiError('forbidden','库权限已撤销','LIBRARY_FORBIDDEN',403);return {assetId:'last',path:entry.path,available:true,items:[]};}return {total:shrink?1:61,items:new URLSearchParams(path.split('?')[1]).get('offset')==='60'&&shrink?[]:[entry]};});
  const onPlay=vi.fn();await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" onPlay={onPlay} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('下一页')).toBeDefined());await act(async()=>button('下一页').click());
  await vi.waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('offset=60'));await act(async()=>button('last.mp3').click());
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('暂时无法访问这部作品'));expect(root.querySelector('.media-folder-row')).toBeNull();
  failFile=false;await act(async()=>button('重新加载').click());await vi.waitFor(()=>expect(root.querySelector('.media-folder-file-heading')).not.toBeNull());
  expect(request.mock.calls.at(-1)![0]).toBe('assets/last/catalog');expect(onPlay).not.toHaveBeenCalled();
  shrink=true;await act(async()=>button('返回文件列表').click());await vi.waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('offset=0'));
  await vi.waitFor(()=>expect(button('last.mp3')).toBeDefined());expect(root.querySelector('[aria-label="文件分页"]')).toBeNull();
});
it('ignores a late failed folder response after navigating back to the root',async()=>{
  let reject!:(error:Error)=>void;
  const request=vi.fn((path:string)=>new URLSearchParams(path.split('?')[1]).get('path')?new Promise((_resolve,no)=>reject=no):Promise.resolve({total:1,items:[{name:'目录',path:'目录',kind:'folder',assetId:null,files:1,availableFiles:1,size:0}]}));
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('.media-folder-row button')).not.toBeNull());await act(async()=>root.querySelector<HTMLButtonElement>('.media-folder-row button')!.click());
  await vi.waitFor(()=>expect(root.querySelector('.media-read-loading-list')).not.toBeNull());
  await act(async()=>button('库内根目录').click());await vi.waitFor(()=>expect(root.querySelector('.media-folder-row')).not.toBeNull());
  await act(async()=>reject(new Error('过期的失败')));expect(root.querySelector('[role=alert]')).toBeNull();expect(root.querySelector('.media-folder-row')).not.toBeNull();
});
it('restores the file version and chapter page when returning from a full work detail',async()=>{
  const location:FolderLocation={path:'Book',offset:60,assetId:'file',editions:{item:'second'},chapters:{second:{query:'',page:1}}};
  const parts=Array.from({length:61},(_,i)=>({id:'p'+i,assetId:'file',title:'章节 '+(i+1),start:0,end:10,available:true}));
  const request=vi.fn().mockResolvedValue({assetId:'file',path:'Book/book.m4b',available:true,items:[{id:'item',title:'作品',kind:'audiobook',editions:[{id:'first',label:'原版',parts:parts.slice(0,1)},{id:'second',label:'修订版',parts}]}]});
  const onDetail=vi.fn();
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" initialLocation={location} onPlay={vi.fn()} onQueue={vi.fn()} onDetail={onDetail}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-edition .media-row')).toHaveLength(11));
  expect(root.querySelector('select')!.value).toBe('second');expect(root.querySelector('.media-part-copy')?.textContent).toContain('章节 51');
  await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="完整作品详情"]')!.click());expect(onDetail).toHaveBeenCalledWith('item',location);
  await act(async()=>button('返回文件列表').click());await vi.waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('offset=60'));
});
it('retries failures and aborts requests on exit',async()=>{
  const request=vi.fn().mockRejectedValueOnce(new Error('无权限')).mockResolvedValue({total:0,items:[]});
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('无权限'));
  await act(async()=>button('重新加载').click());await vi.waitFor(()=>expect(root.textContent).toContain('暂无已扫描'));
  const signal=request.mock.calls[1]![3] as AbortSignal;act(()=>render(null,root));expect(signal.aborted).toBe(true);
});
it('pages a large directory and keeps the page when returning from a file',async()=>{
  const request=vi.fn(async(path:string)=>path.startsWith('assets/')?{assetId:'last',path:'last.mp3',available:false,items:[]}:{total:61,items:[{name:'last.mp3',path:'last.mp3',kind:'file',assetId:'last',files:1,availableFiles:0,size:1}]});
  await act(async()=>render(<MediaFolders api={{request} as unknown as MediaApi} libraryId="lib" onPlay={vi.fn()} onQueue={vi.fn()} onDetail={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(button('下一页')).toBeDefined());await act(async()=>button('下一页').click());
  await vi.waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('offset=60'));
  await vi.waitFor(()=>expect(button('last.mp3')).toBeDefined());await act(async()=>button('last.mp3').click());
  await vi.waitFor(()=>expect(root.textContent).toContain('文件已缺失'));
  await act(async()=>button('返回文件列表').click());await vi.waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('offset=60'));
});
