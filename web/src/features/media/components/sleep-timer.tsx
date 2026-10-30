import { Icon } from '../../../ui/icon.tsx';
import type {MediaPlayer} from '../services/player.ts';

/** `partLabel` names what one entry is ("本章", "本曲", "本集"); without it the stop-after-entry choice is not offered. */
export function SleepTimerOptions({player,onSelected,partLabel}:{player:MediaPlayer;onSelected?:()=>void;partLabel?:string}){
  const stopAfterPart=player.sleepAfterPart===true,timed=!!player.sleepAt,off=!timed&&!stopAfterPart;
  function choose(minutes:number){player.sleep(minutes);onSelected?.();}
  function chooseAfterPart(){player.setSleepAfterPart(true);onSelected?.();}
  return <div className="media-sleep-options"><p role="status">{stopAfterPart?'播完'+partLabel+'后自动暂停，并保留当前进度。':timed?'将在 '+player.sleepRemainingMinutes+' 分钟后暂停播放':'选择播放多久后自动暂停'}</p>
    <div className="media-sleep-presets">{[15,30,45,60,90,120].map(minutes=><button key={minutes} onClick={()=>choose(minutes)}>{minutes}<small>分钟</small></button>)}</div>
    <div className="media-sleep-actions">
      {partLabel&&<button className="media-sleep-part" aria-pressed={stopAfterPart} disabled={!player.canSleepAfterPart} onClick={chooseAfterPart}>播完{partLabel}</button>}
      <button className="media-sleep-off" aria-label="关闭定时" aria-pressed={off} onClick={()=>choose(0)}><Icon name="timer-off" size={18} /><span>关闭定时</span>{off&&<Icon name="check" size={16} />}</button>
    </div>
    {partLabel&&player.canSleepAfterPart===false&&<p className="media-sleep-note">当前播放器不支持播完后暂停。</p>}
  </div>;
}
