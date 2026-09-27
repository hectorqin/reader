import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import icons from './vendor/plyr.svg?url';

/** Plyr owns presentation only. The existing video node retains sessions, tracks and progress. */
export function enhanceVideo(video:HTMLVideoElement,onToggle:()=>void){
  const player=new Plyr(video,{
    iconUrl:icons,blankVideo:'',storage:{enabled:false},autoplay:false,clickToPlay:true,
    keyboard:{focused:true,global:false},settings:['speed'],speed:{selected:1,options:[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3]},
    controls:['play-large','play','progress','current-time','duration','mute','volume','settings','pip','fullscreen'],
    listeners:{play:()=>{onToggle();return false;}},
    i18n:{play:'播放',pause:'暂停',seek:'播放进度',seekLabel:'{currentTime} / {duration}',played:'已播放',buffered:'已缓冲',currentTime:'当前时间',duration:'总时长',volume:'音量',mute:'静音',unmute:'取消静音',enterFullscreen:'全屏',exitFullscreen:'退出全屏',settings:'播放设置',pip:'画中画',menuBack:'返回',speed:'倍速',normal:'正常',enabled:'开启',disabled:'关闭'},
  });
  // Plyr's keyboard toggle bypasses its click listener; keep lease renewal on this path too.
  video.closest('.plyr')?.addEventListener('keydown',event=>{
    const key=event as KeyboardEvent,target=key.target as HTMLElement|null;
    if(![' ','k'].includes(key.key)||key.altKey||key.ctrlKey||key.metaKey||key.shiftKey||target?.closest('input,textarea,select,[contenteditable="true"]')||key.key===' '&&target?.closest('button,[role^="menuitem"]'))return;
    key.preventDefault();key.stopImmediatePropagation();if(!key.repeat)onToggle();
  },true);
  return player;
}
