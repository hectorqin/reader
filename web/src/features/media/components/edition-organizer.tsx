import {MediaSelect} from './select.tsx';
import {mediaActionError} from './action-error.ts';
import { useEffect, useRef, useState } from 'react';
import type { Detail, Edition, MediaApi } from '../api/media-api.ts';

export function EditionOrganizer({api,item,edition,onUpdated}:{api:MediaApi;item:Detail;edition:Edition;onUpdated:(detail:Detail)=>void}) {
  const [mode,setMode]=useState<'split'|'merge'>('split'),[name,setName]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[targetId,setTargetId]=useState('');
  const [preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[]);
  const assets=[...new Set(edition.parts.map(part=>part.assetId))].map(id=>({id,parts:edition.parts.filter(part=>part.assetId===id)}));
  const filtered=assets.filter(asset=>asset.parts.some(part=>part.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const pages=Math.max(1,Math.ceil(filtered.length/50)),current=Math.min(page,pages-1);
  const target=item.editions.find(entry=>entry.id===targetId),others=item.editions.filter(entry=>entry.id!==edition.id);
  const valid=!!edition.revision&&(mode==='split'?!!name.trim()&&selected.length>0&&selected.length<assets.length&&selected.length<=2000:!!target?.revision);
  async function save(){
    const signal=abort.current?.signal;if(!valid||busy||!preview||!signal||signal.aborted)return;
    setBusy(true);setError('');
    try{
      const body=mode==='split'?{expectedRevision:edition.revision,assetIds:selected,label:name.trim()}:{expectedRevision:edition.revision,targetEditionId:target!.id,targetRevision:target!.revision};
      const result=await api.request<Detail>(`editions/${encodeURIComponent(edition.id)}/${mode}`,'POST',body,signal);
      if(!signal.aborted){setPreview(false);setSelected([]);setTargetId('');onUpdated(result);}
    }catch(reason){if(!signal.aborted)setError(mediaActionError(reason,'整理失败，请刷新后核对版本'));}
    finally{if(!signal.aborted)setBusy(false);}
  }
  return <section aria-label="拆分或合并版本" className="media-edition-organizer">
    <p>只调整版本与文件的关联，保留章节、进度和队列。内嵌章节随整份文件一起移动。</p>
    <label>整理方式<MediaSelect aria-label="整理方式" value={mode} disabled={busy||preview} onChange={event=>{setMode(event.currentTarget.value as 'split'|'merge');setError('');}}><option value="split">拆成新版本</option><option value="merge">合并到已有版本</option></MediaSelect></label>
    {!preview&&mode==='split'&&<>
      <label>新版本名称<input value={name} maxLength={200} disabled={busy} onInput={event=>setName(event.currentTarget.value)}/></label>
      <p>已选 {selected.length} / {assets.length} 个文件，原版本至少保留一个文件。</p>
      {assets.length>10&&<label>查找文件章节<input value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label>}
      {filtered.slice(current*50,(current+1)*50).map(asset=><label key={asset.id} className="media-row"><input type="checkbox" checked={selected.includes(asset.id)} onChange={event=>setSelected(event.currentTarget.checked?[...selected,asset.id]:selected.filter(id=>id!==asset.id))}/><span>{asset.parts[0]?.title}<small>{asset.parts.length} 节 · {asset.parts.every(part=>part.available)?'可用':'资源缺失'}{asset.parts.length>1?` · 至 ${asset.parts[asset.parts.length-1]?.title}`:''}</small></span></label>)}
      {pages>1&&<nav className="media-toolbar" aria-label="整理文件分页"><button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>下一页</button></nav>}
    </>}
    {!preview&&mode==='merge'&&<><label>目标版本<MediaSelect aria-label="目标版本" value={targetId} onChange={event=>setTargetId(event.currentTarget.value)}><option key="empty" value="">请选择版本</option>{others.map(entry=><option key={entry.id} value={entry.id}>{entry.label} · {entry.parts.length} 节</option>)}</MediaSelect></label>{!others.length&&<p>当前作品没有其他版本。</p>}<p>合并保留目标版本名称；存在手工排序时保留目标顺序并追加源版本，否则按扫描编号排序；原版本移除，文件不会拼接或转码。</p></>}
    {!preview&&<button disabled={!valid||busy} onClick={()=>setPreview(true)}>预览整理结果</button>}
    {preview&&<section aria-label="确认版本整理"><h3>{mode==='split'?`从“${edition.label}”拆出“${name.trim()}”`:`将“${edition.label}”合并到“${target?.label}”`}</h3><p>{mode==='split'?`移动 ${selected.length} 个文件、${edition.parts.filter(part=>selected.includes(part.assetId)).length} 节；原版本保留 ${assets.length-selected.length} 个文件。`:`合并后共 ${edition.parts.length+(target?.parts.length||0)} 节。目标版本名称保留，原版本移除。`}</p><button disabled={busy||!valid} onClick={()=>void save()}>确认整理</button><button disabled={busy} onClick={()=>{setPreview(false);setError('');}}>返回修改</button></section>}
    {error&&<p className="media-error" role="alert">{error}</p>}
  </section>;
}
