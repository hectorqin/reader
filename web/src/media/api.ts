import type { ReaderApi } from '../api/client.ts';

export type MediaChannel = 'video' | 'music' | 'audiobook';
export interface Library {id:string;name:string;kind:MediaChannel;access:'all'|'restricted';storage?:'local'|'openlist'}
export interface LibraryConfiguration extends Library {storage:'local'|'openlist';root:string;openlist?:{baseUrl:string;hasToken:boolean;hasPassword:boolean}}
export interface Item {id:string;libraryId:string;libraryName?:string;kind:string;title:string;parentId:string|null;ordinal?:number;metadata:Record<string,unknown>;overrides:Record<string,unknown>}
export interface Part {id:string;assetId:string;title:string;start:number;end:number|null;available:boolean}
export interface SearchItem extends Item {channel:MediaChannel;libraryName:string}
export interface Edition {id:string;label:string;parts:Part[];revision?:string}
export interface Detail extends Item {children:Item[];editions:Edition[]}
export interface Narrator {name:string;works:number;editions:number}
export interface ScanDiagnostics {
  elapsedMs:number;active:Array<{phase:string;ref?:string;elapsedMs:number}>;
  timings:Record<string,number>;logs:Array<{at:number;message:string}>;
}
export interface ScanJob {id:string;libraryId?:string;state:string;inspected:number;error:string|null;diagnostics?:ScanDiagnostics}
export interface Playback {id:string;itemId?:string;partId:string;streamUrl:string;contentType:string;expiresAt:number;position:number;start:number;end:number|null;revision:number;playbackMode?:'auto'|'direct'|'proxy'}
export interface Progress {position:number;revision:number;completed:boolean}
export interface MediaAccount {username:string;displayName:string;role:'admin'|'member';server:string}

export class MediaApi {
  constructor(private readonly reader:ReaderApi) {}
  businessSettingsRequest<T>(path='',method='GET',body?:unknown,signal?:AbortSignal){return this.reader.businessSettingsRequest<T>(path,method,body,signal);}
  businessTtsPreview(values:Record<string,unknown>,voice:string){return this.reader.businessTtsPreview(values,voice);}
  preferenceScope(){return JSON.stringify([this.reader.baseUrl,this.reader.currentSession()?.user.id??'anonymous']);}
  accountInfo():MediaAccount|null {const user=this.reader.currentSession()?.user;return user?{username:user.username,displayName:user.displayName,role:user.role,server:this.reader.baseUrl}:null;}
  request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
    return this.reader.mediaRequest<T>('/api/v1/media/'+path,method,body,signal?{signal}:{});
  }
  libraries(signal?:AbortSignal){return this.request<{items:Library[]}>('libraries','GET',undefined,signal);}
  users(){return this.reader.adminUsers();}
  search(query:string,channel:MediaChannel|'all',offset=0,signal?:AbortSignal,kind?:string){
    const params=new URLSearchParams({query,offset:String(offset),limit:'60'});
    if(channel!=='all')params.set('channel',channel);
    if(kind)params.set('kind',kind);
    return this.request<{items:SearchItem[];total:number}>('search?'+params,'GET',undefined,signal);
  }
  items(libraryId:string,kind:string,search:string,offset=0,signal?:AbortSignal,sort='default',filters:{artist?:string;album?:string}={}){
    const q=new URLSearchParams({kind,search,offset:String(offset),limit:'60',sort});
    if(filters.artist)q.set('artist',filters.artist);if(filters.album)q.set('album',filters.album);
    return this.request<{items:Item[];total:number}>(`libraries/${encodeURIComponent(libraryId)}/items?${q}`,'GET',undefined,signal);
  }
  browse(channel:MediaChannel,kind:string,offset=0,signal?:AbortSignal,sort='default',filters:{artist?:string;album?:string}={}){
    const query=new URLSearchParams({channel,kind,offset:String(offset),limit:'60',sort});
    if(filters.artist)query.set('artist',filters.artist);if(filters.album)query.set('album',filters.album);
    return this.request<{items:SearchItem[];total:number}>('browse?'+query,'GET',undefined,signal);
  }
  detail(id:string,signal?:AbortSignal){return this.request<Detail>('items/'+encodeURIComponent(id),'GET',undefined,signal);}
  narrators(libraryId:string,search:string,offset:number,signal?:AbortSignal){
    const query=new URLSearchParams({search,offset:String(offset),limit:'60'});
    return this.request<{items:Narrator[];total:number}>((libraryId?`libraries/${encodeURIComponent(libraryId)}/`:'')+`narrators?${query}`,'GET',undefined,signal);
  }
  narratorWorks(libraryId:string,name:string,offset:number,signal?:AbortSignal){
    const query=new URLSearchParams({name,offset:String(offset),limit:'60'});
    return this.request<{items:Detail[];total:number}>((libraryId?`libraries/${encodeURIComponent(libraryId)}/`:'')+`narrators?${query}`,'GET',undefined,signal);
  }
  cover(id:string,signal?:AbortSignal){return this.reader.coverBytes(`/api/v1/media/items/${encodeURIComponent(id)}/cover`,signal?{signal}:{});}
  playback(partId:string,signal?:AbortSignal){return this.request<Playback>('playback','POST',{partId},signal);}
  nativePlan(session:Playback){
    return {...session,...this.nativeCredentials()};
  }
  nativeCredentials(){
    const login=this.reader.currentSession();
    if(!login)throw new Error('请先登录');
    return {baseUrl:this.reader.baseUrl.replace(/\/+$/,''),accessToken:login.accessToken,userId:login.user.id};
  }
  streamUrl(session:Playback):string {
    // The server returns a same-origin relative URL, never a plugin-controlled URL.
    if(!session.streamUrl.startsWith('/api/v1/media/streams/'))throw new Error('无效的播放地址');
    return this.reader.baseUrl.replace(/\/$/,'')+session.streamUrl;
  }
}
