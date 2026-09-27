import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { notFound } from '../lib/errors.ts';
const run=promisify(execFile);

/** Bounded, deduplicated extraction of the original attached image bytes. */
export class EmbeddedArtwork {
  private readonly pending=new Map<string,Promise<Buffer>>();
  private readonly cache=new Map<string,Buffer>();
  private bytes=0;
  private active=0;
  private readonly waiting:Array<()=>void>=[];
  async read(key:string,path:string,index:number):Promise<Buffer>{
    const cached=this.cache.get(key);if(cached){this.cache.delete(key);this.cache.set(key,cached);return cached;}
    const pending=this.pending.get(key);if(pending)return pending;
    if(this.pending.size>=100)throw notFound('封面提取繁忙，请稍后重试','MEDIA_COVER_UNAVAILABLE');
    const task=this.extract(path,index).then(bytes=>{
      this.cache.set(key,bytes);this.bytes+=bytes.length;
      while(this.bytes>24*1024*1024||this.cache.size>128){const oldest=this.cache.keys().next().value!;this.bytes-=this.cache.get(oldest)!.length;this.cache.delete(oldest);}
      return bytes;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,task);return task;
  }
  private async extract(path:string,index:number){
    if(!Number.isSafeInteger(index)||index<0)throw notFound('invalid artwork track');
    if(this.active>=2)await new Promise<void>(resolve=>this.waiting.push(resolve));
    else this.active++;
    try{
      const {stdout}=await run(process.env.MEDIA_FFMPEG_PATH||'ffmpeg',[
        '-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe',
        '-format_whitelist','mp3,flac,ogg,mov,matroska,webm,aac,wav,aiff,asf',
        '-i',path,'-map',`0:${index}`,'-an','-sn','-c:v','copy','-frames:v','1','-f','image2pipe','pipe:1',
      ],{encoding:'buffer',timeout:15000,maxBuffer:5*1024*1024,windowsHide:true});
      if(!stdout.length)throw new Error('empty image');return stdout;
    }catch{throw notFound('嵌入封面暂不可用','MEDIA_COVER_UNAVAILABLE');}
    finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
}
