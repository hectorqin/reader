import {mediaActionError} from './action-error.ts';
import {useEffect,useRef,useState} from '../ui/vendor/preact.ts';
import type {Detail,Item,MediaApi} from './api.ts';
import {ApiError} from '../api/errors.ts';

export function MusicParentEditor({api,item,onUpdated}:{api:MediaApi;item:Detail;onUpdated:(item:Detail)=>void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [items,setItems]=useState<Item[]>([]),[total,setTotal]=useState(0),[target,setTarget]=useState<Item|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [conflict,setConflict]=useState(false);
  const [newTitle,setNewTitle]=useState(''),[newPreview,setNewPreview]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const kind=item.kind==='track'?'album':'artist',label=kind==='album'?'专辑':'歌手';
  useEffect(()=>()=>pending.current?.abort(),[]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setBusy(true);setError('');setItems([]);setTarget(null);setNewPreview(false);
    void api.items(item.libraryId,kind,search,offset,controller.signal).then(result=>{
      if(!controller.signal.aborted){setItems(result.items);setTotal(result.total);}
    }).catch(reason=>{if(!controller.signal.aborted)setError(mediaActionError(reason,'读取目标失败'));})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[api,item.id,item.parentId,item.libraryId,kind,open,search,offset,attempt]);
  if(!['track','album'].includes(item.kind))return null;
  const save=async()=>{
    if((!target&&!newPreview)||busy||conflict||pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{
      const updated=await api.request<Detail>('items/'+item.id+'/parent',newPreview?'POST':'PUT',newPreview?{title:newTitle.trim(),expectedParentId:item.parentId}:{targetParentId:target!.id,expectedParentId:item.parentId},controller.signal);
      if(!controller.signal.aborted){setTarget(null);setNewPreview(false);setNewTitle('');setOpen(false);onUpdated(updated);}
    }catch(reason){if(!controller.signal.aborted){setError(mediaActionError(reason,'归属保存失败'));if(reason instanceof ApiError&&reason.code==='MEDIA_PARENT_CHANGED'){setConflict(true);setTarget(null);setNewPreview(false);}}}
    finally{pending.current=null;if(!controller.signal.aborted)setBusy(false);}
  };
  const refresh=async()=>{
    if(busy||pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{const updated=await api.detail(item.id,controller.signal);if(!controller.signal.aborted){setTarget(null);setConflict(false);onUpdated(updated);setAttempt(value=>value+1);}}
    catch(reason){if(!controller.signal.aborted)setError(mediaActionError(reason,'读取当前归属失败'));}
    finally{pending.current=null;if(!controller.signal.aborted)setBusy(false);}
  };
  return <section className="media-parent-editor">
    <button disabled={busy} onClick={()=>setOpen(value=>!value)}>{open?'收起归属整理':'调整所属'+label}</button>
    {open&&<>
      <h2>调整所属{label}</h2><p>只调整同一媒体库中的分组，不移动文件、不修改标签或在线匹配。版本和播放进度保留，重新扫描不会撤销这次整理。</p>
      <form className="media-search" onSubmit={event=>{event.preventDefault();setSearch(query.trim());setOffset(0);setAttempt(value=>value+1);}}><input aria-label={'查找目标'+label} value={query} maxLength={200} disabled={busy} onInput={event=>setQuery(event.currentTarget.value)}/><button disabled={busy}>查找</button></form>
      {error&&<p className="media-error" role="alert">{error}{!conflict&&<button disabled={busy} onClick={()=>setAttempt(value=>value+1)}>重新读取目标</button>}</p>}
      {conflict&&<p role="status">当前归属已变化，请先刷新，再重新选择目标。<button disabled={busy} onClick={()=>void refresh()}>刷新当前归属</button></p>}
      {busy&&<p role="status">正在处理归属…</p>}
      {newPreview?<div className="media-parent-preview"><p>新建{label}“{newTitle.trim()}”，并将“{item.title}”归入其中。</p><p>{kind==='album'?'新专辑沿用原专辑的歌手。':''}同名条目不会自动合并；确认后一起保存。</p><button disabled={busy||conflict} onClick={()=>void save()}>确认新建并调整归属</button><button disabled={busy} onClick={()=>setNewPreview(false)}>取消新建</button></div>:target?<div className="media-parent-preview"><p>将“{item.title}”归入“{target.title}”。</p><button disabled={busy||conflict} onClick={()=>void save()}>确认调整归属</button><button disabled={busy} onClick={()=>setTarget(null)}>重新选择</button></div>:items.map(candidate=><div className="media-row" key={candidate.id}><span>{candidate.title}<small>{String(candidate.overrides.artist??candidate.metadata.artist??'')}{candidate.id===item.parentId?' · 当前归属':''}</small></span><button disabled={busy||conflict||candidate.id===item.parentId} onClick={()=>{setNewPreview(false);setTarget(candidate);}}>选择</button></div>)}
      {!target&&!newPreview&&<form className="media-search" onSubmit={event=>{event.preventDefault();if(!busy&&!conflict&&newTitle.trim()){setTarget(null);setNewPreview(true);}}}><input aria-label={'新建'+label+'名称'} value={newTitle} maxLength={200} disabled={busy||conflict} onInput={event=>setNewTitle(event.currentTarget.value)}/><button disabled={busy||conflict||!newTitle.trim()}>预览新建{label}</button></form>}
      {!newPreview&&!target&&!busy&&!error&&!items.length&&<p>未找到同库{label}，请调整搜索词。</p>}
      {total>60&&!target&&!newPreview&&<nav className="media-toolbar"><button disabled={busy||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-60))}>上一页</button><span>{Math.floor(offset/60)+1} / {Math.ceil(total/60)}</span><button disabled={busy||offset+60>=total} onClick={()=>setOffset(value=>value+60)}>下一页</button></nav>}
    </>}
  </section>;
}
