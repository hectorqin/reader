import {Check,ChevronRight,Heart,SlidersHorizontal} from 'lucide-react';
import {MediaCover} from './cover.tsx';
import {itemLabel} from './item-label.ts';
import type {Item,MediaApi,MediaChannel} from '../api/media-api.ts';
import '../styles/favorites.css';

export type FavoriteScope=MediaChannel|'all';
const scopes:Array<[FavoriteScope,string]>=[['all','全部'],['video','影视'],['music','音乐'],['audiobook','有声书']];
const kindNames:Record<string,string>={movie:'电影',series:'剧集',season:'季',episode:'单集',album:'专辑',artist:'歌手',track:'曲目',audiobook:'有声书'};
export const favoriteScope=(value?:string):FavoriteScope=>scopes.some(([scope])=>scope===value)?value as FavoriteScope:'all';
export const favoriteChannel=(item:Item):MediaChannel=>item.kind==='audiobook'?'audiobook':['album','artist','track'].includes(item.kind)?'music':'video';

export function MediaFavorites({api,items,total,offset,scope,busy,onScope,onPage,onOpen}:{
  api:MediaApi;items:Item[];total:number;offset:number;scope:FavoriteScope;busy:boolean;
  onScope:(scope:FavoriteScope)=>void;onPage:(offset:number)=>void;onOpen:(item:Item)=>void;
}){
  return <section className="media-favorites" aria-label="收藏列表">
    <div className="media-favorite-tools"><p>{total} 项收藏{scope!=='all'?' · '+scopes.find(([value])=>value===scope)![1]:''}</p><details className="media-favorite-filter-menu"><summary aria-label="筛选收藏"><SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true"/><span>筛选</span></summary><div className="media-favorite-filter-options" role="listbox" aria-label="收藏类型">{scopes.map(([value,label])=><button key={value} type="button" role="option" aria-selected={scope===value} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');if(scope!==value)onScope(value);}}><span>{label}</span>{scope===value&&<Check size={16} strokeWidth={1.9} aria-hidden="true"/>}</button>)}</div></details></div>
    <div className="media-favorite-list">{items.map(item=><button type="button" key={item.id} className="media-favorite-row" onClick={()=>onOpen(item)}>
      <MediaCover api={api} item={item} square={favoriteChannel(item)==='music'}/>
      <span className="media-favorite-copy"><strong title={item.title}>{item.title}</strong><small>{[kindNames[item.kind],itemLabel(item)].filter(Boolean).join(' · ')}</small></span>
      <ChevronRight size={18} aria-hidden="true"/>
    </button>)}</div>
    {!items.length&&<div className="media-personal-empty"><Heart size={32} strokeWidth={1.4} aria-hidden="true"/><p>{scope==='all'?'还没有收藏，打开作品详情即可收藏。':'暂无这类收藏。'}</p>{scope!=='all'&&<button onClick={()=>onScope('all')}>查看全部收藏</button>}</div>}
    {total>60&&<nav className="media-toolbar" aria-label="收藏分页"><button disabled={busy||offset===0} onClick={()=>onPage(Math.max(0,offset-60))}>上一页</button><span>第 {Math.floor(offset/60)+1} 页</span><button disabled={busy||offset+60>=total} onClick={()=>onPage(offset+60)}>下一页</button></nav>}
  </section>;
}
