import { randomUUID } from 'node:crypto';
import { matchEvidence } from './match-evidence.ts';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { MediaCatalog } from './catalog.ts';
import type { MediaItemKind } from './catalog.ts';
import type { MediaActor } from './libraries.ts';
import { MetadataHttp, MusicBrainzProvider, TmdbProvider } from './metadata-providers.ts';
import type { MetadataCandidate, MetadataProvider } from './metadata-providers.ts';

interface CandidateRow { id: string; item_id: string; actor_id: string; provider: string; external_id: string; expires_at: number }

/** Search stores reviewable candidates. Only a confirmed, item-bound candidate may publish metadata. */
export class MediaScraping {
  private readonly providers: MetadataProvider[];
  constructor(private readonly db:MediaDatabase, private readonly catalog: MediaCatalog, providers?: MetadataProvider[]) {
    const http = new MetadataHttp();
    this.providers = providers ?? [new TmdbProvider(http), new MusicBrainzProvider(http)];
    db.run(`CREATE TABLE IF NOT EXISTS media_scrape_candidates (
      id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,provider TEXT NOT NULL,external_id TEXT NOT NULL,expires_at INTEGER NOT NULL)`);
    db.run('CREATE INDEX IF NOT EXISTS media_scrape_expiry ON media_scrape_candidates(expires_at)');
    if(!db.all<{name:string}>('PRAGMA table_info(media_scrape_candidates)').some(column=>column.name==='preview_json'))
      db.run('ALTER TABLE media_scrape_candidates ADD COLUMN preview_json TEXT');
  }
  private admin(actor: MediaActor) {
    if (actor.role !== 'admin') throw forbidden('admin role required', 'ADMIN_REQUIRED');
  }
  status(actor: MediaActor) {
    this.admin(actor);
    return { items: this.providers.map(({ id, label, kinds, configured }) => ({ id, label, kinds, configured })) };
  }
  candidates(actor:MediaActor,itemId:string){
    this.admin(actor);const item=this.catalog.detail(actor,itemId);
    const rows=this.db.all<CandidateRow&{preview_json:string|null}>('SELECT * FROM media_scrape_candidates WHERE item_id=? AND actor_id=? AND expires_at>? ORDER BY rowid LIMIT 20',itemId,actor.id,Date.now());
    return {items:rows.flatMap(row=>{
      if(!row.preview_json)return [];
      if(row.provider==='tmdb'&&(item.kind==='season'||item.kind==='episode')){
        try{if(this.tmdbChildId(actor,itemId)!==row.external_id)return [];}catch{return [];}
      }
      const candidate=JSON.parse(row.preview_json) as MetadataCandidate;
      return [{...candidate,candidateId:row.id,provider:row.provider,expiresAt:row.expires_at,evidence:matchEvidence(item,candidate)}];
    })};
  }
  private provider(id: string, kind: MediaItemKind): MetadataProvider {
    const provider = this.providers.find(p => p.id === id && p.kinds.includes(kind));
    if (!provider) throw badRequest('此来源不支持当前条目', 'MEDIA_PROVIDER_UNSUPPORTED');
    if (!provider.configured) throw badRequest('刮削来源尚未配置', 'MEDIA_PROVIDER_NOT_CONFIGURED');
    return provider;
  }
  private tmdbChildId(actor:MediaActor,itemId:string):string {
    const item=this.catalog.detail(actor,itemId);
    const season=item.kind==='season'?item:item.parentId?this.catalog.detail(actor,item.parentId):null;
    const series=season?.parentId?this.catalog.detail(actor,season.parentId):null;
    const match=series?.metadata.onlineMatch as {provider?:string;externalId?:string}|undefined;
    if(season?.kind!=='season'||series?.kind!=='series'||match?.provider!=='tmdb'||!match.externalId||!/^[1-9]\d{0,12}$/.test(match.externalId))
      throw badRequest('请先为所属剧集确认 TMDB 匹配','MEDIA_PARENT_MATCH_REQUIRED');
    if(!Number.isInteger(season.ordinal)||season.ordinal<0||season.ordinal>9999||(item.kind==='episode'&&(!Number.isInteger(item.ordinal)||item.ordinal<1||item.ordinal>99999)))throw badRequest('季集编号无效');
    return match.externalId+'/season/'+season.ordinal+(item.kind==='episode'?'/episode/'+item.ordinal:'');
  }
  private clearDependentTmdb(seriesId:string,externalId:string){
    if(!/^[1-9]\d{0,12}$/.test(externalId))return;
    const children=this.db.all<{id:string}>(`SELECT id FROM media_items WHERE parent_id=? AND kind='season'
      UNION SELECT episode.id FROM media_items episode JOIN media_items season ON season.id=episode.parent_id WHERE season.parent_id=? AND season.kind='season' AND episode.kind='episode'`,seriesId,seriesId);
    for(const child of children){
      // Compound ids prove this metadata was derived from the old series.
      this.db.run("DELETE FROM media_online_metadata WHERE item_id=? AND provider='tmdb' AND external_id LIKE ?",child.id,externalId+'/season/%');
      this.db.run("DELETE FROM media_scrape_candidates WHERE item_id=? AND provider='tmdb' AND external_id LIKE ?",child.id,externalId+'/season/%');
    }
  }
  async search(actor: MediaActor, itemId: string, providerId: string, query: string, signal?:AbortSignal, beforePublish?:()=>void, artist?:string) {
    signal?.throwIfAborted();
    this.admin(actor);
    const item = this.catalog.detail(actor, itemId);
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw badRequest('搜索词应为 1 到 200 字');
    if(artist!==undefined&&(typeof artist!=='string'||artist.length>200||providerId!=='musicbrainz'||!['track','album'].includes(item.kind)))throw badRequest('艺人限定仅支持 MusicBrainz 曲目和专辑，最多 200 字符');
    const provider = this.provider(providerId, item.kind);
    const child=providerId==='tmdb'&&(item.kind==='season'||item.kind==='episode');
    let candidates:MetadataCandidate[];
    if(child){
      const metadata=await provider.detail(item.kind,this.tmdbChildId(actor,itemId),signal);
      candidates=[{externalId:metadata.externalId,title:String(metadata.fields.title??''),description:String(metadata.fields.plot??''),...(typeof metadata.fields.year==='number'?{year:metadata.fields.year}:{})}];
    }else candidates=await provider.search(item.kind, query.trim(),signal,artist?.trim());
    this.catalog.detail(actor, itemId);
    const expiresAt = Date.now() + 30 * 60_000;
    return this.db.transaction(() => {
      signal?.throwIfAborted();beforePublish?.();
      this.db.run('DELETE FROM media_scrape_candidates WHERE expires_at<? OR (item_id=? AND actor_id=?)', Date.now(), itemId, actor.id);
      const items = candidates.slice(0, 20).map((candidate: MetadataCandidate) => {
        const candidateId = randomUUID();
        this.db.run('INSERT INTO media_scrape_candidates(id,item_id,actor_id,provider,external_id,expires_at,preview_json) VALUES(?,?,?,?,?,?,?)', candidateId, itemId, actor.id, providerId, candidate.externalId, expiresAt,JSON.stringify(candidate));
        return { ...candidate, candidateId, provider: providerId, evidence:matchEvidence(item,candidate) };
      });
      return { items, expiresAt, truncated:candidates.length>=20 };
    });
  }
  async autoMatch(actor:MediaActor,itemId:string,providerId:string,signal?:AbortSignal,beforePublish?:()=>void) {
    signal?.throwIfAborted();this.admin(actor);
    const item=this.catalog.detail(actor,itemId);
    if(item.metadata.onlineMatch)return {status:'unchanged',item};
    const result=await this.search(actor,itemId,providerId,item.title.slice(0,200),signal,beforePublish);
    signal?.throwIfAborted();
    if(!result.items.length&&!result.truncated)return {status:'unmatched',...result};
    // Numbering can differ between local editions and the provider. A parent
    // match locates candidates, but does not authorize publishing every child.
    if(providerId==='tmdb'&&(item.kind==='season'||item.kind==='episode'))return {status:'review',...result};
    const strong=result.items.filter(candidate=>candidate.evidence.level==='strong');
    if(result.truncated||strong.length!==1)return {status:'review',...result};
    try{return {status:'matched',item:await this.confirm(actor,itemId,strong[0]!.candidateId,true,signal,beforePublish)};}
    catch(error){if((error as {code?:string}).code==='MEDIA_MATCH_REVIEW')return {status:'review',...result};throw error;}
  }
  async confirm(actor: MediaActor, itemId: string, candidateId: string, automatic=false, signal?:AbortSignal, beforePublish?:()=>void) {
    this.admin(actor);
    const item = this.catalog.detail(actor, itemId);
    const candidate = this.db.get<CandidateRow>('SELECT * FROM media_scrape_candidates WHERE id=? AND item_id=? AND actor_id=?', candidateId, itemId, actor.id);
    if (!candidate) throw notFound('候选不存在，请重新搜索');
    if (candidate.expires_at <= Date.now()) throw conflict('候选已过期，请重新搜索', 'MEDIA_CANDIDATE_EXPIRED');
    const provider = this.provider(candidate.provider, item.kind);
    const child=candidate.provider==='tmdb'&&(item.kind==='season'||item.kind==='episode');
    if(child&&this.tmdbChildId(actor,itemId)!==candidate.external_id)throw conflict('所属剧集匹配已变化，请重新获取候选','MEDIA_PARENT_MATCH_CHANGED');
    const metadata = await provider.detail(item.kind, candidate.external_id,signal);
    if (metadata.externalId !== candidate.external_id) throw badRequest('来源条目不匹配');
    // Search/reset in another request invalidates an in-flight confirmation.
    this.db.transaction(() => {
      signal?.throwIfAborted();beforePublish?.();
      const latest=this.catalog.detail(actor, itemId);
      if(child&&this.tmdbChildId(actor,itemId)!==candidate.external_id)throw conflict('所属剧集匹配已变化，请重新获取候选','MEDIA_PARENT_MATCH_CHANGED');
      if(automatic){
        const evidence=matchEvidence(latest,{externalId:metadata.externalId,title:String(metadata.fields.title??''),
          ...(typeof metadata.fields.year==='number'?{year:metadata.fields.year}:{}),
          ...(typeof metadata.fields.artist==='string'?{artist:metadata.fields.artist}:{} )});
        if(latest.metadata.onlineMatch||evidence.level!=='strong')throw conflict('详情匹配依据不足，请人工确认','MEDIA_MATCH_REVIEW');
      }
      const current = this.db.get<CandidateRow>('SELECT * FROM media_scrape_candidates WHERE id=?', candidateId);
      if (!current || current.expires_at <= Date.now()) throw conflict('候选已更新，请重新搜索', 'MEDIA_CANDIDATE_EXPIRED');
      const previous=latest.metadata.onlineMatch as {provider?:string;externalId?:string}|undefined;
      if(latest.kind==='series'&&previous?.provider==='tmdb'&&previous.externalId&&(provider.id!=='tmdb'||previous.externalId!==metadata.externalId))
        this.clearDependentTmdb(itemId,previous.externalId);
      this.db.run(`INSERT INTO media_online_metadata VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET
        provider=excluded.provider,external_id=excluded.external_id,source_url=excluded.source_url,
        fields_json=excluded.fields_json,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at`,
      itemId, provider.id, metadata.externalId, metadata.sourceUrl, JSON.stringify(metadata.fields), actor.id, Date.now());
      this.db.run('DELETE FROM media_scrape_candidates WHERE item_id=?', itemId);
    });
    return this.catalog.detail(actor, itemId);
  }
  clear(actor: MediaActor, itemId: string) {
    this.admin(actor);
    this.db.transaction(() => {
      const item=this.catalog.detail(actor,itemId),previous=item.metadata.onlineMatch as {provider?:string;externalId?:string}|undefined;
      if(item.kind==='series'&&previous?.provider==='tmdb'&&previous.externalId)this.clearDependentTmdb(itemId,previous.externalId);
      this.db.run('DELETE FROM media_online_metadata WHERE item_id=?', itemId);
      this.db.run('DELETE FROM media_scrape_candidates WHERE item_id=?', itemId);
    });
    return this.catalog.detail(actor, itemId);
  }
}
