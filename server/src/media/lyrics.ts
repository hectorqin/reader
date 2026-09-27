import { posix } from 'node:path';
import type { MediaDatabase } from './read-database.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import type { MediaActor } from './libraries.ts';
import { MediaLibraries } from './libraries.ts';
import type { MediaTechnicalInfo } from './probe.ts';

const MAX_BYTES=512*1024;
export interface Lyrics {synced:boolean;lines:Array<{time:number|null;text:string}>;source:'sidecar'|'embedded'|'none'}
const invalid=()=>badRequest('歌词过大、格式无效或编码不受支持','MEDIA_LYRICS_INVALID');

export function parseLyrics(bytes:Uint8Array):Omit<Lyrics,'source'> {
  if(bytes.length>MAX_BYTES)throw invalid();
  let text:string;
  try{const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{try{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch{throw invalid();}}
  if(text.includes('\0'))throw invalid();
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  if(lines.length>10000)throw invalid();
  let offset=0;
  for(const line of lines){const match=/^\[offset:([+-]?\d+)\]\s*$/i.exec(line.trim());if(match)offset=Math.max(-3600000,Math.min(3600000,Number(match[1])))/1000;}
  const timed:Array<{time:number;text:string}>=[],plain:Array<{time:null;text:string}>=[];
  for(const raw of lines){
    const line=raw.trim();
    if(/^\[(?:ar|al|ti|au|by|re|ve|length|offset):/i.test(line))continue;
    const stamps=[...line.matchAll(/\[(\d{1,5}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const content=line.replace(/\[\d{1,5}:[0-5]\d(?:[.:]\d{1,3})?\]/g,'').trim();
    if(stamps.length){for(const stamp of stamps)timed.push({time:Math.max(0,Number(stamp[1])*60+Number(stamp[2])+Number('0.'+(stamp[3]||'0'))-offset),text:content});}
    else if(line)plain.push({time:null,text:line});
    if(timed.length>10000)throw invalid();
  }
  timed.sort((a,b)=>a.time-b.time);
  // A blank timed line ends the previous lyric during an instrumental passage.
  return {synced:timed.length>0,lines:timed.length?timed:plain};
}

/** Part IDs resolve through the catalog; the client never supplies a file path. */
export class MediaLyrics {
  constructor(private readonly db:MediaDatabase,private readonly libraries:MediaLibraries){}
  private asset(actor:MediaActor,partId:string){
    const asset=this.db.get<{id:string;library_id:string;ref:string;available:number;technical_json:string|null}>(`SELECT a.id,a.library_id,a.ref,a.available,a.technical_json FROM media_assets a JOIN media_parts p ON p.asset_id=a.id WHERE p.id=? AND p.active=1`,partId);
    if(!asset)throw notFound('media part not found');
    const library=this.libraries.get(actor,asset.library_id);
    if(library.kind!=='music'||!asset.available)throw notFound('lyrics not available');
    return asset;
  }
  async read(actor:MediaActor,partId:string):Promise<Lyrics>{
    const asset=this.asset(actor,partId),storage=await this.libraries.storage(actor,asset.library_id);
    const stem=posix.basename(asset.ref,posix.extname(asset.ref));
    const sidecar=(await storage.siblings(asset.ref)).find(file=>posix.extname(file.name).toLowerCase()==='.lrc'&&posix.basename(file.name,posix.extname(file.name))===stem);
    let bytes:Uint8Array|undefined,source:Lyrics['source']='none';
    if(sidecar){
      if(sidecar.size>MAX_BYTES)throw invalid();
      const {stream}=await storage.open(sidecar.ref);const chunks:Buffer[]=[];let size=0;
      for await(const chunk of stream){size+=chunk.length;if(size>MAX_BYTES){stream.destroy();throw invalid();}chunks.push(Buffer.from(chunk));}
      bytes=Buffer.concat(chunks);source='sidecar';
    }else{
      const info:MediaTechnicalInfo|null=asset.technical_json?JSON.parse(asset.technical_json):null;
      const tag=Object.entries(info?.tags??{}).find(([key])=>/^(?:lyrics|unsyncedlyrics|unsynced_lyrics)(?:-|$)/i.test(key))?.[1];
      if(tag){bytes=Buffer.from(tag);source='embedded';}
    }
    const current=this.asset(actor,partId);
    if(current.id!==asset.id||current.ref!==asset.ref)throw badRequest('资源已变化，请重新打开歌词','MEDIA_LYRICS_CHANGED');
    return bytes?{...parseLyrics(bytes),source}:{synced:false,lines:[],source};
  }
}
