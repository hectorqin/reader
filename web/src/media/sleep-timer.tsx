import {Check,TimerOff} from 'lucide-preact';
import type {MediaPlayer} from './player.ts';

export function SleepTimerOptions({player,onSelected}:{player:MediaPlayer;onSelected?:()=>void}){
  function choose(minutes:number){player.sleep(minutes);onSelected?.();}
  return <div className="media-sleep-options"><p role="status">{player.sleepAt?'将在 '+player.sleepRemainingMinutes+' 分钟后暂停播放':'选择播放多久后自动暂停'}</p>
    <div className="media-sleep-presets">{[15,30,45,60,90,120].map(minutes=><button key={minutes} onClick={()=>choose(minutes)}>{minutes}<small>分钟</small></button>)}</div>
    <button className="media-sleep-off" onClick={()=>choose(0)}><TimerOff size={18} aria-hidden="true"/><span>关闭定时</span>{!player.sleepAt&&<Check size={17} aria-hidden="true"/>}</button>
  </div>;
}
