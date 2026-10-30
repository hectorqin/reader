import { Icon } from '../../../ui/icon.tsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaApi } from '../api/media-api.ts';
import { Sheet } from '../../../ui/sheet.tsx';

/** The audio player's menus: the app's one sheet, with the audio content styles. */
export function AudioToolSheet({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  return <Sheet className="media-audio-sheet" title={title} onClose={onClose}>{children}</Sheet>;
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
  return <div className="media-playback-favorite"><button className="media-lyrics-toggle" aria-label={favorite?'取消收藏':'收藏'} aria-pressed={favorite??false} disabled={busy||favorite===null} onClick={()=>void toggle()}><Icon name="favorite" size={18} filled={!!favorite} /><span>{favorite?'已收藏':'收藏'}</span></button>{error&&<div className="media-favorite-error" role="alert"><p>{error}</p><button disabled={busy} onClick={()=>setRetry(value=>value+1)}>重读收藏状态</button></div>}</div>;
}
