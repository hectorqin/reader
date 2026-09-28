import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { TestContext } from 'node:test';
import { OpenListMediaStorage, normalizeOpenList } from '../src/media/storage/openlist.ts';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';
import { MediaPlayback } from '../src/media/playback.ts';
import { MediaLyrics } from '../src/media/lyrics.ts';
import { MediaArtwork } from '../src/media/artwork.ts';
import { loadConfig } from '../src/config/index.ts';
import { UserService } from '../src/services/users.ts';
import { signAccessToken } from '../src/services/tokens.ts';
import { registerMediaRoutes } from '../src/http/routes/media.ts';
import { registerErrorHandler } from '../src/http/errors.ts';

const modified = '2026-09-01T00:00:00Z';
const item = (name: string, is_dir = false, size = 10) => ({ name, is_dir, size, modified });
const json = (data: unknown, code = 200) => Response.json({ code, data });
const connection = { baseUrl: 'https://list.example/mounted', token: 'only-api-token', password: 'folder-secret' };
const bytes = async (stream: AsyncIterable<Uint8Array>) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); };

test('OpenList validates configuration and refuses traversal before any HTTP call', async () => {
  for (const baseUrl of ['file:///tmp', 'https://user:pass@example.org', 'https://example.org?token=secret', 'https://example.org/#fragment']) {
    assert.throws(() => normalizeOpenList({ baseUrl }, '/'), { statusCode: 400 });
  }
  for (const root of ['relative', '/../', '/media/../other', '/media//child', '/media\\child']) assert.throws(() => normalizeOpenList(connection, root), {statusCode:400});
  assert.deepEqual(normalizeOpenList({baseUrl:'http://127.0.0.1:5244/'}, '/media/').root, '/media');
  let calls = 0;
  const storage = new OpenListMediaStorage(connection, '/media', async () => { calls++; return json({}); });
  for (const ref of ['../secret.mp4', '/secret.mp4', 'a/./b', 'a//b', 'a\\b', 'a\0b']) await assert.rejects(storage.stat(ref), {code:'invalid-ref'});
  assert.equal(calls, 0);
});

test('OpenList enumerates every page and directory with the official read-only API contract', async () => {
  const requests: Array<{url:string;body:Record<string,unknown>}> = [];
  const storage = new OpenListMediaStorage(connection, '/媒体', async (url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push({url:String(url),body});
    assert.equal(new Headers(init?.headers).get('authorization'), connection.token);
    assert.equal(init?.redirect, 'error'); assert.equal(body.password, connection.password);
    assert.equal(body.refresh, false); assert.equal(init?.method, 'POST');
    const files = body.path === '/媒体' ? [...Array.from({length:200}, (_, i) => item(`${i}.mp4`)), item('子目录', true)] : [item('中文 #?.mp3')];
    return json({ total: files.length, content: files.slice((body.page - 1) * body.per_page, body.page * body.per_page) });
  });
  const entries = await Array.fromAsync(storage.list());
  assert.equal(entries.length, 201); assert.equal(entries.at(-1)?.ref, '子目录/中文 #?.mp3');
  assert.deepEqual(requests.map(r => r.body.page), [1,2,1]);
  assert.ok(requests.every(r => r.url === 'https://list.example/mounted/api/fs/list'));
});

test('OpenList rejects incomplete pagination, duplicates and API failures rather than publishing an empty library', async () => {
  for (const mode of ['incomplete','duplicate','changed','unsafe','auth']) {
    const storage = new OpenListMediaStorage(connection, '/', async (_url, init) => {
      const {page} = JSON.parse(String(init?.body));
      if (mode === 'auth') return json({message:'folder-secret'}, 403);
      if (mode === 'unsafe') return json({total:1,content:[item('../secret.mp3')]});
      return json({total: mode === 'changed' && page === 2 ? 3 : 2, content: page === 1 ? [item('a.mp3')] : mode === 'duplicate' ? [item('a.mp3')] : []});
    });
    await assert.rejects(async () => Array.fromAsync(storage.list()), error => {
      assert.ok(error instanceof Error); assert.equal(error.message.includes('folder-secret'), false); return true;
    });
  }
});

test('OpenList reuses bounded directory snapshots only inside one storage instance and retries failed enumerations', async () => {
  let requests=0,failed=false;
  const request:typeof fetch=async(_url,init)=>{
    requests++;
    if(failed)return json({},500);
    const {page,per_page,path}=JSON.parse(String(init?.body));
    const content=path==='/music'?Array.from({length:1000},(_,i)=>item(`${i}.mp3`)):[];
    // Yield so simultaneous sidecar callers reach the same in-flight enumeration.
    await new Promise(resolve=>setTimeout(resolve,1));
    return json({total:content.length,content:content.slice((page-1)*per_page,page*per_page)});
  };
  const storage=new OpenListMediaStorage(connection,'/music',request);
  await Promise.all(Array.from({length:20},(_,i)=>storage.siblingNames(`${i}.mp3`)));
  assert.equal(requests,5,'concurrent sidecar reads share five list pages');
  for(let i=0;i<1000;i++)await storage.siblingNames(`${i}.mp3`);
  assert.equal(requests,5,'one thousand tracks do not repeat the five-page listing');
  await new OpenListMediaStorage(connection,'/music',request).siblingNames('0.mp3');
  assert.equal(requests,10,'the next scan uses a fresh storage instance');
  for(let i=0;i<65;i++)await storage.siblingNames(`child-${i}/a.mp3`);
  const beforeReload=requests;
  await storage.siblingNames('0.mp3');
  assert.equal(requests,beforeReload+5,'the bounded cache evicts older directories');
  const retry=new OpenListMediaStorage(connection,'/music',request);
  failed=true;await assert.rejects(retry.siblingNames('0.mp3'));
  failed=false;await retry.siblingNames('0.mp3');
  assert.equal(requests,beforeReload+11,'failed enumerations are not cached');
});

test('OpenList Range proxy refreshes signed URLs and never forwards API secrets on raw URL redirects', async () => {
  const seen: Array<{url:string;headers:Headers}> = [];
  let signed = 0;
  const storage = new OpenListMediaStorage(connection, '/movies', async (url, init) => {
    const headers = new Headers(init?.headers); seen.push({url:String(url),headers});
    if (String(url).includes('/api/fs/get')) return json({...item('test.mp4'),raw_url:`https://list.example/download?sign=${++signed}`});
    assert.equal(headers.get('authorization'), null); assert.equal(headers.get('range'), 'bytes=2-5');
    if (String(url).startsWith('https://list.example/download')) return new Response(null, {status:302,headers:{location:'https://cdn.example/bytes'}});
    return new Response('2345', {status:206,headers:{'content-range':'bytes 2-5/10','content-length':'4'}});
  });
  assert.equal((await bytes((await storage.open('test.mp4', {start:2,end:5})).stream)).toString(), '2345');
  assert.equal((await bytes((await storage.open('test.mp4', {start:2,end:5})).stream)).toString(), '2345');
  assert.equal(signed, 2);
  assert.equal(seen.filter(call=>call.headers.has('authorization')).length, 2);
});

test('OpenList refuses ignored, shifted, compressed or truncated Range responses', async () => {
  for (const mode of ['ignored','shifted','compressed','truncated','oversized']) {
    const storage = new OpenListMediaStorage(connection, '/', async (url) => {
      if (String(url).includes('/api/')) return json({...item('song.mp3'),raw_url:'https://cdn.example/data'});
      const headers:Record<string,string> = {'content-range':mode === 'shifted' ? 'bytes 3-6/10' : 'bytes 2-5/10'};
      if (mode === 'compressed') headers['content-encoding'] = 'gzip';
      return new Response(mode === 'truncated' ? '23' : mode === 'oversized' ? '23456' : '2345', {status:mode === 'ignored' ? 200 : 206,headers});
    });
    await assert.rejects(async () => bytes((await storage.open('song.mp3', {start:2,end:5})).stream));
  }
});

test('OpenList bounds stalled API calls, cancels active reads and hides transport errors', async () => {
  const storage = new OpenListMediaStorage(connection, '/', async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('secret-token-and-url')), {once:true});
  }), 15);
  const start = Date.now();
  await assert.rejects(storage.validate(), {code:'MEDIA_OPENLIST_UNAVAILABLE'});
  assert.ok(Date.now() - start < 500);
  const controller = new AbortController();
  const pending = Array.fromAsync(storage.list(controller.signal)); controller.abort();
  await assert.rejects(pending, {name:'AbortError'});
});

test('OpenList terminates stalled download bodies but respects client backpressure', async () => {
  let upstreamAborted=false;
  const storage=new OpenListMediaStorage(connection,'/',async(url,init)=>{
    if(String(url).includes('/api/'))return json({...item('song.mp3'),raw_url:'https://cdn.example/data'});
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(new Uint8Array([1,2]));
      init!.signal!.addEventListener('abort',()=>{upstreamAborted=true;controller.error(new Error('secret upstream location'));},{once:true});
    }}),{status:200});
  },20);
  const opened=await storage.open('song.mp3');
  await assert.rejects(bytes(opened.stream),{code:'MEDIA_OPENLIST_UNAVAILABLE'});
  assert.equal(upstreamAborted,true);
  let downloadSignal:AbortSignal|undefined;
  const responsive=new OpenListMediaStorage(connection,'/',async(url,init)=>{
    if(String(url).includes('/api/'))return json({...item('song.mp3',false,3),raw_url:'https://cdn.example/data'});
    downloadSignal=init!.signal!;
    let position=0;
    return new Response(new ReadableStream({pull(controller){
      if(position===3)controller.close();else controller.enqueue(new Uint8Array([++position]));
    }}));
  },20);
  const stream=(await responsive.open('song.mp3')).stream,iterator=stream[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value,Buffer.from([1]));
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(downloadSignal?.aborted,false,'waiting for a paused client must not time out the source');
  const remaining:Buffer[]=[];for await(const chunk of iterator)remaining.push(chunk);
  assert.deepEqual(Buffer.concat(remaining),Buffer.from([2,3]));
});

async function serverFixture(t: TestContext) {
  const files = new Map<string, Buffer>([
    ['/音乐/track.mp3', Buffer.from('0123456789')],
    ['/音乐/TRACK.NFO', Buffer.from('<album><title>远程曲目</title><album>远程专辑</album><artist>演唱者</artist></album>')],
    ['/音乐/track.lrc', Buffer.from('[00:01.00]远程歌词')],
    ['/音乐/COVER.JPG', Buffer.from([255,216,255,1,2,3])],
    ['/音乐/Artist.NFO', Buffer.from('<artist><name>演唱者</name><biography>远程歌手简介</biography></artist>')],
  ]);
  const state = {token:'library-secret',password:'directory-secret',failed:false,failSidecar:false,origin:'',requests:[] as string[],apiCalls:[] as Array<{method:string;path:string}>};
  const server = createServer(async (req,res) => {
    state.requests.push(req.url!);
    if (req.url!.startsWith('/api/fs/')) {
      let body='';for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      state.apiCalls.push({method:req.url!,path:input.path});
      res.setHeader('content-type','application/json');
      if (req.headers.authorization !== (state.token || undefined) || input.password !== state.password) { res.end(JSON.stringify({code:403,message:'should never expose secrets'})); return; }
      if (state.failed) { res.end(JSON.stringify({code:500,message:'internal failure'})); return; }
      if (req.url === '/api/fs/list') {
        if (input.path !== '/音乐') { res.end(JSON.stringify({code:500})); return; }
        const content = [...files].map(([path,buffer]) => item(path.split('/').at(-1)!,false,buffer.length));
        res.end(JSON.stringify({code:200,data:{total:content.length,content:content.slice((input.page-1)*input.per_page,input.page*input.per_page)}})); return;
      }
      const buffer = files.get(input.path);
      if(state.failSidecar&&input.path.toLowerCase().endsWith('.nfo')){res.end(JSON.stringify({code:500}));return;}
      res.end(JSON.stringify(buffer ? {code:200,data:{...item(input.path.split('/').at(-1),false,buffer.length),raw_url:`${state.origin}/data?path=${encodeURIComponent(input.path)}`}} : {code:404})); return;
    }
    assert.equal(req.headers.authorization, undefined);
    const data = files.get(new URL(req.url!, state.origin).searchParams.get('path')!)!;
    if (req.headers.range) {
      const [,a,b] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range)!;
      res.writeHead(206, {'content-range':`bytes ${a}-${b}/${data.length}`,'content-length':Number(b)-Number(a)+1});res.end(data.subarray(Number(a),Number(b)+1));
    } else { res.writeHead(200,{'content-length':data.length});res.end(data); }
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  state.origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(()=>resolve()); }));
  return {state,files};
}

test('OpenList scans paginated media snapshots without get calls and refreshes each scan',async t=>{
  const {state,files}=await serverFixture(t),db=new Db(':memory:');
  files.clear();for(let i=0;i<220;i++)files.set(`/音乐/track-${i}.mp3`,Buffer.from('audio'));
  const libraries=new MediaLibraries(db),admin={id:'admin',role:'admin'} as const;
  const library=await libraries.create(admin,{name:'Remote',kind:'music',access:'all',storage:'openlist',root:'/音乐',openlist:{baseUrl:state.origin,token:state.token,password:state.password}});
  const scanner=new MediaScanner(db,libraries);
  t.after(async()=>{await scanner.close();db.close();});
  const scan=async()=>{const job=scanner.start(admin,library.id);await scanner.wait(library.id);return scanner.job(admin,job.id);};
  state.apiCalls.length=0;
  assert.equal((await scan()).state,'complete');
  assert.equal(scanner.assets(admin,library.id).total,220);
  assert.deepEqual(state.apiCalls.map(call=>call.method),['/api/fs/list','/api/fs/list']);
  const removed=scanner.assets(admin,library.id).items.find(asset=>asset.ref==='track-0.mp3')!;
  files.delete('/音乐/track-0.mp3');state.failed=true;
  assert.equal((await scan()).state,'failed');assert.equal(scanner.asset(admin,removed.id).available,true);
  state.failed=false;state.apiCalls.length=0;
  assert.equal((await scan()).state,'complete');assert.equal(scanner.asset(admin,removed.id).available,false);
  assert.ok(state.apiCalls.every(call=>call.method==='/api/fs/list'));
});

test('OpenList library creation, scanning, sidecars, playback, access revocation and failed scans work end to end', async t => {
  const {state} = await serverFixture(t), db = new Db(':memory:');
  t.after(() => db.close());
  for (const [id,role] of [['admin','admin'],['member','member']]) db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)',id!,id!,'unused',role!);
  const libraries = new MediaLibraries(db), admin = {id:'admin',role:'admin'} as const, member = {id:'member',role:'member'} as const;
  const input = {name:'OpenList 音乐',kind:'music',access:'restricted',storage:'openlist',root:'/音乐',openlist:{baseUrl:state.origin,token:state.token,password:state.password},requestId:'openlist-creation-test'} as const;
  const library = await libraries.create(admin,input);
  assert.equal(library.storage,'openlist');
  assert.equal((await libraries.create(admin,input)).id,library.id);
  assert.equal(libraries.configuration(admin,library.id).openlist?.hasToken,true);
  const receipt = JSON.stringify(db.all('SELECT * FROM media_library_creations'));
  for (const secret of [state.token,state.password]) {
    assert.equal(JSON.stringify(libraries.configuration(admin,library.id)).includes(secret),false);
    assert.equal(receipt.includes(secret),false);
  }
  await assert.rejects(libraries.create(admin,{...input,requestId:'openlist-bad-request',openlist:{...input.openlist,token:'wrong'}}),{code:'MEDIA_OPENLIST_AUTH'});
  assert.equal(libraries.list(admin).length,1);
  const scanner = new MediaScanner(db,libraries,async () => {throw new Error('Remote URL must never reach local ffprobe');});
  t.after(()=>scanner.close());
  state.apiCalls.length=0;
  const job = scanner.start(admin,library.id); await scanner.wait(library.id);
  assert.equal(scanner.job(admin,job.id).state,'complete');
  assert.deepEqual(state.apiCalls.filter(call=>call.method==='/api/fs/get').map(call=>call.path),['/音乐/TRACK.NFO','/音乐/Artist.NFO']);
  const assets = scanner.assets(admin,library.id).items;
  assert.equal(assets.length,1); assert.equal(assets[0]!.probe.status,'unavailable');
  const catalog = scanner.catalog.list(admin,library.id,{kind:'track'});
  assert.equal(catalog.items[0]!.title,'远程曲目');
  const cover=await new MediaArtwork(db,libraries).cover(admin,catalog.items[0]!.id);
  assert.equal(cover.contentType,'image/jpeg');
  const artist=scanner.catalog.list(admin,library.id,{kind:'artist'}).items[0]!;
  assert.equal(scanner.catalog.detail(admin,artist.id).metadata.plot,'远程歌手简介');
  assert.ok(state.requests.some(path=>path.includes('COVER.JPG')));
  const part = scanner.catalog.detail(admin,catalog.items[0]!.id).editions[0]!.parts[0]!;
  const lyrics = await new MediaLyrics(db,libraries).read(admin,part.id);
  assert.ok(JSON.stringify(lyrics).includes('远程歌词'));
  const playback = new MediaPlayback(db,libraries);
  libraries.setAccess(admin,library.id,'restricted',['member']);
  const session = playback.create(member,part.id),ticket = new URL(session.streamUrl,'http://reader').searchParams.get('ticket')!;
  const opened = await playback.stream(session.id,ticket,'bytes=2-5');
  assert.equal((await bytes(opened.stream)).toString(),'2345');
  libraries.setAccess(admin,library.id,'restricted',[]);
  await assert.rejects(playback.stream(session.id,ticket),{statusCode:404});
  state.failed = true;
  const failure = scanner.start(admin,library.id);await scanner.wait(library.id);
  assert.equal(scanner.job(admin,failure.id).error,'openlist-unavailable');
  assert.equal(scanner.assets(admin,library.id).items[0]!.available,true);
  state.failed = false;
  state.failSidecar = true;
  const sidecarFailure=scanner.start(admin,library.id);await scanner.wait(library.id);
  assert.equal(scanner.job(admin,sidecarFailure.id).state,'failed');
  assert.equal(scanner.catalog.detail(admin,catalog.items[0]!.id).title,'远程曲目');
  state.failSidecar = false;
  state.token = 'rotated-token';
  await libraries.update(admin,library.id,{openlist:{token:state.token}});
  assert.equal(libraries.configuration(admin,library.id).openlist?.hasPassword,true);
  await assert.rejects(libraries.update(member,library.id,{openlist:{token:'wrong'}}),{statusCode:403});
  await assert.rejects(libraries.update(admin,library.id,{openlist:{token:'wrong'}}),{code:'MEDIA_OPENLIST_AUTH'});
  state.token = ''; state.password = '';
  await libraries.update(admin,library.id,{openlist:{token:'',password:''}});
  assert.deepEqual(libraries.configuration(admin,library.id).openlist,{baseUrl:state.origin,hasToken:false,hasPassword:false});
});

test('OpenList HTTP creation and credential renewal enforce admin access and sanitized responses', async t => {
  const {state}=await serverFixture(t),base=await mkdtemp(join(tmpdir(),'reader-openlist-api-'));
  await mkdir(join(base,'books'));
  const original={BOOKS_DIR:process.env.BOOKS_DIR,DATA_DIR:process.env.DATA_DIR,READER_TOKEN_SECRET:process.env.READER_TOKEN_SECRET};
  process.env.BOOKS_DIR=join(base,'books');process.env.DATA_DIR=join(base,'data');process.env.READER_TOKEN_SECRET='openlist-test-secret';
  const config=loadConfig(),db=new Db(':memory:'),app=Fastify({logger:false});
  for(const [key,value]of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  for(const [id,role]of [['admin','admin'],['member','member']])db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,0,0)',id!,id!,'unused',role!);
  registerErrorHandler(app);registerMediaRoutes(app,{db,config,users:new UserService(db,config)});
  t.after(async()=>{await app.close();db.close();await rm(base,{recursive:true,force:true});});
  const admin={authorization:'Bearer '+signAccessToken(config,{id:'admin',role:'admin'}).token};
  const member={authorization:'Bearer '+signAccessToken(config,{id:'member',role:'member'}).token};
  const payload={name:'远程音乐',storage:'openlist',kind:'music',root:'/音乐',access:'all',openlist:{baseUrl:state.origin,token:state.token,password:state.password}};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/media/libraries',payload,headers:member})).statusCode,403);
  const created=await app.inject({method:'POST',url:'/api/v1/media/libraries',payload,headers:admin});
  assert.equal(created.statusCode,201,created.body);assert.equal(created.json().storage,'openlist');
  const url=`/api/v1/media/libraries/${created.json().id}`;
  const publicResult=await app.inject({url,headers:member});
  for(const value of [state.origin,state.token,state.password])assert.equal(publicResult.body.includes(value),false);
  const configuration=await app.inject({url:url+'/configuration',headers:admin});
  assert.deepEqual(configuration.json().openlist,{baseUrl:state.origin,hasToken:true,hasPassword:true});
  assert.equal(configuration.headers['cache-control'],'private, no-store');
  state.token='renewed-secret';
  const updated=await app.inject({method:'PATCH',url,headers:admin,payload:{openlist:{token:state.token}}});
  assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.body.includes(state.token),false);
  const failed=await app.inject({method:'PATCH',url,headers:admin,payload:{openlist:{token:'wrong'}}});
  assert.equal(failed.statusCode,502);assert.equal(failed.json().error.code,'MEDIA_OPENLIST_AUTH');
  assert.equal(failed.body.includes('should never expose secrets'),false);
  assert.equal((await app.inject({method:'PATCH',url,headers:member,payload:{openlist:{token:'wrong'}}})).statusCode,403);
});
