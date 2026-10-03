import type { MediaApi } from '../api/media-api.ts';

interface AudioTrack { label:string;language:string;enabled:boolean }
interface AudioTrackList extends EventTarget { readonly length:number;[index:number]:AudioTrack }
type TrackMedia=HTMLMediaElement&{audioTracks?:AudioTrackList};

/** Only offer tracks exposed by the active decoder, never ffprobe stream indices. */
export class AudioTrackControls {
  readonly element=document.createElement('label');
  private readonly select=document.createElement('select');
  private readonly status=document.createElement('span');
  private media:TrackMedia|null=null;
  private tracks:AudioTrackList|null=null;
  private request:AbortController|null=null;
  private scannedCount=0;
  constructor(private readonly api:MediaApi){
    this.element.className='media-subtitle-controls';this.element.hidden=true;
    this.select.setAttribute('aria-label','音轨');this.status.setAttribute('role','status');
    this.element.append(document.createTextNode('音轨 '),this.select,this.status);
    this.select.addEventListener('change',()=>{
      const tracks=this.tracks,index=Number(this.select.value);
      if(!tracks||!Number.isInteger(index)||index<0||index>=tracks.length)return;
      try{
        tracks[index]!.enabled=true;
        for(let i=0;i<tracks.length;i++)if(i!==index)tracks[i]!.enabled=false;
        this.status.textContent='';
      }catch{this.status.textContent='此设备无法切换该音轨，请选择其他版本或设备。';}
      this.refresh();
    });
  }
  private refresh=()=>{
    const candidate=this.media?.audioTracks;
    const next=candidate&&typeof candidate.addEventListener==='function'&&typeof candidate.removeEventListener==='function'?candidate:null;
    if(next!==this.tracks){
      this.unlisten();this.tracks=next;
      for(const event of ['addtrack','removetrack','change'])next?.addEventListener(event,this.refresh);
    }
    const tracks=this.tracks;
    this.select.replaceChildren();
    for(let i=0;tracks&&i<tracks.length;i++){
      const track=tracks[i]!,option=document.createElement('option');
      option.value=String(i);option.textContent=track.label||track.language||`音轨 ${i+1}`;
      option.selected=track.enabled;this.select.append(option);
    }
    const selectable=(tracks?.length??0)>1;
    this.select.hidden=!selectable;
    this.element.hidden=!selectable&&this.scannedCount<2;
    if(!selectable&&this.scannedCount>1)this.status.textContent='文件包含多个音轨，此浏览器未开放切换；可选择其他版本或设备。';
    else if(selectable&&this.status.textContent.startsWith('文件包含'))this.status.textContent='';
  };
  async load(media:HTMLMediaElement,assetId:string){
    this.clear();this.media=media;
    media.addEventListener('loadedmetadata',this.refresh);media.addEventListener('emptied',this.refresh);this.refresh();
    const controller=new AbortController();this.request=controller;
    try{
      const resource=await this.api.request<{probe?:{info?:{streams?:Array<{type:string}>}|null}}>(`assets/${encodeURIComponent(assetId)}`,'GET',undefined,controller.signal);
      if(controller.signal.aborted)return;
      this.scannedCount=resource.probe?.info?.streams?.filter(stream=>stream.type==='audio').length??0;this.refresh();
    }catch{/* Track selection remains available even when probe information cannot be read. */}
  }
  private unlisten(){for(const event of ['addtrack','removetrack','change'])this.tracks?.removeEventListener(event,this.refresh);}
  clear(){
    this.request?.abort();this.request=null;this.unlisten();this.tracks=null;
    this.media?.removeEventListener('loadedmetadata',this.refresh);this.media?.removeEventListener('emptied',this.refresh);
    this.media=null;this.scannedCount=0;this.select.replaceChildren();this.status.textContent='';this.element.hidden=true;
  }
}
