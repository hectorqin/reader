import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Worker} from 'node:worker_threads';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaStoreDatabase} from '../src/media/store-database.ts';
import {migrateMediaDatabase} from '../src/media/migrate-database.ts';
import {MediaPublicationRunner} from '../src/media/publication-runner.ts';

test('publication worker leaves the reading database responsive and supports durable retry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-writer-')),source=join(root,'reader.db'),target=join(root,'media.db');
  const core=new Db(source),scanner=new MediaScanner(core,new MediaLibraries(core));
  let store:MediaStoreDatabase|undefined,runner:MediaPublicationRunner|undefined;
  try{
    core.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','private','admin',0,0)");
    core.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','lib','music','/media','all',0,0)");
    core.run("INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES('job','lib','running',0)");
    core.transaction(()=>{
      for(let i=0;i<5000;i++){
        const staged={ref:`${i}.mp3`,size:1,modifiedAt:0,fileIdentity:String(i),metadata:{title:`Song ${i}`,artist:'Artist',album:'Album'},probe:{status:'unavailable',info:null}};
        core.run('INSERT INTO media_scan_stage VALUES(?,?,?)','job',staged.ref,JSON.stringify(staged));
      }
    });
    migrateMediaDatabase(source,target);store=new MediaStoreDatabase(target);runner=new MediaPublicationRunner(target);
    let committed=false,readingWrites=0,timer:ReturnType<typeof setInterval>|undefined;
    const publication=runner.publish('lib','job');
    const worker=Reflect.get(runner,'worker') as Worker;
    worker.on('message',(message:{state:string})=>{
      if(message.state==='committed')committed=true;
      if(message.state==='started')timer=setInterval(()=>{
        if(committed)return;
        core.run('UPDATE users SET updated_at=? WHERE id=?',++readingWrites,'admin');
        assert.equal(core.get<{updated_at:number}>("SELECT updated_at FROM users WHERE id='admin'")!.updated_at,readingWrites);
      },5);
    });
    await assert.rejects(runner.publish('lib','job'),{code:'MEDIA_PUBLICATION_BUSY'});
    try{await publication;}finally{if(timer)clearInterval(timer);}
    assert.ok(readingWrites>0,'main-thread reading database work runs during publication');
    assert.equal(store.all('SELECT id FROM media_assets').length,5000);
    assert.equal(core.all('SELECT id FROM media_assets').length,0);
    store.run("UPDATE media_scan_stage SET payload='invalid' WHERE job_id='job'");
    await runner.publish('lib','job');
    assert.equal(store.get<{state:string}>("SELECT state FROM media_scan_jobs WHERE id='job'")!.state,'complete');
    store.run("UPDATE media_scan_jobs SET state='running' WHERE id='job'");
    await assert.rejects(runner.publish('lib','job'),{code:'MEDIA_PUBLICATION_UNCERTAIN'});
    assert.equal(store.all('SELECT id FROM media_assets').length,5000,'failed transaction preserves prior catalog');
    const interrupted=runner.publish('lib','job');
    const rejected=assert.rejects(interrupted,{code:'MEDIA_PUBLICATION_UNCERTAIN'});
    await runner.close();await rejected;
    await assert.rejects(runner.publish('lib','job'),{code:'MEDIA_PUBLICATION_CLOSED'});
    assert.equal(store.get<{state:string}>("SELECT state FROM media_scan_jobs WHERE id='job'")!.state,'running','termination is not labelled cancelled');
  }finally{await runner?.close();store?.close();await scanner.close();core.close();await rm(root,{recursive:true,force:true});}
});
