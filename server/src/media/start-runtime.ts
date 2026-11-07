import {join} from 'node:path';
import type {Db} from '../db/index.ts';
import type {AppConfig} from '../config/index.ts';
import {MediaRuntime} from './runtime.ts';
import {AppError} from '../lib/errors.ts';
import {BusinessSettingsReader} from '../services/business-settings.ts';

export type MediaState='disabled'|'stopping'|'starting'|'ready'|'failed'|'closed';
export type MediaService=Pick<MediaRuntime,'request'|'close'>;

/** Listen for reading first, then start media without queuing public requests. */
export function createMediaService(db:Db,config:AppConfig,onError:(error:unknown)=>void):MediaService & {start:()=>void;setEnabled:(enabled:boolean)=>Promise<void>;state:()=>MediaState}{
  let runtime:MediaRuntime|undefined;
  let state:MediaState='disabled',enabled=false,closed=false,started=false;
  let generation=0,transition=Promise.resolve();
  let timer:ReturnType<typeof setInterval>|undefined;
  const settings=new BusinessSettingsReader(db);
  const setEnabled=(next:boolean):Promise<void>=>{
    if(closed)return transition;
    if(next===enabled&&state!=='failed')return transition;
    enabled=next;
    const revision=++generation;
    state=next?'starting':runtime?'stopping':'disabled';
    if(!next)void runtime?.close();
    transition=transition.then(async()=>{
      if(runtime){const previous=runtime;runtime=undefined;await previous.close();}
      if(closed||revision!==generation)return;
      if(!enabled){state='disabled';return;}
      const current=createRuntime(db,config);
      runtime=current;
      try{
        await current.start();
        if(!closed&&revision===generation)state='ready';
      }catch(error){
        await current.close();
        if(runtime===current)runtime=undefined;
        throw error;
      }
    }).catch(error=>{if(!closed&&revision===generation){state='failed';onError(error);}});
    return transition;
  };
  const service={
    state:()=>state,
    setEnabled,
    start(){
      if(started||closed)return;
      started=true;
      void setEnabled(settings.read('modules').mediaEnabled);
      timer=setInterval(()=>{const next=settings.read('modules').mediaEnabled;if(next!==enabled)void setEnabled(next);},2000);
      timer.unref();
    },
    async request(path:string,options?:RequestInit){
      if(closed)throw new AppError(503,'MEDIA_UNAVAILABLE','影音服务不可用');
      if(!settings.read('modules').mediaEnabled||!enabled)throw new AppError(403,'MEDIA_DISABLED','影音模块已关闭');
      if(state==='starting')throw new AppError(503,'MEDIA_STARTING','影音服务正在准备，请稍后重试');
      if(state!=='ready'||!runtime)throw new AppError(503,'MEDIA_UNAVAILABLE','影音服务不可用，请管理员检查服务日志');
      return runtime.request(path,options);
    },
    async close(){
      closed=true;enabled=false;generation++;state='closed';clearInterval(timer);
      await runtime?.close();await transition;await runtime?.close();
    },
  };
  return service;
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
