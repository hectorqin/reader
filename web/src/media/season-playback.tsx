import {MediaSelect} from './select.tsx';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {useEffect,useState} from '../ui/vendor/preact.ts';
import type {Edition,Item,MediaApi,Part} from './api.ts';
import {Play} from 'lucide-preact';

export interface SeasonEpisode {id:string;title:string;editions:Edition[]}
export function episodeDisplayTitle(index:number,title:string){
  const normalized=title.trim();
  return /^(第\s*\d+\s*集|E(?:P)?\s*\d+)$/i.test(normalized) ? `第 ${index+1} 集` : `第 ${index+1} 集 · ${normalized}`;
}
export function seasonQueue(episodes:SeasonEpisode[],start:number,choices:Record<string,string>){
  const entries:Array<{part:Part;title:string;video:boolean}>=[];
  let count=0,notice='';
  for(const episode of episodes.slice(start)){
    const versions=episode.editions.filter(edition=>edition.parts.length&&edition.parts.every(part=>part.available));
    const selected=choices[episode.id]?versions.find(edition=>edition.id===choices[episode.id]):versions.length===1?versions[0]:undefined;
    if(!selected){notice=`${episode.title}${versions.length?'需要选择版本':'资源不完整'}，连续播放将在此集前停止。`;break;}
    if(entries.length+selected.parts.length>2000){notice='播放列表已达到 2000 段上限。';break;}
    entries.push(...selected.parts.map(part=>({part,title:episode.title+' · '+part.title,video:true})));count++;
  }
  return {entries,count,notice};
}

interface SeasonPlaybackProps {api:MediaApi;id:string;scope?:'season'|'series';layout?:'list'|'grid';currentPartId?:string;onPlay:(entries:Array<{part:Part;title:string;video:boolean}>)=>Promise<void>;onDetail:(id:string)=>void}

export function SeriesSeasons({seasons,...props}:Omit<SeasonPlaybackProps,'id'>&{seasons:Item[]}){
  const [selected,setSelected]=useState('');
  const season=seasons.find(item=>item.id===selected)||seasons[0];
  return <section className="media-series-seasons"><div className="media-toolbar"><h2>选集</h2>{season&&<MediaSelect variant="plain" aria-label="选择季" value={season.id} onChange={event=>setSelected(event.currentTarget.value)}>{seasons.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</MediaSelect>}</div>
    {season?<><SeasonPlayback key={season.id} {...props} id={season.id} layout="grid"/></>:<p className="media-season-notice">暂未收录剧集。</p>}
  </section>;
}

export function SeriesPlayback(props:SeasonPlaybackProps){
  const [open,setOpen]=useState(false);
  return <details className="media-series-playback" onToggle={event=>setOpen(event.currentTarget.open)}><summary>跨季顺序播放</summary>{open&&<SeasonPlayback {...props} scope="series"/>}</details>;
}

export function SeasonPlayback({api,id,scope='season',layout='list',currentPartId,onPlay,onDetail}:SeasonPlaybackProps){
  const [episodes,setEpisodes]=useState<SeasonEpisode[]>([]),[start,setStart]=useState(0),[choices,setChoices]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const [loadCause,setLoadCause]=useState<unknown>();
  const [loadError,setLoadError]=useState('');
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError('');setLoadError('');setLoadCause(undefined);
    void api.request<{episodes:SeasonEpisode[]}>('items/'+encodeURIComponent(id)+'/'+scope+'-playback','GET',undefined,abort.signal)
      .then(result=>{if(!abort.signal.aborted){setEpisodes(result.episodes);setStart(0);setChoices({});setQuery('');setPage(0);}})
      .catch(error=>{if(!abort.signal.aborted){setLoadError(error instanceof Error?error.message:'无法读取选集');setLoadCause(error);}})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>abort.abort();
  },[api,id,scope,attempt]);
  const queue=seasonQueue(episodes,start,choices);
  const filtered=episodes.map((episode,index)=>({episode,index})).filter(({episode})=>episode.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const lastPage=Math.max(0,Math.ceil(filtered.length/50)-1),currentPage=Math.min(page,lastPage);
  async function play(from=start){const next=seasonQueue(episodes,from,choices);if(busy)return;setStart(from);setError('');if(!next.entries.length)return;setBusy(true);try{await onPlay(next.entries);}catch(error){setError(error instanceof Error?error.message:'播放失败');}finally{setBusy(false);}}
  return <section className="media-season-playback" aria-label="剧集顺序播放">
    {loading?<MediaLoading layout={layout==='grid'?'episodes':'tracks'} label="正在读取选集…"/>:loadError?<MediaScreenError error={loadCause} message={loadError} busy={loading} retryLabel="重新读取" onRetry={()=>setAttempt(attempt+1)}/>:<>
      {layout==='list'&&<div className="media-toolbar"><span>{episodes[start]?'从 '+episodes[start]!.title+' 开始':'暂无剧集'}</span><button className="media-primary" disabled={busy||!queue.entries.length} onClick={()=>void play()}><Play size={16} aria-hidden="true"/>顺序播放 {queue.count} 集</button></div>}
      {episodes.length>(layout==='grid'?50:10)&&<div className="media-chapter-filter"><label>查找集数<input type="search" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label><button onClick={()=>{setQuery('');setPage(Math.floor(start/50));}}>定位起播集</button></div>}
      {queue.notice&&<p className="media-season-notice">{queue.notice}</p>}
      {layout==='grid'?<><div className="media-episode-grid">{filtered.slice(currentPage*50,(currentPage+1)*50).map(({episode,index})=><button key={episode.id} aria-label={'播放 '+episode.title} title={episode.title} aria-pressed={episode.editions.some(e=>e.parts.some(p=>p.id===currentPartId))} disabled={busy||!episode.editions.some(e=>e.parts.length&&e.parts.every(p=>p.available))} onClick={()=>void play(index)}><strong>{episodeDisplayTitle(index,episode.title)}</strong><small>{episode.editions.some(e=>e.parts.some(p=>p.id===currentPartId))?'正在播放':episode.editions[0]?.parts.every(p=>p.end!==null)?Math.max(1,Math.round(episode.editions[0].parts.reduce((sum,p)=>sum+p.end!-p.start,0)/60))+' 分钟':'可播放'}</small></button>)}</div>{episodes[start]&&episodes[start]!.editions.length>1&&<div className="media-episode-selection"><span>{episodes[start]!.title}</span>{episodes[start]!.editions.length>1&&<MediaSelect aria-label={episodes[start]!.title+' 版本'} value={choices[episodes[start]!.id]??(episodes[start]!.editions.filter(e=>e.parts.length&&e.parts.every(p=>p.available)).length===1?episodes[start]!.editions.find(e=>e.parts.length&&e.parts.every(p=>p.available))!.id:'')} onChange={event=>setChoices({...choices,[episodes[start]!.id]:event.currentTarget.value})}><option value="">选择版本</option>{episodes[start]!.editions.map(edition=><option key={edition.id} value={edition.id} disabled={!edition.parts.length||edition.parts.some(part=>!part.available)}>{edition.label}</option>)}</MediaSelect>}<button className="media-primary" disabled={busy||!queue.entries.length} onClick={()=>void play()}>播放所选版本</button><button onClick={()=>onDetail(episodes[start]!.id)}>单集详情</button></div>}</>:<div className="media-season-list">{filtered.slice(currentPage*50,(currentPage+1)*50).map(({episode,index})=><div className="media-season-row" key={episode.id}>
        <input type="radio" name={'season-start-'+id} aria-label={'从 '+episode.title+' 开始'} checked={start===index} onChange={()=>setStart(index)}/>
        <button onClick={()=>onDetail(episode.id)}>{episode.title}</button>
        {episode.editions.length>1&&<MediaSelect aria-label={episode.title+' 版本'} value={choices[episode.id]??(episode.editions.filter(e=>e.parts.length&&e.parts.every(p=>p.available)).length===1?episode.editions.find(e=>e.parts.length&&e.parts.every(p=>p.available))!.id:'')} onChange={event=>setChoices({...choices,[episode.id]:event.currentTarget.value})}>
          <option value="">选择版本</option>{episode.editions.map(edition=><option key={edition.id} value={edition.id} disabled={!edition.parts.length||edition.parts.some(part=>!part.available)}>{edition.label}</option>)}
        </MediaSelect>}
      </div>)}</div>}
      {!filtered.length&&<p>没有匹配的集数。</p>}
      {lastPage>0&&<nav className="media-toolbar" aria-label="选集分页"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {lastPage+1}</span><button disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
    </>}
    {error&&<p role="alert">{error}<button disabled={busy||!queue.entries.length} onClick={()=>void play()}>重试播放</button></p>}
  </section>;
}
