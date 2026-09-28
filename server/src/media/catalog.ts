import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import type { MediaActor, MediaLibraryKind } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import type { ProbeResult } from './probe.ts';
import type { LocalMediaMetadata } from './local-metadata.ts';
import {sameArtist,type ArtistProfile} from './artist-metadata.ts';

export type MediaItemKind = 'movie' | 'series' | 'season' | 'episode' | 'artist' | 'album' | 'track' | 'audiobook';
export type MediaBrowseKind = MediaItemKind | 'video';
export type MediaSort = 'default'|'title-asc'|'title-desc';
// Track tags identify an artist, but album artwork and descriptions are not a biography.
function artistMetadata(title:string,metadata:LocalMediaMetadata,profile?:ArtistProfile):LocalMediaMetadata {
  return {title,sources:{title:metadata.sources?.albumArtist??metadata.sources?.artist??metadata.sources?.title??'filename',...(profile?.plot?{plot:'nfo' as const}:{})},externalIds:{},warnings:[],
    ...(profile?.plot?{plot:profile.plot}:{}),...(profile?.coverRef?{coverRef:profile.coverRef}:{})};
}
interface TrackFilters {artist?:string;album?:string}
function trackConditions(options:TrackFilters&{kind?:MediaBrowseKind},conditions:string[],params:Array<string|number>){
  const joins:string[]=[];
  for(const field of ['artist','album'] as const){
    const value=options[field]?.trim();if(!value)continue;
    if(options.kind!=='track'||value.length>200)throw badRequest('艺人和专辑筛选仅支持曲目，最多 200 字符');
    if(!joins.length)joins.push('LEFT JOIN media_online_metadata filter_metadata ON filter_metadata.item_id=i.id');
    joins.push(`LEFT JOIN media_metadata_overrides filter_${field} ON filter_${field}.item_id=i.id AND filter_${field}.field='${field}'`);
    conditions.push(`instr(lower(COALESCE(json_extract(filter_${field}.value_json,'$'),json_extract(filter_metadata.fields_json,'$.${field}'),json_extract(i.metadata_json,'$.${field}'),'')),lower(?))>0`);
    params.push(value);
  }
  return joins.join(' ');
}
function titleOrder(sort:MediaSort|undefined,fallback:string){
  if(!sort||sort==='default')return fallback;
  if(sort!=='title-asc'&&sort!=='title-desc')throw badRequest('无效排序');
  return `COALESCE((SELECT json_extract(o.value_json,'$') FROM media_metadata_overrides o WHERE o.item_id=i.id AND o.field='title'),(SELECT json_extract(m.fields_json,'$.title') FROM media_online_metadata m WHERE m.item_id=i.id),i.title) COLLATE NOCASE ${sort==='title-desc'?'DESC':'ASC'},i.id`;
}
interface ItemRow { id:string;library_id:string;kind:MediaItemKind;parent_id:string|null;title:string;metadata_json:string;local_key:string;ordinal:number;manual_structure:number }
interface PartRow { id:string;edition_id:string;asset_id:string;title:string;ordinal:number;start_seconds:number;end_seconds:number|null;available:number }
export interface MediaItem {
  id:string;libraryId:string;kind:MediaItemKind;parentId:string|null;title:string;ordinal:number;
  metadata:Record<string,unknown>;overrides:Record<string,unknown>;
}

/** Work identities and user overrides never depend on a transient playback URL. */
export class MediaCatalog {
  librarySummaries(actor:MediaActor) {
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');
    const roots=this.db.all<{id:string;root:string}>('SELECT id,root FROM media_libraries ORDER BY created_at,id');
    const counts=this.db.all<{library_id:string;kind:MediaItemKind;n:number}>('SELECT library_id,kind,count(*) n FROM media_items GROUP BY library_id,kind');
    const chapters=this.db.all<{library_id:string;n:number}>(`SELECT i.library_id,count(*) n FROM media_parts p JOIN media_editions e ON e.id=p.edition_id JOIN media_items i ON i.id=e.item_id WHERE i.kind='audiobook' AND p.active=1 GROUP BY i.library_id`);
    const missing=this.db.all<{library_id:string;n:number}>('SELECT library_id,count(*) n FROM media_assets WHERE available=0 GROUP BY library_id');
    const summaries=new Map(roots.map(row=>[row.id,{id:row.id,root:row.root,counts:{} as Partial<Record<MediaItemKind,number>>,chapters:0,missingFiles:0}]));
    for(const row of counts){const summary=summaries.get(row.library_id);if(summary)summary.counts[row.kind]=row.n;}
    for(const row of chapters){const summary=summaries.get(row.library_id);if(summary)summary.chapters=row.n;}
    for(const row of missing){const summary=summaries.get(row.library_id);if(summary)summary.missingFiles=row.n;}
    return {items:[...summaries.values()]};
  }
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,initialize=true) {
    if(!initialize)return;
    db.transaction(()=>{
      db.run(`CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,library_id TEXT NOT NULL REFERENCES media_libraries(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,parent_id TEXT REFERENCES media_items(id),local_key TEXT NOT NULL,
        title TEXT NOT NULL,ordinal INTEGER NOT NULL DEFAULT 0,metadata_json TEXT NOT NULL,
        UNIQUE(library_id,kind,local_key))`);
      db.run(`CREATE INDEX IF NOT EXISTS media_item_parent ON media_items(parent_id,ordinal)`);
      if(!db.all<{name:string}>('PRAGMA table_info(media_items)').some(column=>column.name==='manual_structure'))
        db.run('ALTER TABLE media_items ADD COLUMN manual_structure INTEGER NOT NULL DEFAULT 0');
      db.run(`CREATE TABLE IF NOT EXISTS media_editions (
        id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
        local_key TEXT NOT NULL,label TEXT NOT NULL,UNIQUE(item_id,local_key))`);
      if (!db.all<{name:string}>('PRAGMA table_info(media_editions)').some(column=>column.name==='manual_item')) {
        db.run('ALTER TABLE media_editions ADD COLUMN manual_item INTEGER NOT NULL DEFAULT 0');
      }
      db.run(`CREATE TABLE IF NOT EXISTS media_parts (
        id TEXT PRIMARY KEY,edition_id TEXT NOT NULL REFERENCES media_editions(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES media_assets(id),local_key TEXT NOT NULL,
        title TEXT NOT NULL,ordinal INTEGER NOT NULL,start_seconds REAL NOT NULL DEFAULT 0,end_seconds REAL,
        active INTEGER NOT NULL DEFAULT 1,UNIQUE(asset_id,local_key))`);
      // Details and edition revisions read by edition, not by asset or global part ID.
      db.run('CREATE INDEX IF NOT EXISTS media_parts_edition ON media_parts(edition_id,id)');
      db.run(`CREATE TABLE IF NOT EXISTS media_asset_narrators (asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,name TEXT NOT NULL)`);
      db.run(`CREATE TABLE IF NOT EXISTS media_metadata_overrides (
        item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,field TEXT NOT NULL,value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,PRIMARY KEY(item_id,field))`);
      if(!db.all<{name:string}>('PRAGMA table_info(media_parts)').some(column=>column.name==='manual_order'))db.run('ALTER TABLE media_parts ADD COLUMN manual_order INTEGER');
      db.run(`CREATE TABLE IF NOT EXISTS media_online_metadata (
        item_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,external_id TEXT NOT NULL,source_url TEXT NOT NULL,
        fields_json TEXT NOT NULL,confirmed_by TEXT NOT NULL,confirmed_at INTEGER NOT NULL)`);
    });
  }

  private upsert(libraryId:string,kind:MediaItemKind,key:string,title:string,parentId:string|null,metadata:LocalMediaMetadata,ordinal=0):string {
    const existing=this.db.get<{id:string}>('SELECT id FROM media_items WHERE library_id=? AND kind=? AND local_key=?',libraryId,kind,key);
    const id=existing?.id || randomUUID();
    this.db.run(`INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,ordinal,metadata_json)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(library_id,kind,local_key) DO UPDATE SET
      title=excluded.title,metadata_json=excluded.metadata_json,ordinal=CASE WHEN media_items.manual_structure=1 THEN media_items.ordinal ELSE excluded.ordinal END`,id,libraryId,kind,parentId,key,title,ordinal,JSON.stringify(metadata));
    return id;
  }

  /** Called inside the scanner's publication transaction, after the asset exists. */
  ingest(libraryId:string,kind:MediaLibraryKind,assetId:string,ref:string,metadata:LocalMediaMetadata,probe:ProbeResult):void {
    if(kind==='audiobook'){
      const narrator=(metadata.narrator||metadata.artist||'').trim();
      if(narrator)this.db.run('INSERT INTO media_asset_narrators(asset_id,name) VALUES(?,?) ON CONFLICT(asset_id) DO UPDATE SET name=excluded.name',assetId,narrator);
      else this.db.run('DELETE FROM media_asset_narrators WHERE asset_id=?',assetId);
    }
    if(probe.info?.streams.some(stream=>stream.attachedPicture&&['mjpeg','png','webp'].includes(stream.codec)))metadata={...metadata,embeddedCoverAssetId:assetId};
    const dir=posix.dirname(ref);
    let title=metadata.title;
    const previous=this.db.get<{id:string;item_id:string;manual_item:number}>(`SELECT e.id,e.item_id,e.manual_item FROM media_editions e
      JOIN media_parts p ON p.edition_id=e.id WHERE p.asset_id=? ORDER BY p.active DESC LIMIT 1`,assetId);
    let itemId=previous?.item_id;
    if(!itemId){
      if(kind==='video'&&metadata.show&&metadata.season!==undefined&&metadata.episode!==undefined){
        const showDir=metadata.seriesRoot??(/^(season[ ._-]*\d+|s\d+|第.+季)$/i.test(posix.basename(dir))?posix.dirname(dir):dir);
        const seriesId=this.upsert(libraryId,'series',`${showDir}\0${metadata.show}`,metadata.show,null,metadata);
        const seasonId=this.upsert(libraryId,'season',`${seriesId}:${metadata.season}`,`第 ${metadata.season} 季`,seriesId,metadata,metadata.season);
        itemId=this.upsert(libraryId,'episode',`${seasonId}:${metadata.episode}`,title,seasonId,metadata,metadata.episode);
      }else if(kind==='video'){
        // Unidentified movies remain independent; equal titles alone do not merge.
        itemId=this.upsert(libraryId,'movie',assetId,title,null,metadata);
      }else if(kind==='music'){
        const artist=metadata.albumArtist||metadata.artist||'未知歌手';
        const artistId=this.upsert(libraryId,'artist',artist,artist,null,artistMetadata(artist,metadata,metadata.artistProfile));
        const album=metadata.album||(dir==='.'?'未分类专辑':posix.basename(dir));
        const albumId=this.upsert(libraryId,'album',`${dir}\0${artist}\0${album}`,album,artistId,metadata);
        itemId=this.upsert(libraryId,'track',assetId,title,albumId,metadata,(metadata.disc||1)*10000+(metadata.track||0));
      }else{
        const bookTitle=metadata.album||(dir==='.'?title:posix.basename(dir));
        const bookKey=dir==='.'?assetId:dir;
        itemId=this.upsert(libraryId,'audiobook',bookKey,bookTitle,null,metadata);
      }
    }else if(!previous?.manual_item){
      const item=this.db.get<ItemRow>('SELECT * FROM media_items WHERE id=?',itemId)!;
      if(kind==='video'){
        const old=JSON.parse(item.metadata_json) as LocalMediaMetadata;
        const proposedKind=metadata.show&&metadata.season!==undefined&&metadata.episode!==undefined?'episode':'movie';
        if(item.manual_structure||item.kind!==proposedKind||['show','season','episode','seriesRoot'].some(key=>old[key as keyof LocalMediaMetadata]!==metadata[key as keyof LocalMediaMetadata])){
          metadata={...old,recognition:metadata.recognition};title=item.title;
        }
      }
      const retainedTitle=item.kind==='audiobook'?(metadata.album||item.title):title;
      this.db.run('UPDATE media_items SET title=?,metadata_json=? WHERE id=?',retainedTitle,JSON.stringify(metadata),itemId);
    }
    const editionKey=kind==='audiobook'?`${metadata.narrator||metadata.artist||''}\0${metadata.edition||'默认版本'}`:assetId;
    let editionId=previous?.id || this.db.get<{id:string}>('SELECT id FROM media_editions WHERE item_id=? AND local_key=?',itemId,editionKey)?.id;
    if(!editionId){editionId=randomUUID();this.db.run('INSERT INTO media_editions(id,item_id,local_key,label) VALUES(?,?,?,?)',editionId,itemId,editionKey,metadata.edition||metadata.narrator||'原始版本');}
    this.db.run('UPDATE media_parts SET active=0 WHERE asset_id=?',assetId);
    const chapters=probe.info?.chapters || [];
    const parts=kind==='audiobook'&&chapters.length?chapters:[{title,start:0,end:probe.info?.duration??null}];
    for(const [index,part]of parts.entries()){
      const key=chapters.length&&kind==='audiobook'?`chapter:${index}`:'file';
      const old=this.db.get<{id:string}>('SELECT id FROM media_parts WHERE asset_id=? AND local_key=?',assetId,key);
      this.db.run(`INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal,start_seconds,end_seconds,active)
        VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(asset_id,local_key) DO UPDATE SET title=excluded.title,
        ordinal=excluded.ordinal,start_seconds=excluded.start_seconds,end_seconds=excluded.end_seconds,active=1`,
      old?.id||randomUUID(),editionId,assetId,key,part.title||`第 ${index+1} 章`,(metadata.disc||1)*1000000+(metadata.track||0)*1000+index,part.start,part.end);
    }
  }

  /** Apply reviewed video metadata while preserving asset, edition and part identities. */
  reidentifyVideoAsset(assetId:string,metadata:LocalMediaMetadata){
    const asset=this.db.get<{library_id:string;ref:string}>('SELECT library_id,ref FROM media_assets WHERE id=?',assetId);
    if(!asset)throw notFound('资源已变化');
    const edition=this.db.get<{id:string;item_id:string}>('SELECT e.id,e.item_id FROM media_editions e JOIN media_parts p ON p.edition_id=e.id WHERE p.asset_id=? LIMIT 1',assetId);
    if(!edition)throw notFound('资源尚未关联作品');
    const old=this.db.get<ItemRow>('SELECT * FROM media_items WHERE id=?',edition.item_id)!;
    let parentId:string|null=null,kind:MediaItemKind='movie',key=assetId,ordinal=0;
    if(metadata.show&&metadata.season!==undefined&&metadata.episode!==undefined){
      kind='episode';
      const seriesId=this.upsert(asset.library_id,'series',`${metadata.seriesRoot??posix.dirname(asset.ref)}\0${metadata.show}`,metadata.show,null,metadata);
      parentId=this.upsert(asset.library_id,'season',`${seriesId}:${metadata.season}`,`第 ${metadata.season} 季`,seriesId,metadata,metadata.season);
      key=`${parentId}:${metadata.episode}`;ordinal=metadata.episode;
    }
    const target=this.db.get<{id:string}>('SELECT id FROM media_items WHERE library_id=? AND kind=? AND local_key=?',asset.library_id,kind,key);
    if(target&&target.id!==old.id){
      this.db.run('UPDATE media_editions SET item_id=? WHERE id=?',target.id,edition.id);
      this.db.run('INSERT OR IGNORE INTO media_favorites(user_id,item_id,created_at) SELECT user_id,?,created_at FROM media_favorites WHERE item_id=?',target.id,old.id);
      this.db.run('DELETE FROM media_items WHERE id=?',old.id);
    }else{
      this.db.run('UPDATE media_items SET kind=?,parent_id=?,local_key=?,title=?,ordinal=?,metadata_json=? WHERE id=?',kind,parentId,key,metadata.title,ordinal,JSON.stringify(metadata),old.id);
    }
    this.db.run('UPDATE media_parts SET title=? WHERE asset_id=? AND local_key=?',metadata.title,assetId,'file');
    this.db.run('UPDATE media_assets SET publication_fingerprint=NULL WHERE id=?',assetId);
    // Empty inferred parents can retire; retain explicitly curated/favorited containers.
    let previous=old.parent_id;
    while(previous&&previous!==parentId){
      const parent=this.db.get<{parent_id:string|null;manual_structure:number}>('SELECT parent_id,manual_structure FROM media_items WHERE id=?',previous);
      if(!parent||parent.manual_structure||this.db.get('SELECT 1 FROM media_items WHERE parent_id=?',previous)||this.db.get('SELECT 1 FROM media_editions WHERE item_id=?',previous)||this.db.get('SELECT 1 FROM media_favorites WHERE item_id=?',previous)||this.db.get('SELECT 1 FROM media_metadata_overrides WHERE item_id=?',previous)||this.db.get('SELECT 1 FROM media_online_metadata WHERE item_id=?',previous))break;
      this.db.run('DELETE FROM media_items WHERE id=?',previous);previous=parent.parent_id;
    }
    return target?.id??old.id;
  }

  /** Resolve artwork after the entire scan is published, independent of file order. */
  refreshEmbeddedCovers(libraryId:string):void {
    const items=this.db.all<{id:string;kind:MediaItemKind;title:string;parent_id:string|null;metadata_json:string}>('SELECT id,kind,title,parent_id,metadata_json FROM media_items WHERE library_id=?',libraryId);
    const byId=new Map(items.map(item=>[item.id,item]));
    const profiles=new Map<string,ArtistProfile>();
    const available=new Set(items.some(item=>item.kind==='artist')?this.db.all<{item_id:string}>(`SELECT DISTINCT e.item_id FROM media_editions e JOIN media_parts p ON p.edition_id=e.id AND p.active=1 JOIN media_assets a ON a.id=p.asset_id AND a.available=1 WHERE a.library_id=?`,libraryId).map(row=>row.item_id):[]);
    for(const track of items){
      if(track.kind!=='track'||!available.has(track.id))continue;
      const profile=(JSON.parse(track.metadata_json) as LocalMediaMetadata).artistProfile;
      const album=track.parent_id?byId.get(track.parent_id):undefined,artist=album?.parent_id?byId.get(album.parent_id):undefined;
      if(!profile||artist?.kind!=='artist'||!sameArtist(profile.title,artist.title))continue;
      const current=profiles.get(artist.id);
      if(!current||profile.sourceRef<current.sourceRef)profiles.set(artist.id,profile);
    }
    const candidates=new Map<string,Set<string>>();
    const rows=this.db.all<{id:string;item_id:string;technical_json:string|null}>(`SELECT DISTINCT a.id,e.item_id,a.technical_json,a.ref FROM media_assets a
      JOIN media_parts p ON p.asset_id=a.id AND p.active=1 JOIN media_editions e ON e.id=p.edition_id
      WHERE a.library_id=? AND a.available=1 AND EXISTS (
        SELECT 1 FROM json_each(a.technical_json,'$.streams') stream
        WHERE json_extract(stream.value,'$.attachedPicture')=1
          AND json_extract(stream.value,'$.codec') IN ('mjpeg','png','webp')
      ) ORDER BY a.ref,a.id`,libraryId);
    for(const asset of rows){
      const probe=asset.technical_json?JSON.parse(asset.technical_json) as NonNullable<ProbeResult['info']>:null;
      if(!probe?.streams.some(stream=>stream.attachedPicture&&['mjpeg','png','webp'].includes(stream.codec)))continue;
      let id:string|null=asset.item_id;const visited=new Set<string>();
      while(id&&!visited.has(id)){
        visited.add(id);const item=byId.get(id);if(!item)break;
        if(item.kind==='artist')break;
        let choices=candidates.get(id);if(!choices){choices=new Set();candidates.set(id,choices);}choices.add(asset.id);id=item.parent_id;
      }
    }
    for(const item of items){
      const metadata=JSON.parse(item.metadata_json) as LocalMediaMetadata,choices=candidates.get(item.id);
      if(item.kind==='artist'){
        // Also repair libraries scanned by older versions. Online matches and manual overrides live separately.
        const clean=JSON.stringify(artistMetadata(item.title,metadata,profiles.get(item.id)));
        if(clean!==item.metadata_json)this.db.run('UPDATE media_items SET metadata_json=? WHERE id=?',clean,item.id);
        continue;
      }
      const selected=metadata.embeddedCoverAssetId&&choices?.has(metadata.embeddedCoverAssetId)?metadata.embeddedCoverAssetId:choices?.values().next().value;
      if(selected===metadata.embeddedCoverAssetId)continue;
      if(selected)metadata.embeddedCoverAssetId=selected;else delete metadata.embeddedCoverAssetId;
      this.db.run('UPDATE media_items SET metadata_json=? WHERE id=?',JSON.stringify(metadata),item.id);
    }
  }

  renameEdition(actor:MediaActor,id:string,label:string,expectedLabel:string){
    if(actor.role!=='admin')throw forbidden();
    if(typeof label!=='string'||!label.trim()||label.trim().length>200||typeof expectedLabel!=='string')throw badRequest('版本名称应为 1–200 个字符');
    return this.db.transaction(()=>{
      const edition=this.db.get<{item_id:string;label:string}>('SELECT item_id,label FROM media_editions WHERE id=?',id);
      if(!edition)throw notFound('media edition not found');this.item(actor,edition.item_id);
      if(edition.label!==expectedLabel)throw conflict('版本名称已被修改，请刷新后重试','MEDIA_EDITION_CHANGED');
      const normalized=label.trim();this.db.run('UPDATE media_editions SET label=? WHERE id=?',normalized,id);
      return {id,label:normalized};
    });
  }

  /** Move the relationship, never the files or chapter identities used by playback. */
  reparentMusic(actor:MediaActor,id:string,targetParentId:string,expectedParentId:string|null){
    if(actor.role!=='admin')throw forbidden();
    return this.db.transaction(()=>{
      const item=this.item(actor,id),target=this.item(actor,targetParentId);
      const parentKind=item.kind==='track'?'album':item.kind==='album'?'artist':null;
      if(!parentKind||target.kind!==parentKind||item.library_id!==target.library_id)throw badRequest('只能调整同一音乐库内的曲目专辑或专辑歌手归属','MEDIA_PARENT_TARGET');
      if(item.parent_id!==expectedParentId)throw conflict('作品归属已改变，请刷新后重新选择','MEDIA_PARENT_CHANGED');
      if(item.parent_id!==target.id){
        this.db.run('UPDATE media_items SET parent_id=? WHERE id=?',target.id,item.id);
        this.refreshEmbeddedCovers(item.library_id);
      }
      return this.detail(actor,id);
    });
  }

  createMusicParent(actor:MediaActor,id:string,title:string,expectedParentId:string|null){
    if(actor.role!=='admin')throw forbidden();
    if(typeof title!=='string'||!title.trim()||title.trim().length>200)throw badRequest('名称应为 1–200 个字符');
    return this.db.transaction(()=>{
      const item=this.item(actor,id);
      const kind=item.kind==='track'?'album':item.kind==='album'?'artist':null;
      if(!kind)throw badRequest('此作品不支持新建音乐归属','MEDIA_PARENT_TARGET');
      if(item.parent_id!==expectedParentId)throw conflict('作品归属已改变，请刷新后重新选择','MEDIA_PARENT_CHANGED');
      // A new album retains the current album's artist; never guess an artist from text tags.
      const parentId=kind==='album'&&item.parent_id?this.item(actor,item.parent_id).parent_id:null;
      const created=randomUUID();
      this.db.run('INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,ordinal,metadata_json) VALUES(?,?,?,?,?,?,0,?)',created,item.library_id,kind,parentId,`manual:${created}`,title.trim(),'{}');
      this.db.run('UPDATE media_items SET parent_id=? WHERE id=?',created,id);
      this.refreshEmbeddedCovers(item.library_id);
      return this.detail(actor,id);
    });
  }

  /** Move the relationship, never the files or chapter identities used by playback. */
  reassignEdition(actor:MediaActor,id:string,targetItemId:string,expectedItemId:string) {
    if(actor.role!=='admin')throw forbidden();
    return this.db.transaction(()=>{
      const edition=this.db.get<{item_id:string}>('SELECT item_id FROM media_editions WHERE id=?',id);
      if(!edition)throw notFound('media edition not found');
      const source=this.item(actor,edition.item_id),target=this.item(actor,targetItemId);
      if(source.id!==expectedItemId)throw conflict('版本归属已改变，请刷新后重试','MEDIA_EDITION_CHANGED');
      if(source.library_id!==target.library_id||source.kind!==target.kind||!['movie','episode','track','audiobook'].includes(source.kind)) {
        throw badRequest('只能关联到同一媒体库中相同类型的作品','MEDIA_EDITION_TARGET');
      }
      if(source.id!==target.id){
        // A manual key avoids collisions between independently scanned editions.
        this.db.run('UPDATE media_editions SET item_id=?,local_key=?,manual_item=1 WHERE id=?',target.id,`manual:${id}`,id);
        this.refreshEmbeddedCovers(source.library_id);
      }
      return this.detail(actor,target.id);
    });
  }

  private editionRevision(id:string):string {
    const edition=this.db.get('SELECT * FROM media_editions WHERE id=?',id);
    const parts=this.db.all('SELECT * FROM media_parts WHERE edition_id=? ORDER BY id',id);
    return createHash('sha256').update(JSON.stringify([edition,parts])).digest('hex');
  }

  createEditionItem(actor:MediaActor,id:string,title:string,expectedItemId:string){
    if(actor.role!=='admin')throw forbidden();
    if(typeof title!=='string'||!title.trim()||title.trim().length>200)throw badRequest('作品标题应为 1–200 个字符');
    return this.db.transaction(()=>{
      const edition=this.db.get<{item_id:string}>('SELECT item_id FROM media_editions WHERE id=?',id);
      if(!edition)throw notFound('media edition not found');
      const source=this.item(actor,edition.item_id);
      if(source.id!==expectedItemId)throw conflict('版本归属已改变，请刷新后重试','MEDIA_EDITION_CHANGED');
      if(!['movie','episode','track','audiobook'].includes(source.kind))throw badRequest('此类型不支持新建版本归属','MEDIA_EDITION_TARGET');
      const created=randomUUID();
      const local=JSON.parse(source.metadata_json),structure:Record<string,number>={};
      for(const field of source.kind==='track'?['disc','track']:source.kind==='episode'?['season','episode']:[]){
        if(Number.isInteger(local[field])&&local[field]>=0)structure[field]=local[field];
      }
      // Keep the parent context; neither incorrect source metadata nor online matches are copied.
      this.db.run('INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,ordinal,metadata_json) VALUES(?,?,?,?,?,?,?,?)',created,source.library_id,source.kind,source.parent_id,`manual:${created}`,title.trim(),source.ordinal,JSON.stringify(structure));
      this.db.run('UPDATE media_editions SET item_id=?,local_key=?,manual_item=1 WHERE id=?',created,`manual:${id}`,id);
      this.refreshEmbeddedCovers(source.library_id);
      return this.detail(actor,created);
    });
  }

  narrators(actor:MediaActor,libraryId:string,options:{search?:string;name?:string;offset?:number;limit?:number}={}) {
    if(libraryId){const library=this.libraries.get(actor,libraryId);if(library.kind!=='audiobook')throw badRequest('演播者仅用于有声书库');}
    const params:Array<string|number>=libraryId?[libraryId]:[actor.role,actor.id];
    const scope=libraryId?'i.library_id=?':"l.kind='audiobook' AND (?='admin' OR l.access='all' OR EXISTS (SELECT 1 FROM media_library_users u WHERE u.library_id=l.id AND u.user_id=?))";
    const source=`FROM media_items i JOIN media_libraries l ON l.id=i.library_id JOIN media_editions e ON e.item_id=i.id
      JOIN media_parts p ON p.edition_id=e.id AND p.active=1
      LEFT JOIN media_asset_narrators n ON n.asset_id=p.asset_id
      LEFT JOIN media_metadata_overrides o ON o.item_id=i.id AND o.field='narrator'
      WHERE ${scope} AND i.kind='audiobook'`;
    const name=`trim(COALESCE(json_extract(o.value_json,'$'),n.name,''))`;
    if(options.name!==undefined){
      const rows=this.db.all<{id:string;library_name:string}>(`SELECT DISTINCT i.id,l.name library_name ${source} AND ${name}=? ORDER BY i.title,i.id LIMIT ? OFFSET ?`,...params,options.name,options.limit??60,options.offset??0);
      const editions=new Set(rows.length?this.db.all<{id:string}>(`SELECT DISTINCT e.id ${source} AND ${name}=? AND i.id IN (${rows.map(()=>'?').join(',')})`,...params,options.name,...rows.map(row=>row.id)).map(row=>row.id):[]);
      return {items:rows.map(row=>{const detail=this.detail(actor,row.id);return {...detail,libraryName:row.library_name,editions:detail.editions.filter(edition=>editions.has(edition.id))};}),total:this.db.get<{n:number}>(`SELECT count(DISTINCT i.id) n ${source} AND ${name}=?`,...params,options.name)!.n};
    }
    const filtered=`${source} AND ${name}<>'' AND instr(lower(${name}),lower(?))>0`;
    return {items:this.db.all<{name:string;works:number;editions:number}>(`SELECT ${name} name,count(DISTINCT i.id) works,count(DISTINCT e.id) editions ${filtered} GROUP BY ${name} ORDER BY name LIMIT ? OFFSET ?`,...params,options.search||'',options.limit??60,options.offset??0),
      total:this.db.get<{n:number}>(`SELECT count(DISTINCT ${name}) n ${filtered}`,...params,options.search||'')!.n};
  }

  private checkedEdition(actor:MediaActor,id:string,revision:string) {
    const edition=this.db.get<{id:string;item_id:string;manual_item:number}>('SELECT * FROM media_editions WHERE id=?',id);
    if(!edition)throw notFound('media edition not found');
    this.item(actor,edition.item_id);
    if(this.editionRevision(id)!==revision)throw conflict('版本内容已改变，请刷新后重新核对','MEDIA_EDITION_CHANGED');
    return edition;
  }

  splitEdition(actor:MediaActor,id:string,input:{expectedRevision:string;assetIds:string[];label:string}) {
    if(actor.role!=='admin')throw forbidden();
    if(typeof input.label!=='string'||!input.label.trim()||input.label.trim().length>200||!Array.isArray(input.assetIds)||!input.assetIds.length||input.assetIds.length>2000||input.assetIds.some(id=>typeof id!=='string')||new Set(input.assetIds).size!==input.assetIds.length)throw badRequest('请选择文件并填写 1–200 字的新版本名称');
    return this.db.transaction(()=>{
      const source=this.checkedEdition(actor,id,input.expectedRevision);
      const assets=this.db.all<{asset_id:string}>('SELECT DISTINCT asset_id FROM media_parts WHERE edition_id=? AND active=1',id);
      const chosen=new Set(input.assetIds);
      if(chosen.size>=assets.length||input.assetIds.some(id=>!assets.some(asset=>asset.asset_id===id)))throw badRequest('请选择部分文件，原版本至少保留一个文件','MEDIA_EDITION_SPLIT');
      const created=randomUUID();
      this.db.run('INSERT INTO media_editions(id,item_id,local_key,label,manual_item) VALUES(?,?,?,?,?)',created,source.item_id,`manual:${created}`,input.label.trim(),source.manual_item);
      // Move inactive chapters as well so later scans cannot resurrect the old grouping.
      for(const assetId of input.assetIds)this.db.run('UPDATE media_parts SET edition_id=? WHERE edition_id=? AND asset_id=?',created,id,assetId);
      return this.detail(actor,source.item_id);
    });
  }

  mergeEditions(actor:MediaActor,id:string,input:{expectedRevision:string;targetEditionId:string;targetRevision:string}) {
    if(actor.role!=='admin')throw forbidden();
    return this.db.transaction(()=>{
      const source=this.checkedEdition(actor,id,input.expectedRevision);
      const target=this.checkedEdition(actor,input.targetEditionId,input.targetRevision);
      if(source.id===target.id||source.item_id!==target.item_id)throw badRequest('只能合并同一作品下的不同版本','MEDIA_EDITION_MERGE');
      const ordered=this.db.get('SELECT 1 FROM media_parts WHERE edition_id IN (?,?) AND manual_order IS NOT NULL',source.id,target.id);
      const combined=ordered?[...this.detail(actor,target.item_id).editions.find(e=>e.id===target.id)!.parts,...this.detail(actor,source.item_id).editions.find(e=>e.id===source.id)!.parts]:[];
      this.db.run('UPDATE media_parts SET edition_id=? WHERE edition_id=?',target.id,source.id);
      if(ordered){
        this.db.run('UPDATE media_parts SET manual_order=NULL WHERE edition_id=?',target.id);
        combined.forEach((part,index)=>this.db.run('UPDATE media_parts SET manual_order=? WHERE id=?',index,part.id));
      }
      this.db.run('UPDATE media_editions SET manual_item=?,local_key=? WHERE id=?',Math.max(source.manual_item,target.manual_item),`manual:${target.id}`,target.id);
      this.db.run('DELETE FROM media_editions WHERE id=?',source.id);
      return this.detail(actor,source.item_id);
    });
  }

  orderEdition(actor:MediaActor,id:string,input:{expectedRevision:string;partIds:string[]|null}) {
    if(actor.role!=='admin')throw forbidden();
    if(input.partIds!==null&&(!Array.isArray(input.partIds)||input.partIds.length>10000||input.partIds.some(id=>typeof id!=='string')||new Set(input.partIds).size!==input.partIds.length))throw badRequest('无效章节顺序');
    return this.db.transaction(()=>{
      const edition=this.checkedEdition(actor,id,input.expectedRevision);
      const ids=this.db.all<{id:string}>('SELECT id FROM media_parts WHERE edition_id=? AND active=1',id).map(part=>part.id);
      const requested=new Set(input.partIds);
      if(input.partIds!==null&&(input.partIds.length!==ids.length||ids.some(id=>!requested.has(id))))throw badRequest('排序必须包含此版本的全部章节','MEDIA_EDITION_ORDER');
      this.db.run('UPDATE media_parts SET manual_order=NULL WHERE edition_id=?',id);
      input.partIds?.forEach((partId,index)=>this.db.run('UPDATE media_parts SET manual_order=? WHERE id=?',index,partId));
      return this.detail(actor,edition.item_id);
    });
  }

  private item(actor:MediaActor,id:string):ItemRow {
    const row=this.db.get<ItemRow>('SELECT * FROM media_items WHERE id=?',id);
    if(!row)throw notFound('media item not found');this.libraries.get(actor,row.library_id);return row;
  }
  private dto(row:ItemRow):MediaItem {
    const overrides=Object.fromEntries(this.db.all<{field:string;value_json:string}>('SELECT field,value_json FROM media_metadata_overrides WHERE item_id=?',row.id).map(v=>[v.field,JSON.parse(v.value_json)]));
    const local=JSON.parse(row.metadata_json);
    const online=this.db.get<{provider:string;external_id:string;source_url:string;fields_json:string;confirmed_at:number}>('SELECT * FROM media_online_metadata WHERE item_id=?',row.id);
    const fields:Record<string,unknown>=online?JSON.parse(online.fields_json):{};
    const metadata={...local,...fields,sources:{...local.sources,...Object.fromEntries(Object.keys(fields).map(field=>[field,online!.provider]))},
      externalIds:{...local.externalIds,...(online?{[online.provider]:online.external_id}:{})},
      ...(online?{onlineMatch:{provider:online.provider,externalId:online.external_id,sourceUrl:online.source_url,confirmedAt:online.confirmed_at}}:{})};
    return {id:row.id,libraryId:row.library_id,kind:row.kind,parentId:row.parent_id,title:typeof overrides.title==='string'?overrides.title:typeof fields.title==='string'?fields.title:row.title,ordinal:row.ordinal,metadata,overrides};
  }
  list(actor:MediaActor,libraryId:string,options:TrackFilters&{kind?:MediaBrowseKind;parentId?:string;search?:string;offset?:number;limit?:number;sort?:MediaSort}={}) {
    this.libraries.get(actor,libraryId);
    const conditions=['i.library_id=?'];const params:Array<string|number>=[libraryId];
    if(options.kind==='video')conditions.push("i.kind IN ('movie','series')");
    else if(options.kind){conditions.push('i.kind=?');params.push(options.kind);}
    if(options.parentId){conditions.push('i.parent_id=?');params.push(options.parentId);}
    const filterJoins=trackConditions(options,conditions,params);
    if(options.search){conditions.push(`instr(lower(COALESCE((SELECT json_extract(o.value_json,'$') FROM media_metadata_overrides o WHERE o.item_id=i.id AND o.field='title'),(SELECT json_extract(m.fields_json,'$.title') FROM media_online_metadata m WHERE m.item_id=i.id),i.title)),lower(?))>0`);params.push(options.search);}
    const where=conditions.join(' AND ');
    return {items:this.db.all<ItemRow>(`SELECT i.* FROM media_items i ${filterJoins} WHERE ${where} ORDER BY ${titleOrder(options.sort,'i.ordinal,i.title,i.id')} LIMIT ? OFFSET ?`,...params,options.limit??100,options.offset??0).map(row=>this.dto(row)),total:this.db.get<{n:number}>(`SELECT count(*) n FROM media_items i ${filterJoins} WHERE ${where}`,...params)!.n};
  }
  browse(actor:MediaActor,channel:MediaLibraryKind,kind:MediaBrowseKind,options:TrackFilters&{offset?:number;limit?:number;sort?:MediaSort}={}) {
    const allowed:Record<MediaLibraryKind,MediaBrowseKind[]>={video:['video','movie','series'],music:['artist','album','track'],audiobook:['audiobook']};
    if(!allowed[channel]?.includes(kind))throw badRequest('分类不属于所选频道','MEDIA_BROWSE_KIND');
    return this.search(actor,'',{...options,channel,kind});
  }
  search(actor:MediaActor,query:string,options:TrackFilters&{channel?:MediaLibraryKind;kind?:MediaBrowseKind;offset?:number;limit?:number;sort?:MediaSort}={}) {
    const conditions=[`(?='admin' OR l.access='all' OR EXISTS (SELECT 1 FROM media_library_users u WHERE u.library_id=l.id AND u.user_id=?))`];
    const params:Array<string|number>=[actor.role,actor.id];
    if(options.channel){conditions.push('l.kind=?');params.push(options.channel);}
    if(options.kind==='video')conditions.push("i.kind IN ('movie','series')");
    else if(options.kind){conditions.push('i.kind=?');params.push(options.kind);}
    const filterJoins=trackConditions(options,conditions,params);
    const keyword=query.trim();
    // Browsing matches every title; avoid metadata lookups for each row just to match an empty string.
    if(keyword){
      conditions.push(`instr(lower(COALESCE((SELECT json_extract(o.value_json,'$') FROM media_metadata_overrides o WHERE o.item_id=i.id AND o.field='title'),(SELECT json_extract(m.fields_json,'$.title') FROM media_online_metadata m WHERE m.item_id=i.id),i.title)),lower(?))>0`);
      params.push(keyword);
    }
    const from=`FROM media_items i JOIN media_libraries l ON l.id=i.library_id ${filterJoins} WHERE ${conditions.join(' AND ')}`;
    return {items:this.db.all<ItemRow & {channel:MediaLibraryKind;library_name:string}>(`SELECT i.*,l.kind channel,l.name library_name ${from} ORDER BY ${titleOrder(options.sort,'i.title COLLATE NOCASE,i.id')} LIMIT ? OFFSET ?`,...params,options.limit??60,options.offset??0).map(row=>({...this.dto(row),channel:row.channel,libraryName:row.library_name})),
      total:this.db.get<{n:number}>(`SELECT count(*) n ${from}`,...params)!.n};
  }
  detail(actor:MediaActor,id:string) {
    const row=this.item(actor,id);
    const editions=this.db.all<{id:string;label:string}>('SELECT id,label FROM media_editions WHERE item_id=? ORDER BY rowid',id).map(e=>({...e,parts:this.db.all<PartRow>(`SELECT p.*,a.available FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE p.edition_id=? AND p.active=1 ORDER BY p.manual_order IS NULL,p.manual_order,p.ordinal,a.ref,p.start_seconds`,e.id).map(p=>({id:p.id,assetId:p.asset_id,title:p.title,start:p.start_seconds,end:p.end_seconds,available:p.available===1}))}));
    return {...this.dto(row),editions:editions.map(edition=>({...edition,revision:this.editionRevision(edition.id)})),children:this.db.all<ItemRow>('SELECT * FROM media_items WHERE parent_id=? ORDER BY ordinal,title',id).map(c=>this.dto(c))};
  }
  albumPlayback(actor:MediaActor,id:string) {
    const album=this.item(actor,id);
    if(album.kind!=='album')throw badRequest('请选择音乐专辑','MEDIA_NOT_ALBUM');
    const rows=this.db.all<{id:string}>(`SELECT id FROM media_items WHERE parent_id=? AND kind='track'
      AND EXISTS (SELECT 1 FROM media_editions e JOIN media_parts p ON p.edition_id=e.id WHERE e.item_id=media_items.id AND p.active=1)
      ORDER BY COALESCE(json_extract(metadata_json,'$.disc'),1),COALESCE(json_extract(metadata_json,'$.track'),0),title,id LIMIT 2001`,id);
    if(rows.length>2000)throw badRequest('专辑曲目过多，请分别选择曲目','MEDIA_ALBUM_LIMIT');
    return {tracks:rows.map(row=>{
      const detail=this.detail(actor,row.id);
      return {id:detail.id,title:detail.title,disc:detail.metadata.disc??1,track:detail.metadata.track??null,editions:detail.editions};
    })};
  }
  seasonPlayback(actor:MediaActor,id:string) {
    const season=this.item(actor,id);
    if(season.kind!=='season')throw badRequest('请选择一季剧集','MEDIA_NOT_SEASON');
    const episodes=this.db.all<{id:string}>(`SELECT id FROM media_items WHERE parent_id=?
      AND EXISTS (SELECT 1 FROM media_editions e JOIN media_parts p ON p.edition_id=e.id WHERE e.item_id=media_items.id AND p.active=1)
      ORDER BY ordinal,title`,id);
    if(episodes.length>2000)throw badRequest('本季条目过多，请逐集播放','MEDIA_SEASON_LIMIT');
    return {episodes:episodes.map(episode=>{
      const detail=this.detail(actor,episode.id);
      return {id:detail.id,title:detail.title,editions:detail.editions};
    })};
  }
  seriesPlayback(actor:MediaActor,id:string) {
    const series=this.item(actor,id);
    if(series.kind!=='series')throw badRequest('请选择剧集作品','MEDIA_NOT_SERIES');
    const count=this.db.get<{n:number}>(`SELECT count(*) n FROM media_items episode JOIN media_items season ON season.id=episode.parent_id WHERE season.parent_id=? AND season.kind='season'`,id)!.n;
    if(count>2000)throw badRequest('剧集条目过多，请按季播放','MEDIA_SERIES_LIMIT');
    const seasons=this.db.all<ItemRow>("SELECT * FROM media_items WHERE parent_id=? AND kind='season' ORDER BY ordinal,title",id);
    return {episodes:seasons.flatMap(season=>{
      const title=this.dto(season).title;
      return this.seasonPlayback(actor,season.id).episodes.map(episode=>({...episode,title:title+' · '+episode.title}));
    })};
  }
  override(actor:MediaActor,id:string,patch:Record<string,unknown>):void {
    if(actor.role!=='admin')throw forbidden('admin role required','ADMIN_REQUIRED');this.item(actor,id);
    const allowed=new Set(['title','plot','year','artist','albumArtist','album','author','narrator']);
    if(!patch||Array.isArray(patch)||typeof patch!=='object')throw badRequest('invalid metadata patch');
    for(const[field,value]of Object.entries(patch)){
      if(!allowed.has(field)||(value!==null&&(field==='year'?typeof value!=='number'||!Number.isInteger(value)||value<0||value>9999:typeof value!=='string'||value.length>32000||(field==='title'&&!value.trim()))))throw badRequest('invalid metadata field');
    }
    this.db.transaction(()=>{for(const[field,value]of Object.entries(patch)){
      if(value===null)this.db.run('DELETE FROM media_metadata_overrides WHERE item_id=? AND field=?',id,field);
      else this.db.run('INSERT INTO media_metadata_overrides(item_id,field,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(item_id,field) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',id,field,JSON.stringify(value),Date.now());
    }});
  }
}
