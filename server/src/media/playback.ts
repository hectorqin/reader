import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.ts';
import type { MediaActor } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import { DatabaseMediaAccounts } from './accounts.ts';
import type { MediaAccounts } from './accounts.ts';
import type { ByteRange } from './storage/types.ts';

const CONTENT_TYPES:Record<string,string>={'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska','.mov':'video/quicktime','.avi':'video/x-msvideo','.ts':'video/mp2t','.m2ts':'video/mp2t','.mpg':'video/mpeg','.mpeg':'video/mpeg','.mp3':'audio/mpeg','.m4a':'audio/mp4','.m4b':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac','.ogg':'audio/ogg','.opus':'audio/ogg','.wav':'audio/wav','.aiff':'audio/aiff','.wma':'audio/x-ms-wma'};
interface Part {id:string;item_id:string;edition_id:string;asset_id:string;start_seconds:number;end_seconds:number|null;ref:string;library_id:string;available:number;size:number;title:string}
interface ProgressRow {user_id:string;part_id:string;position:number;completed:number;revision:number;session_id:string;updated_at:number}
interface SessionRow {id:string;user_id:string;part_id:string;token_hash:string;expires_at:number;auth_version:number;sequence:number;created_at:number}
const SESSION_TTL=6*60*60*1000;
const RENEWAL_GRACE=24*60*60*1000;

/** RFC single byte-range support. Multi-range is rejected rather than partially served. */
export function parseMediaRange(header:string|undefined,size:number):ByteRange|undefined {
  if(header===undefined)return undefined;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if(!match||(!match[1]&&!match[2])||size===0)throw badRequest('unsatisfiable byte range','MEDIA_RANGE');
  let start:number,end:number;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)throw badRequest('unsatisfiable byte range','MEDIA_RANGE');start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw badRequest('unsatisfiable byte range','MEDIA_RANGE');
  return {start,end};
}

export class MediaPlayback {
  private readonly directLinks=new Map<string,{url:string;expires:number}>();
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,private readonly accounts:MediaAccounts=new DatabaseMediaAccounts(db),private readonly playbackMode:()=> 'auto'|'direct'|'proxy'=()=> 'proxy') {
    db.transaction(()=>{
      db.run(`CREATE TABLE IF NOT EXISTS media_playback_sessions (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        part_id TEXT NOT NULL REFERENCES media_parts(id),token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,auth_version INTEGER NOT NULL,sequence INTEGER NOT NULL DEFAULT -1,created_at INTEGER NOT NULL)`);
      db.run(`CREATE TABLE IF NOT EXISTS media_progress (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,part_id TEXT NOT NULL REFERENCES media_parts(id),
        position REAL NOT NULL,completed INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,
        session_id TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,part_id))`);
      db.run(`CREATE INDEX IF NOT EXISTS media_session_expiry ON media_playback_sessions(expires_at)`);
      db.run('CREATE INDEX IF NOT EXISTS media_progress_recent ON media_progress(user_id,updated_at DESC,part_id)');
      db.run(`CREATE TABLE IF NOT EXISTS media_background_sessions(session_id TEXT PRIMARY KEY REFERENCES media_playback_sessions(id) ON DELETE CASCADE,grant_id TEXT NOT NULL,expires_at INTEGER NOT NULL)`);
    });
  }
  private part(actor:MediaActor,id:string):Part {
    const row=this.db.get<Part>(`SELECT p.*,e.item_id,a.ref,a.library_id,a.available,a.size FROM media_parts p JOIN media_editions e ON e.id=p.edition_id JOIN media_assets a ON a.id=p.asset_id WHERE p.id=? AND p.active=1`,id);
    if(!row)throw notFound('media part not found');this.libraries.get(actor,row.library_id);
    return row;
  }
  progress(actor:MediaActor,partId:string) {
    const part=this.part(actor,partId);
    const row=this.db.get<ProgressRow>('SELECT * FROM media_progress WHERE user_id=? AND part_id=?',actor.id,partId);
    return {partId,position:row?.position??part.start_seconds,completed:row?.completed===1,revision:row?.revision??0,updatedAt:row?.updated_at??null};
  }
  recover(actor:MediaActor,partId:string,previousSessionId:string) {
    return this.db.transaction(()=>{
      this.part(actor,partId);
      const old=this.db.get<ProgressRow>('SELECT * FROM media_progress WHERE user_id=? AND part_id=?',actor.id,partId);
      if(!old||old.session_id!==previousSessionId||old.completed)throw conflict('播放已结束或已在其他会话继续，请手动选择内容','PLAYBACK_TAKEN_OVER');
      return this.createSession(actor,partId);
    });
  }
  subtitleAsset(actor:MediaActor,sessionId:string){
    const session=this.db.get<SessionRow>('SELECT * FROM media_playback_sessions WHERE id=? AND user_id=?',sessionId,actor.id);
    if(!session||session.expires_at<Date.now())throw notFound('playback session expired');
    return this.part(actor,session.part_id).asset_id;
  }
  create(actor:MediaActor,partId:string) {
    return this.db.transaction(()=>this.createSession(actor,partId));
  }
  private createSession(actor:MediaActor,partId:string) {
    const part=this.part(actor,partId);
    if(!part.available)throw notFound('media resource is missing','MEDIA_MISSING');
    const user=this.accounts.get(actor.id);
    if(!user||user.disabled)throw unauthorized();
    const id=randomUUID(),token=randomBytes(32).toString('base64url'),now=Date.now(),expiresAt=now+SESSION_TTL;
    const old=this.progress(actor,partId);
    const position=old.completed?part.start_seconds:Math.max(part.start_seconds,Math.min(old.position,part.end_seconds??Number.MAX_SAFE_INTEGER));
      this.db.run('DELETE FROM media_playback_sessions WHERE expires_at<?',now-RENEWAL_GRACE);
      this.db.run('INSERT INTO media_playback_sessions(id,user_id,part_id,token_hash,expires_at,auth_version,created_at) VALUES(?,?,?,?,?,?,?)',id,actor.id,partId,this.hash(token),expiresAt,user.auth_version,now);
      this.db.run(`INSERT INTO media_progress(user_id,part_id,position,completed,revision,session_id,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(user_id,part_id) DO UPDATE SET position=excluded.position,completed=excluded.completed,revision=excluded.revision,session_id=excluded.session_id,updated_at=excluded.updated_at`,actor.id,partId,position,0,old.revision+1,id,now);
    return {id,partId,itemId:part.item_id,editionId:part.edition_id,assetId:part.asset_id,contentType:CONTENT_TYPES[extname(part.ref).toLowerCase()]||'application/octet-stream',
      streamUrl:`/api/v1/media/streams/${id}?ticket=${token}`,expiresAt,position,start:part.start_seconds,end:part.end_seconds,revision:old.revision+1,mode:'direct' as const,playbackMode:this.playbackMode()};
  }
  update(actor:MediaActor,id:string,input:{sequence:number;revision:number;position:number;completed?:boolean}) {
    const session=this.db.get<SessionRow>('SELECT * FROM media_playback_sessions WHERE id=? AND user_id=?',id,actor.id);
    if(!session||session.expires_at<Date.now())throw notFound('playback session expired');
    const part=this.part(actor,session.part_id);
    if(!Number.isSafeInteger(input.sequence)||input.sequence<0||!Number.isSafeInteger(input.revision)||
      !Number.isFinite(input.position)||input.position<part.start_seconds||(part.end_seconds!==null&&input.position>part.end_seconds+1)||
      (input.completed!==undefined&&typeof input.completed!=='boolean'))throw badRequest('invalid playback progress');
    this.db.transaction(()=>{
      const current=this.db.get<ProgressRow>('SELECT * FROM media_progress WHERE user_id=? AND part_id=?',actor.id,part.id)!;
      if(current.session_id!==id)throw conflict('playback was continued on another session','PLAYBACK_TAKEN_OVER');
      // The last committed request can be retried when its response was lost.
      if(input.sequence===session.sequence&&input.revision+1===current.revision&&
        input.position===current.position&&(input.completed?1:0)===current.completed)return;
      if(input.sequence<=session.sequence)throw conflict('out of order progress update','PLAYBACK_SEQUENCE');
      if(input.revision!==current.revision)throw conflict('progress version changed','PLAYBACK_REVISION');
      this.db.run('UPDATE media_progress SET position=?,completed=?,revision=revision+1,updated_at=? WHERE user_id=? AND part_id=?',input.position,input.completed?1:0,Date.now(),actor.id,part.id);
      this.db.run('UPDATE media_playback_sessions SET sequence=? WHERE id=?',input.sequence,id);
    });
    return this.progress(actor,part.id);
  }
  /** Extend the existing URL without reloading the media element or taking over progress. */
  renew(actor:MediaActor,id:string) {
    const now=Date.now();
    return this.db.transaction(()=>{
      const session=this.db.get<SessionRow>('SELECT * FROM media_playback_sessions WHERE id=? AND user_id=?',id,actor.id);
      if(!session||session.expires_at+RENEWAL_GRACE<=now)throw notFound('playback session expired','MEDIA_SESSION_EXPIRED');
      const user=this.accounts.get(actor.id);
      if(!user||user.disabled||user.auth_version!==session.auth_version)throw unauthorized('media session revoked','MEDIA_TICKET');
      const part=this.part(actor,session.part_id);
      if(!part.available)throw notFound('media resource is missing','MEDIA_MISSING');
      const progress=this.db.get<ProgressRow>('SELECT * FROM media_progress WHERE user_id=? AND part_id=?',actor.id,part.id);
      if(progress?.session_id!==id)throw conflict('playback was continued on another session','PLAYBACK_TAKEN_OVER');
      const expiresAt=Math.max(session.expires_at,now+SESSION_TTL);
      this.db.run('UPDATE media_playback_sessions SET expires_at=? WHERE id=?',expiresAt,id);
      return {id,expiresAt};
    });
  }
  private hash(token:string){return createHash('sha256').update(token).digest('hex');}
  authorizeStream(id:string,ticket:string) {
    const session=this.db.get<SessionRow>('SELECT * FROM media_playback_sessions WHERE id=? AND token_hash=?',id,this.hash(ticket));
    if(!session||session.expires_at<=Date.now())throw unauthorized('media ticket expired','MEDIA_TICKET');
    const background=this.db.get<{expires_at:number}>('SELECT expires_at FROM media_background_sessions WHERE session_id=?',id);
    if(background&&background.expires_at<=Date.now())throw unauthorized('background authorization expired','MEDIA_TICKET');
    const user=this.accounts.get(session.user_id);
    if(!user||user.disabled||user.auth_version!==session.auth_version)throw unauthorized('media session revoked','MEDIA_TICKET');
    const actor:MediaActor={id:user.id,role:user.role};const part=this.part(actor,session.part_id);
    if(!part.available)throw notFound('media resource is missing','MEDIA_MISSING');
    return {actor,part};
  }
  async stream(id:string,ticket:string,rangeHeader?:string) {
    const {actor,part}=this.authorizeStream(id,ticket);
    const storage=await this.libraries.storage(actor,part.library_id);
    const entry=await storage.stat(part.ref);
    const range=parseMediaRange(rangeHeader,entry.size);
    const opened=await storage.open(part.ref,range);
    try { this.authorizeStream(id,ticket); } catch (error) { opened.stream.destroy(); throw error; }
    return {...opened,partial:range!==undefined,contentType:CONTENT_TYPES[extname(part.ref).toLowerCase()]||'application/octet-stream'};
  }
  async directUrl(id:string,ticket:string):Promise<string|undefined>{
    const {actor,part}=this.authorizeStream(id,ticket);
    const cached=this.directLinks.get(id);
    if(cached&&cached.expires>Date.now())return cached.url;
    this.directLinks.delete(id);
    const storage=await this.libraries.storage(actor,part.library_id);
    if(!storage.directUrl)return;
    const url=await storage.directUrl(part.ref);
    this.authorizeStream(id,ticket);
    while(this.directLinks.size>=256)this.directLinks.delete(this.directLinks.keys().next().value!);
    this.directLinks.set(id,{url,expires:Date.now()+30000});
    return url;
  }
}
