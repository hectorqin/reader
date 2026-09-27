import { useEffect, useRef, useState } from '../ui/vendor/preact.ts';
import type { Detail, Edition, Item, MediaApi } from './api.ts';
import {MediaLoading} from './loading.tsx';
import {mediaActionError} from './action-error.ts';

/** Administrator-only correction of a whole edition; chapter IDs stay stable. */
export function EditionAssignment({api,item,edition,onAssigned}:{api:MediaApi;item:Detail;edition:Edition;onAssigned:(target:Detail)=>void}) {
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[search,setSearch]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [items,setItems]=useState<Item[]>([]),[total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [target,setTarget]=useState<Detail|null>(null),[parent,setParent]=useState('');
  const [newTitle,setNewTitle]=useState(''),[createPreview,setCreatePreview]=useState(false);
  const [readFailure,setReadFailure]=useState(false),[retryTarget,setRetryTarget]=useState('');
  const lifetime=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller;
    return()=>controller.abort();
  },[]);
  useEffect(()=>{
    const controller=new AbortController();++generation.current;
    setLoading(true);setError('');setReadFailure(false);setRetryTarget('');setTarget(null);setItems([]);setParent('');
    void api.items(item.libraryId,item.kind,search,offset,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      setItems(result.items.filter(candidate=>candidate.id!==item.id));setTotal(result.total);
    }).catch(reason=>{if(!controller.signal.aborted){setError(mediaActionError(reason,'读取作品失败'));setReadFailure(true);}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[api,item.id,item.libraryId,item.kind,search,offset,attempt]);
  async function choose(id:string){
    const signal=lifetime.current?.signal,request=++generation.current;
    if(!signal||signal.aborted)return;
    setTarget(null);setCreatePreview(false);setParent('');setError('');setReadFailure(false);setRetryTarget(id);setLoading(true);
    try{
      const detail=await api.detail(id,signal);
      const parentDetail=detail.parentId?await api.detail(detail.parentId,signal):null;
      if(!signal.aborted&&request===generation.current){setTarget(detail);setParent(parentDetail?.title||'');}
    }catch(reason){if(!signal.aborted&&request===generation.current){setError(mediaActionError(reason,'读取作品失败'));setReadFailure(true);}}
    finally{if(!signal.aborted&&request===generation.current)setLoading(false);}
  }
  async function assign(){
    const signal=lifetime.current?.signal;
    if(!target||saving||!signal||signal.aborted)return;
    setSaving(true);setError('');setReadFailure(false);
    try{
      const updated=await api.request<Detail>(`editions/${encodeURIComponent(edition.id)}/item`,'PUT',{targetItemId:target.id,expectedItemId:item.id},signal);
      if(!signal.aborted)onAssigned(updated);
    }catch(reason){if(!signal.aborted)setError(mediaActionError(reason,'修改失败，请刷新核对归属后重试'));}
    finally{if(!signal.aborted)setSaving(false);}
  }
  async function create(){
    const signal=lifetime.current?.signal;
    if(saving||!createPreview||!newTitle.trim()||!signal||signal.aborted)return;
    setSaving(true);setError('');setReadFailure(false);
    try{
      const updated=await api.request<Detail>(`editions/${encodeURIComponent(edition.id)}/new-item`,'POST',{title:newTitle.trim(),expectedItemId:item.id},signal);
      if(!signal.aborted)onAssigned(updated);
    }catch(reason){if(!signal.aborted)setError(mediaActionError(reason,'创建失败，请核对归属后重试'));}
    finally{if(!signal.aborted)setSaving(false);}
  }
  return <section aria-label="纠正版本归属" className="media-edition media-edition-assignment">
    <h3>将“{edition.label}”关联到其他作品</h3>
    <p>整版 {edition.parts.length} 节一起移动，文件和播放进度保留。原作品的收藏和资料保持不变；目标作品已有版本保留。后续扫描保留此次归属。</p>
    <details><summary>目标作品不存在？新建作品</summary>
      <p>在当前媒体库新建同类型作品，所属专辑或季保持不变。只填写新标题，不复制原作品的简介、在线匹配和人工资料；创建后可继续编辑。</p>
      <label>新作品标题<input value={newTitle} maxLength={200} disabled={saving} onInput={event=>{setNewTitle(event.currentTarget.value);setCreatePreview(false);}}/></label>
      <button disabled={saving||!newTitle.trim()} onClick={()=>{setCreatePreview(true);setTarget(null);}}>预览新建作品</button>
      {createPreview&&<section aria-label="确认新建作品"><h4>{item.title} → {newTitle.trim()}</h4><p>将“{edition.label}”及其 {edition.parts.length} 节关联到新作品。</p><button disabled={saving} onClick={()=>void create()}>确认新建并关联</button><button disabled={saving} onClick={()=>setCreatePreview(false)}>取消新建</button></section>}
    </details>
    <form className="media-toolbar" onSubmit={event=>{event.preventDefault();setOffset(0);setSearch(query.trim());setAttempt(value=>value+1);}}>
      <label>查找目标作品<input value={query} disabled={saving} maxLength={200} onInput={event=>setQuery(event.currentTarget.value)}/></label>
      <button disabled={saving}>查找</button>
    </form>
    {loading&&<MediaLoading label="正在读取作品…" layout="tracks" count={3}/>}
    {error&&<div className="media-error" role="alert"><p>{error}</p>{readFailure&&<button disabled={loading||saving} onClick={()=>{if(retryTarget)void choose(retryTarget);else setAttempt(value=>value+1);}}>重新读取作品</button>}</div>}
    {!loading&&!error&&!items.length&&<p>没有其他同类型作品，请调整搜索词。</p>}
    {items.map(candidate=><div key={candidate.id} className="media-row"><span>{candidate.title}<small>{String(candidate.overrides.year??candidate.metadata.year??'')}</small></span><button disabled={saving||loading} onClick={()=>void choose(candidate.id)}>选择此作品</button></div>)}
    {total>60&&<nav className="media-toolbar" aria-label="目标作品分页"><button disabled={saving||loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-60))}>上一页</button><span>{Math.floor(offset/60)+1} / {Math.ceil(total/60)}</span><button disabled={saving||loading||offset+60>=total} onClick={()=>setOffset(offset+60)}>下一页</button></nav>}
    {target&&<section aria-label="确认版本归属"><h4>{item.title} → {target.title}</h4>{parent&&<p>所属：{parent}</p>}<p>目标现有版本：{target.editions.map(entry=>entry.label).join('、')||'无'}</p>{target.editions.map(entry=><p key={entry.id}>{entry.label}：{entry.parts.slice(0,3).map(part=>part.title).join('、')}{entry.parts.length>3?'…':''}</p>)}<button disabled={saving||loading} onClick={()=>void assign()}>确认修改归属</button><button disabled={saving} onClick={()=>setTarget(null)}>取消选择</button></section>}
  </section>;
}
