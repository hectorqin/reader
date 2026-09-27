/** Local HTTP concurrency probe. Uses an isolated server process and disposable synthetic data. */
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {Db} from '../src/db/index.ts';
import {loadConfig} from '../src/config/index.ts';
import {UserService} from '../src/services/users.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {registerMediaRoutes as registerSourceMediaRoutes} from '../src/http/routes/media.ts';
import {registerErrorHandler} from '../src/http/errors.ts';
import type {AppContext} from '../src/http/context.ts';
import {registerLibraryRoutes} from '../src/http/routes/library.ts';
import {registerSyncRoutes} from '../src/http/routes/sync.ts';
import {ShelfService} from '../src/services/shelf.ts';
import {SyncService} from '../src/services/sync.ts';
import {MediaCatalogReader} from '../src/media/catalog-reader.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaCatalog} from '../src/media/catalog.ts';
import {MediaFolders} from '../src/media/folders.ts';
import {MediaUserState} from '../src/media/user-state.ts';
import {executeCatalogQuery} from '../src/media/catalog-query.ts';
import type {CatalogQuery} from '../src/media/catalog-query.ts';

const reading=process.argv.includes('--reading');
const synchronous=process.argv.includes('--sync-baseline');
const folderLoad=process.argv.includes('--folders');
const personalLoad=process.argv.includes('--personal');
if(folderLoad&&personalLoad)throw new Error('choose --folders or --personal');
if(synchronous&&process.argv.includes('--built'))throw new Error('--sync-baseline is source-only');

if(process.argv.includes('--server')){
  const registerMediaRoutes=process.argv.includes('--built')
    ? (await import('../dist/http/routes/media.js')).registerMediaRoutes : registerSourceMediaRoutes;
  const root=await mkdtemp(join(tmpdir(),'media-http-benchmark-'));
  await mkdir(join(root,'books'));process.env.BOOKS_DIR=join(root,'books');process.env.DATA_DIR=join(root,'data');process.env.READER_TOKEN_SECRET='benchmark-only';
  const db=new Db(join(root,'state.db')),config=loadConfig(),app=Fastify({logger:false});
  try{
    const shelf=new ShelfService(db),sync=new SyncService(db,shelf);
    const ctx={db,config,users:new UserService(db,config),shelf,sync} as AppContext;
    registerErrorHandler(app);registerMediaRoutes(app,ctx);
    if(synchronous){
      // Benchmark-only control: use the identical catalog methods on the HTTP thread.
      const libraries=new MediaLibraries(db,false),catalog=new MediaCatalog(db,libraries,false),folders=new MediaFolders(db,libraries,catalog),state=new MediaUserState(db,libraries,catalog,false);
      MediaCatalogReader.prototype.query=async(query:CatalogQuery)=>db.transaction(()=>({
        id:0,access:{actor:query.args[0],libraryIds:libraries.list(query.args[0]).map(library=>library.id).sort()},
        result:executeCatalogQuery(catalog,folders,state,query),
      }));
    }
    if(reading){registerLibraryRoutes(app,ctx);registerSyncRoutes(app,ctx);}
    app.get('/probe',async()=>({ok:true}));
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','unused','member',0,0)");
    if(reading){
      db.run(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000)
        INSERT INTO books(id,content_hash,format,title,created_at,updated_at)
        SELECT printf('book-%04d',n),printf('hash-%04d',n),'txt',printf('Book %04d',n),0,0 FROM seq`);
      db.run("INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) SELECT id,id,id||'.txt',100,0,0,0 FROM books");
      db.run("INSERT INTO user_books(user_id,book_id,added_at) SELECT 'member',id,0 FROM books");
    }
    for(const [id,access]of [['visible','all'],['private','restricted']])db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,'music',?,?,0,0)",id!,id!,root,access!);
    db.run(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000)
      INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json)
      SELECT printf('item-%06d',n),CASE WHEN n%5=0 THEN 'private' ELSE 'visible' END,'track',cast(n AS TEXT),printf('Track %06d',n),json_object('artist','Artist '||(n%10),'album','Album '||(n%100)) FROM seq`);
    if(folderLoad)db.run(`WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<99999)
      INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status)
      SELECT cast(n AS TEXT),'visible',printf('🎧目录%03d/track-%06d.mp3',n/1000,n),1024,0,CASE WHEN n%10=0 THEN 0 ELSE 1 END,'ready' FROM seq`);
    if(personalLoad){
      db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,probe_status) SELECT id,library_id,id||'.mp3',1024,0,'ready' FROM media_items");
      db.run("INSERT INTO media_editions(id,item_id,local_key,label) SELECT id,id,id,'默认版本' FROM media_items");
      db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) SELECT id,id,id,id,title,0 FROM media_items");
      db.run("INSERT INTO media_favorites SELECT 'member',id,0 FROM media_items");
      db.run("INSERT INTO media_progress(user_id,part_id,position,revision,session_id,updated_at) SELECT 'member',id,5,1,'benchmark',0 FROM media_items");
    }
    const origin=await app.listen({host:'127.0.0.1',port:0});
    process.stdout.write(JSON.stringify({origin,token:signAccessToken(config,{id:'member',role:'member'}).token})+'\n');
    await new Promise<void>(resolve=>{process.stdin.resume();process.stdin.once('data',()=>resolve());process.stdin.once('end',()=>resolve());});
  }finally{await app.close();db.close();await rm(root,{recursive:true,force:true});}
}else{
  const child=spawn(process.execPath,[...process.execArgv,fileURLToPath(import.meta.url),'--server',...(process.argv.includes('--built')?['--built']:[]),...(reading?['--reading']:[]),...(synchronous?['--sync-baseline']:[]),...(folderLoad?['--folders']:[]),...(personalLoad?['--personal']:[])],{stdio:['pipe','pipe','inherit'],windowsHide:true});
  try{
    const lines=createInterface({input:child.stdout});
    const ready=await Promise.race([new Promise<string>((resolve,reject)=>{lines.once('line',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error('fixture exited '+code)));}),delay(30000,undefined,{ref:false}).then(()=>{throw Error('fixture startup timeout');})]);
    lines.close();const {origin,token}=JSON.parse(ready) as {origin:string;token:string};
    const paths=folderLoad?['/api/v1/media/libraries/visible/folders?limit=60']:personalLoad?
      ['/api/v1/media/favorites?channel=music&limit=60','/api/v1/media/history?channel=music&limit=60','/api/v1/media/history?channel=music&limit=60&offset=60000']:
      ['/api/v1/media/browse?channel=music&kind=track&limit=60','/api/v1/media/browse?channel=music&kind=track&offset=60000&limit=60','/api/v1/media/browse?channel=music&kind=track&artist=Artist%203&album=Album%203&limit=60'];
    const request=async(path:string,payload?:unknown)=>{const start=performance.now();const response=await fetch(origin+path,{method:payload?'PUT':'GET',headers:{authorization:'Bearer '+token,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);const body=await response.json();return {ms:performance.now()-start,body};};
    let progressSequence=0;
    const readAndSave=async()=>{
      const sequence=++progressSequence;
      const payload={locator:'chapter:'+sequence,percentage:sequence/100,chapterTitle:'第 '+sequence+' 章',device:'benchmark',updatedAt:Date.now()+sequence};
      const [books,saved]=await Promise.all([request('/api/v1/books?pageSize=50'),request('/api/v1/sync/progress/book-0001',payload)]);
      assert.equal(books.body.total,1000);assert.equal(books.body.items.length,50);
      assert.ok(books.body.items.every((book:{id:string})=>book.id.startsWith('book-')));
      for(const field of ['locator','percentage','chapterTitle','device','updatedAt'] as const)assert.equal(saved.body.progress[field],payload[field]);
      const restored=await request('/api/v1/sync/progress/book-0001');
      assert.deepEqual(restored.body.progress,saved.body.progress);
      return {shelf:books.ms,save:saved.ms,restore:restored.ms};
    };
    const baseline=[];for(let i=0;i<5;i++)baseline.push((await request('/probe')).ms);
    const readingBaseline=[];if(reading)for(let i=0;i<5;i++)readingBaseline.push(await readAndSave());
    const rows=[];
    for(const concurrency of [1,4,8]){
      const times:number[]=[],probes:number[]=[],readingTimes:Array<{shelf:number;save:number;restore:number}>=[];
      for(let round=0;round<3;round++){
        const pending=Array.from({length:concurrency},(_,index)=>request(paths[(round+index)%paths.length]!).then(result=>{
          assert.equal(result.body.items.length,60);
          if(folderLoad){assert.equal(result.body.total,100);assert.ok(result.body.items.every((item:{files:number;availableFiles:number;size:number})=>item.files===1000&&item.availableFiles===900&&item.size===1024000));}
          else assert.ok(result.body.items.every((item:{libraryId:string})=>item.libraryId==='visible'));
          if(personalLoad)assert.equal(result.body.total,80000);
          times.push(result.ms);
        }));
        await delay(10);const probe=request('/probe').then(result=>probes.push(result.ms));
        const readingWork=reading?readAndSave().then(result=>readingTimes.push(result)):Promise.resolve();
        await Promise.all([...pending,probe,readingWork]);
      }
      const median=(values:number[])=>Math.round([...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]!);
      rows.push({concurrency,requests:times.length,medianMs:median(times),maxMs:Math.round(Math.max(...times)),probeMedianMs:median(probes),probeMaxMs:Math.round(Math.max(...probes)),...(reading?{reading:Object.fromEntries((['shelf','save','restore'] as const).map(key=>[key,{medianMs:median(readingTimes.map(row=>row[key])),maxMs:Math.round(Math.max(...readingTimes.map(row=>row[key])))}]))}:{})});
    }
    console.log(JSON.stringify({build:process.argv.includes('--built')?'dist':'source',execution:synchronous?'synchronous-control':'worker',workload:folderLoad?'100000 assets, 100 folders, root aggregation':personalLoad?'100000 favorites and progress records, 80000 visible':'catalog browse',rows:100000,visible:80000,platform:process.platform,node:process.version,probeBaselineMs:baseline.map(Math.round),...(reading?{readingBooks:1000,readingBaselineMs:readingBaseline.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Math.round(value)])))}:{}),measurements:rows,scope:'loopback HTTP, separate client/server processes, synthetic data, warm OS cache; '+(reading?'real shelf and progress HTTP routes with synthetic index; no book content parsing, rendering, scanning, real media or NAS':'no scanning, real media, NAS or reading-route workload')}));
  }finally{
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.stdin.end('\n');
    await Promise.race([exited,delay(10000,undefined,{ref:false}).then(()=>{if(child.exitCode===null)child.kill();})]);
  }
}
