import { Heart, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaApi } from '../api/media-api.ts';

export function AudioToolSheet({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{const dialog=ref.current;if(!dialog)return;const previous=document.activeElement as HTMLElement|null;dialog.showModal();return ()=>{dialog.close();queueMicrotask(()=>{if(previous?.isConnected)previous.focus({preventScroll:true});});};},[]);
  return <dialog ref={ref} className="media-audio-sheet" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}}>
    <header><h2>{title}</h2><button aria-label="关闭播放菜单" onClick={onClose}><X size={20} aria-hidden="true"/></button></header>{children}
  </dialog>;
}

export function PlaybackFavorite({api,itemId,onChanged}:{api:MediaApi;itemId:string;onChanged?:(id:string,favorite:boolean)=>void}){
  const [favorite,setFavorite]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const lifetime=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController();lifetime.current=controller;setFavorite(null);setError('');
    void api.request<{favorite:boolean}>('items/'+encodeURIComponent(itemId)+'/favorite','GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted){setFavorite(value.favorite);onChanged?.(itemId,value.favorite);}}).catch(()=>{if(!controller.signal.aborted)setError('收藏状态读取失败');});
    return ()=>controller.abort();
  },[api,itemId,retry,onChanged]);
  async function toggle(){
    const signal=lifetime.current?.signal;if(busy||favorite===null||!signal||signal.aborted)return;
    setBusy(true);setError('');
    try{const value=await api.request<{favorite:boolean}>('items/'+encodeURIComponent(itemId)+'/favorite','PUT',{favorite:!favorite},signal);if(!signal.aborted){setFavorite(value.favorite);onChanged?.(itemId,value.favorite);}}
    catch{if(!signal.aborted){setError('收藏保存失败，请重读状态后重试');setFavorite(null);}}
    finally{if(!signal.aborted)setBusy(false);}
  }
  return <div className="media-playback-favorite"><button className="media-lyrics-toggle" aria-label={favorite?'取消收藏':'收藏'} aria-pressed={favorite??false} disabled={busy||favorite===null} onClick={()=>void toggle()}><Heart size={18} fill={favorite?'currentColor':'none'} aria-hidden="true"/><span>{favorite?'已收藏':'收藏'}</span></button>{error&&<div className="media-favorite-error" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>setRetry(value=>value+1)}>重读收藏状态</button></div>}</div>;
}
