import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Db} from '../src/db/index.ts';
import {loadConfig} from '../src/config/index.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {startMediaRuntime} from '../src/media/start-runtime.ts';
import Fastify from 'fastify';
import {registerMediaProxy} from '../src/http/routes/media-proxy.ts';
import {registerErrorHandler} from '../src/http/errors.ts';

test('media runtime serves scan/catalog/playback HTTP in its worker and reads live core authority',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-runtime-')),corePath=join(root,'reader.db'),mediaPath=join(root,'media.db');
  const books=join(root,'books'),assets=join(root,'assets');await mkdir(books);await mkdir(assets);
  await writeFile(join(assets,'movie.mp4'),'fixture-data');
  process.env.BOOKS_DIR=books;process.env.DATA_DIR=join(root,'data');process.env.READER_TOKEN_SECRET='runtime-test-secret';
  const config={...loadConfig(),dataDir:root},core=new Db(corePath);
  core.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','private','admin',0,0)");
  const runtime=await startMediaRuntime(core,config);
  const proxy=Fastify({logger:false});registerErrorHandler(proxy);registerMediaProxy(proxy,runtime);
  try{
    await runtime.start();
    const publicOrigin=await proxy.listen({host:'127.0.0.1',port:0});
    const origin=await Reflect.get(runtime,'ready') as string;
    assert.equal((await fetch(origin+'/api/v1/media/libraries')).status,403);
    assert.equal((await runtime.request('/api/v1/media/libraries')).status,401);
    const token=signAccessToken(config,{id:'admin',role:'admin'}).token;
    const call=async(path:string,method='GET',body?:unknown)=>{
      const response=await fetch(publicOrigin+'/api/v1/media/'+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      assert.ok(response.ok,await response.clone().text());return response.json();
    };
    const library=await call('libraries','POST',{name:'Movies',kind:'video',root:assets,access:'all'});
    const job=await call(`libraries/${library.id}/scan`,'POST');
    let state=job;
    for(let i=0;i<200&&state.state==='running';i++){await delay(20);state=await call(`jobs/${job.id}`);}
    assert.equal(state.state,'complete');
    const catalog=await call(`libraries/${library.id}/items`);
    assert.equal(catalog.total,1);
    const detail=await call(`items/${catalog.items[0].id}`);
    const playback=await call('playback','POST',{partId:detail.editions[0].parts[0].id});
    const stream=await fetch(publicOrigin+playback.streamUrl,{headers:{range:'bytes=0-6'}});
    assert.equal(stream.status,206);assert.equal(await stream.text(),'fixture');
    assert.equal(stream.headers.get('content-range'),'bytes 0-6/12');
    const head=await fetch(publicOrigin+playback.streamUrl,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'12');assert.equal(await head.text(),'');
    const invalidRange=await fetch(publicOrigin+playback.streamUrl,{headers:{range:'bytes=99-100'}});
    assert.equal(invalidRange.status,416);assert.equal(invalidRange.headers.get('content-range'),'bytes */12');
    const noAuth=await fetch(publicOrigin+'/api/v1/media/libraries',{headers:{'x-reader-media-internal':'forged'}});
    assert.equal(noAuth.status,401);
    assert.equal(core.get("SELECT name FROM sqlite_master WHERE name='media_assets'"),undefined);
    core.run("UPDATE users SET disabled=1 WHERE id='admin'");
    assert.equal((await runtime.request('/api/v1/media/libraries',{headers:{authorization:'Bearer '+token}})).status,403);
    core.run("UPDATE users SET disabled=0,auth_version=1 WHERE id='admin'");
    assert.equal((await runtime.request('/api/v1/media/libraries',{headers:{authorization:'Bearer '+token}})).status,401);
    await assert.rejects(runtime.request('/api/v1/media/../../books'),/invalid internal media route/);
    await runtime.close();
    await assert.rejects(runtime.request('/api/v1/media/libraries'),{code:'MEDIA_UNAVAILABLE'});
    const restarted=await startMediaRuntime(core,config);
    try{
      const freshToken=signAccessToken(config,{id:'admin',role:'admin',authVersion:1}).token;
      const result=await restarted.request('/api/v1/media/libraries',{headers:{authorization:'Bearer '+freshToken}});
      assert.equal(result.status,200);assert.equal((await result.json()).items[0].id,library.id);
    }finally{await restarted.close();}
    await rm(mediaPath);
    await assert.rejects(startMediaRuntime(core,config),/activated media database is missing/);
  }finally{await proxy.close();await runtime.close();core.close();await rm(root,{recursive:true,force:true});}
});
