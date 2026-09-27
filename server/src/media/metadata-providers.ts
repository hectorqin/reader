import { setTimeout as delay } from 'node:timers/promises';
import { AppError, badRequest } from '../lib/errors.ts';
import type { MediaItemKind } from './catalog.ts';

export interface MetadataCandidate {
  externalId: string;
  title: string;
  year?: number;
  artist?: string;
  description?: string;
}
export interface OnlineMetadata {
  fields: Record<string, string | number>;
  externalId: string;
  sourceUrl: string;
}
export interface MetadataProvider {
  id: string;
  label: string;
  kinds: MediaItemKind[];
  configured: boolean;
  search(kind: MediaItemKind, query: string, signal?:AbortSignal, artist?:string): Promise<MetadataCandidate[]>;
  detail(kind: MediaItemKind, externalId: string, signal?:AbortSignal): Promise<OnlineMetadata>;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 32000) : '';
const list = (value: unknown): JsonObject[] => Array.isArray(value) ? value.slice(0, 100).map(object) : [];
const year = (value: unknown): number | undefined => {
  const match = /^(\d{4})/.exec(string(value));
  return match ? Number(match[1]) : undefined;
};
const unavailable = () => new AppError(502, 'MEDIA_PROVIDER_UNAVAILABLE', '刮削服务暂时不可用，请稍后重试');

/** Only provider-owned fixed origins are accepted; never follow redirects with credentials. */
export class MetadataHttp {
  private musicBrainzNext = 0;
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async json(url: URL, headers: Record<string, string>, signal?:AbortSignal): Promise<JsonObject> {
    if (!['https://api.themoviedb.org', 'https://musicbrainz.org'].includes(url.origin)) throw badRequest('invalid provider origin');
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      if (url.hostname === 'musicbrainz.org') {
        // Reserve before awaiting so concurrent callers obey MusicBrainz's one-request/second limit.
        const now = Date.now(), scheduled = Math.max(now, this.musicBrainzNext);
        if (scheduled - now > 10_000) throw new AppError(429, 'MEDIA_PROVIDER_BUSY', '刮削请求较多，请稍后重试');
        this.musicBrainzNext = scheduled + 1100;
        if (scheduled > now) await delay(scheduled - now,undefined,{signal});
      }
      try {
        const response = await this.fetcher(url, { headers, redirect: 'error', signal: signal?AbortSignal.any([signal,AbortSignal.timeout(12_000)]):AbortSignal.timeout(12_000) });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          if (attempt === 2) throw unavailable();
          const retry = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retry) && retry > 5) throw unavailable();
          await delay(Math.max((attempt + 1) * 500, Number.isFinite(retry) ? retry * 1000 : 0),undefined,{signal});
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) throw new AppError(404, 'MEDIA_PROVIDER_NOT_FOUND', '来源条目已不存在，请重新搜索');
          throw unavailable();
        }
        if (!response.body || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) {
          await response.body?.cancel();
          throw unavailable();
        }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > 2 * 1024 * 1024) throw unavailable();
            chunks.push(chunk.value);
          }
        } finally { await reader.cancel(); }
        return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof AppError) throw error;
        if (attempt === 2) throw unavailable();
        await delay((attempt + 1) * 500,undefined,{signal});
      }
    }
    throw unavailable();
  }
}

export class TmdbProvider implements MetadataProvider {
  readonly id = 'tmdb';
  readonly label = 'TMDB';
  readonly kinds: MediaItemKind[] = ['movie', 'series', 'season', 'episode'];
  get configured() { return !!(this.token || this.apiKey); }
  constructor(private readonly http: MetadataHttp, private readonly token = process.env.MEDIA_TMDB_TOKEN || '', private readonly apiKey = process.env.MEDIA_TMDB_API_KEY || '') {}
  private endpoint(kind: MediaItemKind): string {
    if (!this.configured) throw badRequest('请先配置 MEDIA_TMDB_TOKEN 或 MEDIA_TMDB_API_KEY', 'MEDIA_PROVIDER_NOT_CONFIGURED');
    if (!this.kinds.includes(kind)) throw badRequest('TMDB 不支持此条目类型');
    return kind === 'movie' ? 'movie' : 'tv';
  }
  private request(path: string, query?: string, signal?:AbortSignal) {
    const url = new URL('https://api.themoviedb.org/3/' + path);
    url.searchParams.set('language', 'zh-CN');
    if (query) url.searchParams.set('query', query);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    else url.searchParams.set('api_key', this.apiKey);
    return this.http.json(url, headers,signal);
  }
  async search(kind: MediaItemKind, query: string, signal?:AbortSignal): Promise<MetadataCandidate[]> {
    if(kind==='season'||kind==='episode')throw badRequest('季集需从已确认的剧集匹配获取');
    const response = await this.request('search/' + this.endpoint(kind), query,signal);
    return list(response.results).slice(0, 20).filter(row => Number.isSafeInteger(row.id) && Number(row.id) > 0).map(row => ({
      externalId: String(row.id), title: string(row.title || row.name), year: year(row.release_date || row.first_air_date), description: string(row.overview),
    })).filter(row => row.title);
  }
  async detail(kind: MediaItemKind, id: string, signal?:AbortSignal): Promise<OnlineMetadata> {
    const entity = this.endpoint(kind);
    if(kind==='season'||kind==='episode'){
      const match=/^([1-9]\d{0,12})\/season\/(\d{1,4})(?:\/episode\/([1-9]\d{0,4}))?$/.exec(id);
      if(!match||(kind==='episode')!==!!match[3])throw badRequest('invalid TMDB season/episode id');
      const row=await this.request('tv/'+id,undefined,signal),title=string(row.name);
      if(!title||row.season_number!==Number(match[2])||(kind==='episode'&&row.episode_number!==Number(match[3])))throw unavailable();
      const fields:OnlineMetadata['fields']={title};
      if(string(row.overview))fields.plot=string(row.overview);
      const releaseYear=year(row.air_date);if(releaseYear!==undefined)fields.year=releaseYear;
      const poster=string(kind==='episode'?row.still_path:row.poster_path);
      if(/^\/[a-zA-Z0-9_-]{1,160}\.(jpg|png|webp)$/.test(poster))fields.tmdbPosterPath=poster;
      return {externalId:id,fields,sourceUrl:'https://www.themoviedb.org/tv/'+id};
    }
    if (!/^[1-9]\d{0,12}$/.test(id)) throw badRequest('invalid TMDB id');
    const row = await this.request(entity + '/' + id,undefined,signal), title = string(row.title || row.name);
    if (!title || String(row.id) !== id) throw unavailable();
    const fields: OnlineMetadata['fields'] = { title };
    const releaseYear = year(row.release_date || row.first_air_date);
    if (releaseYear !== undefined) fields.year = releaseYear;
    if (string(row.overview)) fields.plot = string(row.overview);
    const poster=string(row.poster_path);
    if(/^\/[a-zA-Z0-9_-]{1,160}\.(jpg|png|webp)$/.test(poster))fields.tmdbPosterPath=poster;
    return { fields, externalId: id, sourceUrl: `https://www.themoviedb.org/${entity}/${id}` };
  }
}

export class MusicBrainzProvider implements MetadataProvider {
  readonly id = 'musicbrainz';
  readonly label = 'MusicBrainz';
  readonly kinds: MediaItemKind[] = ['artist', 'album', 'track', 'audiobook'];
  get configured() { return !!this.userAgent; }
  constructor(private readonly http: MetadataHttp, private readonly userAgent = process.env.MEDIA_MUSICBRAINZ_USER_AGENT || '') {}
  private entity(kind: MediaItemKind): string {
    if (!this.configured) throw badRequest('请先配置包含联系地址的 MEDIA_MUSICBRAINZ_USER_AGENT', 'MEDIA_PROVIDER_NOT_CONFIGURED');
    if (!this.kinds.includes(kind)) throw badRequest('MusicBrainz 不支持此条目类型');
    return kind === 'artist' ? 'artist' : kind === 'track' ? 'recording' : 'release-group';
  }
  private request(entity: string, query: Record<string, string>, signal?:AbortSignal) {
    const url = new URL('https://musicbrainz.org/ws/2/' + entity);
    url.searchParams.set('fmt', 'json');
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return this.http.json(url, { 'User-Agent': this.userAgent, Accept: 'application/json' },signal);
  }
  private artist(row: JsonObject): string {
    return list(row['artist-credit']).map(credit => string(object(credit.artist).name) + (typeof credit.joinphrase === 'string' ? credit.joinphrase.slice(0, 100) : '')).join('').slice(0, 32000);
  }
  async search(kind: MediaItemKind, query: string, signal?:AbortSignal, artist?:string): Promise<MetadataCandidate[]> {
    const entity = this.entity(kind);
    if(artist&&(artist.length>200||!['track','album'].includes(kind)))throw badRequest('艺人限定仅支持曲目和专辑，最多 200 字符');
    const escaped = query.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
    const escapedArtist=artist?.trim().replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
    const expression = `${entity === 'artist' ? 'artist' : entity === 'recording' ? 'recording' : 'releasegroup'}:"${escaped}"${kind === 'audiobook' ? ' AND secondarytype:audiobook' : ''}${escapedArtist?' AND artist:"'+escapedArtist+'"':''}`;
    const result = await this.request(entity, { query: expression, limit: '20' },signal);
    return list(result[entity === 'release-group' ? 'release-groups' : entity + 's']).filter(row => /^[a-f0-9-]{36}$/i.test(string(row.id))).map(row => ({
      externalId: string(row.id), title: string(row.title || row.name), year: year(row['first-release-date']), artist: this.artist(row), description: string(row.disambiguation),
    })).filter(row => row.title);
  }
  async detail(kind: MediaItemKind, id: string, signal?:AbortSignal): Promise<OnlineMetadata> {
    const entity = this.entity(kind);
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw badRequest('invalid MusicBrainz id');
    const row = await this.request(entity + '/' + id, entity === 'artist' ? {} : { inc: 'artists' },signal);
    const title = string(row.title || row.name);
    if (!title || string(row.id) !== id) throw unavailable();
    const fields: OnlineMetadata['fields'] = { title };
    const releaseYear = year(row['first-release-date']), artist = this.artist(row);
    if(entity==='artist'){
      const type=string(row.type),area=string(object(row.area).name),disambiguation=string(row.disambiguation);
      if(type)fields.artistType=type;
      if(area)fields.artistArea=area;
      if(disambiguation)fields.artistDisambiguation=disambiguation;
    }
    if (releaseYear !== undefined) fields.year = releaseYear;
    if (artist) fields.artist = artist;
    if(entity==='release-group')fields.musicBrainzCoverGroupId=id;
    return { fields, externalId: id, sourceUrl: `https://musicbrainz.org/${entity}/${id}` };
  }
}
