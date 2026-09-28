import { createHash } from 'node:crypto';
import type { MediaDatabase } from './read-database.ts';
import type { MediaActor } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import { MediaCatalog } from './catalog.ts';
import { validateMediaFolderPath } from './folders.ts';
import { conflict, forbidden } from '../lib/errors.ts';

interface Asset {id:string;ref:string}
interface Item {id:string;parent_id:string|null}
interface Edition {id:string;item_id:string}
interface Part {id:string;asset_id:string;edition_id:string}

/** Explicit retirement of missing records. Never opens or deletes storage files. */
export class MediaCleanup {
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,private readonly catalog:MediaCatalog){}

  preview(actor:MediaActor,libraryId:string,path:string){
    return this.db.transaction(()=>this.plan(actor,libraryId,path).summary);
  }

  remove(actor:MediaActor,libraryId:string,path:string,revision:string){
    return this.db.transaction(()=>{
      const plan=this.plan(actor,libraryId,path);
      if(plan.summary.revision!==revision)throw conflict('目录或关联记录已变化，请重新预览清理范围','MEDIA_CLEANUP_CHANGED');
      const parts=JSON.stringify(plan.parts),items=JSON.stringify(plan.items),editions=JSON.stringify(plan.editions);
      // Remove dependent user state before parts; a failure rolls the entire operation back.
      for(const table of ['media_queue','media_progress','media_playback_sessions'])
        this.db.run(`DELETE FROM ${table} WHERE part_id IN (SELECT value FROM json_each(?))`,parts);
      const removedParts=new Set(plan.parts);
      for(const grant of this.db.all<{id:string;parts_json:string}>(`SELECT id,parts_json FROM media_background_grants
        WHERE EXISTS (SELECT 1 FROM json_each(parts_json) WHERE value IN (SELECT value FROM json_each(?)))`,parts)){
        const remaining=(JSON.parse(grant.parts_json) as string[]).filter(id=>!removedParts.has(id));
        this.db.run('UPDATE media_background_grants SET parts_json=?,revoked=CASE WHEN ?=0 THEN 1 ELSE revoked END WHERE id=?',JSON.stringify(remaining),remaining.length,grant.id);
      }
      this.db.run('DELETE FROM media_parts WHERE id IN (SELECT value FROM json_each(?))',parts);
      this.db.run('DELETE FROM media_editions WHERE id IN (SELECT value FROM json_each(?))',editions);
      // Children precede parents. Cascades remove only metadata/favorites of retired works.
      for(const id of plan.items)this.db.run('DELETE FROM media_items WHERE id=?',id);
      this.db.run('DELETE FROM media_scrape_job_items WHERE item_id IN (SELECT value FROM json_each(?))',items);
      this.db.run('DELETE FROM media_assets WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(plan.assets.map(asset=>asset.id)));
      if(plan.assets.length)this.catalog.refreshEmbeddedCovers(libraryId);
      let returnPath=path;
      while(returnPath){
        const prefix=returnPath+'/';
        if(this.db.get('SELECT 1 FROM media_assets WHERE library_id=? AND ref>=? AND ref<? LIMIT 1',libraryId,prefix,returnPath+'0'))break;
        returnPath=returnPath.split('/').slice(0,-1).join('/');
      }
      return {...plan.summary,returnPath};
    });
  }

  private plan(actor:MediaActor,libraryId:string,path:string){
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    this.libraries.get(actor,libraryId);validateMediaFolderPath(path);
    if(this.db.get("SELECT 1 FROM media_scan_jobs WHERE library_id=? AND state IN ('queued','running')",libraryId))
      throw conflict('媒体库正在扫描，请等待完成后再清理','SCAN_RUNNING');
    const latest=this.db.get<{id:string;state:string}>(`SELECT id,state FROM media_scan_jobs WHERE library_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1`,libraryId);
    if(latest?.state!=='complete')throw conflict('请先成功完成一次媒体库扫描，再清理失效资源','MEDIA_CLEANUP_SCAN_REQUIRED');
    if(this.db.get(`SELECT 1 FROM media_scrape_jobs j JOIN media_scrape_job_items r ON r.job_id=j.id
      JOIN media_items i ON i.id=r.item_id WHERE i.library_id=? AND j.state='running'`,libraryId))
      throw conflict('媒体库正在刮削，请等待完成后再清理','SCRAPE_RUNNING');
    const assets=this.db.all<Asset>(`SELECT id,ref FROM media_assets WHERE library_id=? AND available=0${path?' AND ref>=? AND ref<?':''} ORDER BY id`,libraryId,...(path?[path+'/',path+'0']:[]));
    const assetIds=new Set(assets.map(asset=>asset.id));
    const allItems=this.db.all<Item>('SELECT id,parent_id FROM media_items WHERE library_id=?',libraryId);
    const allEditions=this.db.all<Edition>('SELECT e.id,e.item_id FROM media_editions e JOIN media_items i ON i.id=e.item_id WHERE i.library_id=?',libraryId);
    const allParts=this.db.all<Part>('SELECT p.id,p.asset_id,p.edition_id FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE a.library_id=?',libraryId);
    const parts=allParts.filter(part=>assetIds.has(part.asset_id)).map(part=>part.id).sort();
    const touchedEditions=new Set(allParts.filter(part=>assetIds.has(part.asset_id)).map(part=>part.edition_id));
    const retainedEditions=new Set(allParts.filter(part=>!assetIds.has(part.asset_id)).map(part=>part.edition_id));
    const editions=allEditions.filter(edition=>touchedEditions.has(edition.id)&&!retainedEditions.has(edition.id)).map(edition=>edition.id).sort();
    const removedEditions=new Set(editions),byId=new Map(allItems.map(item=>[item.id,item]));
    const candidates=new Set<string>();
    for(const edition of allEditions.filter(edition=>removedEditions.has(edition.id))){
      let id:string|null=edition.item_id;
      while(id&&!candidates.has(id)){candidates.add(id);id=byId.get(id)?.parent_id??null;}
    }
    const hasEdition=new Set(allEditions.filter(edition=>!removedEditions.has(edition.id)).map(edition=>edition.item_id));
    const children=new Map<string,number>();
    for(const item of allItems)if(item.parent_id)children.set(item.parent_id,(children.get(item.parent_id)??0)+1);
    const pending=[...candidates].filter(id=>!hasEdition.has(id)&&!children.get(id)).sort(),items:string[]=[];
    for(let index=0;index<pending.length;index++){
      const id=pending[index]!;items.push(id);
      const parent=byId.get(id)?.parent_id;
      if(parent){children.set(parent,children.get(parent)!-1);if(candidates.has(parent)&&!hasEdition.has(parent)&&!children.get(parent))pending.push(parent);}
    }
    const count=(table:string,column:string,ids:string[])=>this.db.get<{n:number}>(`SELECT count(*) n FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`,JSON.stringify(ids))!.n;
    const counts={assets:assets.length,parts:parts.length,editions:editions.length,items:items.length,
      favorites:count('media_favorites','item_id',items),progress:count('media_progress','part_id',parts),queue:count('media_queue','part_id',parts)};
    const revision=createHash('sha256').update(JSON.stringify([libraryId,path,latest.id,assets,parts,editions,items,counts])).digest('hex');
    return {assets,parts,editions,items,summary:{libraryId,path,revision,...counts}};
  }
}
