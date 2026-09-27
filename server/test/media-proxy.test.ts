import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {setTimeout as delay} from 'node:timers/promises';
import {registerMediaProxy} from '../src/http/routes/media-proxy.ts';
import {registerErrorHandler} from '../src/http/errors.ts';

test('media proxy bounds outstanding work and releases its capacity after replies',async()=>{
  const app=Fastify({logger:false});registerErrorHandler(app);
  const release:Array<()=>void>=[];
  registerMediaProxy(app,{close:async()=>{},request:async()=>new Promise<Response>(resolve=>release.push(()=>resolve(new Response('{}',{headers:{'content-type':'application/json'}}))))});
  try{
    await app.ready();
    const requests=Array.from({length:64},()=>app.inject('/api/v1/media/libraries'));
    for(let i=0;i<100&&release.length!==64;i++)await delay(5);
    assert.equal(release.length,64);
    assert.equal((await app.inject('/api/v1/media/libraries')).statusCode,503);
    release.splice(0).forEach(done=>done());
    for(const response of await Promise.all(requests))assert.equal(response.statusCode,200);
    const next=app.inject('/api/v1/media/libraries');
    for(let i=0;i<100&&!release.length;i++)await delay(5);
    assert.equal(release.length,1);release.shift()!();assert.equal((await next).statusCode,200);
  }finally{release.forEach(done=>done());await app.close();}
});

for(const shutdown of [false,true])test(`open media stream aborts without buffering on ${shutdown?'server shutdown':'client disconnect'}`,async()=>{
  const app=Fastify({logger:false});registerErrorHandler(app);
  let aborted=false;
  registerMediaProxy(app,{close:async()=>{},request:async(_path,options)=>{
    const body=new ReadableStream<Uint8Array>({start(controller){
      controller.enqueue(new TextEncoder().encode('first chunk'));
      options!.signal!.addEventListener('abort',()=>{aborted=true;controller.error(new Error('client disconnected'));},{once:true});
    }});
    return new Response(body,{headers:{'content-type':'audio/mpeg'}});
  }});
  try{
    const origin=await app.listen({host:'127.0.0.1',port:0});
    const controller=new AbortController();
    const response=await fetch(origin+'/api/v1/media/streams/test',{signal:controller.signal});
    const reader=response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),'first chunk');
    if(shutdown){
      const stopped=app.close();
      await Promise.race([stopped,delay(2000,undefined,{ref:false}).then(()=>{throw Error('shutdown waited for the unfinished stream');})]);
    }else controller.abort();
    await reader.cancel().catch(()=>{});
    for(let i=0;i<100&&!aborted;i++)await delay(5);
    assert.equal(aborted,true);
  }finally{await app.close();}
});
