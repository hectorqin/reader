// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {SeasonPlayback,SeriesSeasons} from '../src/media/season-playback.tsx';
import type {MediaApi} from '../src/media/api.ts';

it('plays from a grid tile and waits for a version choice before starting ambiguous episodes',async()=>{
  const root=document.createElement('div');document.body.append(root);
  const edition=(id:string)=>({id,label:id,parts:[{id,assetId:id,title:id,start:0,end:30,available:true}]});
  const episodes=[{id:'one',title:'第一集',editions:[edition('one')]},{id:'two',title:'第二集',editions:[edition('original'),edition('dubbed')]},{id:'three',title:'第三集',editions:[edition('three')]}];
  const request=vi.fn().mockResolvedValue({episodes}),onPlay=vi.fn().mockResolvedValue(undefined);
  try{
    await act(async()=>render(<SeasonPlayback id="season" layout="grid" api={{request} as unknown as MediaApi} onPlay={onPlay} onDetail={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelectorAll('.media-episode-grid button')).toHaveLength(3));
    await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="播放 第二集"]')!.click());
    expect(onPlay).not.toHaveBeenCalled();expect(root.textContent).toContain('需要选择版本');
    act(()=>{const select=root.querySelector('select')!;select.value='dubbed';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>root.querySelector<HTMLButtonElement>('.media-primary')!.click());
    expect(onPlay.mock.calls[0]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(['dubbed','three']);
    await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="播放 第三集"]')!.click());
    expect(onPlay.mock.calls[1]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(['three']);
  }finally{act(()=>render(null,root));root.remove();}
});

it('switches seasons without carrying the previous season selection or accepting late responses',async()=>{
  const root=document.createElement('div');document.body.append(root);
  const seasons=['one','two'].map(id=>({id,title:id,kind:'season',libraryId:'lib',parentId:'series',metadata:{},overrides:{}}));
  let resolveFirst:(value:unknown)=>void=()=>{};
  const request=vi.fn((path:string)=>path.includes('/one/')?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve({episodes:[{id:'second',title:'第二季第一集',editions:[]}]}));
  try{
    await act(async()=>render(<SeriesSeasons seasons={seasons} api={{request} as unknown as MediaApi} onPlay={vi.fn()} onDetail={vi.fn()}/>,root));
    await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
    await act(async()=>{const select=root.querySelector<HTMLSelectElement>('[aria-label="选择季"]')!;select.value='two';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await vi.waitFor(()=>expect(root.textContent).toContain('第二季第一集'));
    await act(async()=>resolveFirst({episodes:[{id:'old',title:'第一季迟到结果',editions:[]}]}));
    expect(root.textContent).not.toContain('第一季迟到结果');expect(root.textContent).toContain('第二季第一集');
  }finally{act(()=>render(null,root));root.remove();}
});

it('retries playback with the chosen start and edition without fetching the list again',async()=>{
  const root=document.createElement('div');document.body.append(root);
  const edition=(id:string)=>({id,label:id,parts:[{id,assetId:id,title:id,start:0,end:30,available:true}]});
  const episodes=[{id:'first',title:'第一集',editions:[edition('first')]},{id:'second',title:'第二集',editions:[edition('original'),edition('alternate')]}];
  const request=vi.fn().mockResolvedValue({episodes});
  const onPlay=vi.fn().mockRejectedValueOnce(new Error('播放连接失败')).mockResolvedValue(undefined);
  try{
    await act(async()=>render(<SeasonPlayback id="show" api={{request} as unknown as MediaApi} onPlay={onPlay} onDetail={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelectorAll('.media-season-row')).toHaveLength(2));
    await act(async()=>{
      const start=root.querySelector<HTMLInputElement>('[aria-label="从 第二集 开始"]')!;
      start.checked=true;start.dispatchEvent(new Event('change',{bubbles:true}));
      const version=root.querySelector('select')!;version.value='alternate';version.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await act(async()=>{Array.from(root.querySelectorAll('button')).find(button=>button.textContent==='顺序播放 1 集')!.click();});
    expect(root.querySelector('[role=alert]')!.textContent).toContain('播放连接失败');
    await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
    expect(onPlay).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[1]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(['alternate']);
    expect(root.querySelector<HTMLInputElement>('[aria-label="从 第二集 开始"]')!.checked).toBe(true);
    expect(root.querySelector('select')!.value).toBe('alternate');expect(root.querySelector('[role=alert]')).toBeNull();
  }finally{act(()=>render(null,root));root.remove();}
});

it.each(['season','series'] as const)('does not show an empty %s after a read failure and recovers without playing',async scope=>{
  const root=document.createElement('div');document.body.append(root);
  const episodes=[{id:'episode',title:'恢复的第一集',editions:[]}];
  const request=vi.fn().mockRejectedValueOnce(new Error('选集服务暂不可用')).mockResolvedValue({episodes});
  const onPlay=vi.fn();
  try{
    await act(async()=>render(<SeasonPlayback id="show" scope={scope} api={{request} as unknown as MediaApi} onPlay={onPlay} onDetail={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('选集服务暂不可用'));
    expect(root.textContent).not.toContain('暂无剧集');
    expect(root.textContent).not.toContain('没有匹配的集数');
    expect(root.querySelector('.media-season-list')).toBeNull();
    await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
    await vi.waitFor(()=>expect(root.querySelector('.media-season-row')?.textContent).toContain('恢复的第一集'));
    expect(request).toHaveBeenCalledTimes(2);expect(onPlay).not.toHaveBeenCalled();
    expect(root.querySelector('[role=alert]')).toBeNull();
  }finally{act(()=>render(null,root));root.remove();}
});

it.each(['season','series'] as const)('searches and pages a long %s without changing the selected start or playback order',async(scope)=>{
  const root=document.createElement('div');document.body.append(root);
  const episodes=Array.from({length:120},(_,index)=>({id:String(index),title:`Episode ${String(index+1).padStart(3,'0')}`,editions:[{id:'e'+index,label:'默认',parts:[{id:'p'+index,assetId:'a'+index,title:'视频',start:0,end:30,available:true}]}]}));
  const onPlay=vi.fn().mockResolvedValue(undefined);
  const request=vi.fn(async(_path:string)=>({episodes}));
  try{
    await act(async()=>render(<SeasonPlayback id="season" scope={scope} api={{request} as unknown as MediaApi} onPlay={onPlay} onDetail={()=>{}}/>,root));
    await vi.waitFor(()=>expect(root.querySelectorAll('.media-season-row')).toHaveLength(50));
    expect(request.mock.calls[0]?.[0]).toBe('items/season/'+scope+'-playback');
    const button=(label:string)=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent===label)!;
    act(()=>button('下一页').click());
    const start=root.querySelector<HTMLInputElement>('[aria-label="从 Episode 061 开始"]')!;
    act(()=>{start.checked=true;start.dispatchEvent(new Event('change',{bubbles:true}));});
    const search=root.querySelector<HTMLInputElement>('input[type=search]')!;
    act(()=>{search.value='120';search.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(root.querySelectorAll('.media-season-row')).toHaveLength(1);
    await act(async()=>button('顺序播放 60 集').click());
    expect(onPlay.mock.calls[0]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(Array.from({length:60},(_,i)=>'p'+(i+60)));
    act(()=>button('定位起播集').click());
    expect(search.value).toBe('');
    expect(root.querySelector<HTMLInputElement>('[aria-label="从 Episode 061 开始"]')!.checked).toBe(true);
    expect(root.querySelectorAll('.media-season-row')).toHaveLength(50);
  }finally{act(()=>render(null,root));root.remove();}
});
