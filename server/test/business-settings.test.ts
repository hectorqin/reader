import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {Db} from '../src/db/index.ts';
import type {AppConfig} from '../src/config/index.ts';
import type {AppContext} from '../src/http/context.ts';
import {BusinessSettings,BusinessSettingsReader} from '../src/services/business-settings.ts';
import {UserService} from '../src/services/users.ts';
import {buildApp} from '../src/http/app.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {configuredProviders} from '../src/media/configured-providers.ts';
import {MediaReadDatabase} from '../src/media/read-database.ts';
import {RegistrationService} from '../src/services/registration.ts';

function config(root:string):AppConfig{return {booksDir:root,dataDir:root,host:'127.0.0.1',port:0,jwtSecret:'settings-test-secret-at-least-16',accessTokenTtl:604800,refreshTokenTtl:31536000,scanInterval:1800,watchInterval:60,logLevel:'silent',publicUrl:'',corsOrigins:[],webDir:join(root,'web')};}

test('settings migrate once, redact secrets, reject stale edits and are visible to read-only media connections',async t=>{
  const root=await mkdtemp(join(tmpdir(),'business-settings-')),path=join(root,'reader.db');
  t.after(()=>rm(root,{recursive:true,force:true}));
  const old=process.env.MEDIA_TMDB_TOKEN;process.env.MEDIA_TMDB_TOKEN='legacy-secret';
  t.after(()=>{if(old===undefined)delete process.env.MEDIA_TMDB_TOKEN;else process.env.MEDIA_TMDB_TOKEN=old;});
  const db=new Db(path),settings=new BusinessSettings(db,config(root)),view=settings.view('tmdb');
  assert.equal(settings.read('tmdb').token,'legacy-secret');assert.equal(view.secrets.token,true);
  assert.ok(!JSON.stringify(view).includes('legacy-secret'));assert.equal(view.values.token,undefined);
  const remote=new MediaReadDatabase(path),reader=new BusinessSettingsReader(remote),providers=configuredProviders(reader);
  const running=providers();assert.equal(running[0]!.configured,true);
  settings.save('tmdb',{enabled:false,token:'',apiKey:''},view.revision);
  assert.equal(providers()[0]!.configured,false);assert.equal(running[0]!.configured,true,'existing job keeps its provider snapshot');
  assert.throws(()=>settings.save('tmdb',{enabled:true},view.revision),{code:'SETTINGS_CONFLICT'});
  assert.throws(()=>settings.save('scanning',{files:999},settings.view('scanning').revision),{statusCode:400});
  assert.equal(settings.read('scanning').interval,60);
  assert.equal(settings.read('playback').mode,'auto');
  assert.throws(()=>settings.save('playback',{mode:'invalid'},settings.view('playback').revision),{statusCode:400});
  settings.save('playback',{mode:'proxy'},settings.view('playback').revision);
  assert.equal(reader.read('playback').mode,'proxy');
  remote.close();db.close();
  const reopened=new Db(path);try{const next=new BusinessSettings(reopened,config(root));assert.equal(next.read('tmdb').token,'');assert.equal(next.read('tmdb').enabled,false);}finally{reopened.close();}
});

test('admin API changes HTTP speech and OPDS live, preserves secrets, and blocks member writes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'business-api-')),db=new Db(':memory:'),cfg=config(root);
  let authHeader='',calls=0;
  const upstream=createServer((req,res)=>{
    authHeader=String(req.headers.authorization||'');calls++;
    if(req.url?.startsWith('/voices')){res.setHeader('content-type','application/json');res.end('[{"id":"zh","name":"中文"}]');}
    else{res.setHeader('content-type','audio/mpeg');res.end('audio');}
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(upstream.address() as {port:number}).port;
  const ctx={config:cfg,db,users:new UserService(db,cfg)} as AppContext;
  for(const [id,role] of [['admin','admin'],['member','member']])db.run('INSERT INTO users(id,username,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,0,0)',id!,id!,id!,'unused',role!);
  const app=buildApp(ctx);await app.ready();
  t.after(async()=>{await app.close();db.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(root,{recursive:true,force:true});});
  const admin={authorization:'Bearer '+signAccessToken(cfg,{id:'admin',role:'admin'}).token},member={authorization:'Bearer '+signAccessToken(cfg,{id:'member',role:'member'}).token};
  assert.equal((await app.inject({url:'/api/v1/admin/settings'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/v1/admin/settings',headers:member})).statusCode,403);
  assert.equal((await app.inject({method:'PATCH',url:'/api/v1/admin/settings/tts',headers:member,payload:{}})).statusCode,403);
  const save=async(group:string,values:object,headers:Record<string,string>=admin)=>app.inject({method:'PATCH',url:'/api/v1/admin/settings/'+group,headers,payload:{values,revision:ctx.settings!.view(group as 'tts').revision}});
  const saved=await save('tts',{enabled:true,url:origin+'/tts',voicesUrl:origin+'/voices',token:'private-token',cacheMaxBytes:0});
  assert.equal(saved.statusCode,200,saved.body);assert.ok(!saved.body.includes('private-token'));
  const voices=await app.inject({url:'/api/v1/tts/voices',headers:admin});assert.equal(voices.json().http,true);assert.equal(voices.json().voices[0].id,'zh');
  const audio=await app.inject({method:'POST',url:'/api/v1/tts/test',headers:admin,payload:{}});assert.equal(audio.statusCode,200,audio.body);assert.equal(authHeader,'Bearer private-token');
  const count=calls;await app.inject({method:'POST',url:'/api/v1/tts/test',headers:admin,payload:{}});assert.ok(calls>count,'cache disabled really bypasses existing audio');
  await save('tts',{timeoutMs:1000});assert.equal(ctx.settings!.read('tts').token,'private-token');
  assert.equal((await save('tts',{enabled:false,token:''})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/tts/voices',headers:admin})).json().http,false);
  assert.equal((await save('access',{publicUrl:'https://books.example'})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/opds/credentials',headers:admin})).json().catalogUrl,'https://books.example/opds');
  const locked=await save('access',{corsOrigins:'https://other.example'},{...admin,origin:'https://books.example'});
  assert.equal(locked.statusCode,400);assert.equal(ctx.config.corsOrigins.length,0);
});

test('registration stores legacy default once instead of falling back after later env changes',()=>{
  const db=new Db(':memory:'),old=process.env.ALLOW_REGISTRATION;
  try{process.env.ALLOW_REGISTRATION='true';const service=new RegistrationService(db);assert.equal(service.mode(),'open');service.setMode('closed');assert.equal(new RegistrationService(db).mode(),'closed');}
  finally{db.close();if(old===undefined)delete process.env.ALLOW_REGISTRATION;else process.env.ALLOW_REGISTRATION=old;}
});
