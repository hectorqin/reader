/** Isolates publication of synthetic staged records; does not claim filesystem/probe coverage. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import Fastify from 'fastify';
import {Db} from '../src/db/index.ts';
import {loadConfig} from '../src/config/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaStoreDatabase} from '../src/media/store-database.ts';
import {migrateMediaDatabase} from '../src/media/migrate-database.ts';
import {MediaPublicationRunner} from '../src/media/publication-runner.ts';
import {UserService} from '../src/services/users.ts';
import {ShelfService} from '../src/services/shelf.ts';
import {SyncService} from '../src/services/sync.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {registerLibraryRoutes} from '../src/http/routes/library.ts';
import {registerSyncRoutes} from '../src/http/routes/sync.ts';
import {registerErrorHandler} from '../src/http/errors.ts';
import type {AppContext} from '../src/http/context.ts';

const isolated=process.argv.includes('--isolated');
assert.ok(!(isolated&&process.argv.includes('--profile')),'SQL profiling is only supported for the synchronous publisher');
const sizes=process.argv.includes('--large')?[10000,50000]:[100,1000,5000];
const memory=()=>({rssMiB:Math.round(process.memoryUsage().rss/1048576),heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576),processPeakRssMiB:Math.round(process.resourceUsage().maxRSS/1024)});

if(process.argv.includes('--server')){
  const root=await mkdtemp(join(tmpdir(),'media-publish-benchmark-'));
  await mkdir(join(root,'books'));
  process.env.BOOKS_DIR=join(root,'books');process.env.DATA_DIR=join(root,'data');process.env.READER_TOKEN_SECRET='publish-benchmark';
  const config=loadConfig(),db=new Db(join(root,'state.db')),libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries),app=Fastify({logger:false});
  let mediaStore:MediaStoreDatabase|undefined,runner:MediaPublicationRunner|undefined;
  try{
    const shelf=new ShelfService(db),ctx={db,config,shelf,sync:new SyncService(db,shelf),users:new UserService(db,config)} as AppContext;
    registerErrorHandler(app);registerLibraryRoutes(app,ctx);registerSyncRoutes(app,ctx);
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('reader','reader','unused','member',0,0)");
    db.run("INSERT INTO books(id,content_hash,format,title,created_at,updated_at) VALUES('book','hash','txt','Reading book',0,0)");
    db.run("INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) VALUES('file','book','book.txt',1,0,0,0)");
    db.run("INSERT INTO user_books(user_id,book_id,added_at) VALUES('reader','book',0)");
    if(isolated){
      const target=join(root,'media.db');
      migrateMediaDatabase(join(root,'state.db'),target);mediaStore=new MediaStoreDatabase(target);
      const Runner=process.argv.includes('--built')?(await import('../dist/media/publication-runner.js')).MediaPublicationRunner:MediaPublicationRunner;
      runner=new Runner(target);
    }
    const mediaDb=mediaStore||db;
    // Fixture-only routes, bound to loopback in a disposable subprocess.
    app.post<{Body:{count:number}}>('/benchmark/prepare',async request=>{
      const count=request.body.count;
      assert.ok(sizes.includes(count));
      const libraryId='lib-'+count,jobId='job-'+count;
      mediaDb.transaction(()=>{
        mediaDb.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,'music',?,'all',0,0)",libraryId,libraryId,root);
        mediaDb.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,probe_status) VALUES(?,?,'old.mp3',1,0,'ready')",'old-'+count,libraryId);
        mediaDb.run("INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES(?,?,'running',0)",jobId,libraryId);
        for(let i=0;i<count;i++){
          const ref=`Artist/Album ${Math.floor(i/10)}/track-${i}.mp3`;
          const staged={ref,size:1024,modifiedAt:0,fileIdentity:'identity-'+i,metadata:{title:'Track '+i,artist:'Artist',album:'Album '+Math.floor(i/10),track:i%10+1},probe:{status:'ready',info:{format:'mp3',duration:60,streams:[],chapters:[],tags:{}}}};
          mediaDb.run('INSERT INTO media_scan_stage(job_id,ref,payload) VALUES(?,?,?)',jobId,ref,JSON.stringify(staged));
        }
      });
      return {libraryId,jobId};
    });
    app.post<{Body:{libraryId:string;jobId:string;count:number}}>('/benchmark/publish',async request=>{
      const {libraryId,jobId,count}=request.body;
      mediaDb.run("UPDATE media_scan_jobs SET state='running',finished_at=NULL WHERE id=?",jobId);
      const timings=new Map<string,{calls:number;ms:number}>();
      const executor=Reflect.get(scanner,'db') as Pick<Db,'get'|'all'|'run'>;
      const originals={get:executor.get,all:executor.all,run:executor.run};
      if(process.argv.includes('--profile'))for(const method of ['get','all','run'] as const){
        const original=originals[method];
        Reflect.set(executor,method,function(sql:string,...params:unknown[]){
          const start=performance.now();
          try{return Reflect.apply(original,executor,[sql,...params]);}
          finally{const key=method+' '+sql.replace(/\s+/g,' ').trim(),entry=timings.get(key)||{calls:0,ms:0};entry.calls++;entry.ms+=performance.now()-start;timings.set(key,entry);}
        });
      }
      const before=memory(),start=performance.now();
      try{if(runner)await runner.publish(libraryId,jobId);else Reflect.apply(Reflect.get(scanner,'publish'),scanner,[libraryId,jobId]);}
      finally{for(const method of ['get','all','run'] as const)Reflect.set(executor,method,originals[method]);}
      const ms=performance.now()-start,after=memory();
      assert.equal(mediaDb.get<{state:string}>('SELECT state FROM media_scan_jobs WHERE id=?',jobId)!.state,'complete');
      assert.equal(mediaDb.get<{n:number}>('SELECT count(*) n FROM media_assets WHERE library_id=? AND available=1',libraryId)!.n,count);
      assert.equal(mediaDb.get<{n:number}>("SELECT count(*) n FROM media_items WHERE library_id=? AND kind='track'",libraryId)!.n,count);
      assert.equal(mediaDb.get<{available:number}>('SELECT available FROM media_assets WHERE id=?','old-'+count)!.available,0);
      return {ms,assets:count,tracks:count,memory:{before,after},...(timings.size?{sql:[...timings.entries()].sort((a,b)=>b[1].ms-a[1].ms).slice(0,8).map(([sql,value])=>({sql,...value,ms:Math.round(value.ms)}))}:{})};
    });
    const origin=await app.listen({host:'127.0.0.1',port:0});
    process.stdout.write(JSON.stringify({origin,token:signAccessToken(config,{id:'reader',role:'member'}).token})+'\n');
    await new Promise<void>(resolve=>{process.stdin.resume();process.stdin.once('data',()=>resolve());process.stdin.once('end',()=>resolve());});
  }finally{await app.close();await runner?.close();mediaStore?.close();await scanner.close();db.close();await rm(root,{recursive:true,force:true});}
}else{
  const child=spawn(process.execPath,[...process.execArgv,fileURLToPath(import.meta.url),'--server',...(isolated?['--isolated']:[]),...(process.argv.includes('--built')?['--built']:[]),...(process.argv.includes('--profile')?['--profile']:[]),...(process.argv.includes('--large')?['--large']:[])],{stdio:['pipe','pipe','inherit'],windowsHide:true});
  try{
    const lines=createInterface({input:child.stdout});
    const ready=await Promise.race([new Promise<string>((resolve,reject)=>{lines.once('line',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('fixture exited '+code)));}),delay(30000,undefined,{ref:false}).then(()=>{throw Error('startup timeout');})]);
    lines.close();const {origin,token}=JSON.parse(ready);
    const request=async(path:string,method='GET',payload?:unknown)=>{
      const start=performance.now(),response=await fetch(origin+path,{method,headers:{authorization:'Bearer '+token,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(120000)});
      assert.equal(response.status,200);return {ms:performance.now()-start,body:await response.json()};
    };
    let sequence=0;
    const read=async()=>{
      const locator='page-'+(++sequence);
      const [shelf,save]=await Promise.all([request('/api/v1/books'),request('/api/v1/sync/progress/book','PUT',{locator,percentage:.5,updatedAt:Date.now()+sequence})]);
      assert.equal(shelf.body.total,1);assert.equal(shelf.body.items[0].id,'book');assert.equal(save.body.progress.locator,locator);
      assert.equal((await request('/api/v1/sync/progress/book')).body.progress.locator,locator);
      return {shelfMs:Math.round(shelf.ms),saveMs:Math.round(save.ms)};
    };
    const baseline=[];for(let i=0;i<3;i++)baseline.push(await read());
    const measurements=[];
    for(const count of sizes){
      const prepared=await request('/benchmark/prepare','POST',{count});
      const measure=async(unchangedRepeat=false)=>{
        let finished=false;
        const publishing=request('/benchmark/publish','POST',{...prepared.body,count}).finally(()=>{finished=true;});
        const samples=[];
        do{await delay(10);samples.push(await read());}while(!finished);
        const published=await publishing;
        measurements.push({staged:count,...(unchangedRepeat?{unchangedRepeat:true}:{}),publishMs:Math.round(published.body.ms),readingSamples:samples.length,
          shelfMaxMs:Math.max(...samples.map(s=>s.shelfMs)),saveMaxMs:Math.max(...samples.map(s=>s.saveMs)),memory:published.body.memory,...(published.body.sql?{sql:published.body.sql}:{})});
      };
      await measure();
      if(count===sizes.at(-1))await measure(true);
    }
    console.log(JSON.stringify({node:process.version,platform:process.platform,isolated,builtWriter:process.argv.includes('--built'),baseline,measurements,scope:'real MediaPublisher via scanner or isolated worker on synthetic staged music records; real reading shelf/save/readback HTTP; one sample per size, warm local temporary SQLite; excludes enumeration, probes, NAS and device rendering'}));
  }finally{
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.stdin.end('\n');
    await Promise.race([exited,delay(10000,undefined,{ref:false}).then(()=>{if(child.exitCode===null)child.kill();})]);
  }
}
