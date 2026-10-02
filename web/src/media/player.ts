import {MiniNowPlaying} from './mini-now-playing.tsx';
import {readPlaybackPreferences} from './playback-preferences.ts';
import {createElement,render} from '../ui/vendor/preact.ts';
import {Play,Pause,X} from 'lucide-preact';
import { MediaApi } from './api.ts';
import type { Part, Playback, Progress } from './api.ts';
import { PlaybackLease } from './playback-lease.ts';
import { SubtitleControls } from './subtitles.ts';
import { AudioTrackControls } from './audio-tracks.ts';
import { NativeAudio } from './native-audio.ts';
import { playbackSupport, playbackFailure, type PlaybackStream } from './playback-support.ts';

/** Lives outside screen mounts. Navigation must not destroy background audio. */
export class MediaPlayer extends EventTarget {
  readonly element=document.createElement('div');
  readonly audio=document.createElement('audio');
  readonly video=document.createElement('video');
  readonly videoControlsHost=document.createElement('div');
  private readonly videoWorkspace=document.createElement('div');
  private customVideoControls=false;
  private webVideo:{destroy?:()=>void}|null=null;
  private webVideoLoading:Promise<void>|null=null;
  private ensureWebVideo(){
    return this.webVideoLoading??=import('./web-video.ts').then(({enhanceVideo})=>{this.webVideo=enhanceVideo(this.video,()=>this.toggle());}).catch(()=>{this.webVideoLoading=null;this.video.controls=true;});
  }
  private readonly mini=document.createElement('div');
  private readonly miniTitle=document.createElement('button');
  private readonly miniToggle=document.createElement('button');
  private readonly miniClose=document.createElement('button');
  private readonly miniTime=document.createElement('span');
  private readonly miniProgress=document.createElement('progress');
  private readonly audioControls=document.createElement('div');
  private readonly chapterSeek=document.createElement('input');
  private seekSession:Playback|null=null;
  private readonly volumeLabel=document.createElement('label');
  private session:Playback|null=null;
  private media:HTMLMediaElement=this.audio;
  private generation=0;
  private sequence=0;
  private finishedSession='';
  private ready=false;
  private completed=false;
  private saving:Promise<void>=Promise.resolve();
  private readonly pendingProgress=new WeakMap<Playback,{sequence:number;revision:number;position:number;completed:boolean}>();
  private lastSave=0;
  private timer:ReturnType<typeof setTimeout>|null=null;
  sleepAt=0;
  private sleepTicker:ReturnType<typeof setInterval>|null=null;
  get sleepRemainingMinutes(){return this.sleepAt?Math.max(0,Math.ceil((this.sleepAt-Date.now())/60000)):0;}
  private lease:PlaybackLease|null=null;
  private playbackBlocked=false;
  get playbackUnavailable(){return this.playbackBlocked;}
  get playbackErrorCode(){return this.nativeActive?undefined:this.media.error?.code;}
  private resumeIntent=0;
  private readonly subtitles:SubtitleControls;
  private readonly audioTracks:AudioTrackControls;
  private readonly native=NativeAudio.available();
  private nativeActive=false;
  private nativeQueueId='';
  private restoreNative=false;
  private readonly nativeControls=document.createElement('div');
  private queue:Array<{part:Part;title:string;video:boolean;credit?:string}>=[];
  private queueIndex=0;
  private switching=false;
  playbackRate=1;
  get isVideo(){return this.media===this.video;}
  get isWebVideo(){return this.isVideo&&!this.nativeActive;}
  get canOpenNativeVideo(){return !!this.native&&this.active&&this.media===this.video;}
  async openNativeVideo(){
    if(!this.canOpenNativeVideo)return;
    if(this.nativeActive){this.native!.command('showVideo');return;}
    try{await this.play(this.queue,this.queueIndex,true);}
    catch(error){this.error=error instanceof Error?error.message:'无法打开原生视频播放器，请重试。';this.changed();}
  }
  title='';
  error='';
  support='';
  loadingStatus='';
  private proxyFallback=false;
  private corsRetry=false;
  private allowAutomaticFallback=false;
  private sourceAttempt=0;
  private startupTimer:ReturnType<typeof setTimeout>|undefined;
  private startupAt=0;
  private clearStartupTimer(){if(this.startupTimer)clearTimeout(this.startupTimer);this.startupTimer=undefined;}
  private watchStartup(generation:number){
    this.clearStartupTimer();
    this.startupTimer=setTimeout(()=>{
      if(generation!==this.generation||!this.active)return;
      if(this.retryWithProxy())return;
      ++this.sourceAttempt;this.media.pause();this.loadingStatus='';
      this.error='连接或缓冲超时，请检查网络后重试。';this.changed();
    },20000);
  }
  retryPlayback(){if(!this.active||this.playbackBlocked||this.loadingStatus)return;void this.resume();}
  get canRetryViaProxy(){return this.active&&!this.nativeActive&&!this.playbackBlocked&&!this.proxyFallback;}
  retryViaProxy(){this.allowAutomaticFallback=true;this.retryWithProxy(true);}
  private recoverWebPlayback():boolean{
    if(this.session&&this.allowAutomaticFallback&&this.session.playbackMode==='auto'&&!this.proxyFallback&&!this.corsRetry&&!this.nativeActive&&!this.playbackBlocked){
      this.corsRetry=true;this.clearStartupTimer();
      if(this.ready&&Number.isFinite(this.media.currentTime))this.session.position=this.media.currentTime;
      this.ready=false;this.error='';this.loadingStatus='正在尝试兼容跨域的直连方式…';
      this.media.crossOrigin='anonymous';(this.media as HTMLMediaElement&{referrerPolicy?:string}).referrerPolicy='no-referrer';this.media.src=this.api.streamUrl(this.session);
      const generation=this.generation;this.beginWebPlayback(generation);this.changed();

      return true;
    }
    return this.retryWithProxy();
  }
  private retryWithProxy(force=false):boolean{
    if(!this.session||!this.allowAutomaticFallback||(!force&&this.session.playbackMode!=='auto')||this.proxyFallback||this.nativeActive||this.playbackBlocked)return false;
    this.proxyFallback=true;this.clearStartupTimer();
    if(this.ready&&Number.isFinite(this.media.currentTime))this.session.position=this.media.currentTime;
    this.ready=false;this.error='';this.loadingStatus='直连不可用，正在通过服务器连接…';
    this.media.removeAttribute('crossorigin');
    this.media.src=this.api.streamUrl(this.session)+'&proxy=1';
    this.beginWebPlayback(this.generation);this.changed();return true;
  }
  private beginWebPlayback(generation:number){
    this.watchStartup(generation);
    const attempt=++this.sourceAttempt;
    void this.media.play().catch(error=>{
      if(generation!==this.generation||attempt!==this.sourceAttempt)return;
      if(error?.name!=='NotAllowedError'&&error?.name!=='AbortError'&&this.recoverWebPlayback())return;
      this.clearStartupTimer();this.loadingStatus='';this.error=playbackFailure(error,this.media.error);this.changed();
    });
  }
  active=false;
  private visible=true;
  setVisible(visible:boolean){this.visible=visible;this.element.hidden=!visible||!this.active;}
  setControlsExpanded(expanded:boolean){this.element.classList.toggle('media-player-expanded',expanded);this.miniTitle.setAttribute('aria-expanded',String(expanded));if(!expanded&&document.fullscreenElement===this.element)void document.exitFullscreen().catch(()=>{});}
  /** Reuse the live seek control, including its chapter/session guards. */
  mountAudioControls(host: HTMLElement): () => void {
    host.append(this.audioControls, this.miniTime, this.nativeControls, this.audioTracks.element);
    return () => {
      this.element.append(this.audioControls, this.nativeControls, this.audioTracks.element);
      this.mini.insertBefore(this.miniTime, this.miniProgress);
    };
  }
  mountVolumeControl(host: HTMLElement): () => void {
    host.append(this.volumeLabel);
    return () => { this.audioControls.append(this.volumeLabel); };
  }
  /** The video itself stays attached for its entire lifetime; only controls move. */
  mountVideoTimeline(host: HTMLElement): () => void {
    this.customVideoControls=true;this.video.controls=false;
    host.append(this.chapterSeek,this.miniTime);
    this.chapterSeek.setAttribute('aria-label','视频播放进度');
    return ()=>{
      this.customVideoControls=false;this.video.controls=!this.webVideo&&!this.playbackBlocked;
      this.audioControls.prepend(this.chapterSeek);this.mini.insertBefore(this.miniTime,this.miniProgress);
      this.chapterSeek.setAttribute('aria-label','当前章节播放位置');
    };
  }
  mountVideoTracks(host:HTMLElement,kind:'subtitles'|'tracks'):()=>void {
    const control=kind==='subtitles'?this.subtitles.element:this.audioTracks.element;
    host.append(control);return ()=>{this.element.append(control);};
  }
  async fullscreenVideo():Promise<void>{
    if(document.fullscreenElement===this.element){await document.exitFullscreen();return;}
    if(this.element.requestFullscreen){await this.element.requestFullscreen();return;}
    const video=this.video as HTMLVideoElement&{webkitEnterFullscreen?:()=>void};
    if(video.webkitEnterFullscreen){video.webkitEnterFullscreen();return;}
    throw new Error('此浏览器不支持全屏播放。');
  }
  focusControlsEntry(){if(this.active&&this.visible)this.miniTitle.focus({preventScroll:true});}
  constructor(private readonly api:MediaApi) {
    super();this.element.className='media-player';this.element.hidden=true;
    this.mini.className='media-mini';
    this.miniTitle.className='media-mini-title';this.miniTitle.setAttribute('aria-label','打开播放控制');
    this.miniTitle.setAttribute('aria-expanded','false');
    this.miniTitle.addEventListener('click',()=>this.dispatchEvent(new Event('open-controls')));
    this.miniToggle.setAttribute('aria-label','暂停音频');this.miniToggle.addEventListener('click',()=>this.toggle());
    this.miniToggle.className='media-mini-toggle';this.miniTime.className='media-mini-time';
    this.miniProgress.className='media-mini-progress';this.miniProgress.setAttribute('aria-label','当前章节进度');
    this.miniClose.className='media-mini-close';this.miniClose.setAttribute('aria-label','关闭播放器');this.miniClose.title='关闭播放器';this.miniClose.addEventListener('click',()=>void this.stop());render(createElement(X,{size:19,'aria-hidden':true}),this.miniClose);
    this.mini.append(this.miniTitle,this.miniToggle,this.miniClose,this.miniTime,this.miniProgress);
    this.audioControls.className='media-audio-controls';
    this.chapterSeek.type='range';this.chapterSeek.min='0';this.chapterSeek.step='0.1';
    this.chapterSeek.setAttribute('aria-label','当前章节播放位置');
    this.chapterSeek.addEventListener('input',()=>{this.seekSession??=this.session;this.chapterSeek.setAttribute('aria-valuetext',this.chapterSeek.value+' 秒');});
    this.chapterSeek.addEventListener('change',()=>{
      const origin=this.seekSession,value=Number(this.chapterSeek.value);this.seekSession=null;
      if(this.session&&(!origin||origin===this.session))this.seek(this.session.start+value);
      else this.updateMiniProgress();
    });
    const cancelSeek=()=>{this.seekSession=null;this.updateMiniProgress();};
    this.chapterSeek.addEventListener('pointercancel',cancelSeek);this.chapterSeek.addEventListener('blur',cancelSeek);
    const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='1';volume.step='0.05';volume.value='1';volume.setAttribute('aria-label','音量');
    volume.addEventListener('input',()=>{this.media.volume=Number(volume.value);this.media.muted=false;});
    for(const media of [this.audio,this.video])media.addEventListener('volumechange',()=>{if(media===this.media)volume.value=String(media.muted?0:media.volume);});
    this.volumeLabel.className='media-volume';this.volumeLabel.textContent='音量';this.volumeLabel.append(volume);
    this.audioControls.append(this.chapterSeek,this.volumeLabel);
    this.subtitles=new SubtitleControls(api,this.video);
    this.audioTracks=new AudioTrackControls(api);
    this.nativeControls.className='media-native-controls';this.nativeControls.hidden=true;
    const nativeTrackLabel=document.createElement('label');nativeTrackLabel.textContent='音轨 ';nativeTrackLabel.hidden=true;
    const nativeTrackSelect=document.createElement('select');nativeTrackSelect.setAttribute('aria-label','原生音轨');nativeTrackLabel.append(nativeTrackSelect);this.nativeControls.append(nativeTrackLabel);
    nativeTrackSelect.addEventListener('change',()=>{
      const state=this.native?.state,track=state?.audioTracks?.find(value=>value.id===nativeTrackSelect.value);
      if(this.nativeActive&&state&&state.sessionId===this.session?.id&&track?.supported&&Number.isSafeInteger(state.tracksVersion))this.native?.command('audioTrack',{sessionId:state.sessionId,id:track.id,groupId:track.groupId,tracksVersion:state.tracksVersion});
    });
    this.native?.addEventListener('change',()=>{
      const state=this.native!.state;
      if(this.restoreNative&&state.sessionId){
        this.restoreNative=false;
        const identity=this.api.nativeCredentials();
        if(identity.userId!==state.userId||identity.baseUrl!==state.baseUrl){this.native!.command('stop');return;}
        if(!state.partId||!state.queueId||typeof state.start!=='number'||!Number.isFinite(state.start)||state.start<0||
          (state.end!==null&&(typeof state.end!=='number'||!Number.isFinite(state.end)||state.end<state.start)))return;
        this.nativeActive=true;this.active=true;this.nativeQueueId=state.queueId;this.nativeControls.hidden=false;
        this.media=state.video?this.video:this.audio;
        this.audio.hidden=true;this.video.hidden=true;this.element.hidden=!this.visible;
        this.title=state.title||'正在播放';
        this.session={id:state.sessionId,itemId:state.itemId||'',partId:state.partId,start:state.start!,end:state.end??null,position:state.position,
          expiresAt:0,streamUrl:'',contentType:state.video?'video/native':'audio/native',revision:0};
      }
      if(!this.nativeActive||!this.session)return;
      if(state.queueId===this.nativeQueueId&&state.sessionId&&state.sessionId!==this.session.id){
        this.session={...this.session,id:state.sessionId,itemId:state.itemId||'',partId:state.partId||'',start:state.start??0,end:state.end??null};
        this.queueIndex=state.queueIndex??this.queueIndex;this.title=state.title||this.title;
      }
      if(state.sessionId!==this.session.id)return;
      const tracks=Array.isArray(state.audioTracks)?state.audioTracks.filter(track=>track&&typeof track.id==='string'&&typeof track.groupId==='string'&&typeof track.label==='string'&&typeof track.supported==='boolean'&&typeof track.selected==='boolean'):[];
      nativeTrackLabel.hidden=tracks.length<2;
      const signature=JSON.stringify(tracks);
      if(nativeTrackSelect.dataset.tracks!==signature){
        nativeTrackSelect.dataset.tracks=signature;nativeTrackSelect.replaceChildren();
        for(const track of tracks){const option=document.createElement('option');option.value=track.id;option.textContent=track.label+(track.supported?'':'（设备不支持）');option.disabled=!track.supported;option.selected=track.selected;nativeTrackSelect.append(option);}
      }
      if(typeof state.sleepAt==='number'&&Number.isFinite(state.sleepAt)&&state.sleepAt>=0)this.sleepAt=state.sleepAt;
      if(typeof state.speed==='number'&&Number.isFinite(state.speed)&&state.speed>=0.5&&state.speed<=3)this.playbackRate=state.speed;
      this.ready=true;this.loadingStatus='';
      this.error=state.error||'';
      // Native service owns end-of-part transitions even when this page is suspended.
      this.changed();
    });
    this.audio.controls=false;this.video.controls=true;this.video.playsInline=true;
    for(const media of [this.audio,this.video]) {
      media.preload='metadata';
      media.addEventListener('loadedmetadata',()=>{if(media===this.media){this.loadingStatus='正在缓冲…';this.changed();}});
      media.addEventListener('waiting',()=>{if(media===this.media){this.loadingStatus='正在缓冲…';this.changed();}});
      media.addEventListener('playing',()=>{if(media===this.media){this.clearStartupTimer();this.loadingStatus='';this.error='';this.changed();console.info('[media-playback]',{stage:'playing',elapsedMs:Math.round(performance.now()-this.startupAt),transport:this.proxyFallback?'proxy':this.session?.playbackMode});}});
      media.addEventListener('ratechange',()=>{if(media===this.media&&!this.nativeActive){this.playbackRate=media.playbackRate;this.changed();}});
      media.addEventListener('loadedmetadata',()=>{if(media===this.media&&this.session){media.currentTime=this.session.position;this.ready=true;this.updateMiniProgress();}});
      media.addEventListener('timeupdate',()=>{
        if(media!==this.media||!this.session||!this.ready)return;
        this.updateMiniProgress();
        if(this.session.end!==null&&media.currentTime>=this.session.end){media.pause();void this.finished();return;}
        if(Date.now()-this.lastSave>5000){this.lastSave=Date.now();void this.flush();}
      });
      media.addEventListener('seeking',()=>{if(media===this.media&&this.session&&this.ready){this.completed=false;this.finishedSession='';const bounded=Math.max(this.session.start,Math.min(media.currentTime,this.session.end??Number.MAX_SAFE_INTEGER));if(media.currentTime!==bounded)media.currentTime=bounded;}});
      media.addEventListener('seeked',()=>{if(media===this.media)void this.flush();});
      media.addEventListener('ended',()=>{if(media===this.media)void this.finished();});
      media.addEventListener('pause',()=>{if(media===this.media){if(!this.completed)++this.resumeIntent;void this.flush();this.changed();}});
      media.addEventListener('play',()=>this.changed());
      media.addEventListener('error',()=>{if(media===this.media){
        if(this.recoverWebPlayback())return;
        this.clearStartupTimer();this.loadingStatus='';
        this.error=playbackFailure(undefined,media.error);this.changed();
      }});
    }
    this.videoWorkspace.className='media-video-workspace';
    const stage=document.createElement('div');stage.className='media-video-stage';stage.append(this.video);
    this.videoWorkspace.append(stage,this.videoControlsHost);
    this.element.append(this.mini,this.audioControls,this.audio,this.videoWorkspace,this.nativeControls,this.subtitles.element,this.audioTracks.element);
  }
  private changed(){
    const audio=this.media===this.audio;
    this.element.classList.toggle('media-player-audio',audio);this.mini.hidden=false;
    this.element.classList.toggle('media-player-native-video',this.isVideo&&this.nativeActive);
    render(createElement(MiniNowPlaying,{api:this.api,itemId:this.currentItemId,title:this.title}),this.miniTitle);
    render(createElement(this.paused?Play:Pause,{size:21,strokeWidth:1.8,'aria-hidden':true}),this.miniToggle);this.miniToggle.setAttribute('aria-label',(this.paused?'继续':'暂停')+(audio?'音频':'视频'));
    this.miniToggle.disabled=this.playbackBlocked;
    this.audio.controls=false;this.video.controls=!this.webVideo&&!this.playbackBlocked&&!this.customVideoControls;
    this.videoWorkspace.hidden=!this.isWebVideo;
    const volume=this.volumeLabel.querySelector('input');if(volume)volume.value=String(this.media.muted?0:this.media.volume);
    this.audioControls.hidden=!audio&&!this.nativeActive;this.volumeLabel.hidden=this.nativeActive;
    this.updateMiniProgress();
    this.dispatchEvent(new Event('change'));
  }
  private updateMiniProgress(){
    const session=this.session;
    if(!session){this.seekSession=null;this.miniTime.textContent='';this.miniProgress.hidden=true;return;}
    const raw=this.nativeActive?this.native!.state.position:this.ready?this.media.currentTime:session.position;
    const end=session.end??(this.nativeActive?this.native!.state.duration!==undefined?session.start+this.native!.state.duration!:null:this.ready&&Number.isFinite(this.media.duration)?this.media.duration:null);
    const duration=end===null?null:Math.max(0,end-session.start);
    const elapsed=Math.max(0,Math.min(Number.isFinite(raw)?raw-session.start:0,duration??Number.MAX_SAFE_INTEGER));
    const clock=(seconds:number)=>{const total=Math.floor(seconds);return (total>=3600?Math.floor(total/3600)+':':'')+String(Math.floor(total/60)%60).padStart(2,'0')+':'+String(total%60).padStart(2,'0');};
    const elapsedLabel=document.createElement('span'), separator=document.createElement('span'), durationLabel=document.createElement('span');
    elapsedLabel.textContent=clock(elapsed);separator.textContent=' / ';separator.className='media-time-separator';durationLabel.textContent=duration===null?'时长未知':clock(duration);
    this.miniTime.replaceChildren(elapsedLabel,separator,durationLabel);
    this.chapterSeek.style.setProperty('--media-progress',String(duration?elapsed/duration*100:0)+'%');
    this.miniProgress.hidden=duration===null||duration===0;
    this.miniProgress.max=duration||1;this.miniProgress.value=elapsed;
    this.miniProgress.setAttribute('aria-valuetext',this.miniTime.textContent);
    this.chapterSeek.max=String(duration||1);
    if(this.seekSession!==session)this.chapterSeek.value=String(elapsed);
    this.chapterSeek.disabled=this.playbackBlocked||!this.ready||duration===null||duration===0;
    if(this.seekSession!==session)this.chapterSeek.setAttribute('aria-valuetext',this.miniTime.textContent);
  }
  reconnectNative(){
    if(!this.native)return;
    this.restoreNative=!this.active;
    this.native.command('reconnect',this.api.nativeCredentials());
  }
  get currentItemId(){return this.session?.itemId||'';}
  get currentPartId(){return this.session?.partId||'';}
  get position(){return this.nativeActive?this.native!.state.position:this.ready?this.media.currentTime:this.session?.position??0;}
  get playlistPartIds():string[]{
    if(!this.nativeActive)return this.queue.map(entry=>entry.part.id);
    const entries=this.native?.state.currentQueue??[];
    return entries.every(entry=>typeof entry.partId==='string'&&entry.partId.length>0)?entries.map(entry=>entry.partId!):[];
  }
  get currentPlaylist(){const entries=this.nativeActive?this.native?.state.currentQueue??[]:this.queue;return entries.map((entry,index)=>({index,title:entry.title,credit:'credit' in entry?String(entry.credit||''):'',duration:'part' in entry&&entry.part.end!==null?Math.max(0,entry.part.end-entry.part.start):null,current:index===(this.nativeActive?this.native?.state.queueIndex:this.queueIndex)}));}
  get canSelectPlaylist(){return this.active&&!this.switching&&!this.playbackBlocked&&(!this.nativeActive||!this.native?.state.queueSwitching);}
  get canEditPlaylist(){return this.canSelectPlaylist&&(!this.nativeActive||Number.isSafeInteger(this.native?.state.queueRevision));}
  editPlaylist(index:number,direction:-1|0|1){
    const entries=this.currentPlaylist;
    if(!this.canEditPlaylist||!Number.isInteger(index)||index<0||index>=entries.length||![-1,0,1].includes(direction))return;
    if(direction===0?entries[index]!.current:index+direction<0||index+direction>=entries.length)return;
    if(this.nativeActive){this.native!.command('editQueue',{sessionId:this.session?.id,revision:this.native!.state.queueRevision,index,direction});return;}
    const next=this.queue.slice();
    if(direction===0){next.splice(index,1);if(index<this.queueIndex)this.queueIndex--;}
    else{const target=index+direction;[next[index],next[target]]=[next[target]!,next[index]!];if(this.queueIndex===index)this.queueIndex=target;else if(this.queueIndex===target)this.queueIndex=index;}
    this.queue=next;this.changed();
  }
  get paused(){return this.nativeActive?this.native!.state.paused:this.media.paused;}
  get hasQueueNavigation(){return this.active&&(this.nativeActive?this.native!.state.canPrevious===true||this.native!.state.canNext===true||this.native!.state.queueSwitching===true:this.queue.length>1);}
  get canPrevious(){return this.active&&!this.switching&&!this.playbackBlocked&&(this.nativeActive?this.native!.state.canPrevious===true:this.queueIndex>0);}
  get canNext(){return this.active&&!this.switching&&!this.playbackBlocked&&(this.nativeActive?this.native!.state.canNext===true:this.queueIndex+1<this.queue.length);}
  async move(direction:-1|1):Promise<void>{
    if(direction===-1?!this.canPrevious:direction===1?!this.canNext:true)return;
    if(this.nativeActive){this.native!.command(direction<0?'previous':'next');return;}
    await this.selectPlaylist(this.queueIndex+direction);
  }
  async selectPlaylist(target:number):Promise<void>{
    if(!this.canSelectPlaylist||!Number.isInteger(target)||target<0||target>=this.currentPlaylist.length||this.currentPlaylist[target]?.current)return;
    if(this.nativeActive){this.native?.command('selectQueue',{sessionId:this.session?.id,index:target,revision:this.native?.state.queueRevision});return;}
    const index=this.queueIndex,epoch=this.generation,session=this.session;
    this.switching=true;this.changed();
    try{
      this.pause();await this.flush();
      // The browser queues its pause event asynchronously; it may append another
      // save while the explicit flush is in flight. Wait for that writer as well.
      while(epoch===this.generation){const saving=this.saving;await saving;if(saving===this.saving)break;}
      if(epoch!==this.generation)return;
      if(session&&this.pendingProgress.has(session)){this.error='当前进度尚未保存，请稍后重试切换。';return;}
      // Keep the current playback view mounted while only the session URL and
      // selected queue entry change. Re-opening controls here makes route based
      // screens look like they refreshed when switching episodes.
      await this.play(this.queue,target,false,{openControls:false});
    }catch(error){
      if(this.session===session){this.queueIndex=index;this.error=error instanceof Error?error.message:'切换失败，请重试。';}
    }finally{this.switching=false;this.changed();}
  }
  async play(parts:Array<{part:Part;title:string;video:boolean;credit?:string}>,index=0,nativeVideo=false,options:{autoplay?:boolean;signal?:AbortSignal;openControls?:boolean}={}):Promise<void> {
    if(options.signal?.aborted)return;
    this.restoreNative=false;
    const selected=parts[index];if(!selected)return;
    const generation=++this.generation;
    this.pause();await this.flush();if(generation!==this.generation||options.signal?.aborted)return;
    const session=await (options.signal?this.api.playback(selected.part.id,options.signal):this.api.playback(selected.part.id));
    if(generation!==this.generation||options.signal?.aborted)return;
    if(selected.video&&!nativeVideo){await this.ensureWebVideo();if(generation!==this.generation||options.signal?.aborted)return;}
    this.queue=parts;this.queueIndex=index;
    this.lease?.stop();this.lease=null;
    if(!this.active)this.playbackRate=readPlaybackPreferences(this.api.preferenceScope()).defaultRate;
    this.session=session;this.sequence=0;this.finishedSession='';this.ready=false;this.completed=false;this.title=selected.title;this.error='';this.active=true;this.playbackBlocked=false;
    this.proxyFallback=false;this.corsRetry=false;this.startupAt=performance.now();this.loadingStatus=options.autoplay===false?'':'正在连接媒体源…';
    this.allowAutomaticFallback=options.autoplay!==false;
    if(!this.native||(selected.video&&!nativeVideo))this.lease=new PlaybackLease(this.api,session,(message,terminal)=>{
      if(this.session!==session)return;
      this.error=message;
      if(terminal){this.playbackBlocked=true;this.pause();}
      this.changed();
    });
    this.media=selected.video?this.video:this.audio;
    // Anonymous CORS mode makes the browser attach Origin to the media
    // request and to redirected HLS segment requests such as media-0.ts.
    this.media.crossOrigin='anonymous';(this.media as HTMLMediaElement&{referrerPolicy?:string}).referrerPolicy='no-referrer';
    const rate=this.playbackRate;
    this.media.defaultPlaybackRate=rate;this.media.playbackRate=rate;
    if(this.nativeActive)this.native?.command('stop');
    this.nativeActive=!!this.native&&(!selected.video||nativeVideo);
    this.support=this.nativeActive?'由 Android 原生播放器直接播放。':playbackSupport(this.media,session.contentType);
    if(!this.nativeActive)void this.api.request<{probe:{info:{streams:PlaybackStream[]}|null}}>('assets/'+encodeURIComponent(selected.part.assetId))
      .then(resource=>{
        if(generation!==this.generation||this.session!==session)return;
        this.support=playbackSupport(this.media,session.contentType,resource.probe.info?.streams??[]);this.changed();
      }).catch(()=>{/* Technical details are advisory; playback remains available if this request fails. */});
    this.nativeControls.hidden=!this.nativeActive;
    this.subtitles.clear();this.audioTracks.clear();
    if(selected.video&&!this.nativeActive)void this.subtitles.load(selected.part.assetId);
    this.audio.hidden=selected.video||this.nativeActive;this.video.hidden=!selected.video||this.nativeActive;
    this.element.hidden=!this.visible;
    if(this.nativeActive){
      this.nativeQueueId=crypto.randomUUID();
      this.native!.command('play',{sessionId:session.id,url:this.api.streamUrl(session),title:this.title,position:session.position,
        plan:{...this.api.nativePlan(session),video:selected.video,queueId:this.nativeQueueId,queueIndex:index,
          queue:parts.map(entry=>({partId:entry.part.id,title:entry.title.slice(0,200)}))}});
      this.changed();return;
    }
    this.media.crossOrigin='anonymous';
    this.media.src=this.api.streamUrl(session);
    void this.audioTracks.load(this.media,selected.part.assetId);
    this.changed();
    if(selected.video&&options.openControls!==false)this.dispatchEvent(new Event('open-controls'));
    if(options.autoplay===false)this.media.load();
    else{
      this.beginWebPlayback(generation);
    }
  }
  private async finished(){
    const session=this.session,generation=this.generation,intent=this.resumeIntent;
    if(!session||this.finishedSession===session.id)return;
    this.finishedSession=session.id;this.completed=true;
    await this.flush(true);
    // The chapter-boundary pause may enqueue another save after this one.
    while(generation===this.generation){const saving=this.saving;await saving;if(saving===this.saving)break;}
    if(generation!==this.generation)return;
    if(this.pendingProgress.has(session)||this.playbackBlocked||!this.ready){
      this.finishedSession='';this.error='本章完成进度尚未保存，点击继续重试。';this.changed();return;
    }
    if(intent!==this.resumeIntent){this.finishedSession='';return;}
    if(readPlaybackPreferences(this.api.preferenceScope()).continuous&&this.queueIndex+1<this.queue.length)await this.play(this.queue,this.queueIndex+1);
  }
  async flush(completed=false):Promise<void> {
    if(this.nativeActive)return; // The service owns both the revision and background persistence.
    const currentTime=this.nativeActive?this.native!.state.position:this.media.currentTime;
    const session=this.session;if(!session||!this.ready||this.playbackBlocked||!Number.isFinite(currentTime))return;
    const lease=this.lease;
    const position=Math.max(session.start,Math.min(currentTime,session.end??Number.MAX_SAFE_INTEGER));
    const sequence=this.sequence++;
    const finished=completed||this.completed;
    this.saving=this.saving.then(async()=>{
      try {
        if(session.expiresAt-Date.now()<=2*60_000)await lease?.ensure();
        const pending=this.pendingProgress.get(session);
        if(pending){
          const saved=await this.saveProgress(session.id,pending);
          session.revision=saved.revision;this.pendingProgress.delete(session);
        }
        const payload={sequence,revision:session.revision,position,completed:finished};
        this.pendingProgress.set(session,payload);
        const response=await this.saveProgress(session.id,payload);
        session.revision=response.revision;
        this.pendingProgress.delete(session);
      }catch(error){if(this.session===session){this.error=error instanceof Error?error.message:'进度保存失败';this.changed();}}
    });
    return this.saving;
  }
  pause(){++this.resumeIntent;this.allowAutomaticFallback=false;this.clearStartupTimer();this.loadingStatus='';if(this.nativeActive)this.native?.command('pause');else this.media.pause();}
  private async saveProgress(id:string,payload:{sequence:number;revision:number;position:number;completed:boolean}):Promise<Progress>{
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{reject(new Error('进度保存超时，将在下次保存时重试。'));controller.abort();},15000);
    });
    try{return await Promise.race([this.api.request<Progress>(`playback/${id}/progress`,'PUT',payload,controller.signal),timeout]);}
    finally{if(timer)clearTimeout(timer);}
  }
  private async resume(){
    const generation=this.generation,session=this.session,intent=++this.resumeIntent;
    if(!session||this.playbackBlocked)return;
    try{
      if(!this.nativeActive&&this.completed&&this.finishedSession===''){await this.finished();return;}
      await this.lease?.ensure();
      if(generation!==this.generation||intent!==this.resumeIntent||this.playbackBlocked)return;
      if(this.nativeActive){this.native!.command('resume');return;}
      this.allowAutomaticFallback=true;
      if(this.media.error&&this.recoverWebPlayback())return;
      if(this.media.error){
        if(this.ready&&Number.isFinite(this.media.currentTime))session.position=this.media.currentTime;
        this.ready=false;this.media.load();
      }
      this.error='';this.loadingStatus='正在连接媒体源…';this.watchStartup(generation);this.changed();
      const attempt=++this.sourceAttempt;
      try { await this.media.play(); }
      catch(error) {
        if(generation===this.generation&&attempt===this.sourceAttempt){
          const name=(error as {name?:string})?.name;
          if(name!=='NotAllowedError'&&name!=='AbortError'&&this.recoverWebPlayback())return;
          this.clearStartupTimer();this.loadingStatus='';this.error=playbackFailure(error,this.media.error);this.changed();
        }
        return;
      }
      if(generation===this.generation){this.error='';this.changed();}
    }catch{if(generation===this.generation){if(!this.error)this.error='播放连接恢复失败，请稍后重试。';this.changed();}}
  }
  seek(position:number){
    const session=this.session;
    if(!session||!this.active||this.playbackBlocked||!Number.isFinite(position)||(!this.nativeActive&&!this.ready))return;
    const duration=this.nativeActive?this.native!.state.duration!==undefined?session.start+this.native!.state.duration!:undefined:Number.isFinite(this.media.duration)?this.media.duration:undefined;
    const end=session.end??duration??Number.MAX_SAFE_INTEGER;
    const bounded=Math.max(session.start,Math.min(position,end));
    if(this.nativeActive)this.native?.command('seek',{position:bounded});
    else {this.media.currentTime=bounded;this.completed=false;this.finishedSession='';void this.flush();}
    this.changed();
  }
  skip(seconds:number){if(Number.isFinite(seconds))this.seek((this.nativeActive?this.native!.state.position:this.media.currentTime)+seconds);}
  toggle(){if(this.paused)void this.resume();else this.pause();}
  speed(value:number){if(Number.isFinite(value)&&value>=0.5&&value<=3){this.playbackRate=value;if(this.nativeActive)this.native?.command('speed',{value});else{this.media.defaultPlaybackRate=value;this.media.playbackRate=value;}this.changed();}}
  sleep(minutes:number){
    if(!Number.isFinite(minutes)||minutes<0||minutes>1440)return;
    if(this.timer)clearTimeout(this.timer);if(this.sleepTicker)clearInterval(this.sleepTicker);
    this.timer=null;this.sleepTicker=null;this.sleepAt=minutes>0?Date.now()+minutes*60000:0;
    if(this.nativeActive)this.native?.command('sleep',{minutes});
    else if(minutes>0){
      this.timer=setTimeout(()=>{this.sleepAt=0;this.timer=null;if(this.sleepTicker)clearInterval(this.sleepTicker);this.sleepTicker=null;this.pause();this.changed();},minutes*60000);
      this.sleepTicker=setInterval(()=>this.changed(),30000);
    }
    this.changed();
  }
  async stop(){this.restoreNative=false;++this.generation;this.clearStartupTimer();this.loadingStatus='';this.error='';this.pause();const pending=this.flush();this.native?.command('stop');this.nativeActive=false;this.nativeControls.hidden=true;this.subtitles.clear();this.audioTracks.clear();this.lease?.stop();this.lease=null;this.session=null;this.ready=false;this.audio.removeAttribute('src');this.video.removeAttribute('src');this.audio.load();this.video.load();this.active=false;this.element.hidden=true;this.sleep(0);this.queue=[];this.changed();await pending;}
}
