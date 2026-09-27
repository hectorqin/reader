import {Play} from 'lucide-preact';
import { useEffect, useRef, useState } from '../ui/vendor/preact.ts';
import type { MediaApi, Part } from './api.ts';
import {MediaCover} from './cover.tsx';
import {historyPosition} from './history-labels.ts';

interface Recent {libraryId:string;itemId:string;partId:string;title:string;partTitle:string;start:number;end:number|null;position:number;completed:number;available:number}

/** A single compact continuation, scoped to the selected library. */
export function ContinuePlaying({api,libraryId,libraryIds=[],onPlay}:{api:MediaApi;libraryId:string;libraryIds?:string[];onPlay:(parts:Part[],index:number,title:string)=>Promise<void>}) {
  const [recent,setRecent]=useState<Recent|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lifetime=useRef<AbortController|null>(null);
  const scope=JSON.stringify(libraryId?[libraryId]:libraryIds);
  useEffect(()=>{
    const abort=new AbortController();lifetime.current=abort;setRecent(null);setError('');
    const allowed=new Set<string>(JSON.parse(scope));
    if(allowed.size)void api.request<{items:Recent[]}>('history','GET',undefined,abort.signal).then(result=>{
      if(!abort.signal.aborted)setRecent(result.items.find(row=>allowed.has(row.libraryId)&&!row.completed&&row.available&&row.position>row.start)??null);
    }).catch(()=>{/* Optional history must not prevent browsing. */});
    return ()=>abort.abort();
  },[api,scope]);
  async function resume(){
    if(!recent||busy)return;setBusy(true);setError('');
    const abort=lifetime.current;
    try{
      const detail=await api.detail(recent.itemId,abort?.signal);
      if(abort?.signal.aborted)return;
      const parts=detail.editions.find(edition=>edition.parts.some(part=>part.id===recent.partId))?.parts.filter(part=>part.available)??[];
      const index=parts.findIndex(part=>part.id===recent.partId);
      if(index<0)throw new Error('续播资源已变化，请从作品详情重新选择。');
      await onPlay(parts,index,detail.title);
    }catch(error){setError(error instanceof Error?error.message:'无法续播，请重试。');}
    finally{setBusy(false);}
  }
  if(!recent)return null;
  const elapsed=Math.max(0,recent.position-recent.start),duration=recent.end===null?null:Math.max(0,recent.end-recent.start);
  return <section className="media-continue" aria-label="最近续播">
    <MediaCover api={api} item={{id:recent.itemId,libraryId:recent.libraryId,kind:'recent',title:recent.title,parentId:null,metadata:{},overrides:{}}} square={false} loadWithoutMetadata/><div><strong title={recent.title}>{recent.title}</strong><small title={recent.partTitle}>{recent.partTitle&&recent.partTitle!==recent.title?recent.partTitle+' · ':''}{historyPosition(recent.position,recent.start)}{duration!==null&&duration>0?' / '+historyPosition(duration,0):''}</small>
      {duration!==null&&duration>0&&<progress aria-label="已播进度" max={duration} value={Math.min(elapsed,duration)}/>}</div>
    <button className="media-primary" aria-label={busy?'正在打开…':'续播'} title="继续播放" disabled={busy} onClick={()=>void resume()}><Play size={18} fill="currentColor" aria-hidden="true"/></button>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
