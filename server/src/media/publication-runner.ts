import {Worker} from 'node:worker_threads';
import {AppError} from '../lib/errors.ts';

/** Single writer, existing media store only. Callers must authorize commands before dispatch. */
export class MediaPublicationRunner {
  private worker:Worker|null=null;
  private closed=false;
  constructor(private readonly path:string){}

  publish(libraryId:string,jobId:string):Promise<void>{
    if(this.closed)return Promise.reject(new AppError(503,'MEDIA_PUBLICATION_CLOSED','影音发布已关闭'));
    if(this.worker)return Promise.reject(new AppError(503,'MEDIA_PUBLICATION_BUSY','影音发布正在进行，请稍后重试'));
    const source=import.meta.url.endsWith('.ts');
    const url=new URL(source?'./publication-worker.ts':'./publication-worker.js',import.meta.url);
    const workerData={path:this.path,libraryId,jobId};
    const worker=source?new Worker(`import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then(({tsImport})=>tsImport(${JSON.stringify(url.href)},${JSON.stringify(import.meta.url)}))`,{eval:true,workerData}):new Worker(url,{workerData});
    this.worker=worker;
    return new Promise((resolve,reject)=>{
      let committed=false;
      worker.on('message',(message:{state:string})=>{if(message.state==='committed')committed=true;});
      // An error can occur after SQLite committed but before the acknowledgement arrived.
      worker.on('error',()=>{});
      worker.on('exit',code=>{
        if(this.worker===worker)this.worker=null;
        if(committed&&code===0)resolve();
        else reject(new AppError(503,'MEDIA_PUBLICATION_UNCERTAIN','发布线程已结束，请核对扫描任务状态后重试'));
      });
    });
  }

  /** Does not label a possibly committed transaction as cancelled. */
  async close():Promise<void>{this.closed=true;if(this.worker)await this.worker.terminate();}
}
