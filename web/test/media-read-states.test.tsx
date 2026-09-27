// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {MediaScreen} from '../src/media/screen.tsx';

const call=(name:string,state:object,...args:unknown[])=>Reflect.apply(Reflect.get(MediaScreen.prototype,name),state,args);
const deferred=()=>{let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

it('shows personal loading in the target page, hides stale records on errors, and recovers with GET only',async()=>{
  const first=deferred(),request=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({items:[],total:0});
  const state={personalSequence:0,personal:null,personalLoading:false,personalFailed:false,personalRequest:null,channel:'music',favorites:[],activity:[],favoriteTotal:0,historyTotal:0,abort:new AbortController(),api:{request},draw:vi.fn(),personalPage:(...args:unknown[])=>call('personalPage',state,...args),personalEmpty:()=> 'empty'};
  const pending=call('loadPersonal',state,'favorites',60);expect(state.personal).toBe('favorites');expect(state.personalLoading).toBe(true);
  const root=document.createElement('div');act(()=>render(call('personalView',state) as Parameters<typeof render>[0],root));expect(root.querySelector('.media-read-loading-list')).not.toBeNull();expect(root.querySelectorAll('.media-skeleton-entry')).toHaveLength(6);
  first.reject(Error('offline'));await expect(pending).rejects.toThrow('offline');expect(state.personalFailed).toBe(true);expect(call('personalView',state)).toBeNull();
  await call('loadPersonal',state,'favorites',60);expect(state.personalFailed).toBe(false);expect(state.personalLoading).toBe(false);expect(request.mock.calls.every(args=>args[1]==='GET')).toBe(true);
  act(()=>render(null,root));
});

it('aborts personal reads on return and ignores a late response',async()=>{
  const pending=deferred(),request=vi.fn().mockReturnValue(pending.promise);
  const state={personalSequence:0,personal:null,personalLoading:false,personalFailed:false,channel:'music',favorites:[],activity:[],favoriteTotal:0,historyTotal:0,abort:new AbortController(),api:{request},draw:vi.fn(),personalPage:(...args:unknown[])=>call('personalPage',state,...args)};
  const read=call('loadPersonal',state,'history');call('leavePersonal',state);expect(request.mock.calls[0]![3].aborted).toBe(true);
  pending.resolve({items:[{id:'old'}],total:1});await read;expect(state.personal).toBeNull();expect(state.activity).toEqual([]);expect(state.personalLoading).toBe(false);
});

it('does not let a superseded catalog response replace the chosen library',async()=>{
  const pending=deferred(),items=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({items:[{id:'new'}],total:1});
  const state={catalogRequest:0,catalogLoading:false,catalogFailed:false,foldersOpen:false,kind:'movie',libraries:[{id:'a'},{id:'b'}],libraryId:'a',channel:'video',query:'',offset:0,trackSort:'default',abort:new AbortController(),api:{items},items:[{id:'old'}],total:1,draw:vi.fn()};
  const older=call('load',state);expect(state.catalogLoading).toBe(true);state.libraryId='b';await call('load',state);
  expect(items.mock.calls[0]![4].aborted).toBe(true);pending.resolve({items:[{id:'stale'}],total:30});await older;
  expect(state.items).toEqual([{id:'new'}]);expect(state.total).toBe(1);expect(state.catalogLoading).toBe(false);
});

it('reports an unavailable history part instead of passing a negative index to playback',async()=>{
  const state={api:{detail:vi.fn().mockResolvedValue({title:'旧作品',editions:[{parts:[{id:'part',available:false}]}]})},abort:new AbortController(),player:{play:vi.fn()}};
  await expect(call('playHistory',state,{itemId:'work',partId:'part'})).rejects.toThrow('资源已不可用');expect(state.player.play).not.toHaveBeenCalled();
});
it('does not carry the catalog item count into folder browsing and keeps multi-library selection',async()=>{
  const root=document.createElement('div');
  const state={foldersOpen:true,libraries:[{id:'a',name:'库一'}],libraryId:'a',kind:'movie',channel:'video',catalogLoading:false,catalogFailed:false,preferences:{showContinue:false},total:99,api:{request:vi.fn().mockResolvedValue({path:'',total:0,items:[]})},librarySelector:()=> <select aria-label="媒体库"><option>库一</option><option>库二</option></select>};
  try{
    await act(async()=>render(call('browseView',state) as Parameters<typeof render>[0],root));
    expect(root.textContent).not.toContain('99 项');expect(root.querySelector('.media-browse-tools')).toBeNull();
    state.libraries.push({id:'b',name:'库二'});await act(async()=>render(call('browseView',state) as Parameters<typeof render>[0],root));
    expect(root.querySelector('[aria-label="媒体库"]')).not.toBeNull();expect(root.textContent).not.toContain('99 项');expect(root.querySelector('.media-folders')).not.toBeNull();
  }finally{act(()=>render(null,root));}
});
it('returns full work details to their folder only within the original account and channel',()=>{
  let scope='account-a';const api={preferenceScope:()=>scope},navigate=vi.fn(),location={path:'Book',offset:60,assetId:'asset',editions:{item:'version'},chapters:{}};
  const state={api,navigate,channel:'audiobook',libraryId:'books',itemId:'item',folderReturn:()=>call('folderReturn',state)};
  call('openFolderDetail',state,'item',location);expect(navigate).toHaveBeenLastCalledWith('audiobook','item');
  expect(call('backToFolder',state)).toBe(true);expect(navigate).toHaveBeenLastCalledWith('audiobook');expect(state.folderReturn()).toMatchObject({restore:true,location,libraryId:'books'});
  scope='account-b';expect(state.folderReturn()).toBeUndefined();expect(call('backToFolder',state)).toBe(false);
  scope='account-a';state.channel='music';expect(state.folderReturn()).toBeUndefined();
});

it('keeps saved queue editing mounted during a refresh and through read failure recovery',async()=>{
  const root=document.createElement('div'),pending=deferred(),request=vi.fn().mockReturnValueOnce(pending.promise);
  const entry={id:'queue',itemId:'item',libraryId:'music',partId:'part',assetId:'asset',title:'曲目',partTitle:'曲目',start:0,end:60,available:1};
  const state={personal:'queue',personalSequence:0,personalLoading:false,personalFailed:false,channel:'music',libraries:[{id:'music'}],activity:[entry],abort:new AbortController(),api:{request},busy:false,draw:()=>render(call('personalView',state) as Parameters<typeof render>[0],root),savedQueueView:()=>call('savedQueueView',state),personalEmpty:()=>null};
  try{
    act(()=>state.draw());act(()=>root.querySelector<HTMLButtonElement>('[aria-label="编辑队列"]')!.click());expect(root.querySelector('[aria-label="移除 曲目"]')).not.toBeNull();
    let reading!:Promise<unknown>;act(()=>{reading=call('loadPersonal',state,'queue') as Promise<unknown>;});
    expect(root.querySelector('[aria-label="移除 曲目"]')).not.toBeNull();pending.reject(Error('offline'));await expect(reading).rejects.toThrow('offline');
    request.mockResolvedValueOnce({items:[entry]});await act(async()=>{await call('loadPersonal',state,'queue');});
    expect(root.querySelector('[aria-label="移除 曲目"]')).not.toBeNull();
  }finally{act(()=>render(null,root));}
});
