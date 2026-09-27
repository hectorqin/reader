import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from '../src/db/index.ts';
import {activateMediaDatabase} from '../src/media/migrate-database.ts';

test('termination inside a real migration transaction rolls back and startup can retry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-migration-crash-')),source=join(root,'reader.db'),target=join(root,'media.db');
  const core=new Db(source);core.run('CREATE TABLE media_sample(id TEXT PRIMARY KEY,value TEXT)');
  core.run("INSERT INTO media_sample VALUES('one','preserved'),('two','also preserved')");
  const moduleUrl=new URL('../src/media/migrate-database.ts',import.meta.url).href;
  // Instrument only this test worker's SQLite iterator. Pause after the first row
  // was inserted by the real migration, with its target transaction still open.
  const worker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const {DatabaseSync}=require('node:sqlite');
    const prepare=DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare=function(sql){
      const statement=prepare.call(this,sql);
      if(sql==='SELECT "id","value" FROM "media_sample"'){
        const iterate=statement.iterate.bind(statement);
        statement.iterate=function*(){
          let index=0;
          for(const row of iterate()){
            if(index++===1){parentPort.postMessage('inside-transaction');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
            yield row;
          }
        };
      }
      return statement;
    };
    import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then(({tsImport})=>tsImport(${JSON.stringify(moduleUrl)},${JSON.stringify(import.meta.url)})).then(({activateMediaDatabase})=>activateMediaDatabase(workerData.source,workerData.target));
  `,{eval:true,workerData:{source,target}});
  try{
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('migration did not reach the transaction barrier')),10000);
      worker.once('message',message=>{clearTimeout(timer);assert.equal(message,'inside-transaction');resolve();});
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('exit',code=>{clearTimeout(timer);reject(Error('unexpected worker exit '+code));});
    });
    await worker.terminate();
    const interrupted=new DatabaseSync(target);
    try{assert.equal(interrupted.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length,0);}finally{interrupted.close();}
    assert.equal(core.get<{activated:number}>('SELECT activated FROM media_storage_identity')!.activated,0);
    assert.equal(activateMediaDatabase(source,target).state,'copied');
    const restored=new DatabaseSync(target);
    try{assert.deepEqual(restored.prepare('SELECT value FROM media_sample ORDER BY id').all().map(row=>row.value),['preserved','also preserved']);}finally{restored.close();}
    assert.equal(core.get<{activated:number}>('SELECT activated FROM media_storage_identity')!.activated,1);
  }finally{await worker.terminate();core.close();await rm(root,{recursive:true,force:true});}
});
