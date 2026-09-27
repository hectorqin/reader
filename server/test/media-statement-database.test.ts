import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaStatementDatabase} from '../src/media/statement-database.ts';

test('scanner statements share rollback with the original connection and remain reusable after failure',()=>{
  const db=new Db(':memory:'),batch=new MediaStatementDatabase(db);
  try{
    db.run('CREATE TABLE fixture(id INTEGER PRIMARY KEY,value TEXT)');
    batch.run('INSERT INTO fixture VALUES(?,?)',1,'before');
    assert.throws(()=>batch.transaction(()=>{
      batch.run('UPDATE fixture SET value=? WHERE id=?','rolled back',1);
      db.run('INSERT INTO fixture VALUES(?,?)',2,'same transaction');
      throw Error('abort');
    }),/abort/);
    assert.equal(batch.get<{value:string}>('SELECT value FROM fixture WHERE id=?',1)!.value,'before');
    assert.equal(db.get('SELECT * FROM fixture WHERE id=?',2),undefined);
    batch.transaction(()=>batch.run('UPDATE fixture SET value=? WHERE id=?','committed',1));
    assert.equal(db.get<{value:string}>('SELECT value FROM fixture WHERE id=?',1)!.value,'committed');
    assert.throws(()=>batch.run('INSERT INTO fixture VALUES(?,?)',1,'duplicate'),/UNIQUE/);
    batch.run('INSERT INTO fixture VALUES(?,?)',2,'reused');
    assert.equal(batch.all('SELECT * FROM fixture ORDER BY id').length,2);
    batch.clear();
    assert.equal(batch.get<{value:string}>('SELECT value FROM fixture WHERE id=?',2)!.value,'reused');
  }finally{batch.clear();db.close();}
});

test('scanner statement cache is bounded and does not change ordinary database execution',t=>{
  const db=new Db(':memory:'),batch=new MediaStatementDatabase(db);
  const prepare=db.prepare.bind(db);let prepared=0;
  t.mock.method(db,'prepare',(sql:string)=>{prepared++;return prepare(sql);});
  try{
    for(let i=0;i<20;i++)assert.equal(batch.get<{value:number}>('SELECT ? value',i)!.value,i);
    assert.equal(prepared,1);
    db.get('SELECT ? value',42);assert.equal(prepared,1,'reading path does not opt into the batch cache');
    for(let i=0;i<140;i++)batch.get('SELECT '+i+' value');
    assert.equal(Reflect.get(batch,'statements').size,128);
    assert.equal(batch.get<{value:number}>('SELECT ? value',7)!.value,7);
    assert.equal(Reflect.get(batch,'statements').size,128);
  }finally{batch.clear();db.close();}
});
