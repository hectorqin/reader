import {MediaResourceSummary} from './resource-summary.tsx';
import {mediaActionError} from './action-error.ts';
import { useState } from 'react';
import {Search,ListPlus,Ellipsis} from 'lucide-react';
import type { Detail, Edition, MediaApi, Part } from '../api/media-api.ts';
import { ResourceInfo } from './resource-info.tsx';
import { EditionAssignment } from './edition-assignment.tsx';
import { EditionOrganizer } from './edition-organizer.tsx';
import { EditionOrder } from './edition-order.tsx';
import { MissingEdition } from './missing-edition.tsx';

function duration(part:Part):string {
  if(part.end===null)return '时长未知';
  const seconds=Math.max(0,Math.floor(part.end-part.start));
  return seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

/** Keep long works usable without mixing technical file information into chapter browsing. */
export interface ChapterPosition {query:string;page:number;searchOpen?:boolean}
export interface EditionDetailsProps {api:MediaApi;item?:Detail;edition:Edition;busy:boolean;onPlay:(parts:Part[],index:number)=>void;onQueue:(ids:string[])=>void;onRename?:(label:string)=>void;onAssigned?:(target:Detail)=>void;onUpdated?:(detail:Detail)=>void;onRefresh?:()=>void;onChooseVersion?:(()=>void)|undefined;layout?:'inline'|'detail'|'chapters';showTools?:boolean;showResourceSummary?:boolean;compact?:boolean;managementOnly?:boolean;onShowAll?:()=>void;currentPartId?:string;position?:ChapterPosition;onPositionChange?:(position:ChapterPosition)=>void}
export function EditionDetails(props:EditionDetailsProps) {
  const {edition,busy,onPlay,onQueue,onRefresh,layout='inline',showTools=true}=props;
  const [localPosition,setPosition]=useState<ChapterPosition>({query:'',page:0});
  const location=props.position??localPosition,{query,page}=location,preview=!!props.onShowAll;
  const changePosition=(next:ChapterPosition)=>{setPosition(next);props.onPositionChange?.(next);};
  const playable=edition.parts.filter(part=>part.available);
  const filtered=edition.parts.filter(part=>part.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/50)),current=Math.min(page,pages-1);
  const previewStart=Math.max(0,edition.parts.findIndex(part=>part.id===props.currentPartId)-1);
  const visible=preview?edition.parts.slice(previewStart,previewStart+3):filtered.slice(current*50,(current+1)*50);
  return <section className={'media-edition'+(layout==='detail'?' media-edition-detail':'')}><div className="media-edition-content"><div className="media-chapter-heading"><h2>{props.item?.kind==='audiobook'?'章节':edition.label}</h2>{preview&&<button onClick={props.onShowAll} aria-label="全部章节">全部 {edition.parts.length} 章</button>}</div>
    {!preview&&<div className="media-toolbar media-chapter-toolbar"><span>{edition.parts.length} 节 · {playable.length} 节可用</span><div>{layout==='chapters'&&edition.parts.length>10&&<button className="media-chapter-icon" aria-label={location.searchOpen?'收起章节查找':'展开章节查找'} title="查找章节" aria-expanded={!!location.searchOpen} onClick={()=>changePosition(location.searchOpen?{query:'',page:0,searchOpen:false}:{...location,searchOpen:true})}><Search size={18} aria-hidden="true"/></button>}<button className={layout==='chapters'?'media-chapter-icon':undefined} aria-label="加入队列" title="加入待播队列" disabled={busy||!playable.length} onClick={()=>onQueue(playable.map(part=>part.id))}>{layout==='chapters'?<ListPlus size={18} aria-hidden="true"/>:'加入队列'}</button></div></div>}
    {edition.parts.length>0&&!playable.length?<MissingEdition label={edition.label} busy={busy} onRefresh={onRefresh} onChooseVersion={props.onChooseVersion}/>:playable.length<edition.parts.length&&<div className="media-missing-resource" role="status"><p>{edition.parts.length-playable.length} 节资源缺失，作品和播放进度仍保留。可以选择其他可用版本；请管理员确认文件或挂载恢复后重新扫描媒体库，再刷新状态。</p>{onRefresh&&<button disabled={busy} onClick={onRefresh}>刷新资源状态</button>}</div>}
    {!preview&&edition.parts.length>10&&(layout!=='chapters'||location.searchOpen)&&<div className="media-chapter-filter"><label>查找章节<input type="search" value={query} onInput={event=>changePosition({...location,query:event.currentTarget.value,page:0})}/></label><span>{filtered.length} 节</span></div>}
    {visible.map(part=><div className="media-row" key={part.id}>{edition.parts.length>1&&<span className="media-part-number">{String(edition.parts.indexOf(part)+1).padStart(2,'0')}</span>}<button className="media-part-copy" aria-label={part.available?'播放':'资源缺失'} aria-current={props.currentPartId===part.id?'true':undefined} disabled={busy||!part.available} title={part.available?'播放 '+part.title:'资源缺失'} onClick={()=>onPlay(playable,playable.findIndex(entry=>entry.id===part.id))}><strong>{part.title}</strong>{!part.available?<small>资源缺失</small>:props.currentPartId===part.id?<small>当前播放</small>:preview&&<small>第 {edition.parts.indexOf(part)+1} 章</small>}</button><span className="media-part-duration">{duration(part)}</span>{preview&&<details className="media-actions"><summary aria-label={'更多 '+part.title+' 操作'}><Ellipsis size={20} aria-hidden="true"/></summary><nav><button disabled={busy||!part.available} onClick={()=>onQueue([part.id])}>加入播放队列</button></nav></details>}</div>)}
    {!visible.length&&<p>{edition.parts.length?'没有匹配的章节。':'暂无章节。'}</p>}
    {!preview&&pages>1&&<nav className="media-toolbar" aria-label="章节分页"><button disabled={current===0} onClick={()=>changePosition({...location,page:current-1})}>上一页</button><span>{current+1} / {pages}</span><button disabled={current+1>=pages} onClick={()=>changePosition({...location,page:current+1})}>下一页</button></nav>}
    </div>{showTools&&<EditionTools {...props}/>}
  </section>;
}

export function EditionTools({api,item,edition,busy,onRename,onAssigned,onUpdated,showResourceSummary=false,compact=false,managementOnly=false}:EditionDetailsProps) {
  const [organizing,setOrganizing]=useState(false);
  const [ordering,setOrdering]=useState(false);
  const [assigning,setAssigning]=useState(false);
  const [resources,setResources]=useState(false);
  const [editing,setEditing]=useState(false),[name,setName]=useState(edition.label),[saving,setSaving]=useState(false),[error,setError]=useState('');
  async function saveName(){
    if(saving||!name.trim()||name.trim()===edition.label)return;
    setSaving(true);setError('');
    try{const result=await api.request<{label:string}>('editions/'+encodeURIComponent(edition.id),'PATCH',{label:name.trim(),expectedLabel:edition.label});onRename?.(result.label);setEditing(false);}
    catch(error){setError(mediaActionError(error,'修改失败，请重试'));}
    finally{setSaving(false);}
  }
  return <aside className="media-edition-tools">{!managementOnly&&<><h2>资源信息</h2><p className="media-resource-summary">{new Set(edition.parts.map(part=>part.assetId)).size} 个文件 · {edition.label}</p>{showResourceSummary&&edition.parts[0]&&<MediaResourceSummary api={api} assetId={edition.parts[0].assetId}/>}</>} {!compact&&(onUpdated||onAssigned||onRename)&&<details className="media-edition-admin" open={managementOnly||undefined}><summary>{managementOnly?edition.label:'版本管理'}</summary>
    {onUpdated&&<details onToggle={event=>setOrdering(event.currentTarget.open)}><summary>调整章节顺序</summary>{ordering&&<EditionOrder key={edition.revision} api={api} edition={edition} onUpdated={onUpdated}/>}</details>}
    {onUpdated&&item&&<details onToggle={event=>setOrganizing(event.currentTarget.open)}><summary>拆分或合并版本</summary>{organizing&&<EditionOrganizer key={edition.revision} api={api} item={item} edition={edition} onUpdated={onUpdated}/>}</details>}
    {onAssigned&&item&&<details onToggle={event=>setAssigning(event.currentTarget.open)}><summary>纠正版本归属</summary>{assigning&&<EditionAssignment key={item.id} api={api} item={item} edition={edition} onAssigned={onAssigned}/>}</details>}
    {onRename&&(editing?<form className="media-toolbar" onSubmit={event=>{event.preventDefault();void saveName();}}><label>版本名称<input value={name} maxLength={200} disabled={saving} onInput={event=>setName(event.currentTarget.value)}/></label><button disabled={saving||busy||!name.trim()||name.trim()===edition.label}>保存版本名称</button><button type="button" disabled={saving} onClick={()=>{setEditing(false);setError('');}}>取消</button>{error&&<p className="media-error" role="alert">{error}</p>}</form>:<button disabled={busy} onClick={()=>{setName(edition.label);setError('');setEditing(true);}}>修改版本名称</button>)}
    </details>}
    {!compact&&!managementOnly&&<details className="media-edition-resources" onToggle={event=>setResources(event.currentTarget.open)}><summary>文件与技术信息</summary>{resources&&[...new Set(edition.parts.map(part=>part.assetId))].map(assetId=><ResourceInfo key={assetId} api={api} assetId={assetId} title={edition.parts.find(part=>part.assetId===assetId)?.title||''}/>)}</details>}</aside>;
}
