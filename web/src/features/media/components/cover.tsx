import { useEffect, useRef, useState } from 'react';
import type { Item, MediaApi } from '../api/media-api.ts';
import { ApiError } from '../../../api/errors.ts';
import {personColor} from './person-portrait.tsx';

import { createStores } from '../../../store/idb.ts';
const coverStores=createStores().catch(()=>null);
const memoryCoverCache=new Map<string,Uint8Array>();
async function readCachedCover(key:string){const memory=memoryCoverCache.get(key);if(memory)return memory;const stores=await coverStores;const bytes=stores?await stores.blobs.get(key):null;if(bytes)memoryCoverCache.set(key,bytes);return bytes;}
async function writeCachedCover(key:string,bytes:Uint8Array){memoryCoverCache.set(key,bytes);const stores=await coverStores;try{await stores?.blobs.put(key,bytes);}catch{/* optional cache */}}

const failureLabel=(error:unknown)=>{
  if(error instanceof ApiError){
    const labels:Record<string,string>={MEDIA_COVER_TIMEOUT:'封面读取超时',MEDIA_COVER_NOT_FOUND:'来源暂无封面',MEDIA_COVER_BUSY:'封面服务繁忙',MEDIA_COVER_UPSTREAM:'封面来源暂不可用'};
    if(labels[error.code])return labels[error.code]!;
    if(error.kind==='offline')return '网络连接不可用';
  }
  return '封面加载失败';
};

/** Load visible covers through the authenticated transport, then release blobs on unmount. */
export function MediaCover({ api, item, square, retryable=false, loadWithoutMetadata=false }: { api: MediaApi; item: Item; square: boolean;retryable?:boolean;loadWithoutMetadata?:boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(() => {
    setUrl(''); setFailed('');
    if (!loadWithoutMetadata&&!item.metadata.coverRef&&!item.metadata.tmdbPosterPath&&!item.metadata.embeddedCoverAssetId&&!item.metadata.musicBrainzCoverGroupId) return;
    const controller = new AbortController();
    let blobUrl = '', requested = false;
    const cacheKey='media-cover:'+item.id+':'+[item.metadata.coverRef,item.metadata.tmdbPosterPath,item.metadata.embeddedCoverAssetId,item.metadata.musicBrainzCoverGroupId].join('|');
    let observer: IntersectionObserver | null = null;
    async function load() {
      if (requested) return;
      requested = true; observer?.disconnect();
      try {
        const persistent=Object.prototype.hasOwnProperty.call(api,'reader');
        const cached=persistent?await readCachedCover(cacheKey):null;let bytes:Uint8Array;
        if(cached){bytes=cached;}else{bytes=await api.cover(item.id,controller.signal);if(persistent)void writeCachedCover(cacheKey,bytes);}
        if (controller.signal.aborted) return;
        const type = bytes[0] === 137 ? 'image/png' : bytes[0] === 255 ? 'image/jpeg' : 'image/webp';
        blobUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
        setUrl(blobUrl);
      } catch(error) { if (!controller.signal.aborted) setFailed(failureLabel(error)); }
    }
    if (typeof IntersectionObserver !== 'undefined' && host.current) {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(); }, { rootMargin: '200px' });
      observer.observe(host.current);
    } else void load();
    return () => { controller.abort(); observer?.disconnect(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [api, item.id, item.metadata.coverRef, item.metadata.tmdbPosterPath, item.metadata.embeddedCoverAssetId,item.metadata.musicBrainzCoverGroupId,attempt,loadWithoutMetadata]);
  return <span ref={host} style={item.kind==='artist'?{backgroundColor:personColor(item.title)}:undefined} className={'media-cover ' + (square ? 'square ' : '') + (item.kind==='artist'?'media-portrait '+(!url||failed?'media-person-placeholder ':''):'') + (failed&&retryable?'media-cover-failed ':'') + (url && !failed ? 'has-image' : '')}>
    {url && !failed ? <img src={url} alt="" decoding="async" onError={() => setFailed('封面图片无法解码')}/> : <span className="media-cover-title" aria-label={item.title}>{item.kind==='artist'?Array.from(item.title)[0]:({movie:'电影',series:'剧集',season:'剧集',episode:'单集',album:'专辑',track:'音乐',audiobook:'有声书'} as Record<string,string>)[item.kind]||'影音'}</span>}
    {failed&&retryable&&<span className="media-cover-retry"><small role="status">{failed}</small><button type="button" onClick={()=>setAttempt(value=>value+1)}>重试封面</button></span>}
  </span>;
}
