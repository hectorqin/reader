import {join} from 'node:path';
import type {Db} from '../db/index.ts';
import type {AppConfig} from '../config/index.ts';
import {MediaRuntime} from './runtime.ts';
import {AppError} from '../lib/errors.ts';

export type MediaService=Pick<MediaRuntime,'request'|'close'>;

/** Listen for reading first, then start media without queuing public requests. */
export function createMediaService(db:Db,config:AppConfig,onError:(error:unknown)=>void):MediaService & {start:()=>void}{
  let runtime:MediaRuntime|undefined;
  let state:'pending'|'starting'|'ready'|'failed'|'closed'='pending';
  return {
    start(){
      if(state!=='pending')return;
      state='starting';
      try{
        runtime=createRuntime(db,config);
        void runtime.start().then(()=>{if(state==='starting')state='ready';},error=>{
          if(state==='closed')return;
          state='failed';onError(error);
        });
      }catch(error){state='failed';onError(error);}
    },
    async request(path,options){
      if(state==='pending'||state==='starting')throw new AppError(503,'MEDIA_STARTING','影音服务正在准备，请稍后重试');
      if(state!=='ready'||!runtime)throw new AppError(503,'MEDIA_UNAVAILABLE','影音服务不可用，请管理员检查服务日志');
      return runtime.request(path,options);
    },
    async close(){state='closed';await runtime?.close();},
  };
}

function createRuntime(db:Db,config:AppConfig):MediaRuntime{
  const corePath=db.all<{name:string;file:string}>('PRAGMA database_list').find(row=>row.name==='main')?.file;
  if(!corePath)throw new Error('isolated media runtime requires a file database');
  return new MediaRuntime(corePath,join(config.dataDir,'media.db'),config);
}

/** Awaitable entry for callers that explicitly need a ready media service. */
export async function startMediaRuntime(db:Db,config:AppConfig):Promise<MediaRuntime>{
  const runtime=createRuntime(db,config);
  try{await runtime.start();return runtime;}catch(error){await runtime.close();throw error;}
}
