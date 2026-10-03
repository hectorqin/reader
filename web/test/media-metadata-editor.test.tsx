import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { MetadataEditor } from '../src/media/metadata-editor.tsx';
import type { Detail, MediaApi } from '../src/media/api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const item:Detail={id:'book',libraryId:'lib',kind:'audiobook',title:'原题',parentId:null,metadata:{title:'本地标题',year:2024,author:'原作者'},overrides:{title:'原题'},editions:[],children:[]};
const submit=async()=>{await act(async()=>{root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});};
it('discards a late save after the detail was refreshed and allows editing the new detail',async()=>{
  let resolve!:(value:Detail)=>void;
  const request=vi.fn().mockImplementationOnce(()=>new Promise<Detail>(done=>{resolve=done;})).mockResolvedValue(item);
  const updated=vi.fn(),api={request} as unknown as MediaApi;
  await act(async()=>render(<MetadataEditor api={api} item={item} onUpdated={updated}/>,root));
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="作者"]')!;input.value='旧请求作者';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await submit();
  const signal=request.mock.calls[0]![3] as AbortSignal;
  const refreshed:Detail={...item,metadata:{...item.metadata,author:'新详情作者'}};
  await act(async()=>render(<MetadataEditor api={api} item={refreshed} onUpdated={updated}/>,root));
  expect(signal.aborted).toBe(true);
  expect(root.querySelector<HTMLInputElement>('[aria-label="作者"]')!.disabled).toBe(false);
  await act(async()=>resolve({...item,overrides:{...item.overrides,author:'旧请求作者'}}));
  expect(updated).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLInputElement>('[aria-label="作者"]')!.value).toBe('新详情作者');
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="作者"]')!;input.value='新请求作者';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await submit();expect(request).toHaveBeenCalledTimes(2);expect(updated).toHaveBeenCalledOnce();
});
it('only patches edited fields and explicitly clears an override',async()=>{
  const request=vi.fn(async()=>item),updated=vi.fn();
  await act(async()=>render(<MetadataEditor api={{request} as unknown as MediaApi} item={item} onUpdated={updated}/>,root));
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="作者"]')!;input.value='新作者';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await submit();
  expect(request.mock.calls[0]).toEqual(['items/book/metadata','PATCH',{author:'新作者'},expect.any(AbortSignal)]);
  await act(async()=>{Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='撤销人工修正')!.click();});
  await submit();
  expect(request.mock.calls[1]).toEqual(['items/book/metadata','PATCH',{title:null},expect.any(AbortSignal)]);
  expect(updated).toHaveBeenCalledTimes(2);
});
it('keeps edits after failure and rejects invalid years without sending',async()=>{
  const request=vi.fn(async()=>{throw new Error('网络错误');});
  await act(async()=>render(<MetadataEditor api={{request} as unknown as MediaApi} item={item} onUpdated={()=>{}}/>,root));
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="年份"]')!;input.value='oops';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await submit();expect(request).not.toHaveBeenCalled();
  await act(async()=>{const input=root.querySelector<HTMLInputElement>('[aria-label="年份"]')!;input.value='2025';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await submit();expect(root.querySelector('[role=alert]')!.textContent).toBe('网络错误');
  expect(root.querySelector<HTMLInputElement>('[aria-label="年份"]')!.value).toBe('2025');
});
it('previews the underlying source on reset without writing and allows keeping the override',async()=>{
  const request=vi.fn();
  const online:Detail={...item,metadata:{...item.metadata,title:'在线标题',sources:{title:'tmdb',author:'tag'}}};
  await act(async()=>render(<MetadataEditor api={{request} as unknown as MediaApi} item={online} onUpdated={()=>{}}/>,root));
  expect(root.textContent).toContain('当前来源：人工修正');
  expect(root.textContent).toContain('当前来源：文件内嵌标签');
  expect(root.textContent).toContain('当前来源：来源未标注');
  expect(root.textContent).toContain('当前来源：暂无信息');
  await act(async()=>{Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='撤销人工修正')!.click();});
  const title=root.querySelector<HTMLInputElement>('[aria-label="标题"]')!;
  expect(title.value).toBe('在线标题');expect(title.disabled).toBe(true);
  expect(root.textContent).toContain('保存后恢复：TMDB 在线资料');expect(request).not.toHaveBeenCalled();
  await act(async()=>{Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='保留人工修正')!.click();});
  expect(title.value).toBe('原题');expect(title.disabled).toBe(false);
  await submit();expect(request).not.toHaveBeenCalled();
});
