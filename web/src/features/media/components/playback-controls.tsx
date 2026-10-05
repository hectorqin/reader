import {MediaSelect} from './select.tsx';
import {SleepTimerOptions} from './sleep-timer.tsx';
import { ChevronLeft, Layers, Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw, Square, Timer, Gauge, Ellipsis, BookOpen, ListMusic, Search, ArrowUp, ArrowDown, X, Volume2, Pencil } from 'lucide-react';
import type { MediaPlayer } from '../services/player.ts';
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import type {Detail,MediaApi,Part} from '../api/media-api.ts';
import {MediaCover} from './cover.tsx';
import {AudiobookChapters} from './audiobook-chapters.tsx';
import type {ChapterPosition} from './edition-details.tsx';
import {SavePlaylist} from './save-playlist.tsx';
import {Lyrics} from './lyrics.tsx';
import {AudioToolSheet,PlaybackFavorite} from './audio-tools.tsx';
import {FloatingNotice} from '../../../ui/floating-notice.tsx';
import {MediaLoading} from './loading.tsx';
import {MediaScreenError} from './screen-error.tsx';
import {PlaybackProblem} from './playback-problem.tsx';

function PlayingArtwork({api,item,failed,onRetry,player,lyrics,onMore}:{api:MediaApi;item:Detail|null;failed:boolean;onRetry:()=>void;player:MediaPlayer;lyrics:boolean;onMore:()=>void}){
  const field=(key:string)=>item?.overrides[key]??item?.metadata[key];
  const edition=item?.editions?.find(entry=>entry.parts.some(part=>part.id===player.currentPartId)),chapter=edition?.parts.find(part=>part.id===player.currentPartId);
  const book=item?.kind==='audiobook';
  const credit=book?[field('narrator')&&String(field('narrator'))+' 演播',field('author')&&String(field('author'))+' 著'].filter(Boolean).join(' · '):[field('artist'),field('album')].filter(Boolean).join(' · ');
  const title=book?chapter?.title||item.title:item?.kind==='track'?item.title:player.title;
  return <>{lyrics?<><div className="media-lyrics-heading"><h2 className="media-playing-title">{title}</h2>{credit&&<p>{credit}</p>}</div><Lyrics key={player.currentPartId} api={api} player={player}/></>:<div className="media-playing-artwork">
    {!item&&!failed&&<FloatingNotice message="正在读取作品资料…" busy />}{item?<MediaCover api={api} item={item} square={!book} retryable/>:<div className="media-artwork-placeholder" role="status" aria-label={failed?'作品资料暂不可用':'正在读取作品资料'}>{failed?'作品资料暂不可用':null}</div>}
    {book&&chapter&&<p className="media-playing-chapter">第 {edition!.parts.indexOf(chapter)+1} / {edition!.parts.length} 章 · {item.title}</p>}
    <div className="media-playing-copy"><div><h2 className="media-playing-title">{title}</h2>{credit&&<p>{credit}</p>}{failed&&<p role="alert">作品资料读取失败。<button onClick={onRetry}>重新读取作品资料</button></p>}</div><button className="media-icon-button" aria-label="当前内容操作" onClick={onMore}><Ellipsis size={20} aria-hidden="true"/></button></div>
  </div>}</>;
}

function PlayingChapters({api,player,item,error,cause,onRetry}:{api:MediaApi;player:MediaPlayer;item:Detail|null;error:string;cause:unknown;onRetry:()=>void}){
  const [editionId,setEditionId]=useState('');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[position,setPosition]=useState<ChapterPosition>({query:'',page:0});
  useEffect(()=>{if(item)setEditionId(previous=>item.editions.some(entry=>entry.id===previous)?previous:item.editions.find(entry=>entry.parts.some(part=>part.id===player.currentPartId))?.id||item.editions[0]?.id||'');},[item]);
  async function run(action:()=>Promise<void>,queue=false){if(busy)return;setBusy(true);setNotice('');try{await action();if(queue)setNotice('已加入待播队列。');}catch(error){setNotice((error instanceof Error?error.message:'操作失败')+(queue?' 请先核对待播队列再重新添加。':''));}finally{setBusy(false);}}
  if(!item&&!error)return <MediaLoading layout="tracks" label="正在读取章节…"/>;
  if(!item)return <MediaScreenError error={cause} message={error} busy={false} onRetry={onRetry} retryLabel="重新读取章节"/>;
  return <><AudiobookChapters api={api} item={item} editionId={editionId} currentPartId={player.currentPartId} busy={busy} onEditionChange={id=>{setEditionId(id);setPosition({query:'',page:0});setNotice('');}} onPlay={(parts:Part[],index:number)=>void run(()=>player.play(parts.map(part=>({part,title:item.title+' · '+part.title,video:false})),index))} onQueue={ids=>void run(async()=>{await api.request('queue','POST',{partIds:ids});},true)} onRefresh={onRetry} position={position} onPositionChange={setPosition}/>{notice&&<p role="status">{notice}</p>}</>;
}

function CurrentPlaylist({player}:{player:MediaPlayer}){
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const [editing,setEditing]=useState(false),[selected,setSelected]=useState<number|null>(null);
  const [searchOpen,setSearchOpen]=useState(player.currentPlaylist.length>10);
  const entries=player.currentPlaylist,filtered=entries.filter(entry=>entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const last=Math.max(0,Math.ceil(filtered.length/50)-1),currentPage=Math.min(page,last);
  const active=entries.find(entry=>entry.index===selected);
  return <section className="media-current-playlist" aria-label="当前播放列表"><div className="media-playlist-toolbar"><h2>当前队列</h2><small>{entries.length} 首 · 正在播放第 {Math.max(0,entries.findIndex(entry=>entry.current))+1} 首</small><details className="media-actions media-playlist-tools"><summary aria-label="队列操作"><Ellipsis size={20} aria-hidden="true"/></summary><nav><button aria-label="查找播放列表" title="查找播放列表" aria-expanded={searchOpen} onClick={()=>{setSearchOpen(!searchOpen);if(searchOpen){setQuery('');setPage(0);}}}><Search size={18} aria-hidden="true"/>查找曲目</button><button aria-label={editing?'完成编辑':'编辑播放列表'} title={editing?'完成编辑':'编辑播放列表'} aria-pressed={editing} disabled={!player.canEditPlaylist} onClick={()=>setEditing(!editing)}><Pencil size={18} aria-hidden="true"/>{editing?'完成编辑':'编辑队列'}</button></nav></details></div>
    {searchOpen&&<div className="media-playlist-search"><label>查找曲目或章节<input type="search" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label><button onClick={()=>{setQuery('');setPage(Math.floor(Math.max(0,entries.findIndex(entry=>entry.current))/50));}}>定位当前播放</button></div>}
    {editing&&<p>调整本次播放顺序，或移除其他条目；正在播放的内容不中断。已保存的待播队列不随此处修改。</p>}
    <ol start={currentPage*50+1}>{filtered.slice(currentPage*50,currentPage*50+50).map(entry=><li key={entry.index}><button className="media-playlist-select" aria-current={entry.current?'true':undefined} disabled={!player.canSelectPlaylist||entry.current} onClick={()=>void player.selectPlaylist(entry.index)}><span className="media-playlist-number" aria-hidden="true">{entry.current?<Volume2 size={17}/>:String(entry.index+1).padStart(2,'0')}</span><span><strong>{entry.title}</strong>{entry.credit&&<small>{entry.credit}</small>}</span></button>{editing&&<div className="media-playlist-edit"><button aria-label={`上移 ${entry.title}`} title="上移" disabled={!player.canEditPlaylist||entry.index===0} onClick={()=>player.editPlaylist(entry.index,-1)}><ArrowUp size={17} aria-hidden="true"/></button><button aria-label={`下移 ${entry.title}`} title="下移" disabled={!player.canEditPlaylist||entry.index===entries.length-1} onClick={()=>player.editPlaylist(entry.index,1)}><ArrowDown size={17} aria-hidden="true"/></button></div>}{entry.duration!==null&&entry.duration!==undefined&&<time>{Math.floor(entry.duration/60)}:{String(Math.floor(entry.duration)%60).padStart(2,'0')}</time>}{editing?<button className="media-playlist-remove" aria-label={`移除 ${entry.title}`} title="移出当前播放列表" disabled={!player.canEditPlaylist||entry.current} onClick={()=>player.editPlaylist(entry.index,0)}><X size={17} aria-hidden="true"/></button>:<button className="media-playlist-more" aria-label={`更多 ${entry.title} 操作`} onClick={()=>setSelected(entry.index)}><Ellipsis size={20} aria-hidden="true"/></button>}</li>)}</ol>
    {active&&<AudioToolSheet title={active.title} onClose={()=>setSelected(null)}><button disabled={!player.canSelectPlaylist||active.current} onClick={()=>{void player.selectPlaylist(active.index);setSelected(null);}}>播放这首</button><button disabled={!player.canEditPlaylist||active.current} onClick={()=>{player.editPlaylist(active.index,0);setSelected(null);}}>移出播放队列</button></AudioToolSheet>}
    {!filtered.length&&<p>没有匹配的曲目或章节。</p>}
    {last>0&&<nav aria-label="当前播放列表分页"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {last+1}</span><button disabled={currentPage===last} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
  </section>;
}

function AudioTimeline({player}:{player:MediaPlayer}) {
  const host=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>host.current?player.mountAudioControls?.(host.current):undefined,[player]);
  return <div className="media-inline-timeline" ref={host}/>;
}

function VolumeControl({player}:{player:MediaPlayer}) {
  const host=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>host.current?player.mountVolumeControl?.(host.current):undefined,[player]);
  return <div ref={host}/>;
}

export type PlaybackPanel='main'|'lyrics'|'queue'|'chapters';
export function PlaybackControls({player,api,panel,onPanelChange,onBack,onFavoriteChange}:{player:MediaPlayer;api:MediaApi;panel?:PlaybackPanel;onPanelChange?:(panel:PlaybackPanel)=>void;onBack?:()=>void;onFavoriteChange?:(id:string,favorite:boolean)=>void}) {
  const [localPanel,setLocalPanel]=useState<PlaybackPanel>('main');
  const [detail,setDetail]=useState<Detail|null>(null),[failed,setFailed]=useState(''),[cause,setCause]=useState<unknown>(),[retry,setRetry]=useState(0);
  const [tool,setTool]=useState<'more'|'versions'|'sleep'|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const itemId=player.currentItemId;
  useEffect(()=>{const abort=new AbortController();setDetail(null);setFailed('');setCause(undefined);if(itemId)void api.detail(itemId,abort.signal).then(value=>{if(!abort.signal.aborted)setDetail(value);}).catch(error=>{if(!abort.signal.aborted){setFailed(error instanceof Error?error.message:'作品资料读取失败');setCause(error);}});return ()=>abort.abort();},[api,itemId,retry]);
  useEffect(()=>{setTool(null);setNotice('');},[itemId]);
  const item=detail?.id===itemId?detail:null;
  // The browsing channel can differ from the still-playing item's channel.
  const channel=player.isVideo?'video':item?.kind==='audiobook'?'audiobook':item?.kind==='track'?'music':undefined;
  const requestedView=panel??localPanel,view=requestedView==='chapters'&&!!channel&&channel!=='audiobook'?'main':requestedView==='lyrics'&&channel!=='music'?'main':requestedView,lyrics=view==='lyrics';
  const setView=(value:PlaybackPanel)=>{if(onPanelChange)onPanelChange(value);else setLocalPanel(value);};
  const edition=item?.editions?.find(entry=>entry.parts.some(part=>part.id===player.currentPartId));
  function open(value:'more'|'versions'|'sleep'){setNotice('');setTool(value);}
  async function changeVersion(id:string){if(busy||!item)return;const target=item.editions.find(entry=>entry.id===id);if(!target||!target.parts.length||target.parts.some(part=>!part.available))return;setBusy(true);setNotice('');try{await player.play(target.parts.map(part=>({part,title:item.title+' · '+part.title,video:false})));if(!player.error)setTool(null);}catch(error){setNotice(error instanceof Error?error.message:'版本切换失败，请重试。');}finally{setBusy(false);}}
  if(!player.active)return null;
  const speed=<label title="播放倍速"><Gauge size={18} aria-hidden="true"/><MediaSelect aria-label="倍速" value={player.playbackRate} onChange={e=>player.speed(Number(e.currentTarget.value))}>{[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3].map(value=><option key={value} value={value}>{value}×</option>)}</MediaSelect></label>;
  return <>
    {onBack&&<header className="media-heading media-audio-heading"><button className="media-back-button" aria-label={requestedView==='main'?'← 返回浏览':'← 返回播放'} title={requestedView==='main'?'返回浏览':'返回播放'} onClick={onBack}><ChevronLeft size={20} aria-hidden="true"/></button><strong>{view==='chapters'?'章节列表':view==='lyrics'?'歌词':view==='queue'?'播放队列':channel==='music'?'音乐播放':channel==='audiobook'?'有声书播放':channel==='video'?'视频播放':'正在播放'}</strong><button className="media-icon-button" aria-label="更多播放选项" title="更多播放选项" onClick={()=>open('more')}><Ellipsis size={20} aria-hidden="true"/></button></header>}
    <section className="media-playback-status" data-panel={view} data-channel={channel??'unknown'} aria-label="播放控制">
    {(player.isVideo||!itemId)&&<header className="media-now-playing"><div><small>正在播放</small><strong>{player.title}</strong></div><button className="media-symbol-button" aria-label="结束" title="结束播放" onClick={()=>void player.stop()}><Square size={18} aria-hidden="true"/></button></header>}
    {player.error&&<PlaybackProblem player={player} {...(item?.editions.length?{onVersions:()=>open('versions')}:{})} {...(onBack?{onBack}:{})} backLabel={view==='main'?'返回浏览':'返回播放'}/>}
    {!player.error&&player.loadingStatus&&<FloatingNotice message={player.loadingStatus} busy />}
    {player.canOpenNativeVideo&&<button onClick={()=>void player.openNativeVideo()}>打开 Android 视频播放器</button>}
    {view==='chapters'?<PlayingChapters key={itemId} player={player} api={api} item={item} error={failed} cause={cause} onRetry={()=>setRetry(value=>value+1)}/>:view==='queue'?<CurrentPlaylist player={player}/>:!player.isVideo&&itemId&&<PlayingArtwork api={api} item={item} failed={!!failed} onRetry={()=>setRetry(value=>value+1)} player={player} lyrics={lyrics} onMore={()=>open('more')}/>}
    {view!=='queue'&&view!=='chapters'&&<div className="media-audio-bottom">
    {!player.isVideo&&<AudioTimeline player={player}/>}
    <div className="media-transport">
      {channel==='audiobook'&&<button className="media-symbol-button media-skip" aria-label="快退 15 秒" title="快退 15 秒" disabled={player.playbackUnavailable} onClick={()=>player.skip(-15)}><RotateCcw size={24} aria-hidden="true"/><small aria-hidden="true">15</small></button>}
      {channel!=='audiobook'&&<button className="media-symbol-button" aria-label="上一首 / 章" title="上一首 / 章" disabled={!player.canPrevious} onClick={()=>void player.move(-1)}><SkipBack size={26} aria-hidden="true"/></button>}
      <button disabled={player.playbackUnavailable} className="media-toggle-play" aria-label={player.playbackUnavailable?'请重新选择播放':player.paused?'继续':'暂停'} onClick={()=>player.toggle()}>{player.paused?<Play size={30} fill="currentColor" aria-hidden="true"/>:<Pause size={30} fill="currentColor" aria-hidden="true"/>}</button>
      {channel!=='audiobook'&&<button className="media-symbol-button" aria-label="下一首 / 章" title="下一首 / 章" disabled={!player.canNext} onClick={()=>void player.move(1)}><SkipForward size={26} aria-hidden="true"/></button>}
      {channel==='audiobook'&&<button className="media-symbol-button media-skip" aria-label="快进 30 秒" title="快进 30 秒" disabled={player.playbackUnavailable} onClick={()=>player.skip(30)}><RotateCw size={24} aria-hidden="true"/><small aria-hidden="true">30</small></button>}
    </div>
    <div className="media-playback-options">
      {channel==='music'?<PlaybackFavorite key={itemId} api={api} itemId={itemId} {...(onFavoriteChange?{onChanged:onFavoriteChange}:{})}/>:speed}
      <button className="media-lyrics-toggle" aria-label="睡眠定时" aria-haspopup="dialog" onClick={()=>open('sleep')}><Timer size={18} aria-hidden="true"/><span>{player.sleepAt?player.sleepRemainingMinutes+' 分钟':'定时'}</span></button>
      <button className="media-lyrics-toggle" aria-label={channel==='audiobook'?'全部章节':'播放队列'} onClick={()=>setView(channel==='audiobook'?'chapters':'queue')}>{channel==='audiobook'?<BookOpen size={18} aria-hidden="true"/>:<ListMusic size={18} aria-hidden="true"/>}<span>{channel==='audiobook'?'章节':'队列'}</span></button>
      {channel==='audiobook'?<button className="media-lyrics-toggle" aria-label="播放版本" onClick={()=>open('versions')}><Layers size={18} aria-hidden="true"/><span>版本</span></button>:channel==='music'?<button className="media-lyrics-toggle" aria-label={lyrics?'封面':'歌词'} aria-pressed={lyrics} onClick={()=>setView(lyrics?'main':'lyrics')}><BookOpen size={18} aria-hidden="true"/><span>{lyrics?'封面':'歌词'}</span></button>:null}
      {!onBack&&<button className="media-lyrics-toggle" aria-label="更多播放选项" onClick={()=>open('more')}><Ellipsis size={20} aria-hidden="true"/></button>}
    </div>
    </div>}
    {tool&&<AudioToolSheet key={tool} title={tool==='sleep'?'睡眠定时':tool==='more'?'更多播放选项':'播放版本'} onClose={()=>{if(!busy)setTool(null);}}>
      {tool==='sleep'?<SleepTimerOptions player={player} onSelected={()=>setTool(null)}/>:tool==='versions'?<div className="media-audio-versions">{item?.editions?.map(value=><button key={value.id} disabled={busy||value.id===edition?.id&&!player.error||!value.parts.length||value.parts.some(part=>!part.available)} aria-current={value.id===edition?.id?'true':undefined} onClick={()=>void changeVersion(value.id)}><strong>{value.label}</strong><small>{value.parts.some(part=>!part.available)?'资源缺失':value.id===edition?.id?'当前版本':value.parts.length+' 个章节'}</small></button>)}</div>:<>
        <VolumeControl player={player}/>{channel!=='audiobook'&&<div className="media-audio-speed">{speed}</div>}
        <div className="media-audio-shortcuts"><button aria-label="上一首 / 章" disabled={!player.canPrevious} onClick={()=>void player.move(-1)}><SkipBack size={18} aria-hidden="true"/>上一{channel==='music'?'首':'章'}</button><button aria-label="下一首 / 章" disabled={!player.canNext} onClick={()=>void player.move(1)}><SkipForward size={18} aria-hidden="true"/>下一{channel==='music'?'首':'章'}</button></div>
        <div className="media-audio-shortcuts"><button aria-label="快退 15 秒" disabled={player.playbackUnavailable} onClick={()=>player.skip(-15)}><RotateCcw size={18} aria-hidden="true"/>15 秒</button><button aria-label="快进 30 秒" disabled={player.playbackUnavailable} onClick={()=>player.skip(30)}><RotateCw size={18} aria-hidden="true"/>30 秒</button></div>
        {channel==='audiobook'&&<button aria-label="播放队列" onClick={()=>{setTool(null);setView('queue');}}>当前播放队列</button>}
        <SavePlaylist api={api} player={player}/>{player.support&&<p className="media-audio-support">{player.support}</p>}
        <button className="media-end-playback" onClick={()=>void player.stop()}><Square size={17} aria-hidden="true"/>结束播放</button>
      </>}
      {(notice||player.error)&&<p role="alert" className="media-error">{notice||player.error}</p>}
    </AudioToolSheet>}
    </section>
  </>;
}
