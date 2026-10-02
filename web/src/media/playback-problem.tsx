import {LockKeyhole,TriangleAlert} from 'lucide-preact';
import type {MediaPlayer} from './player.ts';

/** Recovery opens an existing selector; it never creates a session automatically. */
export function PlaybackProblem({player,onVersions,onBack,backLabel='返回浏览'}:{player:MediaPlayer;onVersions?:()=>void;onBack?:()=>void;backLabel?:string}){
  const blocked=player.playbackUnavailable,code=player.playbackErrorCode;
  const Icon=blocked?LockKeyhole:TriangleAlert;
  return <section className="media-playback-problem" role="alert">
    <Icon size={28} strokeWidth={1.5} aria-hidden="true"/>
    <strong>{blocked?'播放会话已失效':code===4?'当前设备无法直接播放':code===3?'资源解码失败':'播放提示'}</strong>
    <p>{player.error}</p>
    {!blocked&&<button className="media-primary" onClick={()=>player.retryPlayback()}>重试播放</button>}
    {!blocked&&player.canRetryViaProxy&&<button onClick={()=>player.retryViaProxy()}>通过服务器重试</button>}
    {(onVersions||onBack)&&<div>{onVersions&&<button className={blocked?'media-primary':undefined} onClick={onVersions}>{blocked?'重新选择播放':'选择播放版本'}</button>}{onBack&&<button onClick={onBack}>{backLabel}</button>}</div>}
  </section>;
}
