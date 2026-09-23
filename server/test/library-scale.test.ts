import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { ShelfService } from '../src/services/shelf.ts';
import { SyncService } from '../src/services/sync.ts';
test('10,000 indexed books keep shelf queries paginated and incremental sync bounded', t => {
 const db = new Db(':memory:');
 try {
  db.run('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)','u','scale','x','member',1,1);
  const started=performance.now();
  db.transaction(()=>{for(let i=0;i<10000;i++){
   const id='b'+String(i).padStart(5,'0');
   db.run('INSERT INTO books(id,content_hash,format,title,author,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,id,'txt','书籍 '+id,'作者 '+i%20,1,i+1);
   db.run('INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) VALUES(?,?,?,?,?,?,?)',id,id,id+'.txt',100,1,1,1);
   db.run('INSERT INTO user_books(user_id,book_id,added_at) VALUES(?,?,?)','u',id,i+1);
  }});
  const seedMs=performance.now()-started,shelf=new ShelfService(db);
  const query=performance.now(),first=shelf.list('u'),last=shelf.list('u',{page:200});
  assert.equal(first.total,10000);assert.equal(first.items.length,50);assert.equal(last.items.length,50);
  assert.equal(new Set([...first.items,...last.items].map(b=>b.id)).size,100);
  assert.equal(shelf.list('u',{search:'b09999'}).items.length,1);
  const queryMs=performance.now()-query,sync=new SyncService(db,shelf),syncStart=performance.now();
  sync.push('u',{progress:[{bookId:'b09999',locator:'r1:0:s',percentage:0,chapterTitle:'s',device:'test',updatedAt:10}]});
  assert.equal(sync.pull('u',9).progress.length,1);assert.equal(sync.pull('u',10).progress.length,0);
  t.diagnostic(JSON.stringify({rows:10000,seedMs:Math.round(seedMs),threeQueriesMs:Math.round(queryMs),syncMs:Math.round(performance.now()-syncStart)}));
 }finally{db.close();}
});
