import {Worker} from 'node:worker_threads';
import {randomBytes} from 'node:crypto';
import type {AppConfig} from '../config/index.ts';
import {AppError} from '../lib/errors.ts';
import {ensureMediaStorageIdentity} from './storage-identity.ts';
import {markMediaStorageActivated} from './migrate-database.ts';

/** Owns all media handlers and their writes; core accounts are opened read-only. */
export class MediaRuntime {
  private readonly secret=randomBytes(32).toString('hex');
  private readonly worker:Worker;
  private readonly ready:Promise<string>;
  private readonly exited:Promise<void>;
  private closed=false;
  constructor(corePath:string,mediaPath:string,config:AppConfig){
    // Only the host writes core identity, serialized with synchronous reading
    // transactions. The worker copies from a read-only source snapshot.
    ensureMediaStorageIdentity(corePath);
    const source=import.meta.url.endsWith('.ts');
    const url=new URL(source?'./runtime-worker.ts':'./runtime-worker.js',import.meta.url);
    const workerData={corePath,mediaPath,config,secret:this.secret};
    this.worker=source?new Worker(`import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then(({tsImport})=>tsImport(${JSON.stringify(url.href)},${JSON.stringify(import.meta.url)}))`,{eval:true,workerData}):new Worker(url,{workerData});
    this.exited=new Promise(resolve=>this.worker.once('exit',()=>{this.closed=true;resolve();}));
    this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{void this.worker.terminate();reject(new AppError(503,'MEDIA_START_TIMEOUT','影音服务启动超时'));},300000);
      const fail=(error?:unknown)=>{clearTimeout(timer);reject(error instanceof Error?error:new AppError(503,'MEDIA_UNAVAILABLE','影音服务不可用'));};
      this.worker.once('error',fail);this.worker.once('exit',fail);
      this.worker.on('message',(message:{type:string;origin:string})=>{
        if(this.closed)return;
        if(message.type==='prepared'){
          try{markMediaStorageActivated(corePath);this.worker.postMessage({type:'activated'});}
          catch(error){fail(error);void this.worker.terminate();}
        }
        if(message.type==='ready'){clearTimeout(timer);resolve(message.origin);}
      });
    });
    // Start failures remain observable through start/request without an unhandled rejection.
    void this.ready.catch(()=>{});
  }
  async start():Promise<void>{await this.ready;if(this.closed)throw new AppError(503,'MEDIA_UNAVAILABLE','影音服务不可用');}
  async request(path:string,options:RequestInit={}):Promise<Response>{
    if(!path.startsWith('/api/v1/media/')||path.includes('#')||path.includes('\\'))throw new Error('invalid internal media route');
    await this.start();
    const origin=await this.ready,url=new URL(path,origin);
    if(url.origin!==origin||!url.pathname.startsWith('/api/v1/media/'))throw new Error('invalid internal media route');
    const headers=new Headers(options.headers);headers.set('x-reader-media-internal',this.secret);
    // Return playback redirects to the browser; never follow them with internal credentials.
    return fetch(url,{...options,headers,redirect:'manual'});
  }
  async close():Promise<void>{
    if(this.closed)return;
    this.closed=true;this.worker.postMessage({type:'close'});
    const timer=setTimeout(()=>{void this.worker.terminate();},10000);
    try{await this.exited;}finally{clearTimeout(timer);}
  }
}
