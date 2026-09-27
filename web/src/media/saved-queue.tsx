import { ArrowDown, ArrowUp, Check, Ellipsis, ListMusic, ListOrdered, Search, Trash2, X } from 'lucide-preact';
import { useState } from '../ui/vendor/preact.ts';

export interface SavedQueueEntry {id:string;itemId:string;title:string;partTitle:string;editionLabel?:string;start:number;end:number|null;available:number}
const duration=(entry:SavedQueueEntry)=>{if(entry.end===null||entry.end<entry.start)return '';const seconds=Math.floor(entry.end-entry.start);return seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
export function SavedQueue({entries,busy,onPlay,onDetail,onMove,onRemove,onClear}:{entries:SavedQueueEntry[];busy:boolean;onPlay:(index:number)=>void;onDetail:(id:string)=>void;onMove:(index:number,direction:'up'|'down')=>void;onRemove:(id:string)=>void;onClear:()=>void}){
  const [editing,setEditing]=useState(false),[searching,setSearching]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(0);
  const filtered=entries.map((entry,index)=>({entry,index})).filter(({entry})=>[entry.title,entry.partTitle,entry.editionLabel].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const last=Math.max(0,Math.ceil(filtered.length/50)-1),current=Math.min(page,last),rows=filtered.slice(current*50,current*50+50);
  return <section className="media-saved-queue" aria-label="已保存的待播队列">
    <div className="media-saved-queue-toolbar"><span>{entries.length} 项 · 已保存</span><div>
      <button className="media-icon-button" aria-label="查找队列" aria-pressed={searching} title="查找队列" onClick={()=>{setSearching(!searching);setQuery('');setPage(0);}}><Search size={18} aria-hidden="true"/></button>
      <button className="media-icon-button" aria-label={editing?'完成编辑队列':'编辑队列'} title={editing?'完成编辑':'编辑队列'} aria-pressed={editing} onClick={()=>setEditing(!editing)}>{editing?<Check size={18} aria-hidden="true"/>:<ListOrdered size={18} aria-hidden="true"/>}</button>
      <button className="media-icon-button" aria-label="清空当前频道队列" title="清空当前频道队列" disabled={busy} onClick={onClear}><Trash2 size={18} aria-hidden="true"/></button>
    </div></div>
    {searching&&<input className="media-saved-queue-search" type="search" aria-label="查找已保存队列" placeholder="查找标题、章节或版本" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/>}
    <p className="media-saved-queue-note">点击条目从这里开始播放。编辑仅影响已保存队列。</p>
    <ol className={'media-saved-queue-list'+(editing?' is-editing':'')}>
      {rows.map(({entry,index})=><li className="media-saved-queue-row" key={entry.id}>
        <span className="media-saved-queue-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
        <button className="media-saved-queue-title" aria-label={'播放 '+entry.title} title={entry.title} disabled={busy||!entry.available} onClick={()=>onPlay(index)}><strong>{entry.title}</strong><small>{[entry.partTitle!==entry.title?entry.partTitle:'',entry.editionLabel,!entry.available?'资源不可用':''].filter(Boolean).join(' · ')||'本地资源'}</small></button>
        {!editing&&<span className="media-saved-queue-duration">{duration(entry)}</span>}
        {editing?<span className="media-queue-actions">{(['up','down'] as const).map(direction=><button aria-label={(direction==='up'?'上移 ':'下移 ')+entry.title} title={direction==='up'?'上移':'下移'} disabled={busy||(direction==='up'?index===0:index===entries.length-1)} onClick={()=>onMove(index,direction)}>{direction==='up'?<ArrowUp size={17} aria-hidden="true"/>:<ArrowDown size={17} aria-hidden="true"/>}</button>)}<button aria-label={'移除 '+entry.title} title="移除" disabled={busy} onClick={()=>onRemove(entry.id)}><X size={17} aria-hidden="true"/></button></span>:<button className="media-saved-queue-detail" aria-label={'查看 '+entry.title+' 详情'} title="作品详情" onClick={()=>onDetail(entry.itemId)}><Ellipsis size={18} aria-hidden="true"/></button>}
      </li>)}
    </ol>
    {!rows.length&&<div className="media-personal-empty"><ListMusic size={30} aria-hidden="true"/><p>队列中没有符合条件的条目。</p><button onClick={()=>{setQuery('');setPage(0);}}>清除查找</button></div>}
    {last>0&&<nav className="media-toolbar" aria-label="已保存队列分页"><button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页</button></nav>}
  </section>;
}
