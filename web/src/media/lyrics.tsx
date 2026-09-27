import { useEffect, useRef, useState } from '../ui/vendor/preact.ts';
import type { MediaApi } from './api.ts';
import type { MediaPlayer } from './player.ts';
import {LocateFixed,Music2} from 'lucide-preact';
interface LyricsData {synced:boolean;lines:Array<{time:number|null;text:string}>;source:string}
export function Lyrics({api,player}:{api:MediaApi;player:MediaPlayer}){
  const partId=player.currentPartId;
  const [data,setData]=useState<LyricsData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[position,setPosition]=useState(player.position),[follow,setFollow]=useState(true);
  const viewport=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    const abort=new AbortController();setData(null);setError('');setFollow(true);
    void api.request<LyricsData>('parts/'+encodeURIComponent(partId)+'/lyrics','GET',undefined,abort.signal).then(result=>{if(!abort.signal.aborted)setData(result);}).catch(error=>{if(!abort.signal.aborted)setError(error instanceof Error?error.message:'无法读取歌词');});
    return ()=>abort.abort();
  },[api,partId,retry]);
  useEffect(()=>{setPosition(player.position);const timer=setInterval(()=>setPosition(player.position),250);return ()=>clearInterval(timer);},[player,partId]);
  let activeTime:number|null=null;
  if(data?.synced)for(const line of data.lines){if(line.time!==null&&line.time<=position)activeTime=line.time;else break;}
  useEffect(()=>{
    if(!follow||activeTime===null)return;
    const host=viewport.current;if(!host)return;
    const align=()=>{
      const current=host.querySelectorAll<HTMLElement>('[aria-current=true]'),first=current[0],last=current[current.length-1];
      if(!first||!last)return;
      const height=last.offsetTop+last.offsetHeight-first.offsetTop;
      host.scrollTop=Math.max(0,first.offsetTop-(height>host.clientHeight-32?16:(host.clientHeight-height)/2));
    };
    align();
    if(typeof ResizeObserver==='undefined')return;
    const resize=new ResizeObserver(align);resize.observe(host);
    host.querySelectorAll('[aria-current=true]').forEach(line=>resize.observe(line));
    document.fonts?.addEventListener('loadingdone',align);
    return ()=>{resize.disconnect();document.fonts?.removeEventListener('loadingdone',align);};
  },[activeTime,follow]);
  return <section className="media-lyrics" aria-label="歌词">
    {error?<div className="media-lyrics-empty" role="alert"><Music2 size={30} aria-hidden="true"/><h3>歌词暂时无法读取</h3><p>{error}</p><button onClick={()=>setRetry(retry+1)}>重试歌词</button></div>:!data?<div className="media-lyrics-empty media-lyrics-loading" role="status"><span>正在读取歌词…</span><i aria-hidden="true"/><i aria-hidden="true"/><i aria-hidden="true"/></div>:!data.lines.length?<div className="media-lyrics-empty"><Music2 size={30} aria-hidden="true"/><h3>暂无歌词</h3><p>可在音频旁放置同名 .lrc 文件。</p></div>:<>
      <div className="media-toolbar media-lyrics-toolbar"><small title={data.source==='sidecar'?'本地歌词文件':'内嵌歌词标签'}>{data.synced?'点击歌词跳转':'纯文本歌词'}</small>{data.synced&&<button aria-label={follow?'暂停跟随':'跟随播放'} title={follow?'暂停跟随':'跟随播放'} aria-pressed={follow} onClick={()=>setFollow(!follow)}><LocateFixed size={18} aria-hidden="true"/></button>}</div>
      <div ref={viewport} className="media-lyrics-lines" tabIndex={0} aria-label="歌词文本" onWheel={()=>setFollow(false)} onTouchStart={()=>setFollow(false)} onKeyDown={event=>{
        if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key))return;
        // Avoid a native page-scroll animation finishing after the user resumes following.
        event.preventDefault();setFollow(false);const host=event.currentTarget;
        host.scrollTop=event.key==='Home'?0:event.key==='End'?host.scrollHeight:host.scrollTop+(event.key==='ArrowUp'?-40:event.key==='ArrowDown'?40:event.key==='PageUp'?-host.clientHeight*.8:host.clientHeight*.8);
      }}>{data.lines.map((line,index)=>line.time===null?<p key={index}>{line.text}</p>:<button key={index} data-secondary={index>0&&data.lines[index-1]?.time===line.time?'true':undefined} disabled={player.playbackUnavailable} aria-current={line.time===activeTime?'true':undefined} onClick={()=>{player.seek(line.time!);setPosition(line.time!);setFollow(true);}}>{line.text||'♪'}</button>)}</div>
    </>}
  </section>;
}
