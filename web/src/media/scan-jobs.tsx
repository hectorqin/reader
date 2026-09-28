import { RefreshCw, X } from 'lucide-preact';
import { useState } from '../ui/vendor/preact.ts';
import type { Library, ScanJob } from './api.ts';
import { scanFeedback } from './scan-feedback.ts';

const states:Record<string,string>={queued:'排队中',running:'进行中',complete:'已完成',failed:'失败',cancelled:'已取消'};
const phases:Record<string,string>={list:'读取目录',probe:'分析媒体',stat:'校验文件',metadata:'读取元数据',publish:'保存资料'};
const duration=(ms:number)=>`${(ms/1000).toFixed(1)} 秒`;
export function ScanJobs({jobs,libraryName,libraries,busy,onCancel,onRetry}:{jobs:ScanJob[];libraryName:string;libraries?:Library[];busy:boolean;onCancel:(id:string)=>void;onRetry:(libraryId?:string)=>void}){
  const [page,setPage]=useState(0),last=Math.max(0,Math.ceil(jobs.length/30)-1),current=Math.min(page,last);
  return <div className="media-scan-jobs">{jobs.slice(current*30,current*30+30).map(job=><article className={'media-scan-job'+(job.state==='running'?' is-running':'')} key={job.id}>
    <div className="media-task-copy"><strong>{libraries?.find(library=>library.id===job.libraryId)?.name||libraryName} · 目录扫描</strong><small>已检查 {job.inspected} 个文件</small></div>
    <span className="media-task-state" data-state={job.state}>{states[job.state]||job.state}</span>
    {['running','queued'].includes(job.state)?<button className="media-task-icon" aria-label="取消扫描" title="取消扫描" disabled={busy} onClick={()=>onCancel(job.id)}><X size={18} aria-hidden="true"/></button>:['failed','cancelled'].includes(job.state)?<button className="media-task-icon" aria-label="重新扫描媒体库" title="重新扫描媒体库" disabled={busy||jobs.some(row=>['running','queued'].includes(row.state)&&row.libraryId===job.libraryId)} onClick={()=>onRetry(job.libraryId)}><RefreshCw size={18} aria-hidden="true"/></button>:null}
    {job.state==='running'&&<progress className="media-task-progress" aria-label="扫描进度"/>}
    {job.diagnostics&&<div className="media-task-note">
      <p>耗时 {duration(job.diagnostics.elapsedMs)}{job.diagnostics.elapsedMs>0?` · 平均 ${(job.inspected*1000/job.diagnostics.elapsedMs).toFixed(1)} 个文件/秒`:''}</p>
      {job.state==='running'&&job.diagnostics.active.map((activity,index)=><p key={index}>{phases[activity.phase]||activity.phase}{activity.ref?` · ${activity.ref}`:''} · 已等待 {duration(activity.elapsedMs)}</p>)}
      <details><summary>扫描日志与耗时</summary>
        <p>各阶段累计耗时（并发操作分别计时）：{Object.entries(job.diagnostics.timings).map(([phase,ms])=>`${phases[phase]||phase} ${duration(ms)}`).join(' · ')}</p>
        <ol>{job.diagnostics.logs.map((log,index)=><li key={index}><time>{new Date(log.at).toLocaleTimeString()}</time> {log.message}</li>)}</ol>
      </details>
    </div>}
    {job.error&&<p className="media-task-note">{scanFeedback(job.error)}</p>}
  </article>)}{last>0&&<nav className="media-toolbar" aria-label="扫描任务分页"><button disabled={!current} onClick={()=>setPage(current-1)}>上一页</button><span>{current+1} / {last+1}</span><button disabled={current===last} onClick={()=>setPage(current+1)}>下一页</button></nav>}</div>;
}
