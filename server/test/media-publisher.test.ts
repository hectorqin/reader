import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaCatalog} from '../src/media/catalog.ts';
import {MediaPublisher} from '../src/media/publisher.ts';
import {MediaStoreDatabase} from '../src/media/store-database.ts';
import {MediaStatementDatabase} from '../src/media/statement-database.ts';
import {DatabaseMediaAccounts} from '../src/media/accounts.ts';
import {migrateMediaDatabase} from '../src/media/migrate-database.ts';

test('isolated publisher preserves unrelated jobs, shares no reading write lock and acknowledges committed jobs without replay',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-publisher-')),source=join(root,'reader.db'),target=join(root,'media.db');
  const core=new Db(source),libraries=new MediaLibraries(core),scanner=new MediaScanner(core,libraries);
  let store:MediaStoreDatabase|undefined;
  try{
    core.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','private','admin',0,0)");
    core.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','lib','music','/media','all',0,0)");
    for(const id of ['publish','other','cancelled'])core.run('INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES(?,?,?,0)',id,'lib',id==='cancelled'?'cancelled':'running');
    const staged={ref:'track.mp3',size:1,modifiedAt:0,fileIdentity:'one',metadata:{title:'Song',artist:'Artist',album:'Album'},probe:{status:'unavailable',info:null}};
    core.run('INSERT INTO media_scan_stage VALUES(?,?,?)','publish',staged.ref,JSON.stringify(staged));
    assert.throws(()=>new MediaStoreDatabase(target),/migrated/);
    migrateMediaDatabase(source,target);store=new MediaStoreDatabase(target);
    const executor=new MediaStatementDatabase(store),mediaLibraries=new MediaLibraries(store,false,new DatabaseMediaAccounts(core));
    const catalog=new MediaCatalog(executor,mediaLibraries,false),publisher=new MediaPublisher(executor,catalog);
    store.transaction(()=>{
      store.run("UPDATE media_libraries SET name='Writing' WHERE id='lib'");
      core.run("UPDATE users SET display_name='Reading write succeeds' WHERE id='admin'");
    });
    publisher.publish('lib','publish');
    assert.equal(store.get<{state:string}>("SELECT state FROM media_scan_jobs WHERE id='other'")!.state,'running');
    assert.equal(store.get<{state:string}>("SELECT state FROM media_scan_jobs WHERE id='publish'")!.state,'complete');
    const assets=store.all('SELECT * FROM media_assets'),parts=store.all('SELECT * FROM media_parts');
    assert.equal(assets.length,1);assert.equal(parts.length,1);
    assert.equal(core.all('SELECT * FROM media_assets').length,0,'legacy database is not the publication target');
    store.run("UPDATE media_scan_stage SET payload='invalid' WHERE job_id='publish'");
    publisher.publish('lib','publish');
    assert.deepEqual(store.all('SELECT * FROM media_assets'),assets);assert.deepEqual(store.all('SELECT * FROM media_parts'),parts);
    assert.throws(()=>publisher.publish('wrong-lib','publish'),/does not belong/);
    assert.throws(()=>publisher.publish('lib','cancelled'),/no longer running/);
    assert.equal(store.get("SELECT name FROM sqlite_master WHERE name='books'"),undefined);
    executor.clear();
  }finally{store?.close();await scanner.close();core.close();await rm(root,{recursive:true,force:true});}
});
