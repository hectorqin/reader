import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../../../ui/icon.tsx';
import { ActionMenu } from '../../../ui/action-menu.tsx';
import type { Library,MediaApi,ScanJob } from '../api/media-api.ts';
import { FloatingNotice } from '../../../ui/floating-notice.tsx';
import { scanFeedback } from './scan-feedback.ts';
interface Summary {id:string;root:string;counts:Record<string,number>;chapters:number;missingFiles:number}
export interface LibraryListPosition {query:string;page:number}
const labels={video:'影视',music:'音乐',audiobook:'有声书'};
const icons:Record<string,IconName>={video:'video',music:'music',audiobook:'audiobook'};
const count=(library:Library,summary:Summary)=>library.kind==='video'?`${summary.counts.movie||0} 部电影 · ${summary.counts.series||0} 部剧集`:library.kind==='music'?`${summary.counts.album||0} 张专辑 · ${summary.counts.track||0} 首曲目`:`${summary.counts.audiobook||0} 部作品 · ${summary.chapters} 章（全部版本）`;
/** "今天 09:12", "昨天 21:40", or "3月8日 09:12": when the last scan finished. */
export function scanTime(at:number,now=Date.now()):string{
  const date=new Date(at),day=(value:Date)=>new Date(value.getFullYear(),value.getMonth(),value.getDate()).getTime();
  const clock=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  const days=Math.round((day(new Date(now))-day(date))/86400000);
  return days===0?'今天 '+clock:days===1?'昨天 '+clock:`${date.getMonth()+1}月${date.getDate()}日 ${clock}`;
}
/**
 * The latest scan of one library, as prototype 20 draws it: a running scan with its
 * share of files processed and 取消; a failed one with what went wrong, 重试 and 查看详情;
 * otherwise when it last finished, beside 重新扫描.
 */
function ScanState({job,busy,onScan,onCancel,onDetails}:{job:ScanJob|undefined;busy:boolean;onScan:()=>void;onCancel?:(job:ScanJob)=>void;onDetails?:()=>void}){
  if(job&&(job.state==='running'||job.state==='queued')){
    const percent=job.total?Math.min(100,Math.round(job.inspected/job.total*100)):null;
    return <div className="media-library-scan" data-state="running">
      <span role="status">{job.state==='queued'?'排队等待扫描':percent!==null?`正在扫描 · 已处理 ${percent}%`:`正在扫描 · 已检查 ${job.inspected} 个文件`}</span>
      <progress className="media-library-progress" max={100} {...(percent!==null?{value:percent}:{})} aria-label="扫描进度"/>
      {onCancel&&<button disabled={busy} onClick={()=>onCancel(job)}>取消</button>}
    </div>;
  }
  if(job?.state==='failed')return <div className="media-library-scan" data-state="failed">
    <span className="media-library-scan-error" role="alert">{scanFeedback(job.error)}</span>
    <span className="media-library-scan-actions">{onDetails&&<button className="media-library-details" onClick={onDetails}>查看详情</button>}<button disabled={busy} onClick={onScan}>重试</button></span>
  </div>;
  return <div className="media-library-scan" data-state="idle">
    {job?.finishedAt?<span className="media-library-scan-time">{job.state==='cancelled'?'上次扫描已取消 · ':'上次扫描 '}{scanTime(job.finishedAt)}</span>:job?null:<span className="media-library-scan-time">尚未扫描</span>}
    <button disabled={busy} onClick={onScan}>{job?'重新扫描':'开始扫描'}</button>
  </div>;
}
export function MediaLibraryList({api,libraries,busy,position,onPosition,onEdit,onScan,onPermissions,jobs,onCancel,onDetails}:{api:MediaApi;libraries:Library[];busy:boolean;position:LibraryListPosition;onPosition:(position:LibraryListPosition)=>void;onEdit:(library:Library)=>void;onScan:(id:string)=>void;onPermissions:(library:Library)=>void;onJobs?: (id:string)=>void;
  /** Latest scan per library (GET scan-jobs); without it the row only offers 重新扫描. */
  jobs?:ScanJob[];onCancel?:(job:ScanJob)=>void;onDetails?:(library:Library)=>void}){
  const latest=new Map((jobs??[]).filter(job=>job.libraryId).map(job=>[job.libraryId!,job]));
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
    <div className="media-library-list">{filtered.slice(page*30,page*30+30).map(library=>{const summary=summariesById.get(library.id),glyph=icons[library.kind]??'folder';return <div className="media-library-row" data-kind={library.kind} key={library.id}>
      <span className="media-library-icon" aria-hidden="true"><Icon name={glyph} size={20} /></span>
      <span className="media-library-copy"><strong><span className="media-library-name">{library.name}</span> <em className="media-library-kind">{labels[library.kind]}</em>{library.access!=='all'&&<em className="media-library-kind" data-access="restricted">指定用户</em>}</strong>{summary?<><small>{count(library,summary)}</small><small className="media-library-directory" title={summary.root}>{library.storage==='openlist'?'OpenList · ':''}{summary.root}</small></>:status==='ready'?<small>目录与数量暂不可用</small>:null}</span>
      <ActionMenu className="media-library-actions media-icon-button" label={'媒体库操作 '+library.name} title={library.name} items={[{label:'编辑媒体库',disabled:busy,onSelect:()=>onEdit(library)},{label:'访问权限',onSelect:()=>onPermissions(library)},...(onDetails?[{label:'扫描记录',onSelect:()=>onDetails(library)}]:[])]}/>
      <footer className="media-library-footer"><span className="media-library-missing" data-missing={summary&&summary.missingFiles>0?'true':undefined}>{summary?summary.missingFiles>0?summary.missingFiles+' 个文件缺失':'无缺失文件':'摘要暂不可用'}</span>{jobs?<ScanState job={latest.get(library.id)} busy={busy} onScan={()=>onScan(library.id)} {...(onCancel?{onCancel}:{})} {...(onDetails?{onDetails:()=>onDetails(library)}:{})}/>:<button disabled={busy} onClick={()=>onScan(library.id)}>重新扫描</button>}</footer>
    </div>;})}</div>
    {!filtered.length&&!!libraries.length&&<p className="media-manager-note">没有符合查找条件的媒体库。<button onClick={()=>onPosition({query:'',page:0})}>清除查找</button></p>}
    {last>0&&<nav className="media-toolbar" aria-label="媒体库分页"><button disabled={!page} onClick={()=>onPosition({...position,page:page-1})}>上一页</button><span>{page+1} / {last+1}</span><button disabled={page===last} onClick={()=>onPosition({...position,page:page+1})}>下一页</button></nav>}
  </section>;
}
