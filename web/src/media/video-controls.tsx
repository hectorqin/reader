import {VideoEpisodeRail} from './video-episode-rail.tsx';
import {SleepTimerOptions} from './sleep-timer.tsx';
import {Ellipsis,X,Square,Check,Subtitles,AudioLines,Layers} from 'lucide-preact';
import {useEffect,useLayoutEffect,useRef,useState,type ComponentChildren} from '../ui/vendor/preact.ts';
import type {MediaPlayer} from './player.ts';
import type {Detail,MediaApi} from './api.ts';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {PlaybackProblem} from './playback-problem.tsx';
import {FloatingNotice} from '../ui/floating-notice.tsx';

type Tool='episodes'|'subtitles'|'tracks'|'volume'|'more'|'versions';
const titles:Record<Tool,string>={episodes:'选集',subtitles:'字幕',tracks:'音轨',volume:'音量',more:'更多播放选项',versions:'播放版本'};

function TrackOptions({player,kind}:{player:MediaPlayer;kind:'subtitles'|'tracks'}){
  const host=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>host.current?player.mountVideoTracks(host.current,kind):undefined,[player,kind]);
  return <><div className="media-video-track-host" ref={host}/><p className="media-video-empty-track">{kind==='subtitles'?'当前没有可选字幕。':'当前没有可切换的音轨。'}</p></>;
}

function Volume({player}:{player:MediaPlayer}){
  const host=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>host.current?player.mountVolumeControl(host.current):undefined,[player]);
  return <div ref={host}/>;
}

function ToolSheet({tool,onClose,children}:{tool:Tool;onClose:()=>void;children:ComponentChildren}){
  const ref=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{const dialog=ref.current;if(!dialog)return;dialog.showModal();return ()=>dialog.close();},[]);
  return <dialog ref={ref} className="media-video-sheet" aria-label={titles[tool]} onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}}>
    <header><h2>{titles[tool]}</h2><button className="media-video-icon" aria-label="关闭播放菜单" onClick={onClose}><X size={20} aria-hidden="true"/></button></header>{children}
  </dialog>;
}

/** Rendered in the permanent player's controls host, alongside the live video. */
export function VideoControls({player,api,onBack}:{player:MediaPlayer;api:MediaApi;onBack?:()=>void}){
  const [tool,setTool]=useState<Tool|null>(null),[detail,setDetail]=useState<Detail|null>(null),[plot,setPlot]=useState(''),[failed,setFailed]=useState(false),[cause,setCause]=useState<unknown>(),[retry,setRetry]=useState(0),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const itemId=player.currentItemId;
  useEffect(()=>{const abort=new AbortController();setDetail(null);setPlot('');setFailed(false);setCause(undefined);if(itemId)void api.detail(itemId,abort.signal).then(async value=>{let current=value;let text=String(current.overrides.plot??current.overrides.description??current.metadata.plot??current.metadata.description??'').trim();for(let depth=0;!text&&current.parentId&&depth<3;depth++){current=await api.detail(current.parentId,abort.signal);text=String(current.overrides.plot??current.overrides.description??current.metadata.plot??current.metadata.description??'').trim();}if(!abort.signal.aborted){setDetail(value);setPlot(text);}}).catch(error=>{if(!abort.signal.aborted){setFailed(true);setCause(error);}});return ()=>abort.abort();},[api,itemId,retry]);
  const item=detail?.id===itemId?detail:null,edition=item?.editions.find(entry=>entry.parts.some(part=>part.id===player.currentPartId));
  const entries=player.currentPlaylist;
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const filtered=entries.filter(entry=>entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),last=Math.max(0,Math.ceil(filtered.length/50)-1),currentPage=Math.min(page,last);
  function open(value:Tool){setNotice('');setTool(value);setQuery('');setPage(0);}
  async function run(action:()=>Promise<void>,close=false){if(busy)return;setBusy(true);setNotice('');try{await action();if(close&&!player.error)setTool(null);}catch(error){setNotice(error instanceof Error?error.message:'操作失败，请重试。');}finally{setBusy(false);}}
  return <section className="media-playback-status media-video-controls" aria-label="播放控制">
    <div className="media-video-caption"><div><strong>{item?.title||player.title}</strong>{edition&&<small>{edition.label}</small>}</div></div>
    <div className="media-video-toolbar media-video-tools">{entries.length>1&&<button onClick={()=>open('episodes')}><Layers size={20} aria-hidden="true"/>选集</button>}<button onClick={()=>open('subtitles')}><Subtitles size={20} aria-hidden="true"/>字幕</button><button onClick={()=>open('tracks')}><AudioLines size={20} aria-hidden="true"/>音轨</button><button onClick={()=>open('versions')}><Layers size={20} aria-hidden="true"/>版本</button><button aria-label="更多播放选项" onClick={()=>open('more')}><Ellipsis size={20} aria-hidden="true"/>更多</button></div>
    {player.error&&<PlaybackProblem player={player} {...(item?.editions.length?{onVersions:()=>open('versions')}:{})} {...(onBack?{onBack}:{})}/>}
    {!player.error&&player.loadingStatus&&<FloatingNotice message={player.loadingStatus} busy />}
    {notice&&<p className="media-error" role="alert">{notice}</p>}
    {plot&&<details className="media-video-description" open><summary>剧情简介</summary><p>{plot}</p></details>}
    {item?.kind==='episode'&&item.parentId&&<VideoEpisodeRail key={item.parentId} api={api} item={item} player={player}/>}
    {!item&&itemId&&!failed&&<MediaLoading layout="tracks" count={2} label="正在读取作品资料…"/>}
    {failed&&<MediaScreenError error={cause} message="作品资料读取失败，播放控制仍可使用。" busy={false} onRetry={()=>setRetry(value=>value+1)} retryLabel="重试作品资料"/>}
    {tool&&<ToolSheet key={tool} tool={tool} onClose={()=>{if(!busy)setTool(null);}}>
      {tool==='volume'?<Volume player={player}/>:tool==='subtitles'||tool==='tracks'?<TrackOptions player={player} kind={tool}/>:tool==='episodes'?<>
        <p>本次播放列表 · {entries.length} 项</p>
        {entries.length>10&&<label className="media-video-search">查找集数<input type="search" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label>}
        <div className="media-video-episodes">{filtered.slice(currentPage*50,currentPage*50+50).map(entry=><button key={entry.index} aria-current={entry.current?'true':undefined} disabled={busy||entry.current||!player.canSelectPlaylist} onClick={()=>void run(()=>player.selectPlaylist(entry.index),true)}><span>{entry.index+1}</span><span>{entry.title}</span>{entry.current&&<Check size={17} aria-label="正在播放"/>}</button>)}</div>
        {!filtered.length&&<p>没有匹配的集数。</p>}{last>0&&<nav aria-label="选集分页"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {last+1}</span><button disabled={currentPage===last} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
      </>:tool==='versions'?<div className="media-video-episodes">{item?.editions.map(value=><button disabled={busy||value.id===edition?.id&&!player.error||!value.parts.length||value.parts.some(part=>!part.available)} aria-current={value.id===edition?.id?'true':undefined} onClick={()=>void run(()=>player.play(value.parts.map(part=>({part,title:item.title+' · '+part.title,video:true}))),true)}><span>{value.label}</span><small>{value.parts.some(part=>!part.available)?'资源缺失':value.id===edition?.id?'当前版本':`${value.parts.length} 个片段`}</small></button>)}</div>:<>
        {entries.length>1&&item?.kind!=='episode'&&<button onClick={()=>open('episodes')}>本次播放列表 · {entries.length} 项</button>}<div className="media-video-seek"><button disabled={player.playbackUnavailable} onClick={()=>player.skip(-15)}>快退 15 秒</button><button disabled={player.playbackUnavailable} onClick={()=>player.skip(30)}>快进 30 秒</button></div>
        <SleepTimerOptions player={player}/>
        {player.canOpenNativeVideo&&<button onClick={()=>void player.openNativeVideo()}>打开 Android 视频播放器</button>}
        {player.support&&<p>{player.support}</p>}
        <button className="media-video-end" onClick={()=>void player.stop()}><Square size={17} aria-hidden="true"/>结束播放</button>
      </>}
      {(player.error||notice)&&<p role="alert" className="media-error">{player.error||notice}</p>}
    </ToolSheet>}
  </section>;
}
