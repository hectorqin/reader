import { useEffect, useRef, useState } from 'react';
import type { MediaApi } from '../api/media-api.ts';
import type { MediaPlayer } from '../services/player.ts';

interface Preview {revision:string;channel:'video'|'music'|'audiobook';existingCount:number;newCount:number;partIds:string[]}
export function SavePlaylist({api,player}:{api:MediaApi;player:MediaPlayer}){
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[]);
  const ids=player.playlistPartIds??[];
  const changed=preview&&JSON.stringify(preview.partIds)!==JSON.stringify(ids);
  async function run(save:boolean){
    const signal=abort.current?.signal;if(busy||!signal||signal.aborted)return;
    const partIds=ids.slice();if(!partIds.length)return;
    setBusy(true);setError('');setNotice('');
    try{
      if(save&&preview&&!changed){
        await api.request('queue/snapshot','PUT',{partIds:preview.partIds,expectedRevision:preview.revision},signal);
        if(!signal.aborted){setPreview(null);setNotice('已保存，可在“更多 → 队列”中继续播放。');}
      }else{
        const result=await api.request<Omit<Preview,'partIds'>>('queue/preview','POST',{partIds},signal);
        if(!signal.aborted)setPreview({...result,partIds});
      }
    }catch(reason){if(!signal.aborted){setError(reason instanceof Error?reason.message:'保存失败，请重新预览后重试');setPreview(null);}}
    finally{if(!signal.aborted)setBusy(false);}
  }
  return <section aria-label="保存播放列表">
    {!preview&&<button disabled={busy||!ids.length} onClick={()=>void run(false)}>保存为待播队列</button>}
    {preview&&<><p>将当前 {preview.newCount} 项保存为{({video:'影视',music:'音乐',audiobook:'有声书'})[preview.channel]}待播队列，替换已有 {preview.existingCount} 项。其他频道和当前播放不变。</p>{changed&&<p>当前列表已变化，请重新预览。</p>}<button disabled={busy||!!changed} onClick={()=>void run(true)}>确认保存队列</button><button disabled={busy} onClick={()=>void run(false)}>重新预览</button><button disabled={busy} onClick={()=>setPreview(null)}>取消保存</button></>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}
