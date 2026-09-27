import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from '../src/db/index.ts';
import {loadConfig} from '../src/config/index.ts';
import {ensureMediaStorageIdentity} from '../src/media/storage-identity.ts';
import {createMediaService} from '../src/media/start-runtime.ts';
import {setTimeout as delay} from 'node:timers/promises';
import {buildApp} from '../src/http/app.ts';
import type {AppContext} from '../src/http/context.ts';
import {UserService} from '../src/services/users.ts';
import {ShelfService} from '../src/services/shelf.ts';
import {SyncService} from '../src/services/sync.ts';
import {signAccessToken} from '../src/services/tokens.ts';

test('missing activated media database leaves real reading routes available without legacy fallback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-start-failure-')),books=join(root,'books');await mkdir(books);
  process.env.BOOKS_DIR=books;process.env.DATA_DIR=root;process.env.LOG_LEVEL='silent';process.env.READER_TOKEN_SECRET='startup-failure-test';
  const config=loadConfig(),corePath=join(root,'reader.db'),db=new Db(corePath);
  ensureMediaStorageIdentity(corePath);db.run('UPDATE media_storage_identity SET activated=1');
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','reader','private','admin',0,0)");
  db.run("INSERT INTO books(id,content_hash,format,title,created_at,updated_at) VALUES('book','hash','txt','Reading',0,0)");
  db.run("INSERT INTO book_files(id,book_id,rel_path,size,mtime_ms,first_seen,last_seen) VALUES('file','book','reading.txt',1,0,0,0)");
  db.run("INSERT INTO user_books(user_id,book_id,added_at) VALUES('u','book',0)");
  const errors:unknown[]=[],service=createMediaService(db,config,error=>errors.push(error));
  const shelf=new ShelfService(db),ctx={config,db,shelf,sync:new SyncService(db,shelf),users:new UserService(db,config)} as AppContext;
  const app=buildApp(ctx,service);
  try{
    service.start();
    const headers={authorization:'Bearer '+signAccessToken(config,{id:'u',role:'admin'}).token};
    const reading=await app.inject({url:'/api/v1/books',headers});assert.equal(reading.statusCode,200);assert.equal(reading.json().items[0].id,'book');
    const saved=await app.inject({method:'PUT',url:'/api/v1/sync/progress/book',headers,payload:{locator:'chapter:9',percentage:.4,updatedAt:Date.now()}});
    assert.equal(saved.statusCode,200);
    assert.equal((await app.inject({url:'/api/v1/sync/progress/book',headers})).json().progress.locator,'chapter:9');
    for(let attempt=0;errors.length===0;attempt++){assert.ok(attempt<250,'worker failure not reported');await delay(20);}
    assert.equal(errors.length,1);
    const media=await app.inject({url:'/api/v1/media/libraries',headers});assert.equal(media.statusCode,503);assert.equal(media.json().error.code,'MEDIA_UNAVAILABLE');
    assert.equal((await app.inject({url:'/api/v1/books',headers})).statusCode,200);
    await assert.rejects(access(join(root,'media.db')),{code:'ENOENT'});
    assert.equal(db.get("SELECT name FROM sqlite_master WHERE name='media_libraries'"),undefined);
  }finally{await app.close();db.close();await rm(root,{recursive:true,force:true});}
});
