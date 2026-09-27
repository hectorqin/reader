import type { MediaDatabase } from './read-database.ts';
import { badRequest,notFound } from '../lib/errors.ts';
import type { MediaActor } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import { MediaCatalog } from './catalog.ts';

/** Browse the published media snapshot, without exposing server paths or unrelated files. */
export class MediaFolders {
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,private readonly catalog:MediaCatalog){}
  list(actor:MediaActor,libraryId:string,path='',offset=0,limit=60){
    this.libraries.get(actor,libraryId);
    if(path.length>4000||path.includes('\\')||path.includes(':')||path.includes('\0')||(path&&path.split('/').some(part=>!part||part==='.'||part==='..')))throw badRequest('无效的媒体库内目录','MEDIA_FOLDER_PATH');
    const prefix=path?path+'/':'';
    // Binary range ['path/', 'path0') covers exactly the descendants and uses (library_id,ref).
    // Keep the literal prefix check too; unlike LIKE, names containing % or _ are not patterns.
    const range=path?' AND ref>=? AND ref<?':'';
    const cte=`WITH descendants AS (
      SELECT id,ref,size,available,substr(ref,?) tail FROM media_assets WHERE library_id=?${range} AND substr(ref,1,?)=?
    ), entries AS (
      SELECT CASE WHEN instr(tail,'/')>0 THEN substr(tail,1,instr(tail,'/')-1) ELSE tail END name,
      CASE WHEN instr(tail,'/')>0 THEN 'folder' ELSE 'file' END kind,
      CASE WHEN instr(tail,'/')>0 THEN NULL ELSE id END assetId,size,available FROM descendants
    ), grouped AS (
      SELECT name,kind,assetId,count(*) files,sum(available) availableFiles,sum(size) size FROM entries GROUP BY kind,name,assetId
    )`;
    // SQLite substr counts Unicode code points, while JS length counts UTF-16 units.
    const length=[...prefix].length;
    const params=[length+1,libraryId,...(path?[prefix,path+'0']:[]),length,prefix];
    const total=this.db.get<{n:number}>(`${cte} SELECT count(*) n FROM grouped`,...params)!.n;
    if(path&&!total)throw notFound('该目录没有已扫描的媒体文件');
    const items=this.db.all<{name:string;kind:'folder'|'file';assetId:string|null;files:number;availableFiles:number;size:number}>(`${cte} SELECT * FROM grouped ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END,name COLLATE NOCASE,name LIMIT ? OFFSET ?`,...params,limit,offset);
    return {path,total,items:items.map(item=>({...item,path:prefix+item.name})),source:'scan' as const};
  }
  file(actor:MediaActor,id:string){
    const asset=this.db.get<{id:string;library_id:string;ref:string;available:number}>('SELECT id,library_id,ref,available FROM media_assets WHERE id=?',id);
    if(!asset)throw notFound('media asset not found');this.libraries.get(actor,asset.library_id);
    const rows=this.db.all<{item_id:string}>(`SELECT DISTINCT e.item_id FROM media_editions e JOIN media_parts p ON p.edition_id=e.id WHERE p.asset_id=? AND p.active=1`,id);
    return {assetId:id,path:asset.ref,available:asset.available===1,items:rows.map(row=>{
      const detail=this.catalog.detail(actor,row.item_id);
      return {...detail,editions:detail.editions.map(edition=>({...edition,parts:edition.parts.filter(part=>part.assetId===id)})).filter(edition=>edition.parts.length)};
    })};
  }
}
