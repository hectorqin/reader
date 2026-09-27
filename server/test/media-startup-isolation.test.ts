import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {Db} from '../src/db/index.ts';
import {loadConfig} from '../src/config/index.ts';
import {Scanner} from '../src/indexer/scanner.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {createMediaService} from '../src/media/start-runtime.ts';

test('real main serves reading during a paused migration, then activates only the independent media store',async()=>{
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url)),'-p',fileURLToPath(new URL('../tsconfig.build.json',import.meta.url))]);
  const root=await mkdtemp(join(tmpdir(),'media-start-isolated-')),books=join(root,'books');
  await mkdir(books);await writeFile(join(books,'reading.txt'),'第一章\n阅读隔离验证\n'.repeat(20));
  const paused=join(root,'paused'),resume=join(root,'resume'),preload=join(root,'pause-migration.mjs');
  process.env.BOOKS_DIR=books;process.env.DATA_DIR=root;process.env.READER_TOKEN_SECRET='startup-isolation-test';
  const config=loadConfig(),db=new Db(join(root,'reader.db'));
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','reader','private','admin',0,0)");
  await new Scanner(db,config,{info(){},warn(){}}).scan();
  const book=db.get<{id:string}>('SELECT id FROM books')!.id;
  db.run("INSERT OR IGNORE INTO user_books(user_id,book_id,added_at) VALUES('u',?,0)",book);
  db.run('CREATE TABLE media_startup_sample(id TEXT PRIMARY KEY,value TEXT)');
  db.run("INSERT INTO media_startup_sample VALUES('one','preserved'),('two','also preserved')");
  db.close();
  // Test-only preload, inherited by the real production Worker. Hold an actual
  // copy transaction after one row, without adding timing hooks to production.
  await writeFile(preload,`
    import {DatabaseSync} from 'node:sqlite';
    import {isMainThread} from 'node:worker_threads';
    import {writeFileSync,existsSync} from 'node:fs';
    const prepare=DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare=function(sql){
      const statement=prepare.call(this,sql);
      if(!isMainThread&&sql==='SELECT "id","value" FROM "media_startup_sample"'){
        const iterate=statement.iterate.bind(statement);
        statement.iterate=function*(){
          let index=0;
          for(const row of iterate()){
            if(index++===1){
              writeFileSync(${JSON.stringify(paused)},'paused');
              const deadline=Date.now()+20000;
              while(!existsSync(${JSON.stringify(resume)})){
                if(Date.now()>deadline)throw Error('migration barrier timed out');
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
              }
            }
            yield row;
          }
        };
      }
      return statement;
    };
  `);
  const entry=fileURLToPath(new URL('../dist/main.js',import.meta.url));
  const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,entry],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',SCAN_INTERVAL:'0',WATCH_INTERVAL:'0',WEB_DIR:''},
  });
  let logs='';child.stderr!.on('data',chunk=>{logs+=chunk;});
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  const lines=createInterface({input:child.stdout!});
  try{
    const origin=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('listen timeout '+logs)),15000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code+' '+logs));});
      lines.on('line',line=>{
        logs=(logs+line+'\n').slice(-10000);
        try{const match=/Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(JSON.parse(line).msg);
          if(match){clearTimeout(timer);resolve(match[1]!);}
        }catch{}
      });
    });
    const headers={authorization:'Bearer '+signAccessToken(config,{id:'u',role:'admin'}).token};
    const call=async(path:string,method='GET',payload?:unknown)=>{
      const response=await fetch(origin+path,{method,headers:{...headers,...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(5000)});
      return {status:response.status,body:await response.json()};
    };
    for(let attempt=0;;attempt++){
      try{await access(paused);break;}catch{assert.ok(attempt<300,'migration never paused: '+logs);await delay(20);}
    }
    const pending=await call('/api/v1/media/libraries');
    assert.equal(pending.status,503);assert.equal(pending.body.error.code,'MEDIA_STARTING');
    const checkReading=async(index:number)=>{
      const shelf=await call('/api/v1/books');assert.equal(shelf.status,200);assert.equal(shelf.body.items[0].id,book);
      const locator='chapter:'+index;
      assert.equal((await call('/api/v1/sync/progress/'+book,'PUT',{locator,percentage:.4,updatedAt:Date.now()+index})).status,200);
      assert.equal((await call('/api/v1/sync/progress/'+book)).body.progress.locator,locator);
    };
    for(let index=0;index<20;index++)await checkReading(index);
    const before=new DatabaseSync(join(root,'reader.db'),{readOnly:true});
    try{assert.equal(before.prepare('SELECT activated FROM media_storage_identity').get()!.activated,0);}finally{before.close();}
    await writeFile(resume,'resume');
    for(let index=20;;index++){
      await checkReading(index);
      const media=await call('/api/v1/media/libraries');
      if(media.status===200){assert.deepEqual(media.body.items,[]);break;}
      assert.equal(media.body.error.code,'MEDIA_STARTING');assert.ok(index<320,'media did not start: '+logs);await delay(20);
    }
    const core=new DatabaseSync(join(root,'reader.db'),{readOnly:true}),media=new DatabaseSync(join(root,'media.db'),{readOnly:true});
    try{
      assert.equal(core.prepare('SELECT activated FROM media_storage_identity').get()!.activated,1);
      assert.equal(core.prepare("SELECT name FROM sqlite_master WHERE name='media_libraries'").get(),undefined);
      assert.deepEqual(media.prepare('SELECT value FROM media_startup_sample ORDER BY id').all().map(row=>row.value),['preserved','also preserved']);
      assert.equal(media.prepare("SELECT name FROM sqlite_master WHERE name='books'").get(),undefined);
    }finally{core.close();media.close();}
  }finally{child.kill();await exited;lines.close();await rm(root,{recursive:true,force:true});}
});

test('closing deferred media before or immediately after start cannot reopen it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-start-close-'));process.env.DATA_DIR=root;
  const config=loadConfig(),db=new Db(join(root,'reader.db')),errors:unknown[]=[];
  try{
    const neverStarted=createMediaService(db,config,error=>errors.push(error));
    await neverStarted.close();neverStarted.start();
    await assert.rejects(neverStarted.request('/api/v1/media/libraries'),{code:'MEDIA_UNAVAILABLE'});
    await assert.rejects(access(join(root,'media.db')),{code:'ENOENT'});
    const starting=createMediaService(db,config,error=>errors.push(error));
    starting.start();await starting.close();
    await assert.rejects(starting.request('/api/v1/media/libraries'),{code:'MEDIA_UNAVAILABLE'});
    assert.deepEqual(errors,[]);
  }finally{db.close();await rm(root,{recursive:true,force:true});}
});
