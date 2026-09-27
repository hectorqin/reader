import {MediaSelect} from './select.tsx';
import {useRef} from '../ui/vendor/preact.ts';
import {Play} from 'lucide-preact';
import type {Detail,MediaApi,Part} from './api.ts';
import {EditionDetails,type ChapterPosition} from './edition-details.tsx';

export function AudiobookChapters({api,item,editionId,currentPartId='',busy,onEditionChange,onPlay,onQueue,onRefresh,position,onPositionChange}:{api:MediaApi;item:Detail;editionId:string;currentPartId?:string;busy:boolean;onEditionChange:(id:string)=>void;onPlay:(parts:Part[],index:number)=>void;onQueue:(ids:string[])=>void;onRefresh:()=>void;position:ChapterPosition;onPositionChange:(position:ChapterPosition)=>void}){
  const versionControl=useRef<HTMLButtonElement>(null);
  const edition=item.editions.find(entry=>entry.id===editionId)||item.editions[0];
  const playable=edition?.parts.filter(part=>part.available)||[],current=playable.findIndex(part=>part.id===currentPartId);
  return <section className="media-audiobook-chapters" aria-label="全部章节">
    <div className="media-chapters-context"><div><strong>{item.title}</strong>{item.editions.length>1?<MediaSelect controlRef={versionControl} className="media-chapters-version" aria-label="章节版本" disabled={busy} value={edition?.id} onChange={event=>onEditionChange(event.currentTarget.value)}>{item.editions.map(entry=><option key={entry.id} value={entry.id}>{entry.label}</option>)}</MediaSelect>:edition&&<small>{edition.label}</small>}</div><button className="media-primary" disabled={busy||!playable.length} onClick={()=>onPlay(playable,Math.max(0,current))}><Play size={16} aria-hidden="true"/>{current>=0?'继续当前章':'开始收听'}</button></div>
    {edition?<EditionDetails key={edition.id} api={api} item={item} edition={edition} currentPartId={currentPartId} busy={busy} layout="chapters" showTools={false} onPlay={onPlay} onQueue={onQueue} onRefresh={onRefresh} onChooseVersion={item.editions.length>1?()=>{versionControl.current?.scrollIntoView({block:'center'});versionControl.current?.focus();}:undefined} position={position} onPositionChange={onPositionChange}/>:<p>暂无可用的演播版本。</p>}
  </section>;
}
