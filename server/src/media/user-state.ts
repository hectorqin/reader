import { createHash, randomUUID } from 'node:crypto';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import type { MediaActor, MediaLibraryKind } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import { MediaCatalog } from './catalog.ts';

export class MediaUserState {
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,private readonly catalog:MediaCatalog,initialize=true) {
    if(!initialize)return;
    db.transaction(()=>{
      db.run(`CREATE TABLE IF NOT EXISTS media_favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,item_id))`);
      db.run(`CREATE TABLE IF NOT EXISTS media_queue (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        part_id TEXT NOT NULL REFERENCES media_parts(id),ordinal INTEGER NOT NULL,created_at INTEGER NOT NULL)`);
      db.run('CREATE INDEX IF NOT EXISTS media_queue_user ON media_queue(user_id,ordinal)');
    });
  }
  favorite(actor:MediaActor,itemId:string,enabled:boolean) {
    this.catalog.detail(actor,itemId);
    if(typeof enabled!=='boolean')throw badRequest('invalid favorite state');
    if(enabled)this.db.run('INSERT INTO media_favorites VALUES(?,?,?) ON CONFLICT(user_id,item_id) DO NOTHING',actor.id,itemId,Date.now());
    else this.db.run('DELETE FROM media_favorites WHERE user_id=? AND item_id=?',actor.id,itemId);
    return {itemId,favorite:enabled};
  }
  isFavorite(actor:MediaActor,itemId:string) {
    this.catalog.detail(actor,itemId);
    return {itemId,favorite:!!this.db.get('SELECT 1 FROM media_favorites WHERE user_id=? AND item_id=?',actor.id,itemId)};
  }
  private visible(actor:MediaActor) {return this.libraries.list(actor).map(lib=>lib.id);}
  favorites(actor:MediaActor,options:{channel?:MediaLibraryKind;offset?:number;limit?:number}={}) {
    const visible=this.libraries.list(actor).filter(lib=>!options.channel||lib.kind===options.channel).map(lib=>lib.id);
    if(!visible.length)return {items:[],total:0};
    const from=`FROM media_items i JOIN media_favorites f ON f.item_id=i.id WHERE f.user_id=? AND i.library_id IN (${visible.map(()=>'?').join(',')})`;
    const rows=this.db.all<{id:string}>(`SELECT i.id FROM media_items i JOIN media_favorites f ON f.item_id=i.id
      WHERE f.user_id=? AND i.library_id IN (${visible.map(()=>'?').join(',')}) ORDER BY f.created_at DESC,i.id LIMIT ? OFFSET ?`,actor.id,...visible,options.limit??500,options.offset??0);
    return {items:rows.map(row=>this.catalog.detail(actor,row.id)),total:this.db.get<{n:number}>(`SELECT count(*) n ${from}`,actor.id,...visible)!.n};
  }
  history(actor:MediaActor,options:{channel?:MediaLibraryKind;offset?:number;limit?:number}={}) {
    const visible=this.libraries.list(actor).filter(lib=>!options.channel||lib.kind===options.channel).map(lib=>lib.id);
    if(!visible.length)return {items:[],total:0};
    const total=this.db.get<{n:number}>(`SELECT count(*) n FROM media_progress g JOIN media_parts p ON p.id=g.part_id JOIN media_editions e ON e.id=p.edition_id JOIN media_items i ON i.id=e.item_id JOIN media_assets a ON a.id=p.asset_id WHERE g.user_id=? AND i.library_id IN (${visible.map(()=>'?').join(',')})`,actor.id,...visible)!.n;
    // Page visible identities first: metadata joins are only needed for the returned page.
    return {items:this.db.all(`WITH page AS MATERIALIZED (
      SELECT g.part_id,g.position,g.completed,g.updated_at FROM media_progress g
      JOIN media_parts p ON p.id=g.part_id JOIN media_editions e ON e.id=p.edition_id
      JOIN media_items i ON i.id=e.item_id JOIN media_assets a ON a.id=p.asset_id
      WHERE g.user_id=? AND i.library_id IN (${visible.map(()=>'?').join(',')})
      ORDER BY g.updated_at DESC,g.part_id LIMIT ? OFFSET ?
    ) SELECT i.id itemId,i.library_id libraryId,i.kind,
      COALESCE(json_extract(o.value_json,'$'),json_extract(m.fields_json,'$.title'),i.title) title,
      e.id editionId,e.label editionLabel,p.id partId,p.title partTitle,a.id assetId,p.start_seconds start,p.end_seconds end,
      g.position,g.completed,g.updated_at updatedAt,(a.available=1 AND p.active=1) available,json_patch(i.metadata_json,COALESCE(m.fields_json,'{}')) metadataJson FROM page g JOIN media_parts p ON p.id=g.part_id
      JOIN media_editions e ON e.id=p.edition_id JOIN media_items i ON i.id=e.item_id JOIN media_assets a ON a.id=p.asset_id
      LEFT JOIN media_metadata_overrides o ON o.item_id=i.id AND o.field='title' LEFT JOIN media_online_metadata m ON m.item_id=i.id
    ORDER BY g.updated_at DESC,p.id`,actor.id,...visible,options.limit??100,options.offset??0),total};
  }
  queue(actor:MediaActor) {
    const visible=this.visible(actor);
    if(!visible.length)return {items:[]};
    return {items:this.db.all(`SELECT q.id,q.part_id partId,q.ordinal,i.id itemId,i.library_id libraryId,i.kind,
      COALESCE(json_extract(o.value_json,'$'),json_extract(m.fields_json,'$.title'),i.title) title,e.label editionLabel,p.title partTitle,a.id assetId,
      p.start_seconds start,p.end_seconds end,a.available FROM media_queue q JOIN media_parts p ON p.id=q.part_id
      JOIN media_editions e ON e.id=p.edition_id JOIN media_items i ON i.id=e.item_id JOIN media_assets a ON a.id=p.asset_id
      LEFT JOIN media_metadata_overrides o ON o.item_id=i.id AND o.field='title' LEFT JOIN media_online_metadata m ON m.item_id=i.id
      WHERE q.user_id=? AND i.library_id IN (${visible.map(()=>'?').join(',')}) AND p.active=1 ORDER BY q.ordinal,q.id`,actor.id,...visible)};
  }
  enqueue(actor:MediaActor,partIds:string[]) {
    if(!Array.isArray(partIds)||partIds.length<1||partIds.length>500||partIds.some(id=>typeof id!=='string'))throw badRequest('invalid queue entries');
    this.db.transaction(()=>{
      const count=this.db.get<{n:number}>('SELECT count(*) n FROM media_queue WHERE user_id=?',actor.id)!.n;
      if(count+partIds.length>2000)throw badRequest('queue limit reached');
      let ordinal=this.db.get<{n:number|null}>('SELECT max(ordinal) n FROM media_queue WHERE user_id=?',actor.id)!.n??-1;
      for(const id of partIds){
        const part=this.db.get<{library_id:string}>(`SELECT a.library_id FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE p.id=? AND p.active=1`,id);
        if(!part)throw notFound('media part not found');this.libraries.get(actor,part.library_id);
        this.db.run('INSERT INTO media_queue VALUES(?,?,?,?,?)',randomUUID(),actor.id,id,++ordinal,Date.now());
      }
    });
    return this.queue(actor);
  }
  move(actor:MediaActor,id:string,neighborId:string,direction:'up'|'down') {
    this.db.transaction(()=>{
      const channels=new Map(this.libraries.list(actor).map(lib=>[lib.id,lib.kind]));
      const rows=this.queue(actor).items as Array<{id:string;libraryId:string;ordinal:number}>;
      const entry=rows.find(row=>row.id===id);
      if(!entry)throw notFound('queue entry not found');
      const channel=channels.get(entry.libraryId);
      const sameChannel=rows.filter(row=>channels.get(row.libraryId)===channel);
      const index=sameChannel.findIndex(row=>row.id===id);
      const neighbor=sameChannel[index+(direction==='up'?-1:1)];
      if(!neighbor||neighbor.id!==neighborId)throw conflict('queue changed; reload before moving','QUEUE_CHANGED');
      this.db.run('UPDATE media_queue SET ordinal=? WHERE id=? AND user_id=?',neighbor.ordinal,entry.id,actor.id);
      this.db.run('UPDATE media_queue SET ordinal=? WHERE id=? AND user_id=?',entry.ordinal,neighbor.id,actor.id);
    });
    return this.queue(actor);
  }
  private queueReplacement(actor:MediaActor,partIds:string[]) {
    if(!Array.isArray(partIds)||partIds.length<1||partIds.length>2000||partIds.some(id=>typeof id!=='string'))throw badRequest('无效播放列表');
    let channel:MediaLibraryKind|undefined;
    for(const id of new Set(partIds)){
      const part=this.db.get<{library_id:string}>('SELECT a.library_id FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE p.id=? AND p.active=1',id);
      if(!part)throw notFound('media part not found');
      const library=this.libraries.get(actor,part.library_id);
      if(channel&&channel!==library.kind)throw badRequest('一次只能保存同一频道的播放列表');
      channel=library.kind;
    }
    const visible=new Set(this.libraries.list(actor).filter(library=>library.kind===channel).map(library=>library.id));
    const rows=(this.queue(actor).items as Array<{id:string;libraryId:string;partId:string;ordinal:number}>).filter(row=>visible.has(row.libraryId));
    const revision=createHash('sha256').update(JSON.stringify(rows.map(row=>[row.id,row.partId,row.ordinal]))).digest('hex');
    return {channel:channel!,rows,revision};
  }
  previewQueue(actor:MediaActor,partIds:string[]){
    const result=this.queueReplacement(actor,partIds);
    return {channel:result.channel,revision:result.revision,existingCount:result.rows.length,newCount:partIds.length};
  }
  replaceQueue(actor:MediaActor,partIds:string[],expectedRevision:string){
    return this.db.transaction(()=>{
      const {rows,revision}=this.queueReplacement(actor,partIds);
      if(revision!==expectedRevision)throw conflict('待播队列已变化，请重新预览后保存','QUEUE_CHANGED');
      const total=this.db.get<{n:number}>('SELECT count(*) n FROM media_queue WHERE user_id=?',actor.id)!.n;
      if(total-rows.length+partIds.length>2000)throw badRequest('queue limit reached');
      for(const row of rows)this.db.run('DELETE FROM media_queue WHERE id=? AND user_id=?',row.id,actor.id);
      let ordinal=this.db.get<{n:number|null}>('SELECT max(ordinal) n FROM media_queue WHERE user_id=?',actor.id)!.n??-1;
      for(const id of partIds)this.db.run('INSERT INTO media_queue VALUES(?,?,?,?,?)',randomUUID(),actor.id,id,++ordinal,Date.now());
      return this.queue(actor);
    });
  }
  clear(actor:MediaActor,channel:MediaLibraryKind,entryIds:string[]) {
    // Delete the reviewed snapshot only; entries added by another device stay queued.
    const libraries=this.libraries.list(actor).filter(lib=>lib.kind===channel).map(lib=>lib.id);
    if(libraries.length&&entryIds.length)this.db.transaction(()=>{
      const selected=new Set(entryIds);
      const rows=this.queue(actor).items as Array<{id:string;libraryId:string}>;
      for(const row of rows)if(selected.has(row.id)&&libraries.includes(row.libraryId))
        this.db.run('DELETE FROM media_queue WHERE user_id=? AND id=?',actor.id,row.id);
    });
    return this.queue(actor);
  }
  remove(actor:MediaActor,id:string){this.db.run('DELETE FROM media_queue WHERE id=? AND user_id=?',id,actor.id);return this.queue(actor);}
}
