import type {MediaApi} from '../api/media-api.ts';

/** Resolve a stable part ID against current library data, never a saved stream ticket. */
export async function restorePlaybackEntries(api:MediaApi,itemId:string,partId:string,signal:AbortSignal){
  const item=await api.detail(itemId,signal);
  const edition=item.editions.find(value=>value.parts.some(part=>part.id===partId));
  const part=edition?.parts.find(value=>value.id===partId);
  if(!edition||!part)throw new Error('播放资源已变化，请返回作品详情重新选择版本。');
  if(!part.available)throw new Error('播放文件已丢失或不可访问，请检查媒体库。');
  const video=['movie','episode'].includes(item.kind);
  if(!video&&!['track','audiobook'].includes(item.kind))throw new Error('此作品不能直接播放，请重新选择具体资源。');
  const entries=edition.parts.filter(value=>value.available).map(part=>({part,title:item.title+(edition.parts.length>1?' · '+part.title:''),video}));
  return {entries,index:entries.findIndex(value=>value.part.id===partId)};
}
