import {Readable} from 'node:stream';
import type {FastifyInstance} from 'fastify';
import type {MediaRuntime} from '../../media/runtime.ts';
import {AppError} from '../../lib/errors.ts';

/** Streaming bridge. No media database connection or synchronous work in the reading host. */
export function registerMediaProxy(app:FastifyInstance,runtime:Pick<MediaRuntime,'request'|'close'>):void {
  let inFlight=0;
  const active=new Set<AbortController>();
  app.addHook('preClose',async()=>{for(const controller of active)controller.abort();});
  app.addHook('onClose',()=>runtime.close());
  app.route({method:['GET','HEAD','POST','PUT','PATCH','DELETE'],url:'/api/v1/media/*',logLevel:'silent',handler:async(request,reply)=>{
    if(inFlight>=64)throw new AppError(503,'MEDIA_BUSY','影音请求繁忙，请稍后重试');
    inFlight++;
    const controller=new AbortController();
    active.add(controller);
    let released=false;
    const release=()=>{if(released)return;released=true;inFlight--;active.delete(controller);clearTimeout(timer);};
    const disconnected=()=>{controller.abort();release();};
    // Bound waiting for response headers, not the duration of media playback.
    const timer=setTimeout(()=>controller.abort(),30000);
    reply.raw.once('close',disconnected);reply.raw.once('finish',release);
    try{
      const headers=new Headers();
      for(const name of ['authorization','x-media-background','range','if-range','accept']){
        const value=request.headers[name];if(typeof value==='string')headers.set(name,value);
      }
      let body:string|undefined;
      if(request.body!==undefined){body=JSON.stringify(request.body);headers.set('content-type','application/json');}
      const upstream=await runtime.request(request.raw.url!,{method:request.method,headers,body,signal:controller.signal});
      clearTimeout(timer);
      reply.status(upstream.status);
      for(const name of ['content-type','content-length','content-range','accept-ranges','cache-control','content-security-policy','x-content-type-options','referrer-policy','retry-after']){
        const value=upstream.headers.get(name);if(value!==null)reply.header(name,value);
      }
      if(request.method==='HEAD'||!upstream.body){await upstream.body?.cancel();return reply.send();}
      const stream=Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
      stream.once('error',release);
      return reply.send(stream);
    }catch(error){
      release();
      if(error instanceof AppError)throw error;
      throw new AppError(503,'MEDIA_REQUEST_UNCERTAIN','影音请求未完成；写入结果请查询后确认');
    }
  }});
}
