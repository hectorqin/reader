import {createHash, randomUUID} from 'node:crypto';
import type {Db} from '../db/index.ts';
import type {BusinessValues} from './business-settings.ts';
import {AppError, badRequest} from '../lib/errors.ts';
import type {FastifyBaseLogger} from 'fastify';

export type AiConfig=BusinessValues['ai'];
export interface AiScanJob {id:string;libraryId:string;path:string;state:'queued'|'running'|'complete'|'failed';totalPaths:number;processedPaths:number;batchCount:number;resultCount:number;error:string|null;startedAt:number;finishedAt:number|null}
export interface AiScanBatch {id:string;jobId:string;batch:number;pathCount:number;paths:string[];raw:string|null;items:unknown[];state:'running'|'complete'|'failed';error:string|null;startedAt:number;finishedAt:number|null}
interface JobRow {id:string;library_id:string;path:string;state:AiScanJob['state'];total_paths:number;processed_paths:number;batch_count:number;result_count:number;error:string|null;started_at:number;finished_at:number|null}
interface BatchRow {id:string;job_id:string;batch:number;path_count:number;paths_json:string;raw:string|null;items_json:string;state:AiScanBatch['state'];error:string|null;started_at:number;finished_at:number|null}
export class AiService {
  constructor(private readonly db:Pick<Db,'run'|'get'|'all'|'transaction'>, private readonly config:()=>AiConfig, private readonly log?:Pick<FastifyBaseLogger,'info'|'warn'|'error'>){
    db.run(`CREATE TABLE IF NOT EXISTS ai_scan_results(id TEXT PRIMARY KEY,library_id TEXT NOT NULL,path TEXT NOT NULL,category TEXT NOT NULL,payload_json TEXT NOT NULL,raw TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(library_id,path))`);
    db.run(`CREATE TABLE IF NOT EXISTS ai_summaries(user_id TEXT NOT NULL,book_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content_hash TEXT NOT NULL,prompt_hash TEXT NOT NULL,summary TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,book_id,chapter_id,content_hash,prompt_hash))`);
    db.run(`CREATE TABLE IF NOT EXISTS ai_scan_jobs(id TEXT PRIMARY KEY,library_id TEXT NOT NULL,path TEXT NOT NULL,state TEXT NOT NULL,total_paths INTEGER NOT NULL,processed_paths INTEGER NOT NULL DEFAULT 0,batch_count INTEGER NOT NULL DEFAULT 0,result_count INTEGER NOT NULL DEFAULT 0,error TEXT,started_at INTEGER NOT NULL,finished_at INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS ai_scan_batches(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ai_scan_jobs(id) ON DELETE CASCADE,batch INTEGER NOT NULL,path_count INTEGER NOT NULL,paths_json TEXT NOT NULL,raw TEXT,items_json TEXT NOT NULL,state TEXT NOT NULL,error TEXT,started_at INTEGER NOT NULL,finished_at INTEGER,UNIQUE(job_id,batch))`);
  }
  private readonly active = new Map<string,{controller:AbortController;done:Promise<void>}>();
  private closing=false;
  recoverJobs():void {
    const now=Date.now();
    this.db.run("UPDATE ai_scan_batches SET state='failed',error='服务重启，批次中断',finished_at=? WHERE state='running'",now);
    this.db.run("UPDATE ai_scan_jobs SET state='failed',error='服务重启，扫描中断；已完成批次仍可查看',finished_at=? WHERE state IN ('queued','running')",now);
  }
  async close():Promise<void>{
    this.closing=true;
    for(const entry of this.active.values())entry.controller.abort();
    await Promise.all([...this.active.values()].map(entry=>entry.done));
  }
  private jobDto(row:JobRow):AiScanJob {
    return {id:row.id,libraryId:row.library_id,path:row.path,state:row.state,totalPaths:row.total_paths,
      processedPaths:row.processed_paths,batchCount:row.batch_count,resultCount:row.result_count,
      error:row.error,startedAt:row.started_at,finishedAt:row.finished_at};
  }
  private batchDto(row:BatchRow):AiScanBatch {
    return {id:row.id,jobId:row.job_id,batch:row.batch,pathCount:row.path_count,paths:JSON.parse(row.paths_json),
      raw:row.raw,items:JSON.parse(row.items_json),state:row.state,error:row.error,startedAt:row.started_at,finishedAt:row.finished_at};
  }
  startJob(libraryId:string,path:string,paths:string[]):AiScanJob {
    if(this.closing)throw new AppError(503,'AI_SCAN_STOPPING','服务正在关闭');
    const existing=this.db.get<JobRow>("SELECT * FROM ai_scan_jobs WHERE library_id=? AND state IN ('queued','running')",libraryId);
    if(existing){
      if(existing.path===path)return this.jobDto(existing);
      throw new AppError(409,'AI_SCAN_RUNNING','该媒体库已有 AI 扫描任务，请等待完成');
    }
    const config={...this.settings('scanEnabled')},id=randomUUID(),controller=new AbortController();
    this.db.run("INSERT INTO ai_scan_jobs(id,library_id,path,state,total_paths,started_at) VALUES(?,?,?,'queued',?,?)",id,libraryId,path,paths.length,Date.now());
    // Return acceptance before any billable upstream request.
    const done=new Promise<void>(resolve=>setImmediate(resolve))
      .then(()=>this.runJob(id,libraryId,paths,config,controller.signal))
      .finally(()=>this.active.delete(id));
    this.active.set(id,{controller,done});
    this.log?.info({jobId:id,libraryId,path,pathCount:paths.length},'ai media scan job accepted');
    return this.job(id);
  }
  private splitBatches(paths:string[],size:number):string[][] {
    const groups=new Map<string,string[]>();
    for(const path of paths){
      const index=path.lastIndexOf('/'),dir=index<0?'':path.slice(0,index),group=groups.get(dir)??[];
      group.push(path);groups.set(dir,group);
    }
    const batches:string[][]=[];let current:string[]=[];
    for(const group of groups.values()){
      if(current.length&&current.length+group.length>size){batches.push(current);current=[];}
      current.push(...group);
    }
    if(current.length)batches.push(current);
    return batches;
  }
  private async runJob(id:string,libraryId:string,paths:string[],config:AiConfig,signal:AbortSignal):Promise<void>{
    try{
      signal.throwIfAborted();
      const batches=this.splitBatches(paths,config.batchSize);
      this.db.run("UPDATE ai_scan_jobs SET state='running',batch_count=? WHERE id=?",batches.length,id);
      let processed=0,resultCount=0;
      for(const [index,part] of batches.entries()){
        signal.throwIfAborted();
        const bid=randomUUID(),started=Date.now();
        this.db.run("INSERT INTO ai_scan_batches(id,job_id,batch,path_count,paths_json,items_json,state,started_at) VALUES(?,?,?,?,?,?,'running',?)",
          bid,id,index+1,part.length,JSON.stringify(part),'[]',started);
        this.log?.info({jobId:id,libraryId,batch:index+1,totalBatches:batches.length,pathCount:part.length},'ai media scan batch started');
        try{
          const result=await this.scan(libraryId,part,raw=>this.db.run('UPDATE ai_scan_batches SET raw=? WHERE id=?',raw,bid),config,signal);
          processed+=part.length;resultCount+=result.items.length;
          this.db.transaction(()=>{
            this.db.run("UPDATE ai_scan_batches SET items_json=?,state='complete',finished_at=? WHERE id=?",JSON.stringify(result.items),Date.now(),bid);
            this.db.run('UPDATE ai_scan_jobs SET processed_paths=?,result_count=? WHERE id=?',processed,resultCount,id);
          });
          this.log?.info({jobId:id,libraryId,batch:index+1,resultCount:result.items.length,elapsedMs:Date.now()-started},'ai media scan batch completed');
        }catch(error){
          this.db.run("UPDATE ai_scan_batches SET state='failed',error=?,finished_at=? WHERE id=?",this.jobError(error,signal),Date.now(),bid);
          throw error;
        }
      }
      this.db.run("UPDATE ai_scan_jobs SET state='complete',finished_at=? WHERE id=?",Date.now(),id);
      this.log?.info({jobId:id,libraryId,batchCount:batches.length,resultCount},'ai media scan job completed');
    }catch(error){
      this.db.run("UPDATE ai_scan_jobs SET state='failed',error=?,finished_at=? WHERE id=?",this.jobError(error,signal),Date.now(),id);
      this.log?.error({err:error,jobId:id,libraryId},'ai media scan job failed');
    }
  }
  private jobError(error:unknown,signal:AbortSignal){return signal.aborted?'服务停止，扫描中断；已完成批次仍可查看':error instanceof Error?error.message:'AI 扫描失败';}
  job(id:string):AiScanJob {
    const row=this.db.get<JobRow>('SELECT * FROM ai_scan_jobs WHERE id=?',id);
    if(!row)throw new AppError(404,'AI_SCAN_JOB_NOT_FOUND','AI 扫描任务不存在');
    return this.jobDto(row);
  }
  jobs(libraryId?:string):AiScanJob[]{
    const rows=libraryId?this.db.all<JobRow>('SELECT * FROM ai_scan_jobs WHERE library_id=? ORDER BY started_at DESC LIMIT 200',libraryId)
      :this.db.all<JobRow>('SELECT * FROM ai_scan_jobs ORDER BY started_at DESC LIMIT 200');
    return rows.map(row=>this.jobDto(row));
  }
  batches(id:string):AiScanBatch[]{
    this.job(id);
    return this.db.all<BatchRow>('SELECT * FROM ai_scan_batches WHERE job_id=? ORDER BY batch',id).map(row=>this.batchDto(row));
  }
  deleteJob(id:string):void {
    const job=this.job(id);
    if(['queued','running'].includes(job.state))throw new AppError(409,'AI_SCAN_RUNNING','运行中的任务不能删除');
    this.db.transaction(()=>{
      this.db.run('DELETE FROM ai_scan_batches WHERE job_id=?',id);
      this.db.run('DELETE FROM ai_scan_jobs WHERE id=?',id);
    });
  }
  private async fetch(url:string,init:RequestInit):Promise<Response>{
    let parsed:URL;try{parsed=new URL(url);}catch{throw badRequest('请输入有效的 AI 服务地址');}
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw badRequest('请输入有效的 HTTP 或 HTTPS 地址');
    const started=Date.now();this.log?.info({url:parsed.origin+parsed.pathname,method:init.method??'GET'},'ai upstream request started');
    try{const response=await fetch(url,{...init,redirect:'error'});this.log?.info({url:parsed.origin+parsed.pathname,status:response.status,elapsedMs:Date.now()-started},'ai upstream response received');return response;}catch(error){this.log?.error({err:error,url:parsed.origin+parsed.pathname,elapsedMs:Date.now()-started},'ai upstream request failed');throw new AppError(502,'AI_CONNECTION_FAILED','AI 连接失败或超时，请检查服务地址及网络');}
  }
  async scanBatches(libraryId:string,paths:string[]){
    const c=this.settings('scanEnabled'),groups=new Map<string,string[]>();
    this.log?.info({libraryId,pathCount:paths.length,batchSize:c.batchSize},'ai media scan started');
    for(const path of paths){const index=path.lastIndexOf('/'),dir=index<0?'':path.slice(0,index);const group=groups.get(dir)??[];group.push(path);groups.set(dir,group);}
    const batches:string[][]=[];let batch:string[]=[];
    for(const group of groups.values()){if(batch.length&&batch.length+group.length>c.batchSize){batches.push(batch);batch=[];}batch.push(...group);}
    if(batch.length)batches.push(batch);
    const items:unknown[]=[];for(const [index,part] of batches.entries()){this.log?.info({libraryId,batch:index+1,totalBatches:batches.length,pathCount:part.length},'ai media scan batch started');items.push(...(await this.scan(libraryId,part)).items);this.log?.info({libraryId,batch:index+1,resultCount:items.length},'ai media scan batch completed');}
    this.log?.info({libraryId,pathCount:paths.length,batchCount:batches.length,resultCount:items.length},'ai media scan completed');
    return {items,total:paths.length,batches:batches.length};
  }
  private settings(required:'scanEnabled'|'summaryEnabled') { const c=this.config(); if(!c.enabled||!c[required]) throw new AppError(403,'AI_DISABLED','AI 功能未启用'); if(!c.baseUrl||!c.apiKey||!c.model) throw badRequest('AI 尚未完成配置'); return c; }
  private async chat(prompt:string,system:string,c:AiConfig,signal?:AbortSignal):Promise<string>{
    const base=c.baseUrl.replace(/\/$/,''); const response=await this.fetch(`${base}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${c.apiKey}`},body:JSON.stringify({model:c.model,temperature:0.2,messages:[{role:'system',content:system},{role:'user',content:prompt}]}) ,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
    if(!response.ok) throw new AppError(502,'AI_REQUEST_FAILED',`AI 请求失败（HTTP ${response.status}）`);
    const body=await response.json() as {choices?:Array<{message?:{content?:string}}>}; const text=body.choices?.[0]?.message?.content; if(typeof text!=='string'||!text.trim()) throw new AppError(502,'AI_EMPTY_RESPONSE','AI 未返回有效内容'); return text.trim();
  }
  async models(baseUrl?:string,apiKey?:string){const c=this.config(),url=(baseUrl||c.baseUrl).trim(),key=apiKey||c.apiKey; if(!url||!key) throw badRequest('请先填写 Base URL 和 API Key'); const response=await this.fetch(`${url.replace(/\/$/,'')}/models`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)}); if(!response.ok) throw new AppError(502,'AI_MODELS_FAILED',`获取模型失败（HTTP ${response.status}）`); const body=await response.json() as {data?:Array<{id?:string}>}; return (body.data||[]).map(x=>x.id).filter((x):x is string=>!!x);}
  async scan(libraryId:string,paths:string[],onRaw?:(raw:string)=>void,config?:AiConfig,signal?:AbortSignal){const c=config??this.settings('scanEnabled'); if(!paths.length)return {items:[]}; const prompt=`${c.scanPrompt}\n\n媒体路径列表：\n${paths.map(p=>JSON.stringify(p)).join('\n')}`; const raw=await this.chat(prompt,'你是媒体库分类器，只输出合法 JSON 数组。',c,signal); onRaw?.(raw); let parsed:unknown; try{parsed=JSON.parse(raw.replace(/^```json\s*|\s*```$/g,''));}catch{throw new AppError(502,'AI_INVALID_JSON','AI 返回的扫描结果不是合法 JSON');} if(!Array.isArray(parsed)){this.log?.error({libraryId,responseType:typeof parsed},'ai media response shape invalid');throw new AppError(502,'AI_INVALID_JSON','AI 扫描结果必须是数组');} const allowed=new Set(['movie','series','music','audiobook','other']); const items=parsed.flatMap((x:any)=>x!==null&&typeof x==='object'&&typeof x.path==='string'?[{...x,category:allowed.has(x.category)?x.category:'other'}]:[]); this.log?.info({libraryId,pathCount:paths.length,resultCount:items.length},'ai media response parsed'); this.db.transaction(()=>{for(const item of items)this.db.run('INSERT INTO ai_scan_results(id,library_id,path,category,payload_json,raw,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(library_id,path) DO UPDATE SET category=excluded.category,payload_json=excluded.payload_json,raw=excluded.raw,created_at=excluded.created_at',randomUUID(),libraryId,item.path,item.category,JSON.stringify(item),raw,Date.now());}); return {items,raw};}
  async summary(userId:string,bookId:string,chapterId:string,content:string){const c=this.settings('summaryEnabled'); const limited=content.slice(0,c.maxInputChars); const contentHash=createHash('sha256').update(limited).digest('hex'),promptHash=createHash('sha256').update(c.summaryPrompt).digest('hex'); const hit=this.db.get<{summary:string}>('SELECT summary FROM ai_summaries WHERE user_id=? AND book_id=? AND chapter_id=? AND content_hash=? AND prompt_hash=?',userId,bookId,chapterId,contentHash,promptHash); if(hit)return {summary:hit.summary,cached:true}; const summary=await this.chat(`${c.summaryPrompt}\n\n章节内容：\n${limited}`,'你是专业阅读助手。',c); this.db.run('INSERT INTO ai_summaries(user_id,book_id,chapter_id,content_hash,prompt_hash,summary,created_at) VALUES(?,?,?,?,?,?,?)',userId,bookId,chapterId,contentHash,promptHash,summary,Date.now()); return {summary,cached:false};}
}

