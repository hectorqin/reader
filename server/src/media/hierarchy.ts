import type { MediaDatabase } from './read-database.ts';
import {badRequest,conflict,forbidden} from '../lib/errors.ts';
import type {MediaActor} from './libraries.ts';
import {MediaCatalog} from './catalog.ts';
import {randomUUID} from 'node:crypto';

interface Move {targetParentId:string;ordinal:number;expectedParentId:string|null;expectedOrdinal:number}
export interface CreateVideoParent {seriesTitle?:string;targetSeriesId?:string;seasonOrdinal?:number;ordinal:number;expectedParentId:string|null;expectedOrdinal:number}

/** Structural edits preserve playback identities and invalidate hierarchy-bound matches atomically. */
export class MediaHierarchy {
  constructor(private readonly db:MediaDatabase,private readonly catalog:MediaCatalog){}

  moveVideo(actor:MediaActor,id:string,input:Move){
    if(actor.role!=='admin')throw forbidden();
    return this.db.transaction(()=>this.applyMove(actor,id,input));
  }

  createParent(actor:MediaActor,id:string,input:CreateVideoParent){
    if(actor.role!=='admin')throw forbidden();
    return this.db.transaction(()=>{
      const item=this.catalog.detail(actor,id);
      if(!['season','episode'].includes(item.kind))throw badRequest('只能为季或单集新建归属','MEDIA_PARENT_TARGET');
      if(item.parentId!==input.expectedParentId||item.ordinal!==input.expectedOrdinal)
        throw conflict('归属或编号已变化，请刷新后重试','MEDIA_PARENT_CHANGED');
      const title=input.seriesTitle?.trim();
      if((input.seriesTitle!==undefined)===(input.targetSeriesId!==undefined)||input.seriesTitle!==undefined&&(!title||title.length>200))
        throw badRequest('请选择已有剧集，或填写 1–200 字符的新剧集名称');
      if(item.kind==='season'&&(input.targetSeriesId!==undefined||input.seasonOrdinal!==undefined))throw badRequest('移动季到已有剧集请使用归属整理');
      let seriesId=input.targetSeriesId;
      if(seriesId){const series=this.catalog.detail(actor,seriesId);if(series.kind!=='series'||series.libraryId!==item.libraryId)throw badRequest('请选择同库剧集','MEDIA_PARENT_TARGET');}
      else{
        seriesId=randomUUID();
        this.db.run("INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,ordinal,metadata_json,manual_structure) VALUES(?,?,'series',NULL,?,?,0,'{}',1)",seriesId,item.libraryId,`manual:${seriesId}`,title!);
      }
      let parentId=seriesId;
      if(item.kind==='episode'){
        const seasonNumber=input.seasonOrdinal;
        if(!Number.isInteger(seasonNumber)||seasonNumber!<0||seasonNumber!>9999)throw badRequest('新季号应为 0–9999');
        if(this.db.get("SELECT id FROM media_items WHERE parent_id=? AND kind='season' AND ordinal=?",seriesId,seasonNumber!))throw conflict('该剧集已有此季，请选择已有季','MEDIA_NUMBER_OCCUPIED');
        parentId=randomUUID();
        this.db.run("INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,ordinal,metadata_json,manual_structure) VALUES(?,?,'season',?,?,?,?, '{}',1)",parentId,item.libraryId,seriesId,`manual:${parentId}`,`第 ${seasonNumber} 季`,seasonNumber!);
      }
      return this.applyMove(actor,id,{...input,targetParentId:parentId});
    });
  }

  private applyMove(actor:MediaActor,id:string,input:Move){
      const item=this.catalog.detail(actor,id),target=this.catalog.detail(actor,input.targetParentId);
      const targetKind=item.kind==='episode'?'season':item.kind==='season'?'series':null;
      if(!targetKind||target.kind!==targetKind||target.libraryId!==item.libraryId)
        throw badRequest('只能调整同一影视库内的季或单集归属','MEDIA_PARENT_TARGET');
      const minimum=item.kind==='season'?0:1,maximum=item.kind==='season'?9999:99999;
      if(!Number.isInteger(input.ordinal)||input.ordinal<minimum||input.ordinal>maximum)
        throw badRequest(item.kind==='season'?'季号应为 0–9999，0 表示特别篇':'集号应为 1–99999');
      if(item.parentId!==input.expectedParentId||item.ordinal!==input.expectedOrdinal)
        throw conflict('归属或编号已变化，请刷新后重试','MEDIA_PARENT_CHANGED');
      if(item.parentId===target.id&&item.ordinal===input.ordinal)return item;
      if(this.db.get('SELECT id FROM media_items WHERE parent_id=? AND kind=? AND ordinal=? AND id<>?',target.id,item.kind,input.ordinal,id))
        throw conflict('目标已有相同编号，请选择其他编号；不同版本请使用版本归属整理','MEDIA_NUMBER_OCCUPIED');
      const affected=item.kind==='season'?[id,...item.children.filter(child=>child.kind==='episode').map(child=>child.id)]:[id];
      this.db.run('UPDATE media_items SET parent_id=?,ordinal=?,manual_structure=1 WHERE id=?',target.id,input.ordinal,id);
      const hasCandidates=!!this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='media_scrape_candidates'");
      for(const childId of affected){
        // TMDB season/episode identities include the parent show and season number.
        this.db.run("DELETE FROM media_online_metadata WHERE item_id=? AND provider='tmdb'",childId);
        if(hasCandidates)
          this.db.run("DELETE FROM media_scrape_candidates WHERE item_id=? AND provider='tmdb'",childId);
      }
      return this.catalog.detail(actor,id);
  }
}
