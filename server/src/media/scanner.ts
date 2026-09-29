import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Db } from '../db/index.ts';
import type { MediaDatabase } from './read-database.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import type { MediaActor } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import { probeMedia, MEDIA_PROBE_VERSION } from './probe.ts';
import type { MediaProbe, ProbeResult } from './probe.ts';
import { readLocalMetadata } from './local-metadata.ts';
import { readArtistProfile } from './artist-metadata.ts';
import { MediaCatalog } from './catalog.ts';
import { MediaStatementDatabase } from './statement-database.ts';
import { MediaPublisher } from './publisher.ts';
import { ScanTrace, type ScanDiagnostics, type ScanLogger } from './scan-diagnostics.ts';
import type { StorageEntry } from './storage/types.ts';
import {MediaDirectoryRules} from './directory-rules.ts';
import {recognizeVideo,withinDirectory} from './video-recognition.ts';
import {videoMetadataReader} from './video-metadata.ts';

const VIDEO = new Set(['.mp4','.mkv','.avi','.mov','.webm','.m4v','.ts','.m2ts','.mpg','.mpeg']);
const AUDIO = new Set(['.mp3','.flac','.m4a','.m4b','.aac','.ogg','.opus','.wav','.aiff','.wma']);
interface AssetRow { id:string; library_id:string; ref:string; size:number; modified_at:number; file_identity:string|null; available:number; probe_status:ProbeResult['status']; technical_json:string|null; publication_fingerprint:string|null }
export interface MediaAsset {
  id:string; libraryId:string; ref:string; size:number; modifiedAt:number; available:boolean;
  probe:ProbeResult;
}
export interface MediaScanJob {
  id:string; libraryId:string; state:'queued'|'running'|'complete'|'failed'|'cancelled';
  inspected:number; error:string|null; startedAt:number; finishedAt:number|null;
  diagnostics?:ScanDiagnostics;
}
interface JobRow { id:string;library_id:string;state:MediaScanJob['state'];inspected:number;error:string|null;started_at:number;finished_at:number|null;diagnostics_json:string|null }

/** Stage a complete snapshot before publishing it; failed scans never mark missing. */
export class MediaScanner {
  readonly catalog:MediaCatalog;
  private readonly db:MediaStatementDatabase;
  private readonly active = new Map<string,{controller:AbortController;done:Promise<void>;cancelQueued:(()=>void)|undefined}>();
  private running=0;
  private pending:Array<()=>void>=[];
  private readonly traces=new Map<string,ScanTrace>();
  constructor(db:MediaDatabase & Pick<Db,'prepare'>,private readonly libraries:MediaLibraries,private readonly probe:MediaProbe=probeMedia,private readonly logger?:ScanLogger,private readonly settings=()=>({libraries:2,files:4})) {
    this.db=new MediaStatementDatabase(db);
    db.transaction(()=>{
      db.run(`CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,
        ref TEXT NOT NULL, size INTEGER NOT NULL, modified_at REAL NOT NULL, file_identity TEXT,
        available INTEGER NOT NULL DEFAULT 1, probe_status TEXT NOT NULL, technical_json TEXT,
        UNIQUE(library_id,ref))`);
      db.run(`CREATE INDEX IF NOT EXISTS media_asset_identity ON media_assets(library_id,file_identity)`);
      if(!db.all<{name:string}>('PRAGMA table_info(media_assets)').some(column=>column.name==='publication_fingerprint'))
        db.run('ALTER TABLE media_assets ADD COLUMN publication_fingerprint TEXT');
      db.run(`CREATE TABLE IF NOT EXISTS media_scan_jobs (
        id TEXT PRIMARY KEY,library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,
        state TEXT NOT NULL,inspected INTEGER NOT NULL DEFAULT 0,error TEXT,started_at INTEGER NOT NULL,finished_at INTEGER)`);
      db.run('CREATE INDEX IF NOT EXISTS media_scan_jobs_library_time ON media_scan_jobs(library_id,started_at)');
      if(!db.all<{name:string}>('PRAGMA table_info(media_scan_jobs)').some(column=>column.name==='diagnostics_json'))
        db.run('ALTER TABLE media_scan_jobs ADD COLUMN diagnostics_json TEXT');
      db.run(`CREATE TABLE IF NOT EXISTS media_scan_stage (
        job_id TEXT NOT NULL REFERENCES media_scan_jobs(id) ON DELETE CASCADE,ref TEXT NOT NULL,payload TEXT NOT NULL,
        PRIMARY KEY(job_id,ref))`);
      db.run("UPDATE media_scan_jobs SET state='failed',error='server-restarted',finished_at=? WHERE state IN ('running','queued')",Date.now());
      db.run('DELETE FROM media_scan_stage');
    });
    this.catalog=new MediaCatalog(this.db,libraries);
    new MediaDirectoryRules(this.db);
  }

  start(actor:MediaActor,libraryId:string):MediaScanJob {
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    this.libraries.get(actor,libraryId);
    if(this.active.has(libraryId))throw conflict('media scan already running','SCAN_RUNNING');
    const id=randomUUID(),controller=new AbortController(),options=this.settings();
    this.db.run("INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES(?,?,'queued',?)",id,libraryId,Date.now());
    let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});
    const execute=()=>{
      entry.cancelQueued=undefined;this.running++;
      this.db.run("UPDATE media_scan_jobs SET state='running' WHERE id=?",id);
      void this.scan(actor,libraryId,id,controller.signal,options.files).finally(()=>{this.active.delete(libraryId);this.running--;finish();this.drain();});
    };
    const entry:{controller:AbortController;done:Promise<void>;cancelQueued:(()=>void)|undefined}={controller,done,cancelQueued:()=>{
      this.pending=this.pending.filter(task=>task!==execute);this.active.delete(libraryId);
      this.db.run("UPDATE media_scan_jobs SET state='cancelled',error='cancelled',finished_at=? WHERE id=?",Date.now(),id);finish();
    }};
    this.active.set(libraryId,entry);this.pending.push(execute);this.drain();
    return this.job(actor,id);
  }

  private drain(){while(this.running<this.settings().libraries&&this.pending.length)this.pending.shift()!();}
  startAll(actor:MediaActor){
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    const items:MediaScanJob[]=[],skipped:string[]=[];
    for(const library of this.libraries.list(actor)){if(this.active.has(library.id)){skipped.push(library.id);continue;}items.push(this.start(actor,library.id));}
    return {items,skipped};
  }
  latestJobs(actor:MediaActor):MediaScanJob[]{
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    // One indexed lookup per library; polling must not sort the entire scan history.
    return this.db.all<JobRow>(`SELECT j.* FROM media_libraries l JOIN media_scan_jobs j ON j.id=(SELECT id FROM media_scan_jobs WHERE library_id=l.id ORDER BY started_at DESC,rowid DESC LIMIT 1) ORDER BY CASE WHEN j.state='running' THEN 0 WHEN j.state='queued' THEN 1 ELSE 2 END,j.started_at DESC,j.id`).map(row=>this.jobDto(row));
  }

  async wait(libraryId:string):Promise<void> { await this.active.get(libraryId)?.done; }
  cancel(actor:MediaActor,id:string):MediaScanJob {
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    const job=this.job(actor,id);
    if(job.state==='running'||job.state==='queued'){const entry=this.active.get(job.libraryId);entry?.controller.abort();entry?.cancelQueued?.();}
    return this.job(actor,id);
  }
  deleteJob(actor:MediaActor,id:string):void {
    const job=this.job(actor,id);
    if(job.state==='running'||job.state==='queued')throw conflict('运行中的扫描任务不能删除','SCAN_RUNNING');
    this.db.transaction(()=>{
      this.db.run('DELETE FROM media_scan_stage WHERE job_id=?',id);
      this.db.run('DELETE FROM media_scan_jobs WHERE id=?',id);
    });
  }
  async close():Promise<void> {
    const jobs=[...this.active.values()];jobs.forEach(job=>{job.controller.abort();job.cancelQueued?.();});
    await Promise.all(jobs.map(job=>job.done));
    this.db.clear();
  }

  job(actor:MediaActor,id:string):MediaScanJob {
    const row=this.db.get<JobRow>('SELECT * FROM media_scan_jobs WHERE id=?',id);
    if(!row)throw notFound('media scan job not found');
    this.libraries.get(actor,row.library_id);
    return this.jobDto(row);
  }

  private jobDto(row:JobRow):MediaScanJob {
    return {id:row.id,libraryId:row.library_id,state:row.state,inspected:row.inspected,error:row.error,startedAt:row.started_at,finishedAt:row.finished_at,
      diagnostics:this.traces.get(row.id)?.snapshot()??(row.diagnostics_json?JSON.parse(row.diagnostics_json):undefined)};
  }

  jobs(actor:MediaActor,libraryId:string):MediaScanJob[] {
    this.libraries.get(actor,libraryId);
    return this.db.all<{id:string}>('SELECT id FROM media_scan_jobs WHERE library_id=? ORDER BY started_at DESC LIMIT 50',libraryId).map(row=>this.job(actor,row.id));
  }

  assets(actor:MediaActor,libraryId:string,offset=0,limit=100):{items:MediaAsset[];total:number} {
    this.libraries.get(actor,libraryId);
    const rows=this.db.all<AssetRow>('SELECT * FROM media_assets WHERE library_id=? ORDER BY ref LIMIT ? OFFSET ?',libraryId,limit,offset);
    return {items:rows.map(row=>this.dto(row)),total:this.db.get<{n:number}>('SELECT count(*) n FROM media_assets WHERE library_id=?',libraryId)!.n};
  }
  asset(actor:MediaActor,id:string):MediaAsset {
    const row=this.db.get<AssetRow>('SELECT * FROM media_assets WHERE id=?',id);
    if(!row)throw notFound('media asset not found');
    this.libraries.get(actor,row.library_id);
    return this.dto(row);
  }
  private dto(row:AssetRow):MediaAsset {
    return {id:row.id,libraryId:row.library_id,ref:row.ref,size:row.size,modifiedAt:row.modified_at,available:row.available===1,
      probe:{status:row.probe_status,info:row.technical_json?JSON.parse(row.technical_json):null}};
  }

  private async scan(actor:MediaActor,libraryId:string,jobId:string,signal:AbortSignal,files=4):Promise<void> {
    const trace=new ScanTrace(jobId,libraryId,this.logger);this.traces.set(jobId,trace);trace.note('开始扫描');
    const heartbeat=setInterval(()=>{
      trace.note('扫描进度');
      this.db.run('UPDATE media_scan_jobs SET diagnostics_json=? WHERE id=?',JSON.stringify(trace.snapshot()),jobId);
    },10_000);
    try {
      const library=this.libraries.get(actor,libraryId),storage=await trace.measure('list',undefined,()=>this.libraries.storage(actor,libraryId));
      const supported=library.kind==='video'?VIDEO:AUDIO;
      const rules=library.kind==='video'?new MediaDirectoryRules(this.db).list(libraryId):[];
      const readVideo=videoMetadataReader(storage);
      let inspected=0;
      const fallbackEpisodes=new Map<string,number>();
      const fallbackFor=(ref:string)=>fallbackEpisodes.get(ref);
      const inspect=async(entry:StorageEntry)=>{
        signal.throwIfAborted();
        if(library.kind==='video'&&rules.filter(rule=>withinDirectory(entry.ref,rule.path)).sort((a,b)=>b.path.length-a.path.length)[0]?.mode==='ignore'){
          // Presence remains part of the snapshot, so ignored files aren't falsely marked missing.
          this.db.run('INSERT INTO media_scan_stage(job_id,ref,payload) VALUES(?,?,?)',jobId,entry.ref,JSON.stringify({...entry,ignored:true}));
          this.db.run('UPDATE media_scan_jobs SET inspected=? WHERE id=?',++inspected,jobId);return;
        }
        const old=this.db.get<AssetRow>('SELECT * FROM media_assets WHERE library_id=? AND ref=?',libraryId,entry.ref);
        const oldProbe=old?this.dto(old).probe:null;
        const unchanged=old&&old.size===entry.size&&old.modified_at===entry.modifiedAt&&old.file_identity===entry.fileIdentity;
        const reusable=unchanged&&old.probe_status==='ready'&&oldProbe?.info?.schemaVersion===MEDIA_PROBE_VERSION&&oldProbe.info.streams.every(stream=>typeof stream.attachedPicture==='boolean');
        const probe:ProbeResult=reusable?this.dto(old).probe:storage.filePath?await trace.measure('probe',entry.ref,async()=>this.probe(await storage.filePath!(entry.ref),signal)):{status:'unavailable',info:null};
        // A cache upgrade must not discard known chapters when the probe is temporarily unavailable.
        if(unchanged&&old.probe_status==='ready'&&oldProbe?.info&&(probe.status!=='ready'||!probe.info))throw Object.assign(new Error('probe-upgrade-failed'),{code:'PROBE_UPGRADE_FAILED'});
        if(!reusable&&probe.info)probe.info={...probe.info,schemaVersion:MEDIA_PROBE_VERSION};
        signal.throwIfAborted();
        // Remote scans publish directory snapshots. Resolving each file again
        // can fetch an expensive signed URL; only actual reads need that lookup.
        if(storage.filePath){
          const fresh=await trace.measure('stat',entry.ref,()=>storage.stat(entry.ref));
          if(fresh.size!==entry.size||fresh.modifiedAt!==entry.modifiedAt||fresh.fileIdentity!==entry.fileIdentity)throw new Error('file-changed-during-scan');
        }
        const metadata=await trace.measure('metadata',entry.ref,async()=>{
          const raw=library.kind==='video'?await readVideo(entry.ref,probe):await readLocalMetadata(storage,entry.ref,probe);
          const metadata=library.kind==='video'?recognizeVideo(entry.ref,raw,rules,fallbackFor(entry.ref)).metadata:raw,artist=metadata.albumArtist||metadata.artist;
          if(library.kind==='music'&&artist)metadata.artistProfile=await readArtistProfile(storage,entry.ref,artist,metadata.warnings);
          return metadata;
        });
        signal.throwIfAborted();
        this.db.run('INSERT INTO media_scan_stage(job_id,ref,payload) VALUES(?,?,?)',jobId,entry.ref,JSON.stringify({...entry,probe,metadata}));
        this.db.run('UPDATE media_scan_jobs SET inspected=? WHERE id=?',++inspected,jobId);
      };
      // Remote sidecar reads are I/O bound. Keep local ffprobe sequential and drain
      // every batch before failure/cleanup so no worker writes after staging is removed.
      const concurrency=storage.filePath?1:files;
      const entries:StorageEntry[]=[];const iterator=storage.list(signal)[Symbol.asyncIterator]();
      try{for(;;){const next=await trace.measure('list',undefined,()=>iterator.next());if(next.done)break;if(supported.has(extname(next.value.ref).toLowerCase()))entries.push(next.value);}}finally{await iterator.return?.();}
      if(library.kind==='video'){
        const groups=new Map<string,StorageEntry[]>();
        for(const entry of entries){const rule=rules.filter(value=>withinDirectory(entry.ref,value.path)).sort((a,b)=>b.path.length-a.path.length)[0];if(!rule||!['series','season'].includes(rule.mode))continue;const key=rule.path+'\0'+String(rule.season??'正片');const group=groups.get(key)??[];group.push(entry);groups.set(key,group);}
        for(const group of groups.values())for(const [index,entry] of group.sort((a,b)=>a.ref.localeCompare(b.ref,'zh',{numeric:true})).entries())fallbackEpisodes.set(entry.ref,index+1);
      }
      let batch:StorageEntry[]=[];
      const flush=async()=>{
        const results=await Promise.allSettled(batch.map(inspect));batch=[];
        const failure=results.find(result=>result.status==='rejected');
        if(failure?.status==='rejected')throw failure.reason;
      };
      for(const entry of entries){batch.push(entry);if(batch.length===concurrency)await flush();}
      if(batch.length)await flush();
      signal.throwIfAborted();
      const end=trace.begin('publish');try{this.publish(libraryId,jobId);}finally{end();}
      trace.note('扫描完成');
    }catch(error){
      const code=signal.aborted?'cancelled':(error as NodeJS.ErrnoException).code==='ENOENT'?'directory-unavailable':(error as NodeJS.ErrnoException).code==='PROBE_UPGRADE_FAILED'?'probe-upgrade-failed':(error as NodeJS.ErrnoException).code==='MEDIA_OPENLIST_AUTH'?'openlist-auth-failed':(error as NodeJS.ErrnoException).code?.startsWith('MEDIA_OPENLIST_')?'openlist-unavailable':'scan-failed';
      this.db.run('UPDATE media_scan_jobs SET state=?,error=?,finished_at=? WHERE id=?',signal.aborted?'cancelled':'failed',code,Date.now(),jobId);
      trace.note(signal.aborted?'扫描已取消':`扫描失败：${code}`,!signal.aborted);
    }finally{
      clearInterval(heartbeat);
      this.db.run('UPDATE media_scan_jobs SET diagnostics_json=? WHERE id=?',JSON.stringify(trace.snapshot()),jobId);
      this.traces.delete(jobId);this.db.run('DELETE FROM media_scan_stage WHERE job_id=?',jobId);
    }
  }

  private publish(libraryId:string,jobId:string):void {
    new MediaPublisher(this.db,this.catalog).publish(libraryId,jobId);
  }
}
