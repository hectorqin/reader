import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaAccountCleanup} from '../src/media/account-cleanup.ts';

test('account cleanup bounds each sweep and retries the same batch after authority errors',()=>{
  const db=new Db(':memory:');
  try{
    for(let i=0;i<205;i++){
      const id=String(i).padStart(3,'0');
      db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,'member',0,0)",id,id,'fixture');
    }
    let fail=true,calls=0;
    const cleanup=new MediaAccountCleanup(db,{get(id){
      calls++;
      if(fail&&id==='050')throw Error('authority temporarily unavailable');
      return id==='204'?{id,role:'member',disabled:1,auth_version:0}:undefined;
    }});
    assert.throws(()=>cleanup.sweep(),/temporarily unavailable/);
    assert.equal(db.all('SELECT id FROM users').length,205,'all partial deletes rolled back');
    fail=false;calls=0;assert.equal(cleanup.sweep(),100);assert.equal(calls,100);
    calls=0;assert.equal(cleanup.sweep(),100);assert.equal(calls,100);
    calls=0;assert.equal(cleanup.sweep(),4);assert.equal(calls,5);
    assert.deepEqual(db.all<{id:string}>('SELECT id FROM users').map(row=>row.id),['204']);
    assert.equal(cleanup.sweep(),0,'disabled user retains data after cursor wraps');
  }finally{db.close();}
});
