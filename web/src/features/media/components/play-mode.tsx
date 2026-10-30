import { Icon } from '../../../ui/icon.tsx';
import type {MediaPlayer} from '../services/player.ts';
import {playModeLabels,playModes} from '../services/play-mode.ts';

/** The 播放队列 panel's choice of how the queue advances: in order, at random, or the same entry again. */
export function PlayModeSegments({player}:{player:MediaPlayer}){
  return <div className="media-play-mode" role="group" aria-label="播放模式"><span aria-hidden="true">播放模式</span>
    <div>{playModes.map(mode=><button key={mode} aria-pressed={player.playMode===mode} onClick={()=>player.setPlayMode(mode)}>{playModeLabels[mode]}</button>)}</div>
  </div>;
}

/** One tap on the transport row steps through the modes. Disabled, not hidden, where the player cannot honour a mode, so the row keeps its balance. */
export function PlayModeCycle({player}:{player:MediaPlayer}){
  const mode=player.playMode??'sequential',next=playModes[(playModes.indexOf(mode)+1)%playModes.length]!;
  const glyph=mode==='shuffle'?'shuffle':mode==='repeat-one'?'repeat-one':'repeat';
  const label='播放模式：'+playModeLabels[mode];
  return <button className="media-symbol-button media-play-mode-cycle" data-mode={mode} aria-label={label} disabled={!player.canChoosePlayMode} title={player.canChoosePlayMode?label+'，点按切换为'+playModeLabels[next]:'当前播放器不支持切换播放模式'} onClick={()=>player.setPlayMode(next)}><Icon name={glyph} size={20} /></button>;
}
