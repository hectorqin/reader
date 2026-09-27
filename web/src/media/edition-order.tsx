import { useEffect, useRef, useState } from '../ui/vendor/preact.ts';
import type { Detail, Edition, MediaApi } from './api.ts';
import {ArrowUp,ArrowDown} from 'lucide-preact';
import {mediaActionError} from './action-error.ts';

export function EditionOrder({api,edition,onUpdated}:{api:MediaApi;edition:Edition;onUpdated:(detail:Detail)=>void}) {
  const [parts,setParts]=useState(edition.parts),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [reset,setReset]=useState(false);
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[]);
  const changed=parts.some((part,index)=>part.id!==edition.parts[index]?.id);
  const pages=Math.max(1,Math.ceil(parts.length/50));
  function move(index:number,offset:number){
    const next=parts.slice(),target=index+offset;
    if(target<0||target>=next.length)return;
    [next[index],next[target]]=[next[target]!,next[index]!];setParts(next);setPage(Math.floor(target/50));
  }
  async function save(){
    const signal=abort.current?.signal;if(busy||!signal||signal.aborted||!edition.revision)return;
    setBusy(true);setError('');
    try{
      const result=await api.request<Detail>(`editions/${encodeURIComponent(edition.id)}/order`,'PUT',{expectedRevision:edition.revision,partIds:reset?null:parts.map(part=>part.id)},signal);
      if(!signal.aborted)onUpdated(result);
    }catch(reason){if(!signal.aborted)setError(mediaActionError(reason,'排序失败，请刷新核对后重试'));}
    finally{if(!signal.aborted)setBusy(false);}
  }
  return <section aria-label="章节排序" className="media-edition-order">
    <p>调整此版本的章节顺序，保存后用于新发起的连续播放。当前正在播放的列表保持原顺序。重扫保留已排顺序，新章节追加到末尾。</p>
    <label><input type="checkbox" checked={reset} disabled={busy} onChange={event=>setReset(event.currentTarget.checked)}/>恢复扫描默认顺序</label>
    {!reset&&parts.slice(page*50,(page+1)*50).map((part,offset)=>{const index=page*50+offset;return <div className="media-row" key={part.id}><span>{index+1}. {part.title}</span><div className="media-order-actions"><button aria-label={`上移 ${part.title}`} title="上移" disabled={busy||index===0} onClick={()=>move(index,-1)}><ArrowUp size={17} aria-hidden="true"/></button><button aria-label={`下移 ${part.title}`} title="下移" disabled={busy||index===parts.length-1} onClick={()=>move(index,1)}><ArrowDown size={17} aria-hidden="true"/></button></div></div>;})}
    {!reset&&pages>1&&<nav className="media-toolbar" aria-label="排序章节分页"><button disabled={busy||page===0} onClick={()=>setPage(page-1)}>上一页</button><span>{page+1} / {pages}</span><button disabled={busy||page+1>=pages} onClick={()=>setPage(page+1)}>下一页</button></nav>}
    <button disabled={busy||!edition.revision||parts.length>10000||(!changed&&!reset)} onClick={()=>void save()}>保存章节顺序</button>
    {parts.length>10000&&<p>当前版本超过一万章，暂不支持整版手工排序。</p>}
    {error&&<p className="media-error" role="alert">{error}</p>}
  </section>;
}
