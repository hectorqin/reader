import { randomUUID } from 'node:crypto';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import type { MediaActor } from './libraries.ts';
import type { MediaCatalog } from './catalog.ts';
import type { MediaScraping } from './scraping.ts';
import { DatabaseMediaAccounts } from './accounts.ts';
import type { MediaAccounts } from './accounts.ts';

export const SCRAPE_RESULT_STATES=['pending','running','matched','review','unmatched','unchanged','failed','cancelled','interrupted'] as const;
const resultSelect=`SELECT j.item_id itemId,j.state,j.error,COALESCE((SELECT json_extract(o.value_json,'$') FROM media_metadata_overrides o WHERE o.item_id=i.id AND o.field='title'),(SELECT json_extract(m.fields_json,'$.title') FROM media_online_metadata m WHERE m.item_id=i.id),i.title) title,l.kind channel FROM media_scrape_job_items j LEFT JOIN media_items i ON i.id=j.item_id LEFT JOIN media_libraries l ON l.id=i.library_id WHERE j.job_id=?`;

export class MediaScrapeJobs {
  private active=new Map<string,{controller:AbortController;done:Promise<void>}>();
  constructor(private db:MediaDatabase,private catalog:MediaCatalog,private scraping:MediaScraping,private accounts:MediaAccounts=new DatabaseMediaAccounts(db)){
    db.run(`CREATE TABLE IF NOT EXISTS media_scrape_jobs(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,provider TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS media_scrape_job_options(job_id TEXT PRIMARY KEY REFERENCES media_scrape_jobs(id) ON DELETE CASCADE,match_mode TEXT NOT NULL DEFAULT 'strong')`);
    db.run(`CREATE TABLE IF NOT EXISTS media_scrape_job_items(job_id TEXT NOT NULL REFERENCES media_scrape_jobs(id) ON DELETE CASCADE,item_id TEXT NOT NULL,ordinal INTEGER NOT NULL,state TEXT NOT NULL,error TEXT,PRIMARY KEY(job_id,item_id))`);
    db.transaction(()=>{
      db.run("UPDATE media_scrape_job_items SET state='interrupted',error='server-restarted' WHERE job_id IN (SELECT id FROM media_scrape_jobs WHERE state='running') AND state IN ('pending','running')");
      db.run("UPDATE media_scrape_jobs SET state='interrupted' WHERE state='running'");
    });
  }
  private admin(actor:MediaActor){if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');}
  startSeriesChildren(actor:MediaActor,seriesId:string){
    this.admin(actor);
    const series=this.catalog.detail(actor,seriesId),match=series.metadata.onlineMatch as {provider?:string}|undefined;
    if(series.kind!=='series'||match?.provider!=='tmdb')throw badRequest('请先确认剧集的 TMDB 匹配','MEDIA_PARENT_MATCH_REQUIRED');
    const ids:string[]=[];
    for(const season of series.children.filter(item=>item.kind==='season')){
      ids.push(season.id,...this.catalog.detail(actor,season.id).children.filter(item=>item.kind==='episode').map(item=>item.id));
      if(ids.length>500)throw badRequest('季集超过 500 项，请在批量管理中分批选择');
    }
    return this.start(actor,'tmdb',ids);
  }
  start(actor:MediaActor,provider:string,itemIds:string[],matchMode:'strong'|'first'|'manual'='strong'){
    this.admin(actor);
    if(!Array.isArray(itemIds)||!itemIds.length||itemIds.length>500||new Set(itemIds).size!==itemIds.length)throw badRequest('选择 1–500 个不重复作品');
    const source=this.scraping.status(actor).items.find(p=>p.id===provider&&p.configured);
    if(!source)throw badRequest('刮削来源未配置');
    for(const id of itemIds)if(!source.kinds.includes(this.catalog.detail(actor,id).kind))throw badRequest('包含来源不支持的作品类型');
    if(this.active.size)throw conflict('已有批量刮削任务正在运行','SCRAPE_RUNNING');
    const id=randomUUID(),controller=new AbortController();
    if(matchMode!=='strong'&&matchMode!=='first'&&matchMode!=='manual')throw badRequest('无效的匹配策略');
    this.db.transaction(()=>{this.db.run("INSERT INTO media_scrape_jobs(id,actor_id,provider,state,created_at) VALUES(?,?,?,'running',?)",id,actor.id,provider,Date.now());this.db.run("INSERT INTO media_scrape_job_options VALUES(?,?)",id,matchMode);itemIds.forEach((item,index)=>this.db.run("INSERT INTO media_scrape_job_items VALUES(?,?,?,'pending',NULL)",id,item,index));});
    const done=Promise.resolve().then(()=>this.run(actor,id,provider,itemIds,controller.signal)).finally(()=>this.active.delete(id));
    this.active.set(id,{controller,done});return this.get(actor,id);
  }
  get(actor:MediaActor,id:string){
    this.admin(actor);const job=this.db.get<{id:string;provider:string;state:string;created_at:number}>('SELECT id,provider,state,created_at FROM media_scrape_jobs WHERE id=?',id);
    if(!job)throw notFound('刮削任务不存在');
    return {...job,items:this.db.all<{itemId:string;state:string;error:string|null;title:string|null;channel:string|null}>(resultSelect+' ORDER BY j.ordinal',id)};
  }
  summaries(actor:MediaActor){
    this.admin(actor);
    return {items:this.db.all<{id:string;provider:string;state:string;created_at:number}>('SELECT id,provider,state,created_at FROM media_scrape_jobs ORDER BY created_at DESC,id DESC LIMIT 50').map(job=>{
      const counts=Object.fromEntries(this.db.all<{state:string;count:number}>('SELECT state,count(*) count FROM media_scrape_job_items WHERE job_id=? GROUP BY state',job.id).map(row=>[row.state,row.count]));
      return {...job,counts,total:Object.values(counts).reduce((sum,count)=>sum+count,0),items:[]};
    })};
  }
  results(actor:MediaActor,id:string,{state='',offset=0,limit=50}:{state?:string;offset?:number;limit?:number}={}){
    this.admin(actor);
    if(state&&!SCRAPE_RESULT_STATES.some(value=>value===state)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw badRequest('无效的任务结果查询');
    if(!this.db.get('SELECT id FROM media_scrape_jobs WHERE id=?',id))throw notFound('刮削任务不存在');
    const clause=state?' AND j.state=?':'',params=state?[id,state]:[id];
    const total=this.db.get<{n:number}>('SELECT count(*) n FROM media_scrape_job_items j WHERE j.job_id=?'+clause,...params)!.n;
    const items=this.db.all(resultSelect+clause+' ORDER BY j.ordinal,j.item_id LIMIT ? OFFSET ?',...params,limit,offset);
    return {items,total};
  }
  retry(actor:MediaActor,id:string){
    this.admin(actor);
    const job=this.db.get<{provider:string;state:string}>('SELECT provider,state FROM media_scrape_jobs WHERE id=?',id);
    if(!job)throw notFound('刮削任务不存在');
    if(job.state==='running')throw conflict('任务仍在运行','SCRAPE_RUNNING');
    const ids=this.db.all<{id:string}>("SELECT item_id id FROM media_scrape_job_items WHERE job_id=? AND state IN ('failed','interrupted','cancelled') ORDER BY ordinal",id).map(row=>row.id);
    if(!ids.length)throw badRequest('没有可重试的未完成项');
    return this.start(actor,job.provider,ids,this.matchMode(id));
  }
  list(actor:MediaActor){this.admin(actor);return {items:this.db.all<{id:string}>('SELECT id FROM media_scrape_jobs ORDER BY created_at DESC,id DESC LIMIT 50').map(row=>this.get(actor,row.id))};}
  cancel(actor:MediaActor,id:string){this.get(actor,id);this.active.get(id)?.controller.abort();return this.get(actor,id);}
  async wait(id:string){await this.active.get(id)?.done;}
  async close(){const jobs=[...this.active.values()];jobs.forEach(job=>job.controller.abort());await Promise.all(jobs.map(job=>job.done));}
  private matchMode(id:string):'strong'|'first'|'manual' {
    const mode=this.db.get<{match_mode:string}>('SELECT match_mode FROM media_scrape_job_options WHERE job_id=?',id)?.match_mode;
    return mode==='first'||mode==='manual'?mode:'strong';
  }
  private async run(actor:MediaActor,id:string,provider:string,items:string[],signal:AbortSignal){
    const scraping=this.scraping.snapshot();
    try{
      for(const item of items){
        signal.throwIfAborted();
        const user=this.accounts.get(actor.id);
        if(!user||user.disabled||user.role!=='admin')throw new Error('actor-unavailable');
        this.db.run("UPDATE media_scrape_job_items SET state='running' WHERE job_id=? AND item_id=?",id,item);
        try{const mode=this.matchMode(id);const result=await scraping.autoMatch(actor,item,provider,signal,()=>{const current=this.accounts.get(actor.id);if(!current||current.disabled||current.role!=='admin')throw new Error('actor-unavailable');},mode);signal.throwIfAborted();this.db.run('UPDATE media_scrape_job_items SET state=? WHERE job_id=? AND item_id=?',result.status,id,item);}
        catch(error){if(signal.aborted)throw error;this.db.run("UPDATE media_scrape_job_items SET state='failed',error=? WHERE job_id=? AND item_id=?",'匹配失败，请重新审阅或重试',id,item);}
      }
      this.db.run("UPDATE media_scrape_jobs SET state='complete' WHERE id=?",id);
    }catch{
      const state=signal.aborted?'cancelled':'interrupted';
      this.db.transaction(()=>{this.db.run('UPDATE media_scrape_jobs SET state=? WHERE id=?',state,id);this.db.run("UPDATE media_scrape_job_items SET state=? WHERE job_id=? AND state IN ('pending','running')",state,id);});
    }
  }
}
