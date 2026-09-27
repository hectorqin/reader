// @vitest-environment jsdom
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {MediaScreen} from '../src/media/screen.tsx';
import type {Detail,Part} from '../src/media/api.ts';

const host=document.createElement('div');document.body.append(host);
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};});
afterEach(()=>render(null,host));
const part=(id:string,available=true):Part=>({id,assetId:id,title:id,start:0,end:60,available});
const detail:Detail={id:'film',libraryId:'lib',parentId:null,title:'电影',kind:'movie',metadata:{},overrides:{},children:[],editions:[{id:'one',label:'国语版',parts:[part('missing',false),part('mandarin')]},{id:'two',label:'原声版',parts:[part('original')]}]};

it('plays only the selected version and switches its chapters without mixing editions',async()=>{
  const play=vi.fn(async(_entries:Array<{part:Part}>,_index:number)=>{}),queue=vi.fn(async()=>{});
  const context={selectedEditionId:'',channel:'video',favorite:false,busy:false,admin:false,api:{request:vi.fn().mockResolvedValue({})},player:{play},cover:()=>null,
    run:async(action:()=>Promise<void>)=>action(),enqueue:queue,toggleFavorite:vi.fn(),draw:()=>mount()};
  const mount=()=>render(Reflect.apply(Reflect.get(MediaScreen.prototype,'detailView'),context,[detail]),host);
  act(()=>mount());expect(host.querySelectorAll('.media-edition')).toHaveLength(1);expect(host.textContent).toContain('国语版');
  const primary=()=>host.querySelector<HTMLButtonElement>('.media-detail-actions .media-primary')!;
  await act(async()=>primary().click());expect(play.mock.calls[0]![0].map((entry:{part:Part})=>entry.part.id)).toEqual(['mandarin']);
  act(()=>host.querySelector<HTMLButtonElement>('[data-media-versions]')!.click());
  act(()=>{const select=host.querySelector<HTMLSelectElement>('select[aria-label="播放版本"]')!;select.value='two';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host.querySelector('.media-resource-panel>p')?.textContent).toContain('原声版');expect(host.querySelector('.media-edition')).toBeNull();
  await act(async()=>primary().click());expect(play.mock.calls[1]![0].map((entry:{part:Part})=>entry.part.id)).toEqual(['original']);
});

it('disables primary playback for a missing edition and falls back after an edition is removed',()=>{
  let current={...detail,editions:[{id:'gone',label:'缺失版',parts:[part('missing',false)]}]};
  const context={selectedEditionId:'gone',channel:'video',favorite:false,busy:false,admin:false,api:{request:vi.fn().mockResolvedValue({})},player:{play:vi.fn()},cover:()=>null};
  const mount=()=>render(Reflect.apply(Reflect.get(MediaScreen.prototype,'detailView'),context,[current]),host);
  act(()=>mount());expect(host.querySelector('.media-detail-actions .media-primary')).toBeNull();expect(host.querySelector('.media-state-page')?.textContent).toContain('文件暂不可用');expect(context.player.play).not.toHaveBeenCalled();
  current={...detail,editions:[detail.editions[1]!]};act(()=>mount());
  expect(host.querySelector('.media-resource-panel>p')?.textContent).toContain('原声版');expect(host.querySelector('.media-edition')).toBeNull();expect(host.querySelector<HTMLButtonElement>('.media-primary')?.disabled).toBe(false);
});
