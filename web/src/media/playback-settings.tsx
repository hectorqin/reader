import {MediaSelect} from './select.tsx';
import {useState} from '../ui/vendor/preact.ts';
import {readPlaybackPreferences,savePlaybackPreferences,playbackRates} from './playback-preferences.ts';
import type {MediaPlayer} from './player.ts';
import {SleepTimerOptions} from './sleep-timer.tsx';
export function PlaybackSettings({scope,player,onPlayback}:{scope:string;player:MediaPlayer;onPlayback?:()=>void}) {
  const [value,setValue]=useState(()=>readPlaybackPreferences(scope)),[error,setError]=useState('');
  function change(patch:Partial<typeof value>){const next={...value,...patch};try{savePlaybackPreferences(scope,next);setValue(next);setError('');}catch{setError('无法保存播放偏好，请检查设备存储。');}}
  return <section className="media-settings-panel"><h2>播放偏好</h2>
    <label className="media-setting-field">默认倍速<MediaSelect aria-label="默认倍速" value={value.defaultRate} onChange={event=>change({defaultRate:Number(event.currentTarget.value)})}>{playbackRates.map(rate=><option value={rate}>{rate}×</option>)}</MediaSelect></label>
    <label className="media-settings-check"><span>连续播放</span><input type="checkbox" checked={value.continuous} onChange={event=>change({continuous:event.currentTarget.checked})}/></label>
    <p className="media-theme-note">默认倍速在结束后再次开始播放时使用。连续播放适用于网页播放器，原生播放器使用其自身的队列设置。</p>
    {error&&<p role="alert">{error}</p>}
    {player.active&&<><h2>当前播放</h2><div className="media-settings-playing"><strong>{player.title}</strong>{onPlayback&&<button onClick={onPlayback}>打开播放器</button>}</div><label className="media-setting-field">当前倍速<MediaSelect aria-label="播放倍速" value={player.playbackRate} onChange={event=>player.speed(Number(event.currentTarget.value))}>{playbackRates.map(rate=><option value={rate}>{rate}×</option>)}</MediaSelect></label><h2>睡眠定时</h2><SleepTimerOptions player={player}/></>}
  </section>;
}
