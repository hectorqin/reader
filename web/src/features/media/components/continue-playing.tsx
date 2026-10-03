import {Play} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaApi, Part, Detail } from '../api/media-api.ts';
import {MediaCover} from './cover.tsx';
import {historyPosition} from './history-labels.ts';

interface Recent {libraryId:string;itemId:string;partId:string;title:string;partTitle:string;start:number;end:number|null;position:number;completed:number;available:number;metadataJson?:string}

/** A single compact continuation, scoped to the selected library. */
export function ContinuePlaying({api,libraryId,libraryIds=[],onPlay}:{api:MediaApi;libraryId:string;libraryIds?:string[];onPlay:(parts:Part[],index:number,title:string)=>Promise<void>}) {
  const [recent,setRecent]=useState<Recent|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [work,setWork]=useState<Detail|null>(null),[cover,setCover]=useState<Detail|null>(null);
  const lifetime=useRef<AbortController|null>(null);
  const scope=JSON.stringify(libraryId?[libraryId]:libraryIds);
  useEffect(()=>{
    const abort=new AbortController();lifetime.current=abort;setRecent(null);setWork(null);setCover(null);setError('');
    const allowed=new Set<string>(JSON.parse(scope));
    if(allowed.size)void api.request<{items:Recent[]}>('history','GET',undefined,abort.signal).then(async result=>{
      const row=result.items.find(row=>allowed.has(row.libraryId)&&!row.completed&&row.available&&row.position>row.start)??null;
      if(abort.signal.aborted)return;setRecent(row);
      if(!row)return;
      let detail=await api.detail(row.itemId,abort.signal);
      const hasCover=(item:Detail)=>!!(item.metadata.coverRef||item.metadata.tmdbPosterPath||item.metadata.embeddedCoverAssetId||item.metadata.musicBrainzCoverGroupId);
      let artwork:Detail|null=hasCover(detail)?detail:null;
      for(let depth=0;detail.parentId&&depth<3&&['episode','season','track'].includes(detail.kind);depth++){
        detail=await api.detail(detail.parentId,abort.signal);
        if(!artwork&&hasCover(detail))artwork=detail;
      }
      if(!abort.signal.aborted){setWork(detail);setCover(artwork);}
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
  return <section className="media-continue" aria-label="最近续播" role="button" tabIndex={busy?-1:0} onClick={event=>{if(!(event.target as Element).closest('button'))void resume();}} onKeyDown={event=>{if((event.key==='Enter'||event.key===' ')&&!busy){event.preventDefault();void resume();}}}>
    <MediaCover api={api} item={cover??work??{id:recent.itemId,libraryId:recent.libraryId,kind:'recent',title:recent.title,parentId:null,metadata:{},overrides:{}}} square={false} loadWithoutMetadata/><div><small>最近播放</small><strong title={work?.title??recent.title}>{work?.title??recent.title}</strong><small>{work&&work.id!==recent.itemId?recent.title+' · ':''}已播放 {historyPosition(recent.position,recent.start)}{duration!==null&&duration>0?' / '+historyPosition(duration,0):''}</small>
      {duration!==null&&duration>0&&<progress aria-label="已播进度" max={duration} value={Math.min(elapsed,duration)}/>}</div>
    <button className="media-continue-play" aria-label={busy?'正在打开…':'续播'} title="继续播放" disabled={busy} onClick={()=>void resume()}><Play size={17} fill="currentColor" aria-hidden="true"/></button>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
