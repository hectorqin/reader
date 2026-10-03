import {MediaSelect} from './select.tsx';
import {mediaActionError} from './action-error.ts';
import { useEffect, useRef, useState } from 'react';
import {ApiError} from '../../../api/errors.ts';
import type {Detail,Item,MediaApi} from '../api/media-api.ts';

export function VideoHierarchyEditor({api,item,onUpdated}:{api:MediaApi;item:Detail;onUpdated:(item:Detail)=>void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[attempt,setAttempt]=useState(0);
  const [shows,setShows]=useState<Item[]>([]),[total,setTotal]=useState(0),[show,setShow]=useState<Detail|null>(null),[target,setTarget]=useState<Item|null>(null);
  const [number,setNumber]=useState(String(item.ordinal??'')),[preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const [creating,setCreating]=useState(false),[seriesTitle,setSeriesTitle]=useState(''),[seasonNumber,setSeasonNumber]=useState('1');
  const pending=useRef<AbortController|null>(null),isSeason=item.kind==='season',label=isSeason?'季':'集';
  useEffect(()=>()=>pending.current?.abort(),[]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setBusy(true);setError('');setShows([]);setShow(null);setTarget(null);setPreview(false);setCreating(false);setNumber(String(item.ordinal??''));
    void api.items(item.libraryId,'series',search,offset,controller.signal).then(result=>{if(!controller.signal.aborted){setShows(result.items);setTotal(result.total);}})
      .catch(reason=>{if(!controller.signal.aborted)setError(mediaActionError(reason,'读取剧集失败'));})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[api,item.id,item.parentId,item.ordinal,item.libraryId,open,search,offset,attempt]);
  if(!['season','episode'].includes(item.kind))return null;
  const valid=/^\d+$/.test(number)&&Number(number)>=(isSeason?0:1)&&Number(number)<=(isSeason?9999:99999);
  const validCreate=(!!show||!!seriesTitle.trim())&&(isSeason||/^\d+$/.test(seasonNumber)&&Number(seasonNumber)<=9999);
  const run=async(operation:(signal:AbortSignal)=>Promise<void>)=>{
    if(busy||pending.current)return;const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{await operation(controller.signal);}catch(reason){if(!controller.signal.aborted){setError(mediaActionError(reason,'整理失败'));if(reason instanceof ApiError&&reason.code==='MEDIA_PARENT_CHANGED'){setConflict(true);setPreview(false);setTarget(null);}}}
    finally{pending.current=null;if(!controller.signal.aborted)setBusy(false);}
  };
  const select=(candidate:Item)=>void run(async signal=>{
    const detail=await api.detail(candidate.id,signal);if(signal.aborted)return;setShow(detail);setTarget(isSeason?detail:null);
  });
  const save=()=>void run(async signal=>{
    if((creating?!validCreate:!target)||!valid||conflict||item.ordinal===undefined)return;
    const base={ordinal:Number(number),expectedParentId:item.parentId,expectedOrdinal:item.ordinal};
    const body=creating?{...base,...(show?{targetSeriesId:show.id}:{seriesTitle:seriesTitle.trim()}),...(!isSeason?{seasonOrdinal:Number(seasonNumber)}:{})}:{...base,targetParentId:target!.id};
    const updated=await api.request<Detail>('items/'+item.id+'/hierarchy',creating?'POST':'PUT',body,signal);
    if(!signal.aborted){setOpen(false);setPreview(false);onUpdated(updated);}
  });
  return <section className="media-parent-editor">
    <button disabled={busy} onClick={()=>setOpen(value=>!value)}>{open?'收起季集整理':'调整归属与'+label+'号'}</button>
    {open&&<><h2>整理{isSeason?'季':'单集'}</h2><p>保留文件、版本与播放进度。修改后清除{isSeason?'本季及其单集':'本集'}的 TMDB 匹配和候选，需要重新确认；人工元数据保留。已有相同编号时不会自动合并。</p>
      {error&&<p className="media-error" role="alert">{error}</p>}
      {conflict?<p role="status">归属或编号已变化。<button disabled={busy} onClick={()=>void run(async signal=>{const updated=await api.detail(item.id,signal);if(!signal.aborted){setConflict(false);onUpdated(updated);setAttempt(value=>value+1);}})}>刷新当前归属</button></p>:<>
        {preview&&(target||creating)?<div className="media-parent-preview"><p>{creating?'新建目标后，将':'将'}“{item.title}”归入“{show?.title??seriesTitle.trim()}{!isSeason?' / '+(creating?'第 '+Number(seasonNumber)+' 季':target?.title):''}”，编号改为第 {Number(number)} {label}。</p><p>本操作不移动文件，也不自动更改标题。{creating?'创建与归属调整一起保存，同名剧集不自动合并。':''}</p><button disabled={busy} onClick={save}>确认季集整理</button><button disabled={busy} onClick={()=>setPreview(false)}>返回选择</button></div>:creating?<>
          {show?<p>所属剧集：{show.title}</p>:<label>新剧集名称<input aria-label="新剧集名称" maxLength={200} disabled={busy} value={seriesTitle} onInput={event=>setSeriesTitle(event.currentTarget.value)}/></label>}
          {!isSeason&&<label>新季号<input aria-label="新季号" type="number" min={0} max={9999} disabled={busy} value={seasonNumber} onInput={event=>setSeasonNumber(event.currentTarget.value)}/></label>}
          <label>{label}号<input aria-label={label+'号'} type="number" min={isSeason?0:1} max={isSeason?9999:99999} disabled={busy} value={number} onInput={event=>setNumber(event.currentTarget.value)}/></label>
          <button disabled={busy||!valid||!validCreate||item.ordinal===undefined} onClick={()=>setPreview(true)}>预览新建归属</button><button disabled={busy} onClick={()=>{setCreating(false);setPreview(false);}}>取消新建</button>
        </>:<>
          <form className="media-search" onSubmit={event=>{event.preventDefault();setSearch(query.trim());setOffset(0);setAttempt(value=>value+1);}}><input aria-label="查找目标剧集" placeholder="输入目标剧集名称" disabled={busy} value={query} onInput={event=>setQuery(event.currentTarget.value)} maxLength={200}/><button disabled={busy}>查找剧集</button></form>
          {!show?shows.map(candidate=><div className="media-row" key={candidate.id}><span>{candidate.title}</span><button disabled={busy} onClick={()=>select(candidate)}>选择剧集</button></div>):<><p>目标剧集：{show.title} <button disabled={busy} onClick={()=>{setShow(null);setTarget(null);}}>重新选择剧集</button></p>{!isSeason&&<label>目标季<MediaSelect aria-label="目标季" disabled={busy} value={target?.id??''} onChange={event=>setTarget(show.children.find(child=>child.id===event.currentTarget.value)??null)}><option value="">请选择</option>{show.children.filter(child=>child.kind==='season').map(child=><option key={child.id} value={child.id}>{child.title}（第 {child.ordinal} 季）</option>)}</MediaSelect></label>}</>}
          {!show&&total>60&&<nav className="media-toolbar"><button disabled={busy||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-60))}>上一页</button><span>{Math.floor(offset/60)+1} / {Math.ceil(total/60)}</span><button disabled={busy||offset+60>=total} onClick={()=>setOffset(value=>value+60)}>下一页</button></nav>}
          {!busy&&!error&&!shows.length&&<p>没有匹配的剧集，请调整搜索词。</p>}
          {(!show||!isSeason)&&<button disabled={busy} onClick={()=>{setTarget(null);setCreating(true);}}>{show?'新建季并整理':'新建剧集并整理'}</button>}
          {target&&<><label>{label}号<input aria-label={label+'号'} type="number" min={isSeason?0:1} max={isSeason?9999:99999} value={number} disabled={busy} onInput={event=>setNumber(event.currentTarget.value)}/></label><button disabled={busy||!valid||item.ordinal===undefined} onClick={()=>setPreview(true)}>预览季集整理</button></>}
        </>}
      </>}{busy&&<p role="status">正在处理…</p>}
    </>}
  </section>;
}
