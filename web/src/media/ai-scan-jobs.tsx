import {ChevronDown,ChevronRight,RefreshCw,Trash2} from 'lucide-preact';
import {useEffect,useState} from '../ui/vendor/preact.ts';
import type {AiScanBatch,AiScanJob,Library,MediaApi} from './api.ts';

const labels:Record<string,string>={queued:'排队中',running:'进行中',complete:'已完成',failed:'失败'};
const category:Record<string,string>={movie:'电影',series:'剧集',music:'音乐',audiobook:'有声书',other:'其他'};
const elapsed=(job:AiScanJob)=>`${(((job.finishedAt??Date.now())-job.startedAt)/1000).toFixed(1)} 秒`;
function Batch({batch}:{batch:AiScanBatch}){
  const [open,setOpen]=useState(false);
  return <article className="media-ai-batch"><button className="media-ai-batch-toggle" onClick={()=>setOpen(!open)}>{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}第 {batch.batch} 批 · {batch.pathCount} 条路径 · {batch.state==='complete'?'已完成':batch.state==='failed'?'失败':'进行中'}</button>{open&&<div className="media-ai-batch-detail"><p>路径：{batch.paths.join('、')}</p>{batch.error&&<p className="media-error">{batch.error}</p>}{batch.raw&&<details open><summary>AI 原始返回</summary><pre>{batch.raw}</pre></details>}<details><summary>解析结果（{batch.items.length} 条）</summary><pre>{JSON.stringify(batch.items,(key,value)=>key==='category'?category[value]??value:value,2)}</pre></details></div>}</article>;
}
export function AiScanJobs({api,jobs,libraries,busy,onRefresh,onDelete}:{api:MediaApi;jobs:AiScanJob[];libraries:Library[];busy:boolean;onRefresh:()=>void;onDelete:(id:string)=>void}){
  const [selected,setSelected]=useState<string|null>(null),[batches,setBatches]=useState<AiScanBatch[]>([]);
  useEffect(()=>{if(!selected){setBatches([]);return;}let cancelled=false;void api.aiScanBatches(selected).then(result=>{if(!cancelled)setBatches(result.items);});return()=>{cancelled=true;};},[api,selected,jobs]);
  useEffect(()=>{if(!jobs.some(job=>job.state==='queued'||job.state==='running'))return;const timer=setInterval(onRefresh,2500);return()=>clearInterval(timer);},[jobs,onRefresh]);
  return <section className="media-ai-jobs"><header className="media-ai-jobs-heading"><h2>AI 扫描任务</h2><button disabled={busy} onClick={onRefresh} aria-label="刷新 AI 扫描任务"><RefreshCw size={16}/></button></header>{!jobs.length&&<p>暂无 AI 扫描任务。</p>}{jobs.map(job=><article className="media-ai-job" key={job.id}><div className="media-ai-job-head"><div><strong>{libraries.find(l=>l.id===job.libraryId)?.name??job.libraryId} · {job.path||'整个库'}</strong><small>{job.processedPaths}/{job.totalPaths} 条路径 · {job.resultCount} 条结果 · 耗时 {elapsed(job)}</small></div><span className="media-task-state" data-state={job.state}>{labels[job.state]}</span></div><div className="media-ai-job-actions"><button disabled={busy} onClick={()=>setSelected(selected===job.id?null:job.id)}>{selected===job.id?'收起明细':'查看明细'}</button>{!['queued','running'].includes(job.state)&&<button disabled={busy} onClick={()=>onDelete(job.id)} aria-label="删除 AI 扫描任务"><Trash2 size={16}/>删除</button>}</div>{job.error&&<p className="media-error">{job.error}</p>}{selected===job.id&&<div className="media-ai-batches">{batches.length?batches.map(batch=><Batch batch={batch} key={batch.id}/>):<p>正在读取批次明细…</p>}</div>}</article>)}</section>;
}
