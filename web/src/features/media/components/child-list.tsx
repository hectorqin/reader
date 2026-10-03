import { useState } from 'react';
import type { ReactNode } from 'react';
import type {Item} from '../api/media-api.ts';

/** The detail API supplies all children; bound DOM size without changing their order. */
export function MediaChildList({items,label,renderItems}:{items:Item[];label:string;renderItems:(items:Item[])=>ReactNode}){
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const filtered=items.filter(item=>item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const lastPage=Math.max(0,Math.ceil(filtered.length/60)-1),current=Math.min(page,lastPage);
  return <section aria-label={label+'列表'}>
    {items.length>10&&<div className="media-chapter-filter"><label>查找{label}<input type="search" value={query} onInput={event=>{setQuery(event.currentTarget.value);setPage(0);}}/></label><span>{filtered.length} 项</span></div>}
    {filtered.length?renderItems(filtered.slice(current*60,(current+1)*60)):<p className="media-empty">没有匹配的{label}。</p>}
    {lastPage>0&&<nav className="media-toolbar" aria-label={label+'分页'}><button disabled={current===0} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {lastPage+1}</span><button disabled={current===lastPage} onClick={()=>setPage(current+1)}>下一页</button></nav>}
  </section>;
}
