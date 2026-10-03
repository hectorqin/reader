import { useEffect, useState } from 'react';
import type {MediaApi,Detail} from './api.ts';
import {MediaCover} from './cover.tsx';
import {Music2} from 'lucide-react';
export function MiniNowPlaying({api,itemId,title}:{api:MediaApi;itemId:string;title:string}){
  const [item,setItem]=useState<Detail|null>(null);
  useEffect(()=>{const abort=new AbortController();setItem(null);if(itemId)void api.detail(itemId,abort.signal).then(value=>{if(!abort.signal.aborted)setItem(value);}).catch(()=>{});return()=>abort.abort();},[api,itemId]);
  const current=item?.id===itemId?item:null;
  const credit=String(current?.overrides.artist??current?.metadata.artist??current?.overrides.narrator??current?.metadata.narrator??'');
  return <>{current?<MediaCover api={api} item={current} square/>:<span className="media-mini-artwork"><Music2 size={20} aria-hidden="true"/></span>}<span className="media-mini-copy"><strong>{current?.title||title||'正在播放'}</strong>{credit&&<small>{String(credit)}</small>}</span></>;
}
