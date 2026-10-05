import {MediaSelect} from './select.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import type { Detail, MediaApi, Narrator, Part } from '../api/media-api.ts';
import { MediaCover } from './cover.tsx';
import { EditionDetails } from './edition-details.tsx';
import {PersonPortrait} from './person-portrait.tsx';
import {ChevronLeft,Play,ArrowUpRight} from 'lucide-react';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';

export interface NarratorLocation {libraryId:string;name:string|null;search:string;offset:number;workId:string;editionId:string}

/** Version membership comes from asset credits, never a work's last scanned tag. */
export function Narrators({api,libraryId,showLibraryName=true,onPlay,onQueue,onDetail,libraryControl,initialLocation,onLocationChange,onBack}:{api:MediaApi;libraryId:string;showLibraryName?:boolean;onPlay:(parts:Part[],index:number,title:string)=>Promise<void>;onQueue:(ids:string[])=>Promise<void>;onDetail:(id:string)=>void;libraryControl?:ReactNode;initialLocation?:NarratorLocation;onLocationChange?:(location:NarratorLocation)=>void;onBack?:()=>void}) {
  const initial=initialLocation?.libraryId===libraryId?initialLocation:undefined;
  const [name,setName]=useState<string|null>(initial?.name||null),[search]=useState('');
  const [offset,setOffset]=useState(initial?.offset??0),[total,setTotal]=useState(0),[retry,setRetry]=useState(0);
  const [narrators,setNarrators]=useState<Narrator[]>([]),[works,setWorks]=useState<Detail[]>([]),[selectedId,setSelectedId]=useState(initial?.workId??'');
  const [editionId,setEditionId]=useState(initial?.editionId??'');
  const [busy,setBusy]=useState(true),[acting,setActing]=useState(false),[error,setError]=useState('');
  const selected=works.find(work=>work.id===selectedId);
  useEffect(()=>onLocationChange?.({libraryId,name,search,offset,workId:selectedId,editionId}),[libraryId,name,search,offset,selectedId,editionId,onLocationChange]);
  useEffect(()=>{
    const abort=new AbortController();setBusy(true);setError('');setNarrators([]);setWorks([]);setTotal(0);
    const adjustOffset=(total:number)=>{
      if(offset>0&&offset>=total){setOffset(Math.max(0,Math.floor((total-1)/60)*60));return true;}
      return false;
    };
    void (async()=>{
      try{
        if(name===null){const result=await api.narrators(libraryId,search,offset,abort.signal);if(!abort.signal.aborted&&!adjustOffset(result.total)){setNarrators(result.items);setTotal(result.total);}}
        else{const result=await api.narratorWorks(libraryId,name,offset,abort.signal);if(!abort.signal.aborted&&!adjustOffset(result.total)){setWorks(result.items);setTotal(result.total);setSelectedId(current=>result.items.some(item=>item.id===current)?current:'');}}
      }catch(error){if(!abort.signal.aborted)setError(error instanceof Error?error.message:'无法加载演播者');}
      finally{if(!abort.signal.aborted)setBusy(false);}
    })();
    return ()=>abort.abort();
  },[api,libraryId,name,search,offset,retry]);
  async function action(run:()=>Promise<void>){if(acting)return;setActing(true);setError('');try{await run();}catch(error){setError(error instanceof Error?error.message:'操作失败');}finally{setActing(false);}}
  const edition=selected?.editions.find(entry=>entry.id===editionId)||selected?.editions[0];
  const playable=edition?.parts.filter(part=>part.available)||[];
  return <section className="media-narrators" data-view={selected?'work':name===null?'directory':'person'} aria-label="演播者浏览">
    {name!==null?<header className="media-narrator-heading media-page-heading"><button className="media-back-button" aria-label={selected?'← 返回作品':'← 演播者'} title={selected?'返回作品':'返回演播者'} onClick={()=>{if(onBack){onBack();return;}if(selectedId)setSelectedId('');else{setName(null);setOffset(0);}}}><ChevronLeft size={20} aria-hidden="true"/><span className="media-visually-hidden">{selected?'← 返回作品':'← 演播者'}</span></button><h2>{selected?'演播版本':'演播者详情'}</h2></header>:<div className="media-toolbar media-person-toolbar">{libraryControl}<span>{!busy&&`${total} 位演播者`}</span></div>}

    {error&&<p role="alert">{error}<button onClick={()=>setRetry(retry+1)}>重新加载</button></p>}
    {name!==null&&!selected&&<div className="media-hero media-person-hero"><PersonPortrait name={name}/><div className="media-detail-heading"><small className="media-detail-kind">演播者</small><h1>{name}</h1>{!busy&&!error&&<span className="media-person-count">{total} 部作品</span>}</div></div>}
    {busy&&<FloatingNotice message="正在加载演播者…" busy />}{!busy&&selected?<article className="media-detail-page"><div className="media-hero"><MediaCover api={api} item={selected} square={false}/><div className="media-detail-heading"><small className="media-detail-kind">有声书</small><h1>{selected.title}</h1><p className="media-detail-credit">{name}参与的版本</p></div></div><div className="media-detail-actions"><button className="media-primary" disabled={acting||!playable.length} onClick={()=>void action(()=>onPlay(playable,0,selected.title))}><Play size={17} aria-hidden="true"/>播放此版本</button><button onClick={()=>onDetail(selected.id)}>完整作品详情<ArrowUpRight size={16} aria-hidden="true"/></button>{selected.editions.length>1&&<label className="media-edition-picker">版本<MediaSelect aria-label="演播版本" value={edition?.id} disabled={acting} onChange={event=>setEditionId(event.currentTarget.value)}>{selected.editions.map(entry=><option key={entry.id} value={entry.id}>{entry.label}</option>)}</MediaSelect></label>}</div>{edition&&<EditionDetails key={edition.id} api={api} edition={edition} layout="detail" busy={acting} onPlay={(parts,index)=>void action(()=>onPlay(parts,index,selected.title))} onQueue={ids=>void action(()=>onQueue(ids))}/>}</article>:<>
      {name===null?<div className="media-grid media-people-grid">{narrators.map(narrator=><button className="media-person-tile" key={narrator.name} onClick={()=>{setName(narrator.name);setOffset(0);}}><PersonPortrait name={narrator.name}/><strong title={narrator.name}>{narrator.name}</strong><small>{narrator.works} 部作品 · {narrator.editions} 个版本</small></button>)}</div>:<><h2 className="media-person-works-heading">全部作品</h2><div className="media-grid">{works.map(work=><button className="media-tile" key={work.id} onClick={()=>{setSelectedId(work.id);setEditionId('');}}><MediaCover api={api} item={work} square={false}/><strong>{work.title}</strong>{showLibraryName&&!libraryId&&<small>{work.libraryName}</small>}<small>{work.editions.length} 个相关版本</small></button>)}</div></>}
      {!busy&&!total&&!error&&<p className="media-empty">{name===null?'未找到演播者。已有资料请重新扫描媒体库，并检查文件标签或侧车中的演播者信息。':'此演播者暂无关联作品。'}</p>}
      {total>60&&<nav className="media-toolbar" aria-label="演播者分页"><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-60))}>上一页</button><span>{Math.floor(offset/60)+1} / {Math.ceil(total/60)}</span><button disabled={offset+60>=total} onClick={()=>setOffset(offset+60)}>下一页</button></nav>}
    </>}
  </section>;
}
