import { RefreshCw, X } from 'lucide-preact';
import { useState } from '../ui/vendor/preact.ts';
import type { Library, ScanJob } from './api.ts';
import { scanFeedback } from './scan-feedback.ts';

const states:Record<string,string>={queued:'排队中',running:'进行中',complete:'已完成',failed:'失败',cancelled:'已取消'};
export function ScanJobs({jobs,libraryName,libraries,busy,onCancel,onRetry}:{jobs:ScanJob[];libraryName:string;libraries?:Library[];busy:boolean;onCancel:(id:string)=>void;onRetry:(libraryId?:string)=>void}){
  const [page,setPage]=useState(0),last=Math.max(0,Math.ceil(jobs.length/30)-1),current=Math.min(page,last);
  return <div className="media-scan-jobs">{jobs.slice(current*30,current*30+30).map(job=><article className={'media-scan-job'+(job.state==='running'?' is-running':'')} key={job.id}>
    <div className="media-task-copy"><strong>{libraries?.find(library=>library.id===job.libraryId)?.name||libraryName} · 目录扫描</strong><small>已检查 {job.inspected} 个文件</small></div>
    <span className="media-task-state" data-state={job.state}>{states[job.state]||job.state}</span>
    {['running','queued'].includes(job.state)?<button className="media-task-icon" aria-label="取消扫描" title="取消扫描" disabled={busy} onClick={()=>onCancel(job.id)}><X size={18} aria-hidden="true"/></button>:['failed','cancelled'].includes(job.state)?<button className="media-task-icon" aria-label="重新扫描媒体库" title="重新扫描媒体库" disabled={busy||jobs.some(row=>['running','queued'].includes(row.state)&&row.libraryId===job.libraryId)} onClick={()=>onRetry(job.libraryId)}><RefreshCw size={18} aria-hidden="true"/></button>:null}
    {job.state==='running'&&<progress className="media-task-progress" aria-label="扫描进度"/>}
    {job.error&&<p className="media-task-note">{scanFeedback(job.error)}</p>}
  </article>)}{last>0&&<nav className="media-toolbar" aria-label="扫描任务分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页</button></nav>}</div>;
}
