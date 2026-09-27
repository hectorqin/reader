import { createHash,randomBytes,randomUUID } from 'node:crypto';
import type { MediaDatabase } from './read-database.ts';
import { badRequest,unauthorized } from '../lib/errors.ts';
import type { MediaActor } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import { DatabaseMediaAccounts } from './accounts.ts';
import type { MediaAccounts } from './accounts.ts';

const TTL=24*60*60*1000;
interface Grant {id:string;user_id:string;auth_version:number;expires_at:number;parts_json:string;revoked:number}
/** A separate credential namespace; never accepted by ordinary login middleware. */
export class MediaBackgroundGrants {
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries,private readonly accounts:MediaAccounts=new DatabaseMediaAccounts(db)){
    db.run(`CREATE TABLE IF NOT EXISTS media_background_grants(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,auth_version INTEGER NOT NULL,expires_at INTEGER NOT NULL,parts_json TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)`);
    db.run('CREATE INDEX IF NOT EXISTS media_background_expiry ON media_background_grants(expires_at)');
  }
  private hash(token:string){return createHash('sha256').update(token).digest('hex');}
  private part(actor:MediaActor,partId:string){
    const part=this.db.get<{library_id:string}>(`SELECT a.library_id FROM media_parts p JOIN media_assets a ON a.id=p.asset_id WHERE p.id=? AND p.active=1 AND a.available=1`,partId);
    if(!part)throw unauthorized('background resource unavailable','MEDIA_BACKGROUND_SCOPE');
    this.libraries.get(actor,part.library_id);
  }
  create(actor:MediaActor,partIds:string[]){
    if(!Array.isArray(partIds)||!partIds.length||partIds.length>2000||partIds.some(id=>typeof id!=='string'||!id||id.length>100))throw badRequest('invalid background playlist');
    const parts=[...new Set(partIds)],now=Date.now();
    return this.db.transaction(()=>{
      const user=this.accounts.get(actor.id);
      if(!user||user.disabled)throw unauthorized();
      for(const id of parts)this.part(actor,id);
      this.db.run('DELETE FROM media_playback_sessions WHERE id IN (SELECT session_id FROM media_background_sessions WHERE expires_at<=?)',now);
      this.db.run('DELETE FROM media_background_grants WHERE expires_at<=? OR revoked=1',now);
      const count=this.db.get<{n:number}>('SELECT count(*) n FROM media_background_grants WHERE user_id=?',actor.id)!.n;
      if(count>=20)throw badRequest('后台播放授权过多，请结束其他播放后重试','MEDIA_BACKGROUND_LIMIT');
      const id=randomUUID(),token=randomBytes(32).toString('base64url'),expiresAt=now+TTL;
      this.db.run('INSERT INTO media_background_grants(id,user_id,token_hash,auth_version,expires_at,parts_json) VALUES(?,?,?,?,?,?)',id,actor.id,this.hash(token),user.auth_version,expiresAt,JSON.stringify(parts));
      return {id,token,expiresAt};
    });
  }
  private grant(token:string):{grant:Grant;actor:MediaActor}{
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw unauthorized('invalid background credential','MEDIA_BACKGROUND_INVALID');
    const grant=this.db.get<Grant>('SELECT * FROM media_background_grants WHERE token_hash=?',this.hash(token));
    if(!grant||grant.revoked||grant.expires_at<=Date.now())throw unauthorized('background authorization expired','MEDIA_BACKGROUND_INVALID');
    const user=this.accounts.get(grant.user_id);
    if(!user||user.disabled||user.auth_version!==grant.auth_version)throw unauthorized('background authorization revoked','MEDIA_BACKGROUND_INVALID');
    return {grant,actor:{id:user.id,role:user.role}};
  }
  authorizePart(token:string,partId:string){
    const {grant,actor}=this.grant(token);
    if(!(JSON.parse(grant.parts_json) as string[]).includes(partId))throw unauthorized('part outside background playlist','MEDIA_BACKGROUND_SCOPE');
    this.part(actor,partId);return actor;
  }
  authorizeSession(token:string,sessionId:string){
    const {actor,grant}=this.grant(token);
    const session=this.db.get<{part_id:string}>('SELECT part_id FROM media_playback_sessions WHERE id=? AND user_id=?',sessionId,actor.id);
    if(!session)throw unauthorized('session outside background playlist','MEDIA_BACKGROUND_SCOPE');
    this.authorizePart(token,session.part_id);
    const bound=this.db.get<{grant_id:string}>('SELECT grant_id FROM media_background_sessions WHERE session_id=?',sessionId);
    if(bound&&bound.grant_id!==grant.id)throw unauthorized('session belongs to another background authorization','MEDIA_BACKGROUND_SCOPE');
    this.db.run('INSERT OR IGNORE INTO media_background_sessions(session_id,grant_id,expires_at) VALUES(?,?,?)',sessionId,grant.id,grant.expires_at);
    return actor;
  }
  revoke(token:string){
    if(typeof token!=='string'||token.length!==43)throw unauthorized();
    this.db.transaction(()=>{
      this.db.run('DELETE FROM media_playback_sessions WHERE id IN (SELECT s.session_id FROM media_background_sessions s JOIN media_background_grants g ON g.id=s.grant_id WHERE g.token_hash=?)',this.hash(token));
      this.db.run('UPDATE media_background_grants SET revoked=1 WHERE token_hash=?',this.hash(token));
    });
  }
}
