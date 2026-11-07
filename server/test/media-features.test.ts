import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from '../src/db/index.ts';
import type {AppConfig} from '../src/config/index.ts';
import type {AppContext} from '../src/http/context.ts';
import {buildApp} from '../src/http/app.ts';
import {UserService} from '../src/services/users.ts';
import {BusinessSettings} from '../src/services/business-settings.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {createMediaService} from '../src/media/start-runtime.ts';
import {authenticate} from '../src/http/auth.ts';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';

function config(root:string):AppConfig {
  return {booksDir:root,dataDir:root,host:'127.0.0.1',port:0,jwtSecret:'media-features-test-secret',accessTokenTtl:604800,refreshTokenTtl:31536000,scanInterval:0,watchInterval:0,logLevel:'silent',publicUrl:'',corsOrigins:[],webDir:join(root,'web')};
}

test('administrators control global and per-user media without revoking reading sessions',async context=>{
  const root=await mkdtemp(join(tmpdir(),'media-features-')),db=new Db(join(root,'reader.db')),cfg=config(root);
  const users=new UserService(db,cfg);
  const ctx={config:cfg,db,users} as AppContext;
  for(const role of ['admin','member'])db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)',role,role,'unused',role);
  const app=buildApp(ctx);await app.ready();
  context.after(async()=>{await app.close();db.close();await rm(root,{recursive:true,force:true});});
  const admin={authorization:'Bearer '+signAccessToken(cfg,{id:'admin',role:'admin'}).token};
  const member={authorization:'Bearer '+signAccessToken(cfg,{id:'member',role:'member'}).token};
  const save=(values:object,headers=admin)=>app.inject({method:'PATCH',url:'/api/v1/admin/settings/modules',headers,payload:{revision:ctx.settings!.view('modules').revision,values}});
  const permission=(id:string,mediaEnabled:unknown,headers=admin)=>app.inject({method:'PATCH',url:'/api/v1/admin/users/'+id,headers,payload:{mediaEnabled}});
  assert.deepEqual(ctx.settings!.read('modules'),{mediaEnabled:true,newUserMediaEnabled:true});
  assert.equal((await app.inject({url:'/api/v1/media/libraries',headers:member})).statusCode,200);
  assert.equal((await permission('member',false,member)).statusCode,403);
  assert.equal((await save({mediaEnabled:false},member)).statusCode,403);
  assert.equal((await permission('member','false')).statusCode,400);
  assert.equal((await permission('member',false)).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/media/libraries',headers:member})).json().error.code,'MEDIA_DISABLED');
  const me=await app.inject({url:'/api/v1/auth/me',headers:member});
  assert.equal(me.statusCode,200);
  assert.equal(me.json().user.mediaEnabled,false);
  assert.equal(me.json().user.features.media,false);
  assert.equal((await app.inject({url:'/api/v1/opds/credentials',headers:member})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/media/libraries',headers:admin})).statusCode,200);
  assert.equal((await permission('admin',false)).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/admin/settings',headers:admin})).statusCode,200);
  assert.equal((await permission('admin',true)).statusCode,200);
  assert.equal((await save({mediaEnabled:false,newUserMediaEnabled:false})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/instance'})).json().features.media,false);
  for(const path of ['libraries','streams/old?ticket=old','background/playback/old/subtitles','artwork/old','missing-route']){
    const response=await app.inject({url:'/api/v1/media/'+path,headers:admin});
    assert.equal(response.statusCode,403,path);assert.equal(response.json().error.code,'MEDIA_DISABLED');
  }
  assert.equal((await app.inject({url:'/api/v1/auth/me',headers:admin})).statusCode,200);
  const created=await users.create({username:'new-member',password:'password123'});
  assert.equal(created.mediaEnabled,false);
  assert.equal(users.byId('admin')!.media_enabled,1);
  assert.equal((await save({mediaEnabled:true})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/media/libraries',headers:admin})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/media/libraries',headers:member})).statusCode,403);
  assert.equal((await permission('member',true)).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/media/libraries',headers:member})).statusCode,200);
  assert.equal(users.byId('member')!.auth_version,0);
});

test('disabled media does not open its database; toggles serialize worker shutdown and preserve libraries',async context=>{
  const root=await mkdtemp(join(tmpdir(),'media-toggle-')),cfg=config(root),db=new Db(join(root,'reader.db'));
  const settings=new BusinessSettings(db,cfg),errors:unknown[]=[];
  const save=(enabled:boolean)=>settings.save('modules',{mediaEnabled:enabled},settings.view('modules').revision);
  save(false);
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','unused','admin',0,0)");
  const service=createMediaService(db,cfg,error=>errors.push(error));
  context.after(async()=>{await service.close();db.close();await rm(root,{recursive:true,force:true});});
  service.start();
  assert.equal(service.state(),'disabled');
  await assert.rejects(access(join(root,'media.db')));
  await assert.rejects(service.request('/api/v1/media/libraries'),{code:'MEDIA_DISABLED'});
  save(true);await service.setEnabled(true);
  assert.equal(service.state(),'ready');
  const headers={authorization:'Bearer '+signAccessToken(cfg,{id:'admin',role:'admin'}).token,'content-type':'application/json'};
  const response=await service.request('/api/v1/media/libraries',{method:'POST',headers,body:JSON.stringify({name:'Movies',kind:'video',root,access:'all'})});
  assert.equal(response.status,201,await response.clone().text());
  const library=await response.json();
  save(false);await service.setEnabled(false);
  assert.equal(service.state(),'disabled');
  assert.ok(await access(join(root,'media.db')).then(()=>true));
  save(true);const starting=service.setEnabled(true);
  save(false);const stopping=service.setEnabled(false);
  save(true);const restarted=service.setEnabled(true);
  await Promise.all([starting,stopping,restarted]);
  assert.equal(service.state(),'ready');
  const result=await service.request('/api/v1/media/libraries',{headers});
  assert.equal(result.status,200);assert.equal((await result.json()).items[0].id,library.id);
  assert.deepEqual(errors,[]);
  save(false);await service.setEnabled(false);
  await service.close();
  assert.equal(service.state(),'closed');
});

test('revoking media interrupts an active stream without stopping another user',async context=>{
  const root=await mkdtemp(join(tmpdir(),'media-stream-revoke-')),cfg=config(root),db=new Db(':memory:');
  const users=new UserService(db,cfg),ctx={config:cfg,db,users} as AppContext;
  for(const role of ['admin','member'])db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)',role,role,'unused',role);
  const app=buildApp(ctx);
  app.get('/api/v1/media/test-stream',{preHandler:authenticate(ctx)},async(_request,reply)=>reply.type('application/octet-stream').send(Readable.from((async function*(){while(true){await delay(25);yield Buffer.alloc(1024);}})())));
  const origin=await app.listen({host:'127.0.0.1',port:0});
  context.after(async()=>{await app.close();db.close();await rm(root,{recursive:true,force:true});});
  const stream=async(id:string)=>{
    const response=await fetch(origin+'/api/v1/media/test-stream',{headers:{authorization:'Bearer '+signAccessToken(cfg,{id,role:id==='admin'?'admin':'member'}).token},signal:AbortSignal.timeout(6000)});
    assert.equal(response.status,200);
    const reader=response.body!.getReader();assert.equal((await reader.read()).done,false);return reader;
  };
  const admin=await stream('admin'),member=await stream('member');
  let started=Date.now();
  users.setMediaEnabled('member',false);
  await assert.rejects(async()=>{while(!(await member.read()).done){};throw new Error('stream ended without revocation');},/terminated|aborted/i);
  assert.ok(Date.now()-started<3000,'revocation must close the stream before the client timeout');
  assert.equal((await admin.read()).done,false);
  started=Date.now();
  ctx.settings!.save('modules',{mediaEnabled:false},ctx.settings!.view('modules').revision);
  await assert.rejects(async()=>{while(!(await admin.read()).done){};throw new Error('stream ended without revocation');},/terminated|aborted/i);
  assert.ok(Date.now()-started<3000,'global disable must close the stream before the client timeout');
});
