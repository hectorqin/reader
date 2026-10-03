import {MediaSelect} from './select.tsx';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import {Play,ListPlus,Ellipsis} from 'lucide-react';
import type {Edition,MediaApi,Part} from '../api/media-api.ts';
export interface AlbumTrack {id:string;title:string;disc:number;track:number|null;editions:Edition[]}
type Entry={part:Part;title:string;video:boolean;credit?:string};
export function albumQueue(tracks:AlbumTrack[],start:number,choices:Record<string,string>){
  const entries:Entry[]=[];let count=0,notice='';
  for(const track of tracks.slice(start)){
    const available=track.editions.filter(edition=>edition.parts.length&&edition.parts.every(part=>part.available));
    const edition=choices[track.id]?available.find(edition=>edition.id===choices[track.id]):available.length===1?available[0]:undefined;
    if(!edition){notice=`${track.title}${available.length?'需要选择版本':'资源不完整'}，本次列表将在此曲前结束。`;break;}
    if(entries.length+edition.parts.length>2000){notice='播放列表最多容纳 2000 段，请分批播放。';break;}
    entries.push(...edition.parts.map(part=>({part,title:track.title,video:false})));count++;
  }
  return {entries,count,notice};
}
export function AlbumPlayback({api,id,onPlay,onQueue,onDetail,actions,credit,onTracksRead,sidebar}:{api:MediaApi;id:string;onPlay:(entries:Entry[])=>Promise<void>;onQueue:(ids:string[])=>Promise<void>;onDetail:(id:string)=>void;actions?:ReactNode;sidebar?:ReactNode;credit?:string;onTracksRead?:(tracks:AlbumTrack[])=>void}){
  const [tracks,setTracks]=useState<AlbumTrack[]>([]),[choices,setChoices]=useState<Record<string,string>>({}),[start,setStart]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const [loadCause,setLoadCause]=useState<unknown>();
  const [loadError,setLoadError]=useState(''),[failedAction,setFailedAction]=useState<'play'|'queue'>('play');
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError('');setLoadError('');setLoadCause(undefined);setTracks([]);setNotice('');
    void api.request<{tracks:AlbumTrack[]}>('items/'+encodeURIComponent(id)+'/album-playback','GET',undefined,abort.signal).then(result=>{
      if(!abort.signal.aborted){setTracks(result.tracks);onTracksRead?.(result.tracks);setChoices({});setStart(0);setQuery('');setPage(0);}
    }).catch(error=>{if(!abort.signal.aborted){setLoadError(error instanceof Error?error.message:'无法读取专辑');setLoadCause(error);}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>abort.abort();
  },[api,id,retry]);
  const queue=albumQueue(tracks,start,choices),filtered=tracks.map((track,index)=>({track,index})).filter(({track})=>track.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const seconds=tracks.every(track=>track.editions.length===1&&track.editions[0]!.parts.length>0&&track.editions[0]!.parts.every(part=>part.end!==null))?tracks.reduce((sum,track)=>sum+track.editions[0]!.parts.reduce((n,part)=>n+part.end!-part.start,0),0):null;
  const pages=Math.max(1,Math.ceil(filtered.length/50)),current=Math.min(page,pages-1);
  const visible=filtered.slice(current*50,(current+1)*50),discCount=new Set(tracks.map(track=>track.disc)).size,multipleDiscs=discCount>1;
  async function run(action:()=>Promise<void>,success='',kind:'play'|'queue'='play'){if(busy)return;setBusy(true);setError('');setNotice('');try{await action();setNotice(success);}catch(error){setFailedAction(kind);setError(error instanceof Error?error.message:'操作失败');}finally{setBusy(false);}}
  function playFrom(index:number){
    if(busy)return;
    setStart(index);setError('');setNotice('');
    const selected=albumQueue(tracks,index,choices);
    if(!selected.entries.length)return;
    void run(()=>onPlay(selected.entries.map(entry=>({...entry,...(credit?{credit}:{})}))));
  }
  return <section className="media-album-playback" aria-label="专辑曲目">
    {actions&&(loading||loadError)&&<div className="media-toolbar media-album-actions">{actions}</div>}
    {loading?<MediaLoading layout="tracks" label="正在读取曲目…"/>:loadError?<MediaScreenError error={loadCause} message={loadError} busy={loading} retryLabel="重新读取" onRetry={()=>setRetry(retry+1)}/>:<>
      <div className="media-toolbar media-album-actions"><button className="media-primary" disabled={busy||!queue.entries.length} onClick={()=>void run(()=>onPlay(queue.entries.map(entry=>({...entry,...(credit?{credit}:{})}))))}><Play size={17} aria-hidden="true"/>{start>0?'从此曲播放':'播放全部'}</button>{actions}<button className="media-icon-button" aria-label="加入队列" title="加入队列" disabled={busy||!queue.entries.length} onClick={()=>void run(()=>onQueue(queue.entries.map(entry=>entry.part.id)),'已加入队列','queue')}><ListPlus size={17} aria-hidden="true"/></button></div>
      <div className="media-album-columns"><div className="media-album-track-body"><div className="media-album-summary"><strong>曲目</strong><span>{tracks.length} 首{seconds!==null&&seconds>0?' · '+Math.floor(seconds/60)+' 分钟':''}{multipleDiscs?' · '+discCount+' 碟':''}</span>{start>0&&<button onClick={()=>{setStart(0);setQuery('');setPage(0);}}>从第一首开始</button>}</div>
      {start>0&&tracks[start]&&<p className="media-album-start">从「{tracks[start]!.title}」开始</p>}{queue.notice&&<p className="media-season-notice">{queue.notice}</p>}{notice&&<p role="status">{notice}</p>}
      {tracks.length>10&&<label className="media-chapter-filter">查找曲目<input type="search" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label>}
      <div className="media-season-list">{visible.map(({track,index},row)=>{
        const available=track.editions.filter(edition=>edition.parts.length&&edition.parts.every(part=>part.available));
        const edition=choices[track.id]?available.find(edition=>edition.id===choices[track.id]):available.length===1?available[0]:undefined;
        const duration=edition?.parts.every(part=>part.end!==null&&Number.isFinite(part.end)&&part.end>=part.start)?edition.parts.reduce((total,part)=>total+part.end!-part.start,0):null;
        return <div className="media-album-track" key={track.id}>
          {multipleDiscs&&(row===0||visible[row-1]!.track.disc!==track.disc)&&<h3 className="media-album-disc">第 {track.disc} 碟</h3>}
          <div className="media-season-row" data-selected={index===start?'true':undefined}><span className="media-album-number">{String(track.track??index+1).padStart(2,'0')}</span><button className="media-album-track-link" aria-label={'从 '+track.title+' 开始播放'} disabled={busy||!available.length} onClick={()=>playFrom(index)}><span className="media-album-track-title">{track.title}<small>{!available.length?'资源缺失':credit}</small></span></button>{duration!==null&&<span className="media-album-duration" aria-label={'时长 '+Math.floor(duration/60)+' 分 '+Math.floor(duration%60)+' 秒'}>{Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,'0')}</span>}<button className="media-album-track-detail" aria-label={'查看 '+track.title+' 详情'} title="曲目详情与版本" onClick={()=>onDetail(track.id)}><Ellipsis size={18} aria-hidden="true"/></button>
          {track.editions.length>1&&<MediaSelect aria-label={track.title+' 版本'} value={choices[track.id]??(available.length===1?available[0]!.id:'')} onChange={event=>setChoices({...choices,[track.id]:event.currentTarget.value})}><option key="empty" value="">选择版本</option>{track.editions.map(edition=><option key={edition.id} value={edition.id} disabled={!available.includes(edition)}>{edition.label}</option>)}</MediaSelect>}
        </div></div>;
      })}</div>
      {!filtered.length&&<p>没有匹配的曲目。</p>}{pages>1&&<nav className="media-toolbar" aria-label="专辑曲目分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {pages}</span><button disabled={current+1>=pages} onClick={()=>setPage(current+1)}>下一页</button></nav>}
      </div>{sidebar}</div>
    </>}
    {error&&<p role="alert">{error}{failedAction==='play'?<button disabled={busy||!queue.entries.length} onClick={()=>void run(()=>onPlay(queue.entries.map(entry=>({...entry,...(credit?{credit}:{})}))))}>重试播放</button>:<span> 请先到播放队列核对是否已加入，再决定是否重新添加。</span>}</p>}
  </section>;
}
