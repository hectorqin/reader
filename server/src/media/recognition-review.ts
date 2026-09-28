import {createHash,randomUUID} from 'node:crypto';
import type {MediaDatabase} from './read-database.ts';
import type {MediaActor} from './libraries.ts';
import {MediaLibraries} from './libraries.ts';
import {MediaCatalog} from './catalog.ts';
import {MediaDirectoryRules} from './directory-rules.ts';
import {recognizeVideo,type VideoRecognition} from './video-recognition.ts';
import {videoMetadataReader} from './video-metadata.ts';
import type {ProbeResult} from './probe.ts';
import {badRequest,conflict,notFound} from '../lib/errors.ts';

interface Asset {id:string;ref:string;technical_json:string|null;probe_status:ProbeResult['status']}
interface Proposal {assetId:string;ref:string;before:{id:string;title:string;kind:string}|null;after:VideoRecognition;status:'ready'|'review'|'protected'|'ignored';reason:string}
interface Saved {snapshot:string;proposals:Proposal[]}

export class MediaRecognitionReview {
  private active=new Set<string>();
  private curated(id:string):boolean{
    const rows=this.db.all<{id:string;manual_structure:number}>(`WITH RECURSIVE parents AS (SELECT id,parent_id,manual_structure FROM media_items WHERE id=? UNION SELECT i.id,i.parent_id,i.manual_structure FROM media_items i JOIN parents p ON i.id=p.parent_id) SELECT id,manual_structure FROM parents`,id);
    return rows.some(row=>!!row.manual_structure||!!this.db.get('SELECT 1 FROM media_metadata_overrides WHERE item_id=?',row.id)||!!this.db.get('SELECT 1 FROM media_online_metadata WHERE item_id=?',row.id));
  }
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,private readonly catalog:MediaCatalog,private readonly rules:MediaDirectoryRules){
    db.run(`CREATE TABLE IF NOT EXISTS media_recognition_previews(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,path TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL)`);
  }
  private snapshot(libraryId:string){
    const rows=[this.rules.list(libraryId),
      this.db.all('SELECT * FROM media_assets WHERE library_id=? ORDER BY id',libraryId),
      this.db.all('SELECT * FROM media_items WHERE library_id=? ORDER BY id',libraryId),
      this.db.all('SELECT e.* FROM media_editions e JOIN media_items i ON i.id=e.item_id WHERE i.library_id=? ORDER BY e.id',libraryId),
      this.db.all('SELECT p.* FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE a.library_id=? ORDER BY p.id',libraryId),
      this.db.all('SELECT o.* FROM media_metadata_overrides o JOIN media_items i ON i.id=o.item_id WHERE i.library_id=? ORDER BY o.item_id,o.field',libraryId),
      this.db.all('SELECT o.* FROM media_online_metadata o JOIN media_items i ON i.id=o.item_id WHERE i.library_id=? ORDER BY o.item_id',libraryId)];
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  async preview(actor:MediaActor,libraryId:string,path:string,signal?:AbortSignal){
    this.rules.authorize(actor,this.libraries,libraryId,path);this.rules.assertIdle(libraryId);
    if(this.active.has(libraryId))throw conflict('此媒体库正在生成预览，请稍后重试','MEDIA_RECOGNITION_BUSY');
    this.active.add(libraryId);
    try{
      const snapshot=this.snapshot(libraryId),rules=this.rules.list(libraryId);
      const assets=this.db.all<Asset>(`SELECT id,ref,technical_json,probe_status FROM media_assets WHERE library_id=? AND available=1${path?' AND ref>=? AND ref<?':''} ORDER BY ref LIMIT 501`,libraryId,...(path?[path+'/',path+'0']:[]));
      if(assets.length>500)throw badRequest('目录超过 500 个资源，请进入子目录分批预览','MEDIA_RECOGNITION_LIMIT');
      const storage=await this.libraries.storage(actor,libraryId),read=videoMetadataReader(storage),proposals:Proposal[]=[];
      for(const asset of assets){
        signal?.throwIfAborted();
        const metadata=await read(asset.ref,{status:asset.probe_status,info:asset.technical_json?JSON.parse(asset.technical_json):null});
        const after=recognizeVideo(asset.ref,metadata,rules);
        const current=this.db.get<{id:string;title:string;kind:string;manual_structure:number;manual_item:number;edition_id:string}>(`SELECT i.id,i.title,i.kind,i.manual_structure,e.manual_item,e.id edition_id FROM media_items i JOIN media_editions e ON e.item_id=i.id JOIN media_parts p ON p.edition_id=e.id WHERE p.asset_id=? LIMIT 1`,asset.id);
        const protectedItem=!!current&&(this.curated(current.id)||!!current.manual_item||!!this.db.get('SELECT 1 FROM media_editions WHERE item_id=? AND id<>?',current.id,current.edition_id)||!!this.db.get('SELECT 1 FROM media_parts WHERE edition_id=? AND asset_id<>?',current.edition_id,asset.id));
        const status=after.kind==='ignore'?'ignored':!current||protectedItem?'protected':after.confidence==='high'?'ready':'review';
        proposals.push({assetId:asset.id,ref:asset.ref,before:current?{id:current.id,title:current.title,kind:current.kind}:null,after,status,reason:protectedItem?'已人工整理、在线确认或包含共享版本，保留现有作品':!current?'请先扫描建立作品':after.reasons.join('；')});
      }
      const targets=new Map<string,Proposal[]>();
      for(const proposal of proposals){
        if(proposal.after.kind!=='episode'||!['ready','review'].includes(proposal.status))continue;
        const metadata=proposal.after.metadata,seriesKey=`${metadata.seriesRoot??''}\0${metadata.show}`;
        const key=JSON.stringify([seriesKey,metadata.season,metadata.episode]);
        const group=targets.get(key)??[];group.push(proposal);targets.set(key,group);
        const series=this.db.get<{id:string}>("SELECT id FROM media_items WHERE library_id=? AND kind='series' AND local_key=?",libraryId,seriesKey);
        const season=series&&this.db.get<{id:string}>("SELECT id FROM media_items WHERE kind='season' AND local_key=?",`${series.id}:${metadata.season}`);
        const episode=season&&this.db.get<{id:string}>("SELECT id FROM media_items WHERE kind='episode' AND local_key=?",`${season.id}:${metadata.episode}`);
        if([series,season,episode].some(item=>item&&this.curated(item.id))){proposal.status='protected';proposal.reason='目标剧集已有人工整理或在线确认，保留现有作品';}
        else if(episode&&episode.id!==proposal.before?.id){proposal.status='review';proposal.reason='目标集已存在，应用后合并版本，请核对';}
      }
      for(const group of targets.values())if(group.length>1)for(const proposal of group)if(proposal.status!=='protected'){proposal.status='review';proposal.reason='多个文件识别为同一集，应用后合并版本，请核对';}
      this.rules.assertIdle(libraryId);
      if(snapshot!==this.snapshot(libraryId))throw conflict('扫描、规则或作品已变化，请重新预览','MEDIA_RECOGNITION_CHANGED');
      signal?.throwIfAborted();
      const id=randomUUID(),expiresAt=Date.now()+15*60_000;
      this.db.transaction(()=>{
        this.db.run('DELETE FROM media_recognition_previews WHERE expires_at<? OR (actor_id=? AND library_id=?)',Date.now(),actor.id,libraryId);
        this.db.run('INSERT INTO media_recognition_previews VALUES(?,?,?,?,?,?)',id,actor.id,libraryId,path,expiresAt,JSON.stringify({snapshot,proposals} satisfies Saved));
      });
      return {id,path,expiresAt,items:proposals};
    }finally{this.active.delete(libraryId);}
  }
  apply(actor:MediaActor,libraryId:string,path:string,id:string,assetIds:string[]){
    this.rules.authorize(actor,this.libraries,libraryId,path);
    if(!Array.isArray(assetIds)||!assetIds.length||assetIds.length>500||new Set(assetIds).size!==assetIds.length)throw badRequest('选择 1–500 个不重复资源');
    return this.db.transaction(()=>{
      this.rules.assertIdle(libraryId);
      const preview=this.db.get<{expires_at:number;payload:string}>('SELECT expires_at,payload FROM media_recognition_previews WHERE id=? AND actor_id=? AND library_id=? AND path=?',id,actor.id,libraryId,path);
      if(!preview)throw notFound('预览不存在，请重新生成','MEDIA_RECOGNITION_EXPIRED');
      if(preview.expires_at<=Date.now())throw conflict('预览已过期，请重新生成','MEDIA_RECOGNITION_EXPIRED');
      const saved=JSON.parse(preview.payload) as Saved;
      if(saved.snapshot!==this.snapshot(libraryId))throw conflict('规则或作品已变化，请重新预览','MEDIA_RECOGNITION_CHANGED');
      const proposals=new Map(saved.proposals.map(proposal=>[proposal.assetId,proposal]));
      for(const assetId of assetIds){const proposal=proposals.get(assetId);if(!proposal||!['ready','review'].includes(proposal.status))throw badRequest('选择包含不可自动更改的资源');}
      const updated=assetIds.map(assetId=>{const proposal=proposals.get(assetId)!;return {assetId,itemId:this.catalog.reidentifyVideoAsset(assetId,proposal.after.metadata)};});
      this.catalog.refreshEmbeddedCovers(libraryId);
      this.db.run('DELETE FROM media_recognition_previews WHERE id=?',id);
      return {updated};
    });
  }
}
