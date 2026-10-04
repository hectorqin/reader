import { useEffect, useRef, useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { MediaCover } from './cover.tsx';
import { MediaLoading } from './loading.tsx';
import { MediaScreenError } from './screen-error.tsx';
import type { MediaApi, MediaChannel, SearchItem } from '../api/media-api.ts';
import { newId } from '../../../core/id.ts';

const labels={video:'影视',music:'音乐',audiobook:'有声书'};
const kinds:Record<string,string>={movie:'电影',series:'剧集',season:'季',episode:'单集',album:'专辑',artist:'歌手',track:'曲目',audiobook:'有声书'};
interface SearchReturn { identity:string;channel:MediaChannel;targetChannel:MediaChannel;itemId:string;input:string;query:string;scope:MediaChannel|'all';kind?:string;offset:number;scroll:number;restore?:boolean }
const returns=new WeakMap<MediaApi,SearchReturn>();
const historyEntries=new WeakMap<MediaApi,Map<string,SearchReturn>>();
function tagHistory(key:string,detail:boolean){window.history.replaceState({...window.history.state,readerMediaSearch:{key,detail}},'');}
export function restoreSearchHistory(api:MediaApi,channel:MediaChannel,itemId?:string){
  const marker=window.history.state?.readerMediaSearch;
  if(!marker||typeof marker.key!=='string')return;
  const saved=historyEntries.get(api)?.get(marker.key);
  if(!saved||saved.identity!==api.preferenceScope())return;
  if(itemId?marker.detail&&saved.targetChannel===channel&&saved.itemId===itemId:!marker.detail&&saved.channel===channel){
    returns.set(api,{...saved,restore:!itemId});
  }
}
export function searchReturnFor(api:MediaApi){const saved=returns.get(api);return saved?.identity===api.preferenceScope()?saved:undefined;}
export function clearSearchReturn(api:MediaApi){
  returns.delete(api);
  if(window.history.state?.readerMediaSearch){const state={...window.history.state};delete state.readerMediaSearch;window.history.replaceState(state,'');}
}
export function restoreSearchReturn(api:MediaApi){const saved=searchReturnFor(api);if(saved)saved.restore=true;}

function resultDescription(item:SearchItem):string {
  const field=(key:string)=>{const value=item.overrides[key]??item.metadata[key];return typeof value==='string'||typeof value==='number'?String(value).trim():'';};
  const parts:string[]=[];
  if(['album','track'].includes(item.kind)){const artist=field('artist')||field('albumArtist');if(artist)parts.push(artist);}
  if(item.kind==='audiobook'){
    const author=field('author'),narrator=field('narrator');
    if(author)parts.push('作者 '+author);
    if(narrator)parts.push('演播 '+narrator);
  }
  const year=field('year');if(year)parts.push(year);
  return parts.join(' · ');
}

export function MediaSearch({api,channel,navigate,initialLocation,onLocationChange}:{api:MediaApi;channel:MediaChannel;navigate:(channel:MediaChannel,id:string)=>void;initialLocation?:Record<string,string>|undefined;onLocationChange?:(params:Record<string,string>)=>void}) {
  const saved=searchReturnFor(api),initial=initialLocation?{input:initialLocation.q??'',query:initialLocation.q??'',scope:(['all','music','video','audiobook'].includes(initialLocation.scope??'')?initialLocation.scope:'all') as MediaChannel|'all',offset:Number(initialLocation.offset)||0,scroll:0}:saved?.channel===channel?saved:undefined;
  const host=useRef<HTMLElement>(null);
  const scrollToRestore=useRef(initial?.scroll??null);
  const [input,setInput]=useState(initial?.input??'');
  const [scope,setScope]=useState<MediaChannel|'all'>(initial?.scope??channel);
  const [query,setQuery]=useState(initial?.query??'');
  const [offset,setOffset]=useState(initial?.offset??0);
  useEffect(()=>{if(returns.get(api)===initial)returns.delete(api);},[api,initial]);
  const open=(item:SearchItem)=>{
    const snapshot:SearchReturn={identity:api.preferenceScope(),channel,targetChannel:item.channel,itemId:item.id,input,query,scope,offset,scroll:host.current?.closest('.media-screen')?.scrollTop??0};
    returns.set(api,snapshot);
    const key=newId(),entries=historyEntries.get(api)??new Map<string,SearchReturn>();
    entries.set(key,snapshot);while(entries.size>30)entries.delete(entries.keys().next().value!);historyEntries.set(api,entries);
    const sourceHash='#/media/'+channel;
    if(window.location.hash===sourceHash)tagHistory(key,false);
    navigate(item.channel,item.id);
    if(window.location.hash==='#/media/'+item.channel+'/'+encodeURIComponent(item.id))tagHistory(key,true);
  };
  function change(next:Partial<{q:string;scope:MediaChannel|'all';offset:number}>){onLocationChange?.({q:next.q??query,scope:next.scope??scope,offset:String(next.offset??offset)});}
  const [attempt,setAttempt]=useState(0);
  const [items,setItems]=useState<SearchItem[]>([]);
  const [total,setTotal]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [errorCause,setErrorCause]=useState<unknown>();
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if(!loaded||busy||error||scrollToRestore.current===null)return;
    const screen=host.current?.closest('.media-screen');
    if(screen)screen.scrollTop=scrollToRestore.current;
    scrollToRestore.current=null;
  },[loaded,busy,error,items]);
  useEffect(()=>{
    const controller=new AbortController();
    setItems([]);setTotal(0);setError('');setErrorCause(undefined);setLoaded(false);
    if(!query){setBusy(false);return ()=>controller.abort();}
    setBusy(true);
    let recovering=false;
    void api.search(query,scope,offset,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      if(offset>0&&offset>=result.total){recovering=true;scrollToRestore.current=0;setOffset(0);change({offset:0});return;}
      setItems(result.items);setTotal(result.total);setLoaded(true);
    }).catch(error=>{if(!controller.signal.aborted){setError(error instanceof Error?error.message:'搜索失败');setErrorCause(error);}})
      .finally(()=>{if(!controller.signal.aborted&&!recovering)setBusy(false);});
    return ()=>controller.abort();
  },[api,query,scope,offset,attempt]);
  return <section ref={host} aria-label="影音搜索结果">
    <form className="media-search" role="search" onSubmit={event=>{event.preventDefault();scrollToRestore.current=null;setQuery(input.trim());setOffset(0);change({q:input.trim(),offset:0});setAttempt(value=>value+1);}}>
      <input name="q" aria-label="搜索影音" placeholder="搜索作品、专辑、歌手或曲目" value={input} maxLength={200} onInput={event=>setInput(event.currentTarget.value)}/>
      <button className="media-primary" type="submit" disabled={!input.trim()}>搜索</button>
    </form>
    <nav className="media-search-scopes" aria-label="搜索范围">{(['all','video','music','audiobook'] as const).map(value=><button key={value} type="button" aria-pressed={scope===value} data-scope={value} onClick={()=>{scrollToRestore.current=null;setScope(value);setOffset(0);change({scope:value,offset:0});}}>{value==='all'?'全部':labels[value]}</button>)}</nav>
    {loaded&&!busy&&!error&&<p className="media-search-count media-visually-hidden" role="status">找到 {total} 项内容</p>}
    {busy?<MediaLoading label="正在搜索…" layout="list"/>:error?<MediaScreenError fullPage error={errorCause} message={error} busy={busy} onRetry={()=>setAttempt(value=>value+1)}/>:!query||!items.length?<div className="media-search-empty"><Search size={32} strokeWidth={1.4} aria-hidden="true"/><h2>{query?'没有找到相关内容':'搜索你的影音'}</h2><p>{query?'没有匹配内容，请调整搜索词或搜索范围。':'输入名称，搜索有权访问的媒体库。'}</p>{query&&<button onClick={()=>{setInput('');setQuery('');setOffset(0);change({q:'',offset:0});host.current?.querySelector<HTMLInputElement>('input')?.focus();}}>清空关键词</button>}</div>:<div className="media-search-results">{(['video','music','audiobook'] as const).map(group=>{
      const entries=items.filter(item=>item.channel===group);if(!entries.length)return null;
      return <section key={group} className="media-search-group" aria-label={labels[group]+'搜索结果'}><h2>{labels[group]} <small>{entries.length}{total>60?' · 本页':''}</small></h2>{entries.map(item=><button className="media-search-result" key={item.id} onClick={()=>open(item)}><MediaCover api={api} item={item} square={item.channel==='music'}/><span className="media-search-copy"><strong title={item.title}>{item.title}</strong>{resultDescription(item)&&<small className="media-search-description" title={resultDescription(item)}>{resultDescription(item)}</small>}<small title={(kinds[item.kind]||item.kind)+' · '+item.libraryName}>{kinds[item.kind]||item.kind} · {item.libraryName}</small></span><ChevronRight size={18} aria-hidden="true"/></button>)}</section>;
    })}</div>}
    {total>60&&<div className="media-toolbar"><button disabled={busy||offset===0} onClick={()=>{setOffset(Math.max(0,offset-60));change({offset:Math.max(0,offset-60)});}}>上一页</button><span>{Math.floor(offset/60)+1} / {Math.ceil(total/60)}</span><button disabled={busy||offset+60>=total} onClick={()=>{setOffset(offset+60);change({offset:offset+60});}}>下一页</button></div>}
  </section>;
}
