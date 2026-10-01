import DPlayer from 'dplayer';
import './dplayer.css';

/** Bind DPlayer before its media listeners are installed, retaining Reader's session node. */
export function enhanceVideo(video:HTMLVideoElement,onToggle:()=>void){
  const parent=video.parentElement;
  if(!parent)return null;
  const host=document.createElement('div');host.className='dplayer-host';parent.insertBefore(host,video);
  class ReaderDPlayer extends DPlayer {
    override initVideo(generated:HTMLVideoElement,type:string){
      generated.replaceWith(video);
      video.classList.add('dplayer-video','dplayer-video-current');
      this.video=video;this.template.video=video;
      super.initVideo(video,type);
    }
    override toggle(){onToggle();}
  }
  try {
    const player=new ReaderDPlayer({container:host,video:{url:'',type:'normal'},lang:'zh-cn',autoplay:false,loop:false,mutex:false,hotkey:true,theme:'#b9d98a',contextmenu:[]});
    video.controls=false;
    return player;
  } catch(error){parent.insertBefore(video,host);host.remove();throw error;}
}
