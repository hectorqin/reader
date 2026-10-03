import {MediaSelect} from './select.tsx';
import { useEffect, useState } from 'react';
import type {Detail,Item,MediaApi} from '../api/media-api.ts';
import type {MediaPlayer} from '../services/player.ts';
import {seasonQueue,episodeDisplayTitle,type SeasonEpisode} from './season-playback.tsx';
import {Check} from 'lucide-react';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';

/** Independent of the queued range: opening an episode directly still exposes its season. */
export function VideoEpisodeRail({api,item,player}:{api:MediaApi;item:Detail;player:MediaPlayer}){
  const [seasons,setSeasons]=useState<Item[]>([]),[seasonId,setSeasonId]=useState(item.parentId||''),[episodes,setEpisodes]=useState<SeasonEpisode[]>([]),[choices,setChoices]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{const abort=new AbortController();void(async()=>{
    if(!item.parentId)return;const season=await api.detail(item.parentId,abort.signal);if(abort.signal.aborted)return;setSeasons([season]);
    if(season.parentId){const series=await api.detail(season.parentId,abort.signal);if(!abort.signal.aborted)setSeasons(series.children.filter(child=>child.kind==='season'));}
  })().catch(()=>{/* Current season remains selectable if series metadata is unavailable. */});return()=>abort.abort();},[api,item.parentId]);
  useEffect(()=>{const abort=new AbortController();setLoading(true);setError(undefined);setPage(0);setChoices({});
    void api.request<{episodes:SeasonEpisode[]}>('items/'+encodeURIComponent(seasonId)+'/season-playback','GET',undefined,abort.signal).then(result=>{if(!abort.signal.aborted)setEpisodes(result.episodes);}).catch(cause=>{if(!abort.signal.aborted)setError(cause);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();
  },[api,seasonId,retry]);
  async function play(index:number){if(busy)return;const queue=seasonQueue(episodes,index,choices);setNotice(queue.notice);if(!queue.entries.length)return;setBusy(true);try{await player.play(queue.entries);}catch(cause){setError(cause);}finally{setBusy(false);}}
  const pages=Math.ceil(episodes.length/50);
  return <aside className="media-episode-rail" aria-label="剧集选集"><header><h2>选集</h2>{seasons.length>0&&<MediaSelect aria-label="选择播放季" value={seasonId} onChange={event=>setSeasonId(event.currentTarget.value)}>{seasons.map(season=><option key={season.id} value={season.id}>{season.title}</option>)}</MediaSelect>}</header>
    {loading?<MediaLoading layout="tracks" count={3} label="正在读取选集…"/>:error?<MediaScreenError error={error} message={error instanceof Error?error.message:'选集暂不可用'} busy={busy} onRetry={()=>setRetry(retry+1)}/>:<div className="media-video-episodes">{episodes.slice(page*50,page*50+50).map((episode,index)=>{
      const available=episode.editions.filter(edition=>edition.parts.length&&edition.parts.every(part=>part.available)),current=episode.editions.some(edition=>edition.parts.some(part=>part.id===player.currentPartId));
      return <div key={episode.id}><button aria-current={current?'true':undefined} disabled={busy||current||!available.length} onClick={()=>void play(page*50+index)}><span>{String(page*50+index+1).padStart(2,'0')}</span><span>{episodeDisplayTitle(page*50+index,episode.title)}<small>{current?'正在播放':available.length?'可播放':'资源缺失'}</small></span>{current&&<Check size={17} aria-hidden="true"/>}</button>{available.length>1&&<MediaSelect aria-label={episode.title+' 版本'} value={choices[episode.id]||''} onChange={event=>setChoices({...choices,[episode.id]:event.currentTarget.value})}><option key="empty" value="">选择版本</option>{available.map(edition=><option key={edition.id} value={edition.id}>{edition.label}</option>)}</MediaSelect>}</div>;
    })}</div>}
    {notice&&<p role="status">{notice}</p>}{!loading&&!error&&!episodes.length&&<p>本季尚无剧集。</p>}
    {pages>1&&<nav aria-label="播放选集分页"><button disabled={!page} onClick={()=>setPage(page-1)}>上一页</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(page+1)}>下一页</button></nav>}
  </aside>;
}
