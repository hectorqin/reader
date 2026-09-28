import { createHash,randomUUID } from 'node:crypto';
import type { MediaDatabase } from './read-database.ts';
import type { MediaCatalog } from './catalog.ts';
import type { ProbeResult } from './probe.ts';
import type { StorageEntry } from './storage/types.ts';
import type { LocalMediaMetadata } from './local-metadata.ts';

interface Staged extends StorageEntry { probe:ProbeResult;metadata:LocalMediaMetadata;ignored?:boolean }
interface AssetRow {id:string;library_id:string;ref:string;size:number;modified_at:number;file_identity:string|null;available:number;probe_status:ProbeResult['status'];technical_json:string|null;publication_fingerprint:string|null}
// Bump when ingest semantics require replaying otherwise identical staged inputs.
const PUBLICATION_VERSION=2;

/** Publishes one staged job atomically, without initializing schemas or resetting jobs. */
export class MediaPublisher {
  constructor(private readonly db:MediaDatabase,private readonly catalog:MediaCatalog){}
  publish(libraryId:string,jobId:string):void {
    this.db.transaction(()=>{
      const job=this.db.get<{library_id:string;state:string}>('SELECT library_id,state FROM media_scan_jobs WHERE id=?',jobId);
      if(!job||job.library_id!==libraryId)throw new Error('publication job does not belong to library');
      if(job.state==='complete')return;
      if(job.state!=='running')throw new Error('publication job is no longer running');
      const library=this.db.get<{kind:'video'|'music'|'audiobook'}>('SELECT kind FROM media_libraries WHERE id=?',libraryId)!;
      const staged=this.db.all<{payload:string}>('SELECT payload FROM media_scan_stage WHERE job_id=?',jobId).map(row=>JSON.parse(row.payload) as Staged);
      const refs=new Set(staged.map(e=>e.ref));
      const identityCount=new Map<string,number>();for(const entry of staged)if(entry.fileIdentity)identityCount.set(entry.fileIdentity,(identityCount.get(entry.fileIdentity)||0)+1);

      const existing=this.db.all<AssetRow>('SELECT * FROM media_assets WHERE library_id=?',libraryId);
      const byRef=new Map(existing.map(asset=>[asset.ref,asset]));
      const narratorCredits=library.kind==='audiobook'?new Map(this.db.all<{asset_id:string;name:string}>(
        'SELECT n.asset_id,n.name FROM media_asset_narrators n JOIN media_assets a ON a.id=n.asset_id WHERE a.library_id=?',libraryId).map(row=>[row.asset_id,row.name])):null;
      const byIdentity=new Map<string,AssetRow[]>();
      for(const asset of existing)if(asset.file_identity){
        const matches=byIdentity.get(asset.file_identity)||[];matches.push(asset);byIdentity.set(asset.file_identity,matches);
      }
      // Keep availability intact for unchanged entries. Mark only truly absent refs missing.
      this.db.run(`UPDATE media_assets SET available=0 WHERE library_id=? AND available=1 AND NOT EXISTS
        (SELECT 1 FROM media_scan_stage s WHERE s.job_id=? AND s.ref=media_assets.ref)`,libraryId,jobId);
      for(const entry of staged){
        if(entry.ignored){
          this.db.run('UPDATE media_assets SET available=1 WHERE library_id=? AND ref=? AND available=0',libraryId,entry.ref);
          continue;
        }
        let old=byRef.get(entry.ref);
        const fingerprint=createHash('sha256').update(JSON.stringify([PUBLICATION_VERSION,library.kind,entry])).digest('hex');
        const technical=entry.probe.info?JSON.stringify(entry.probe.info):null;
        const narrator=(entry.metadata.narrator||entry.metadata.artist||'').trim()||undefined;
        // Metadata includes sidecars; mtime alone cannot prove catalog inputs are unchanged.
        if(old?.available===1&&old.publication_fingerprint===fingerprint&&old.technical_json===technical&&
          old.probe_status===entry.probe.status&&old.size===entry.size&&old.modified_at===entry.modifiedAt&&old.file_identity===entry.fileIdentity&&
          (!narratorCredits||narratorCredits.get(old.id)===narrator))continue;
        if(!old&&entry.fileIdentity&&identityCount.get(entry.fileIdentity)===1){
          const candidates=(byIdentity.get(entry.fileIdentity)||[]).filter(row=>row.size===entry.size&&row.modified_at===entry.modifiedAt&&!refs.has(row.ref));
          if(candidates.length===1)old=candidates[0];
        }
        const assetId=old?.id||randomUUID();
        if(old)this.db.run('UPDATE media_assets SET ref=?,size=?,modified_at=?,file_identity=?,available=1,probe_status=?,technical_json=? WHERE id=?',entry.ref,entry.size,entry.modifiedAt,entry.fileIdentity,entry.probe.status,technical,assetId);
        else this.db.run('INSERT INTO media_assets(id,library_id,ref,size,modified_at,file_identity,available,probe_status,technical_json) VALUES(?,?,?,?,?,?,1,?,?)',assetId,libraryId,entry.ref,entry.size,entry.modifiedAt,entry.fileIdentity,entry.probe.status,technical);
        this.catalog.ingest(libraryId,library.kind,assetId,entry.ref,entry.metadata,entry.probe);
        this.db.run('UPDATE media_assets SET publication_fingerprint=? WHERE id=?',fingerprint,assetId);
      }
      this.catalog.refreshEmbeddedCovers(libraryId);
      this.db.run("UPDATE media_scan_jobs SET state='complete',finished_at=? WHERE id=?",Date.now(),jobId);
    });
  }
}
