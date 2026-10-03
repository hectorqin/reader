import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {ScrapeJobs} from '../src/features/media/components/scrape-jobs.tsx';
import type {MediaApi} from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
async function expandJob(){
  await vi.waitFor(()=>expect(root.querySelector('.media-task-history details')).not.toBeNull());
  await act(async()=>{const details=root.querySelector<HTMLDetailsElement>('.media-task-history details')!;details.open=true;details.dispatchEvent(new Event('toggle'));});
}
it('loads compact job pages only on expansion, discards stale filters and retries reads without writes',async()=>{
  const job={id:'compact',provider:'tmdb',state:'complete',items:[],total:65,counts:{review:64,failed:1}};
  let delayed:((value:unknown)=>void)|undefined,failedOnce=true;
  const request=vi.fn(async(path:string,method?:string,_body?:unknown,_signal?:AbortSignal):Promise<any>=>{
    if(path==='metadata/providers')return {items:[]};
    if(path==='scrape-jobs?summary=true')return {items:[job]};
    if(method==='POST')return {id:'retry'};
    const params=new URLSearchParams(path.split('?')[1]);
    if(params.get('state')==='review')return new Promise(resolve=>{delayed=resolve;});
    if(params.get('state')==='failed'){
      if(failedOnce){failedOnce=false;throw Error('network');}
      return {items:[{itemId:'failed',title:'待重试作品',state:'failed',channel:'video'}],total:1};
    }
    return {items:[{itemId:params.get('offset'),title:'第'+params.get('offset')+'项',state:'review',channel:'video'}],total:65};
  });
  await act(async()=>render(<ScrapeJobs api={{request,items:async()=>({items:[],total:0})} as unknown as MediaApi} libraries={[]} navigate={vi.fn()}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('已结束 65/65 项'));
  expect(request.mock.calls.some(call=>call[0].includes('/results?'))).toBe(false);
  await expandJob();await vi.waitFor(()=>expect(root.textContent).toContain('第0项'));
  const button=(name:string)=>[...root.querySelectorAll('button')].find(node=>node.textContent===name)!;
  await act(async()=>button('下一页结果').click());await vi.waitFor(()=>expect(root.textContent).toContain('第50项'));
  const select=async(value:string)=>act(async()=>{const node=root.querySelector<HTMLSelectElement>('[aria-label="结果状态"]')!;node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));});
  await select('review');await vi.waitFor(()=>expect(delayed).toBeDefined());
  const staleSignal=request.mock.calls.find(call=>call[0].includes('state=review'))![3]!;
  await select('failed');await vi.waitFor(()=>expect(root.textContent).toContain('任务结果读取失败'));
  expect(staleSignal.aborted).toBe(true);expect(root.textContent).not.toContain('当前没有此状态的结果');
  await act(async()=>delayed!({items:[{itemId:'old',title:'迟到结果',state:'review'}],total:64}));
  expect(root.textContent).not.toContain('迟到结果');
  await act(async()=>button('重新读取结果').click());await vi.waitFor(()=>expect(root.textContent).toContain('待重试作品'));
  expect(request.mock.calls.filter(call=>call[1]==='POST')).toHaveLength(0);
  await act(async()=>button('重试未完成项').click());
  expect(request).toHaveBeenCalledWith('scrape-jobs/compact/retry','POST',{});
  const resultRequests=request.mock.calls.filter(call=>call[0].includes('/results?'));
  const activeSignal=resultRequests.at(-1)![3]!;
  await act(async()=>{const details=root.querySelector<HTMLDetailsElement>('.media-task-history details')!;details.open=false;details.dispatchEvent(new Event('toggle'));});
  expect(activeSignal.aborted).toBe(true);expect(root.querySelector('[aria-label="任务结果"]')).toBeNull();
});
it('pages large task results and filters review items without changing retry targets',async()=>{
  const job={id:'large',provider:'tmdb',state:'complete',created_at:1700000000000,items:Array.from({length:65},(_,i)=>({itemId:String(i),title:'作品'+i,state:i===64?'failed':'review',error:null,channel:'video'}))};
  const request=vi.fn(async(path,method)=>path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]}:method==='POST'?{id:'retry'}:{items:[job]});
  const navigate=vi.fn();
  await act(async()=>render(<ScrapeJobs api={{request,items:async()=>({items:[],total:0})} as unknown as MediaApi} libraries={[{id:'lib',name:'电影',kind:'video',access:'all'}]} navigate={navigate}/>,root));
  await expandJob();
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-row')).toHaveLength(50));
  expect(root.querySelector('time')!.dateTime).toBe('2023-11-14T22:13:20.000Z');
  const button=(name:string)=>[...root.querySelectorAll('button')].find(value=>(value.getAttribute('aria-label')||value.textContent)===name)!;
  await act(async()=>button('下一页结果').click());
  expect(root.querySelectorAll('.media-row')).toHaveLength(15);
  await act(async()=>{const select=root.querySelector<HTMLSelectElement>('[aria-label="结果状态"]')!;select.value='failed';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(root.querySelectorAll('.media-row')).toHaveLength(1);
  await act(async()=>button('查看作品').click());expect(navigate).toHaveBeenCalledWith('video','64');
  await act(async()=>{const select=root.querySelector<HTMLSelectElement>('[aria-label="结果状态"]')!;select.value='matched';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(root.textContent).toContain('当前没有此状态的结果');
  await act(async()=>button('重试未完成项').click());
  expect(request).toHaveBeenCalledWith('scrape-jobs','POST',{provider:'tmdb',itemIds:['64']});
});
it('retries failed task reads without losing selected works or repeating writes',async()=>{
  let fail=true;
  const request=vi.fn(async(path,method)=>{
    if(path==='metadata/providers')return {items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]};
    if(path==='scrape-jobs?summary=true'&&method==='GET'&&fail)throw new Error('offline');
    return {items:[]};
  });
  const items=vi.fn(async()=>({items:[{id:'one',title:'第一部'}],total:1}));
  const api={request,items} as unknown as MediaApi;
  const button=(name:string)=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===name)!;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'影视',kind:'video',access:'all'}]} navigate={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('任务状态读取失败'));
  expect(root.textContent).not.toContain('暂无批量刮削任务');
  await vi.waitFor(()=>expect(root.querySelector('input[type=checkbox]')).not.toBeNull());
  await act(async()=>root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(button('开始批量匹配').disabled).toBe(true);
  const reads=items.mock.calls.length;
  fail=false;
  await act(async()=>button('重新读取任务').click());
  await vi.waitFor(()=>expect(root.textContent).toContain('暂无批量刮削任务'));
  expect(root.textContent).not.toContain('任务状态读取失败');
  expect(root.textContent).toContain('已选 1');
  expect(button('开始批量匹配').disabled).toBe(false);
  expect(items.mock.calls).toHaveLength(reads);
  expect(request.mock.calls.some(call=>call[1]==='POST')).toBe(false);
});
it('marks stale results after a successful write and recovers using GET only',async()=>{
  let reads=0;
  const request=vi.fn(async(path,method)=>{
    if(path==='metadata/providers')return {items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]};
    if(method==='POST')return {id:'new-job'};
    if(++reads===2)throw new Error('lost connection');
    return {items:[{id:'job',provider:'tmdb',state:'complete',items:[{itemId:'one',title:'第一部',state:'failed',error:null,channel:'video'}]}]};
  });
  const api={request,items:async()=>({items:[],total:0})} as unknown as MediaApi;
  const button=(name:string)=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===name)!;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'影视',kind:'video',access:'all'}]} navigate={()=>{}}/>,root));
  await expandJob();
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-row')).toHaveLength(1));
  await act(async()=>button('重试未完成项').click());
  await vi.waitFor(()=>expect(root.textContent).toContain('下方为上次读取的结果，可能已变化'));
  expect(button('重试未完成项').disabled).toBe(true);
  expect(root.textContent).toContain('第一部');
  await act(async()=>button('重新读取任务').click());
  await vi.waitFor(()=>expect(button('重试未完成项').disabled).toBe(false));
  expect(request.mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1);
  expect(reads).toBe(3);
});
it('keeps review and unmatched results out of retrying unfinished items',async()=>{
  const states=['matched','review','unmatched','unchanged','failed','cancelled','interrupted'];
  const request=vi.fn(async(path,method)=>path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]}:method==='POST'?{id:'retry'}:{items:[{id:'job',provider:'tmdb',state:'complete',items:states.map(state=>({itemId:state,title:state,state,error:null,channel:'video'}))}]});
  const navigate=vi.fn();
  const api={request,items:async()=>({items:[],total:0})} as unknown as MediaApi;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'电影库',kind:'video',access:'all'}]} navigate={navigate}/>,root));
  await expandJob();
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-row')).toHaveLength(7));
  expect(root.textContent).toContain('待审阅 1 · 无匹配 1');
  expect(root.textContent).toContain('已结束 7/7 项');
  await act(async()=>root.querySelectorAll<HTMLButtonElement>('.media-row button')[2].click());
  expect(navigate).toHaveBeenCalledWith('video','unmatched');
  await act(async()=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='重试未完成项')!.click());
  expect(request).toHaveBeenCalledWith('scrape-jobs','POST',{provider:'tmdb',itemIds:['failed','cancelled','interrupted']});
});
it('selects a compatible provider when switching between video and music libraries',async()=>{
  const request=vi.fn(async(path)=>path==='metadata/providers'?{items:[
    {id:'tmdb',label:'TMDB',configured:true,kinds:['movie']},
    {id:'musicbrainz',label:'MusicBrainz',configured:true,kinds:['album']},
  ]}:{items:[]});
  const items=vi.fn(async(_libraryId:string,_kind:string)=>({items:[{id:'one',title:'作品'}],total:1}));
  const api={request,items} as unknown as MediaApi;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'video',name:'影视',kind:'video',access:'all'},{id:'music',name:'音乐',kind:'music',access:'all'}]} navigate={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(1));
  await act(async()=>root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async()=>{const select=root.querySelector('select')!;select.value='music';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await vi.waitFor(()=>expect(root.querySelectorAll('select')[1].value).toBe('musicbrainz'));
  await vi.waitFor(()=>expect(root.querySelectorAll('select')[2].value).toBe('album'));
  expect(root.textContent).toContain('已选 0');
  expect(items.mock.calls.every(call=>!(call[0]==='music'&&call[1]==='movie'))).toBe(true);
  expect(Array.from(root.querySelectorAll('select')[1].options).map(option=>option.value)).toEqual(['musicbrainz']);
});
it('rechecks an unconfigured compatible source and enables its content types',async()=>{
  let configured=false;
  const request=vi.fn(async(path)=>path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',configured,kinds:['movie']}]}:{items:[]});
  const api={request,items:async()=>({items:[{id:'one',title:'作品'}],total:1})} as unknown as MediaApi;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'影视',kind:'video',access:'all'}]} navigate={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.textContent).toContain('当前媒体库没有已配置的匹配来源'));
  expect(root.querySelectorAll('select')[2].disabled).toBe(true);
  configured=true;
  await act(async()=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='重新检查来源')!.click());
  await vi.waitFor(()=>expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(1));
  expect(root.querySelectorAll('select')[2].disabled).toBe(false);
  expect(root.textContent).not.toContain('当前媒体库没有已配置的匹配来源');
});
it('page selection preserves earlier pages and cancelling a page only removes its works',async()=>{
  const request=vi.fn(async(path,method)=>path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]}:method==='POST'?{id:'job'}:{items:[]});
  const api={request,items:async(_lib:string,_kind:string,_query:string,offset:number)=>({items:offset?[{id:'three',title:'第三部'}]:[{id:'one',title:'第一部'},{id:'two',title:'第二部'}],total:61})} as unknown as MediaApi;
  const button=(name:string)=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===name)!;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'电影库',kind:'video',access:'all'}]} navigate={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(2));
  await act(async()=>button('选择本页').click());
  await act(async()=>button('下一页').click());
  await vi.waitFor(()=>expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(1));
  await act(async()=>button('选择本页').click());
  expect(root.textContent).toContain('已选 3');
  await act(async()=>button('取消本页').click());
  expect(root.textContent).toContain('已选 2');
  await act(async()=>button('开始批量匹配').click());
  expect(request).toHaveBeenCalledWith('scrape-jobs','POST',{provider:'tmdb',itemIds:['one','two']});
});
it('retries provider discovery after failure instead of leaving an unusable form',async()=>{
  let attempts=0;
  const request=vi.fn(async(path)=>{if(path==='metadata/providers'){if(++attempts===1)throw new Error('temporary');return {items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]};}return {items:[]};});
  const api={request,items:async()=>({items:[],total:0})} as unknown as MediaApi;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'电影',kind:'video',access:'all'}]} navigate={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')).not.toBeNull());
  await act(async()=>{Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='刷新')!.click();});
  await vi.waitFor(()=>expect(attempts).toBe(2));
  expect(root.textContent).toContain('TMDB');
});
it('shows job history immediately and submits only selected works',async()=>{
  const request=vi.fn(async(path,method)=>path==='metadata/providers'?{items:[{id:'tmdb',label:'TMDB',configured:true,kinds:['movie']}]}:method==='POST'?{id:'job'}:{items:[]});
  const api={request,items:async()=>({items:[{id:'one',title:'第一部'},{id:'two',title:'第二部'}],total:2})} as unknown as MediaApi;
  await act(async()=>render(<ScrapeJobs api={api} libraries={[{id:'lib',name:'电影库',kind:'video',access:'all'}]} navigate={()=>{}}/>,root));
  expect(request).toHaveBeenCalledWith('scrape-jobs?summary=true','GET',undefined,expect.any(AbortSignal));
  await vi.waitFor(()=>expect(root.querySelectorAll('input[type=checkbox]')).toHaveLength(2));
  await act(async()=>root.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await act(async()=>{Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='开始批量匹配')!.click();});
  expect(request).toHaveBeenCalledWith('scrape-jobs','POST',{provider:'tmdb',itemIds:['one']});
});
