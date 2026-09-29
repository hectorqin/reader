import {createHash, randomUUID} from 'node:crypto';
import type {Db} from '../db/index.ts';
import type {BusinessValues} from './business-settings.ts';
import {AppError, badRequest} from '../lib/errors.ts';

export type AiConfig=BusinessValues['ai'];
export class AiService {
  constructor(private readonly db:Pick<Db,'run'|'get'|'transaction'>, private readonly config:()=>AiConfig){
    db.run(`CREATE TABLE IF NOT EXISTS ai_scan_results(id TEXT PRIMARY KEY,library_id TEXT NOT NULL,path TEXT NOT NULL,category TEXT NOT NULL,payload_json TEXT NOT NULL,raw TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(library_id,path))`);
    db.run(`CREATE TABLE IF NOT EXISTS ai_summaries(user_id TEXT NOT NULL,book_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content_hash TEXT NOT NULL,prompt_hash TEXT NOT NULL,summary TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,book_id,chapter_id,content_hash,prompt_hash))`);
  }
  private async fetch(url:string,init:RequestInit):Promise<Response>{
    let parsed:URL;try{parsed=new URL(url);}catch{throw badRequest('请输入有效的 AI 服务地址');}
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw badRequest('请输入有效的 HTTP 或 HTTPS 地址');
    try{return await fetch(url,{...init,redirect:'error'});}catch{throw new AppError(502,'AI_CONNECTION_FAILED','AI 连接失败或超时，请检查服务地址及网络');}
  }
  async scanBatches(libraryId:string,paths:string[]){
    const c=this.settings('scanEnabled'),groups=new Map<string,string[]>();
    for(const path of paths){const index=path.lastIndexOf('/'),dir=index<0?'':path.slice(0,index);const group=groups.get(dir)??[];group.push(path);groups.set(dir,group);}
    const batches:string[][]=[];let batch:string[]=[];
    for(const group of groups.values()){if(batch.length&&batch.length+group.length>c.batchSize){batches.push(batch);batch=[];}batch.push(...group);}
    if(batch.length)batches.push(batch);
    const items:unknown[]=[];for(const part of batches)items.push(...(await this.scan(libraryId,part)).items);
    return {items,total:paths.length,batches:batches.length};
  }
  private settings(required:'scanEnabled'|'summaryEnabled') { const c=this.config(); if(!c.enabled||!c[required]) throw new AppError(403,'AI_DISABLED','AI 功能未启用'); if(!c.baseUrl||!c.apiKey||!c.model) throw badRequest('AI 尚未完成配置'); return c; }
  private async chat(prompt:string,system:string,c:AiConfig):Promise<string>{
    const base=c.baseUrl.replace(/\/$/,''); const response=await this.fetch(`${base}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${c.apiKey}`},body:JSON.stringify({model:c.model,temperature:0.2,messages:[{role:'system',content:system},{role:'user',content:prompt}]}) ,signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new AppError(502,'AI_REQUEST_FAILED',`AI 请求失败（HTTP ${response.status}）`);
    const body=await response.json() as {choices?:Array<{message?:{content?:string}}>}; const text=body.choices?.[0]?.message?.content; if(typeof text!=='string'||!text.trim()) throw new AppError(502,'AI_EMPTY_RESPONSE','AI 未返回有效内容'); return text.trim();
  }
  async models(baseUrl?:string,apiKey?:string){const c=this.config(),url=(baseUrl||c.baseUrl).trim(),key=apiKey||c.apiKey; if(!url||!key) throw badRequest('请先填写 Base URL 和 API Key'); const response=await this.fetch(`${url.replace(/\/$/,'')}/models`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)}); if(!response.ok) throw new AppError(502,'AI_MODELS_FAILED',`获取模型失败（HTTP ${response.status}）`); const body=await response.json() as {data?:Array<{id?:string}>}; return (body.data||[]).map(x=>x.id).filter((x):x is string=>!!x);}
  async scan(libraryId:string,paths:string[]){const c=this.settings('scanEnabled'); if(!paths.length)return {items:[]}; const prompt=`${c.scanPrompt}\n\n媒体路径列表：\n${paths.map(p=>JSON.stringify(p)).join('\n')}`; const raw=await this.chat(prompt,'你是媒体库分类器，只输出合法 JSON 数组。',c); let parsed:unknown; try{parsed=JSON.parse(raw.replace(/^```json\s*|\s*```$/g,''));}catch{throw new AppError(502,'AI_INVALID_JSON','AI 返回的扫描结果不是合法 JSON');} if(!Array.isArray(parsed))throw new AppError(502,'AI_INVALID_JSON','AI 扫描结果必须是数组'); const allowed=new Set(['movie','series','music','audiobook','other']); const items=parsed.flatMap((x:any)=>x!==null&&typeof x==='object'&&typeof x.path==='string'?[{...x,category:allowed.has(x.category)?x.category:'other'}]:[]); this.db.transaction(()=>{for(const item of items)this.db.run('INSERT INTO ai_scan_results(id,library_id,path,category,payload_json,raw,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(library_id,path) DO UPDATE SET category=excluded.category,payload_json=excluded.payload_json,raw=excluded.raw,created_at=excluded.created_at',randomUUID(),libraryId,item.path,item.category,JSON.stringify(item),raw,Date.now());}); return {items,raw};}
  async summary(userId:string,bookId:string,chapterId:string,content:string){const c=this.settings('summaryEnabled'); const limited=content.slice(0,c.maxInputChars); const contentHash=createHash('sha256').update(limited).digest('hex'),promptHash=createHash('sha256').update(c.summaryPrompt).digest('hex'); const hit=this.db.get<{summary:string}>('SELECT summary FROM ai_summaries WHERE user_id=? AND book_id=? AND chapter_id=? AND content_hash=? AND prompt_hash=?',userId,bookId,chapterId,contentHash,promptHash); if(hit)return {summary:hit.summary,cached:true}; const summary=await this.chat(`${c.summaryPrompt}\n\n章节内容：\n${limited}`,'你是专业阅读助手。',c); this.db.run('INSERT INTO ai_summaries(user_id,book_id,chapter_id,content_hash,prompt_hash,summary,created_at) VALUES(?,?,?,?,?,?,?)',userId,bookId,chapterId,contentHash,promptHash,summary,Date.now()); return {summary,cached:false};}
}
