import { AppError, notFound } from '../lib/errors.ts';

const LIMIT=5*1024*1024, CACHE_LIMIT=24*1024*1024;
/** Only TMDB-generated image keys are accepted, never arbitrary URLs from metadata. */
export class RemoteArtwork {
  private cache=new Map<string,{bytes:Buffer;expires:number}>();
  private size=0;
  private active=0;
  private waiting:Array<()=>void>=[];
  private pending=new Map<string,Promise<Buffer>>();
  constructor(private readonly fetcher:typeof fetch=fetch){}
  async tmdb(path:string):Promise<Buffer>{
    if(!/^\/[a-zA-Z0-9_-]{1,160}\.(jpg|png|webp)$/.test(path))throw notFound('invalid artwork key');
    return this.load('tmdb:'+path,'https://image.tmdb.org/t/p/w500'+path,false);
  }
  async musicBrainz(groupId:string):Promise<Buffer>{
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(groupId))throw notFound('invalid artwork key');
    const id=groupId.toLowerCase();return this.load('mb:'+id,`https://coverartarchive.org/release-group/${id}/front-500`,true);
  }
  private async load(path:string,url:string,redirects:boolean):Promise<Buffer>{
    const cached=this.cache.get(path);
    if(cached&&cached.expires>Date.now()){this.cache.delete(path);this.cache.set(path,cached);return cached.bytes;}
    const existing=this.pending.get(path);if(existing)return existing;
    const request=this.download(path,url,redirects);this.pending.set(path,request);
    try{return await request;}finally{this.pending.delete(path);}
  }
  private async download(path:string,url:string,redirects:boolean):Promise<Buffer>{
    if(this.active>=4){
      if(this.waiting.length>=100)throw new AppError(503,'MEDIA_COVER_BUSY','在线封面请求繁忙，请稍后重试');
      await new Promise<void>(resolve=>this.waiting.push(resolve));
    }else this.active++;
    try{
      const signal=AbortSignal.timeout(12000);
      let response:Response;
      for(let hop=0;;hop++){
        response=await this.fetcher(url,{redirect:redirects?'manual':'error',signal});
        if(!redirects||![301,302,303,307,308].includes(response.status))break;
        const location=response.headers.get('location');await response.body?.cancel();
        if(!location||hop>=4)throw new Error('invalid redirect');
        const next=new URL(location,url);
        if(next.protocol!=='https:'||next.username||next.password||next.port||
          !(next.hostname==='coverartarchive.org'||next.hostname==='archive.org'||/^[a-z0-9.-]+\.archive\.org$/.test(next.hostname)))throw new Error('invalid image origin');
        url=next.href;
      }
      if(!response.ok){
        await response.body?.cancel();
        if(response.status===404||response.status===410)throw notFound('来源未提供此封面','MEDIA_COVER_NOT_FOUND');
        throw new AppError(502,'MEDIA_COVER_UPSTREAM','在线封面来源暂时不可用，请稍后重试');
      }
      if(Number(response.headers.get('content-length'))>LIMIT){await response.body?.cancel();throw new Error('image too large');}
      if(!response.body)throw new Error('empty image');
      const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
      try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>LIMIT)throw new Error('image too large');chunks.push(Buffer.from(next.value));}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const bytes=Buffer.concat(chunks);
      if(!bytes.length)throw new Error('empty image');
      const old=this.cache.get(path);if(old){this.size-=old.bytes.length;this.cache.delete(path);}
      while((this.size+bytes.length>CACHE_LIMIT||this.cache.size>=256)&&this.cache.size){const key=this.cache.keys().next().value!;this.size-=this.cache.get(key)!.bytes.length;this.cache.delete(key);}
      this.cache.set(path,{bytes,expires:Date.now()+3600000});this.size+=bytes.length;
      return bytes;
    }catch(error){
      if(error instanceof AppError)throw error;
      const failure=error as {name?:string;code?:string;cause?:{code?:string}}|null;
      if(failure?.name==='TimeoutError'||failure?.name==='AbortError'||[failure?.code,failure?.cause?.code].some(code=>code==='UND_ERR_CONNECT_TIMEOUT'||code==='UND_ERR_HEADERS_TIMEOUT'||code==='UND_ERR_BODY_TIMEOUT')){
        throw new AppError(504,'MEDIA_COVER_TIMEOUT','在线封面读取超时，请稍后重试');
      }
      throw new AppError(502,'MEDIA_COVER_UPSTREAM','在线封面来源暂时不可用，请稍后重试');
    }
    finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
}
