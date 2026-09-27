// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {MediaFavorites,favoriteChannel} from '../src/media/favorites.tsx';
import {MediaScreen} from '../src/media/screen.tsx';
import type {Item,MediaApi} from '../src/media/api.ts';

const root=document.createElement('div');document.body.append(root);
const dialogShow=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal'),dialogClose=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
afterEach(()=>{act(()=>render(null,root));vi.restoreAllMocks();for(const [key,descriptor] of [['showModal',dialogShow],['close',dialogClose]] as const){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,key,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,key);}});
const item=(kind:string):Item=>({id:kind,kind,title:kind,libraryId:'library',parentId:null,metadata:{},overrides:{}});

it('opens mixed favorite types in their own channels and keeps the list free of tabs',()=>{
  const onOpen=vi.fn(),items=['movie','series','album','artist','track','audiobook'].map(item);
  act(()=>render(<MediaFavorites api={{} as MediaApi} items={items} total={items.length} offset={0} scope="all" busy={false} onScope={vi.fn()} onPage={vi.fn()} onOpen={onOpen}/>,root));
  expect(root.textContent).toContain('6 项收藏');expect(root.querySelector('[role=tablist]')).toBeNull();
  const rows=root.querySelectorAll<HTMLButtonElement>('.media-favorite-row');expect(rows).toHaveLength(items.length);
  rows.forEach((row,index)=>{act(()=>row.click());expect(onOpen).toHaveBeenLastCalledWith(items[index]);});
  expect(items.map(favoriteChannel)).toEqual(['video','video','music','music','music','audiobook']);
  expect(rows[0]!.querySelector('svg')).not.toBeNull();
});

it('places type filtering in a dismissible dialog and can recover an empty filter',()=>{
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
  const onScope=vi.fn();
  act(()=>render(<MediaFavorites api={{} as MediaApi} items={[]} total={0} offset={0} scope="music" busy={false} onScope={onScope} onPage={vi.fn()} onOpen={vi.fn()}/>,root));
  expect(root.textContent).toContain('暂无这类收藏');
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="筛选收藏"]')!.click());
  const dialog=root.querySelector('dialog')!;expect(dialog.getAttribute('aria-label')).toBe('收藏类型');
  expect(dialog.querySelector('[aria-pressed=true]')?.textContent).toBe('音乐');
  act(()=>[...dialog.querySelectorAll('button')].find(button=>button.textContent==='有声书')!.click());
  expect(onScope).toHaveBeenLastCalledWith('audiobook');expect(root.querySelector('dialog')).toBeNull();
  act(()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='查看全部收藏')!.click());
  expect(onScope).toHaveBeenLastCalledWith('all');
});

it('filters and paginates on the server so types beyond the first page remain reachable',async()=>{
  const request=vi.fn().mockResolvedValue({items:[],total:120});
  const state={location:{params:{scope:'audiobook'}},channel:'video',api:{request},abort:new AbortController()};
  await Reflect.apply(Reflect.get(MediaScreen.prototype,'personalPage'),state,['favorites',60]);
  expect(request).toHaveBeenCalledWith('favorites?channel=audiobook&offset=60&limit=60','GET',undefined,state.abort.signal);
  state.location.params.scope='all';await Reflect.apply(Reflect.get(MediaScreen.prototype,'personalPage'),state,['favorites',0]);
  expect(request).toHaveBeenLastCalledWith('favorites?offset=0&limit=60','GET',undefined,state.abort.signal);
});
