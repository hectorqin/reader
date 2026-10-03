import { useEffect, useState } from 'react';
import type {MediaApi} from '../api/media-api.ts';
import {ResourceInfo} from './resource-info.tsx';

interface AssetSummary {ref:string;size:number;available:boolean;probe:{info:null|{streams:Array<{type:string;codec:string;channels?:number;sampleRate?:number;height?:number;attachedPicture?:boolean}>}}}
/** Facts come from the scanned file, so unprobed resources never get invented badges. */
export function MediaResourceSummary({api,assetId,badges=false}:{api:MediaApi;assetId:string;badges?:boolean}){
  const [asset,setAsset]=useState<AssetSummary|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setAsset(null);
    void api.request<AssetSummary>('assets/'+encodeURIComponent(assetId),'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setAsset(value);}).catch(()=>{});
    return ()=>controller.abort();
  },[api,assetId]);
  const audio=asset?.probe?.info?.streams.find(stream=>stream.type==='audio'),video=asset?.probe?.info?.streams.find(stream=>stream.type==='video'&&!stream.attachedPicture);
  const format=asset?.ref?.split('.').at(-1)?.toUpperCase();
  const facts=[format,video?.height?video.height+'p':'',audio?.channels===2?'立体声':audio?.channels?audio.channels+' 声道':''].filter(Boolean);
  if(badges)return facts.length?<div className="media-detail-facts">{facts.map(fact=><span key={fact}>{fact}</span>)}</div>:null;
  return <div className="media-resource-compact">{asset&&<><strong>{asset.ref?.split('/').at(-1)}</strong><small>{[format,[video?.codec,audio?.codec].filter(value=>value&&value.toUpperCase()!==format).join(' / ').toUpperCase(),audio?.sampleRate?audio.sampleRate/1000+' kHz':'',(asset.size/1024/1024).toFixed(1)+' MB',asset.available?'本地文件':'文件缺失'].filter(Boolean).join(' · ')}</small></>}<ResourceInfo api={api} assetId={assetId}/></div>;
}
