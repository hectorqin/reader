import { useEffect, useState } from 'react';
import { Ellipsis,Folder } from 'lucide-react';
import type { Library,MediaApi } from '../api/media-api.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
interface Summary {id:string;root:string;counts:Record<string,number>;chapters:number;missingFiles:number}
export interface LibraryListPosition {query:string;page:number}
const labels={video:'影视',music:'音乐',audiobook:'有声书'};
const count=(library:Library,summary:Summary)=>library.kind==='video'?`${summary.counts.movie||0} 部电影 · ${summary.counts.series||0} 部剧集`:library.kind==='music'?`${summary.counts.album||0} 张专辑 · ${summary.counts.track||0} 首曲目`:`${summary.counts.audiobook||0} 部作品 · ${summary.chapters} 章（全部版本）`;
export function MediaLibraryList({api,libraries,busy,position,onPosition,onEdit,onScan,onPermissions}:{api:MediaApi;libraries:Library[];busy:boolean;position:LibraryListPosition;onPosition:(position:LibraryListPosition)=>void;onEdit:(library:Library)=>void;onScan:(id:string)=>void;onPermissions:(library:Library)=>void;onJobs?: (id:string)=>void}){
  const [summaries,setSummaries]=useState<Summary[]>([]),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0);
  const ids=libraries.map(row=>row.id).join(',');
  useEffect(()=>{const abort=new AbortController();setStatus('loading');setSummaries([]);void api.request<{items:Summary[]}>('library-summaries','GET',undefined,abort.signal).then(result=>{if(!abort.signal.aborted){setSummaries(result.items);setStatus('ready');}}).catch(()=>{if(!abort.signal.aborted)setStatus('error');});return ()=>abort.abort();},[api,ids,retry]);
  const summariesById=new Map(summaries.map(summary=>[summary.id,summary]));
  const filtered=libraries.filter(library=>[library.name,labels[library.kind],summariesById.get(library.id)?.root].join(' ').toLocaleLowerCase().includes(position.query.trim().toLocaleLowerCase()));
  const last=Math.max(0,Math.ceil(filtered.length/30)-1),page=Math.min(position.page,last);
  return <section aria-label="全部媒体库">
    {(libraries.length>10||position.query)&&<div className="media-library-find"><label>查找媒体库<input type="search" value={position.query} placeholder="名称、类型或目录" onInput={event=>onPosition({query:event.currentTarget.value,page:0})}/></label><small>{filtered.length} 个</small></div>}
    {status==='loading'&&<FloatingNotice message="正在读取目录与索引数量…" busy />}
    {status==='error'&&<div className="media-error" role="alert"><p>媒体库摘要读取失败，仍可管理媒体库。</p><button onClick={()=>setRetry(value=>value+1)}>重试读取摘要</button></div>}
    <div className="media-library-list">{filtered.slice(page*30,page*30+30).map(library=>{const summary=summariesById.get(library.id);return <div className="media-library-row" key={library.id}><Folder size={22} strokeWidth={1.5} aria-hidden="true"/><span><strong>{library.name} <em className="media-library-kind" title={library.access==='all'?'所有用户可见':'指定用户可见'}>{labels[library.kind]}</em></strong>{summary?<><small>{count(library,summary)}</small><small className="media-library-directory" title={summary.root}>{library.storage==='openlist'?'OpenList · ':''}{summary.root}</small></>:status==='ready'?<small>目录与数量暂不可用</small>:null}</span><details className="media-library-actions"><summary aria-label={'媒体库操作 '+library.name}><Ellipsis size={20} aria-hidden="true"/></summary><nav aria-label={library.name+'的操作'}><button disabled={busy} onClick={()=>onEdit(library)}>编辑媒体库</button><button onClick={()=>onPermissions(library)}>权限</button></nav></details><footer className="media-library-footer"><span>{summary?summary.missingFiles>0?summary.missingFiles+' 个文件缺失':'无缺失文件记录':'摘要暂不可用'}</span><button disabled={busy} onClick={()=>onScan(library.id)}>重新扫描</button></footer></div>;})}</div>
    {!filtered.length&&!!libraries.length&&<p className="media-manager-note">没有符合查找条件的媒体库。<button onClick={()=>onPosition({query:'',page:0})}>清除查找</button></p>}
    {last>0&&<nav className="media-toolbar" aria-label="媒体库分页"><button disabled={!page} onClick={()=>onPosition({...position,page:page-1})}>上一页</button><span>{page+1} / {last+1}</span><button disabled={page===last} onClick={()=>onPosition({...position,page:page+1})}>下一页</button></nav>}
  </section>;
}
