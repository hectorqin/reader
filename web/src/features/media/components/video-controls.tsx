import {VideoEpisodeRail} from './video-episode-rail.tsx';
import {SleepTimerOptions} from './sleep-timer.tsx';
import {Sheet} from '../../../ui/sheet.tsx';
import {Ellipsis,Square,Check,Subtitles,AudioLines,Layers,ListVideo,Maximize,Minimize,Lock,LockOpen,Gauge,Expand,Shrink,Upload} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {subtitleSizes,type MediaPlayer,type SubtitleSize} from '../services/player.ts';
import type {Detail,MediaApi} from '../api/media-api.ts';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {PlaybackProblem} from './playback-problem.tsx';

type Tool='episodes'|'subtitles'|'tracks'|'volume'|'more'|'versions'|'speed';
const titles:Record<Tool,string>={episodes:'选集',subtitles:'字幕与音轨',tracks:'字幕与音轨',volume:'音量',more:'更多播放选项',versions:'字幕与音轨',speed:'倍速'};
/** 字幕, 音轨 and 版本 are tabs of one sheet (prototype 12); switching tabs keeps it open. */
const trackTabs=[{tool:'subtitles',label:'字幕'},{tool:'tracks',label:'音轨'},{tool:'versions',label:'版本'}] as const;
const isTrackTab=(tool:Tool)=>trackTabs.some(tab=>tab.tool===tool);
const speeds=[0.5,0.75,1,1.25,1.5,2,3];
const sizeLabels:Record<SubtitleSize,string>={small:'小',normal:'标准',large:'大'};
const speedLabel=(rate:number)=>`${Number.isInteger(rate)?rate.toFixed(1):String(rate)}×`;

/** 字幕 tab: the list (关闭, 内嵌, 外挂), 添加外挂字幕, 字幕延迟 and 字号. Web video only. */
function SubtitlePanel({player}:{player:MediaPlayer}){
  const controls=player.subtitleControls;
  useSyncExternalStore(notify=>{controls?.addEventListener('change',notify);return()=>controls?.removeEventListener('change',notify);},()=>controls?.version??0);
  const file=useRef<HTMLInputElement>(null);
  const [error,setError]=useState(''),[size,setSize]=useState<SubtitleSize>(player.subtitleSize??'normal');
  if(!controls||!player.isWebVideo)return <p className="media-video-empty-track">使用 Android 播放器时，请在播放器自己的字幕菜单中选择。</p>;
  const options=controls.options,value=controls.value;
  const add=async(picked:File|undefined)=>{if(!picked)return;setError('');try{await controls.addLocal(picked);}catch(cause){setError(cause instanceof Error?cause.message:'无法读取这个字幕文件。');}finally{if(file.current)file.current.value='';}};
  const nudge=(delta:number)=>controls.setDelay(controls.delay+delta);
  return <div className="media-subtitle-panel">
    <div className="media-subtitle-list" role="radiogroup" aria-label="字幕">{options.map(option=><button type="button" role="radio" key={option.value||'off'} aria-checked={value===option.value} onClick={()=>controls.pick(option.value)}>
      <span><strong>{option.label}</strong>{option.note&&<small>{option.note}</small>}</span>{value===option.value&&<Check size={18} aria-hidden="true"/>}
    </button>)}</div>
    {controls.message&&<p className="media-subtitle-status" role="status">{controls.message}</p>}
    <button type="button" className="media-subtitle-add" onClick={()=>file.current?.click()}><Upload size={18} aria-hidden="true"/>添加外挂字幕</button>
    <input ref={file} type="file" accept=".srt,.vtt,.ass,.ssa" hidden aria-label="选择字幕文件" onChange={event=>void add(event.currentTarget.files?.[0])}/>
    {error&&<p className="media-error" role="alert">{error}</p>}
    <div className="media-subtitle-row"><span>字幕延迟</span><div className="media-subtitle-steps" role="group" aria-label="字幕延迟">
      <button type="button" disabled={!controls.canDelay} onClick={()=>nudge(-0.5)}>−0.5s</button>
      <button type="button" disabled={!controls.canDelay||controls.delay===0} aria-label="恢复字幕时间" title="恢复字幕时间" onClick={()=>controls.setDelay(0)}>{controls.delay>0?'+':''}{controls.delay.toFixed(1)}s</button>
      <button type="button" disabled={!controls.canDelay} onClick={()=>nudge(0.5)}>+0.5s</button>
    </div></div>
    {!controls.canDelay&&value!==''&&<p className="media-subtitle-hint">浏览器内嵌字幕不支持调整延迟。</p>}
    <div className="media-subtitle-row"><span>字号</span><div className="media-subtitle-sizes" role="group" aria-label="字幕字号">{subtitleSizes.map(option=><button type="button" key={option} aria-pressed={size===option} onClick={()=>{player.setSubtitleSize(option);setSize(option);}}>{sizeLabels[option]}</button>)}</div></div>
  </div>;
}

function SpeedOptions({player,onDone}:{player:MediaPlayer;onDone?:()=>void}){
  const [rate,setRate]=useState(player.playbackRate??1);
  return <div className="media-video-speeds" role="group" aria-label="播放速度">{speeds.map(value=><button type="button" key={value} aria-pressed={rate===value} onClick={()=>{player.speed(value);setRate(value);onDone?.();}}>{speedLabel(value)}</button>)}</div>;
}

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

function ToolSheet({tool,onClose,children,tabs}:{tool:Tool;onClose:()=>void;children:ReactNode;tabs?:ReactNode}){
  return <Sheet className="media-video-sheet" title={titles[tool]} onClose={onClose}>{tabs}{children}</Sheet>;
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
  // ---- landscape / fullscreen (prototype 13) ----
  const [fullscreen,setFullscreen]=useState(false),[locked,setLocked]=useState(false),[fill,setFill]=useState(false);
  useEffect(()=>{
    const sync=()=>{const on=!!player.element&&document.fullscreenElement===player.element;setFullscreen(on);if(!on)setLocked(false);};
    document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);
  },[player]);
  useEffect(()=>{const element=player.element;if(!element)return;if(locked)element.dataset.locked='true';else delete element.dataset.locked;return()=>{delete element.dataset.locked;};},[player,locked]);
  useEffect(()=>{const element=player.element;if(!element)return;if(fill)element.dataset.fit='cover';else delete element.dataset.fit;return()=>{delete element.dataset.fit;};},[player,fill]);
  const orientation=()=>(typeof screen!=='undefined'?screen.orientation:undefined) as (ScreenOrientation&{lock?:(value:string)=>Promise<void>})|undefined;
  async function toggleFullscreen(){
    try{
      const entering=document.fullscreenElement!==player.element;
      await player.fullscreenVideo();
      // Phones turn sideways for a film; desktop browsers refuse, which is fine.
      if(entering)await orientation()?.lock?.('landscape').catch(()=>undefined);else orientation()?.unlock?.();
    }catch(error){setNotice(error instanceof Error?error.message:'无法进入全屏。');}
  }
  async function run(action:()=>Promise<void>,close=false){if(busy)return;setBusy(true);setNotice('');try{await action();if(close&&!player.error)setTool(null);}catch(error){setNotice(error instanceof Error?error.message:'操作失败，请重试。');}finally{setBusy(false);}}
  return <section className="media-playback-status media-video-controls" aria-label="播放控制">
    <div className="media-video-caption"><div><strong>{item?.title||player.title}</strong>{edition&&<small>{edition.label}</small>}</div></div>
    <div className="media-video-toolbar media-video-tools">{entries.length>1&&<button onClick={()=>open('episodes')}><ListVideo size={20} aria-hidden="true"/>选集</button>}<button onClick={()=>open('subtitles')}><Subtitles size={20} aria-hidden="true"/>字幕</button><button onClick={()=>open('tracks')}><AudioLines size={20} aria-hidden="true"/>音轨</button><button onClick={()=>open('versions')}><Layers size={20} aria-hidden="true"/>版本</button>{player.isWebVideo&&<button aria-label="横屏全屏播放" onClick={()=>void toggleFullscreen()}><Maximize size={20} aria-hidden="true"/>全屏</button>}<button aria-label="更多播放选项" onClick={()=>open('more')}><Ellipsis size={20} aria-hidden="true"/>更多</button></div>
    {fullscreen&&<div className="media-video-landscape" data-locked={locked?'true':undefined}>
      {locked?<button type="button" className="media-video-unlock" aria-label="解除锁定" onClick={()=>setLocked(false)}><LockOpen size={22} aria-hidden="true"/></button>:<>
        <div className="media-video-landscape-title"><button type="button" className="media-video-icon" aria-label="退出全屏" onClick={()=>void toggleFullscreen()}><Minimize size={20} aria-hidden="true"/></button><strong>{item?.title||player.title}</strong></div>
        <div className="media-video-landscape-tools" role="toolbar" aria-label="横屏播放工具">
          {entries.length>1&&<button type="button" onClick={()=>open('episodes')}><ListVideo size={18} aria-hidden="true"/>选集</button>}
          <button type="button" onClick={()=>open('speed')}><Gauge size={18} aria-hidden="true"/>倍速 {speedLabel(player.playbackRate??1)}</button>
          <button type="button" aria-pressed={fill} onClick={()=>setFill(value=>!value)}>{fill?<Shrink size={18} aria-hidden="true"/>:<Expand size={18} aria-hidden="true"/>}{fill?'完整画面':'适应屏幕'}</button>
          <button type="button" onClick={()=>open('subtitles')}><Subtitles size={18} aria-hidden="true"/>字幕</button>
          <button type="button" onClick={()=>{setTool(null);setLocked(true);}}><Lock size={18} aria-hidden="true"/>锁定</button>
        </div>
      </>}
    </div>}
    {player.error&&<PlaybackProblem player={player} {...(item?.editions.length?{onVersions:()=>open('versions')}:{})} {...(onBack?{onBack}:{})}/>}
    {notice&&<p className="media-error" role="alert">{notice}</p>}
    {plot&&<details className="media-video-description" open><summary>剧情简介</summary><p>{plot}</p></details>}
    {item?.kind==='episode'&&item.parentId&&<VideoEpisodeRail key={item.parentId} api={api} item={item} player={player}/>}
    {!item&&itemId&&!failed&&<MediaLoading layout="tracks" count={2} label="正在读取作品资料…"/>}
    {failed&&<MediaScreenError error={cause} message="作品资料读取失败，播放控制仍可使用。" busy={false} onRetry={()=>setRetry(value=>value+1)} retryLabel="重试作品资料"/>}
    {tool&&<ToolSheet key={isTrackTab(tool)?'tracks':tool} tool={tool} onClose={()=>{if(!busy)setTool(null);}}
      tabs={isTrackTab(tool)?<div className="media-video-tabs" role="tablist" aria-label="字幕与音轨">{trackTabs.map(tab=><button type="button" role="tab" key={tab.tool} aria-selected={tool===tab.tool} onClick={()=>setTool(tab.tool)}>{tab.label}</button>)}</div>:undefined}>
      {tool==='volume'?<Volume player={player}/>:tool==='subtitles'?<SubtitlePanel player={player}/>:tool==='tracks'?<TrackOptions player={player} kind={tool}/>:tool==='speed'?<SpeedOptions player={player} onDone={()=>setTool(null)}/>:tool==='episodes'?<>
        <p>本次播放列表 · {entries.length} 项</p>
        {entries.length>10&&<label className="media-video-search">查找集数<input type="search" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label>}
        <div className="media-video-episodes">{filtered.slice(currentPage*50,currentPage*50+50).map(entry=><button key={entry.index} aria-current={entry.current?'true':undefined} disabled={busy||entry.current||!player.canSelectPlaylist} onClick={()=>void run(()=>player.selectPlaylist(entry.index),true)}><span>{entry.index+1}</span><span>{entry.title}</span>{entry.current&&<Check size={17} aria-label="正在播放"/>}</button>)}</div>
        {!filtered.length&&<p>没有匹配的集数。</p>}{last>0&&<nav aria-label="选集分页"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {last+1}</span><button disabled={currentPage===last} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
      </>:tool==='versions'?<div className="media-video-episodes">{item?.editions.map(value=><button disabled={busy||value.id===edition?.id&&!player.error||!value.parts.length||value.parts.some(part=>!part.available)} aria-current={value.id===edition?.id?'true':undefined} onClick={()=>void run(()=>player.play(value.parts.map(part=>({part,title:item.title+' · '+part.title,video:true}))),true)}><span>{value.label}</span><small>{value.parts.some(part=>!part.available)?'资源缺失':value.id===edition?.id?'当前版本':`${value.parts.length} 个片段`}</small></button>)}</div>:<>
        {entries.length>1&&item?.kind!=='episode'&&<button onClick={()=>open('episodes')}>本次播放列表 · {entries.length} 项</button>}
        <p className="media-video-more-label">倍速 · {speedLabel(player.playbackRate??1)}</p><SpeedOptions player={player}/>
        <div className="media-video-seek"><button disabled={player.playbackUnavailable} onClick={()=>player.skip(-15)}>快退 15 秒</button><button disabled={player.playbackUnavailable} onClick={()=>player.skip(30)}>快进 30 秒</button></div>
        <SleepTimerOptions player={player}/>
        {player.canOpenNativeVideo&&<button onClick={()=>void player.openNativeVideo()}>打开 Android 视频播放器</button>}
        {player.support&&<p>{player.support}</p>}
        <button className="media-video-end" onClick={()=>void player.stop()}><Square size={17} aria-hidden="true"/>结束播放</button>
      </>}
      {(player.error||notice)&&<p role="alert" className="media-error">{player.error||notice}</p>}
    </ToolSheet>}
  </section>;
}
