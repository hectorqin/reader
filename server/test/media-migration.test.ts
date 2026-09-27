import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,copyFile,rename,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaUserState} from '../src/media/user-state.ts';
import {MediaPlayback} from '../src/media/playback.ts';
import {migrateMediaDatabase,activateMediaDatabase} from '../src/media/migrate-database.ts';
import {isMediaStorageActivated} from '../src/media/storage-identity.ts';

test('media migration preserves identities and user state, excludes reading credentials and does not replay after completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-migrate-')),source=join(root,'reader.db'),destination=join(root,'media.db');
  const db=new Db(source),libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries);
  new MediaUserState(db,libraries,scanner.catalog);new MediaPlayback(db,libraries);
  try{
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('u','reader','private-password','admin',0,0)");
    db.run("INSERT INTO books(id,content_hash,format,title,created_at,updated_at) VALUES('reading','hash','txt','Private book',0,0)");
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','Music','music','/media','restricted',0,0)");
    db.run("INSERT INTO media_library_users VALUES('lib','u')");
    db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,probe_status,publication_fingerprint) VALUES('asset','lib','track.mp3',100,0,'unavailable','fingerprint')");
    scanner.catalog.ingest('lib','music','asset','track.mp3',{title:'Track',album:'Album',artist:'Artist'},{status:'unavailable',info:null});
    const part=db.get<{id:string}>('SELECT id FROM media_parts')!.id,item=db.get<{id:string}>("SELECT id FROM media_items WHERE kind='track'")!.id;
    scanner.catalog.override({id:'u',role:'admin'},item,{title:'Manual'});
    db.run('INSERT INTO media_favorites VALUES(?,?,0)','u',item);
    db.run("INSERT INTO media_progress(user_id,part_id,position,revision,session_id,updated_at) VALUES(?,?,19.25,3,'session',0)",'u',part);
    const tables=db.all<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'media_%'");
    const before=new Map(tables.map(({name})=>[name,JSON.stringify(db.all('SELECT * FROM '+name+' ORDER BY rowid'))]));
    assert.equal(migrateMediaDatabase(source,destination).state,'copied');
    const target=new DatabaseSync(destination);
    try{
      for(const {name} of tables)assert.equal(JSON.stringify(target.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()),before.get(name));
      assert.deepEqual(target.prepare('PRAGMA table_info(users)').all().map(row=>row.name),['id']);
      assert.equal(target.prepare("SELECT name FROM sqlite_master WHERE name='books'").get(),undefined);
      assert.equal(target.prepare('PRAGMA foreign_key_check').all().length,0);
      target.prepare('UPDATE media_progress SET position=42').run();
    }finally{target.close();}
    assert.equal(migrateMediaDatabase(source,destination).state,'existing');
    const reopened=new DatabaseSync(destination);try{assert.equal(reopened.prepare('SELECT position FROM media_progress').get()!.position,42);}finally{reopened.close();}
    for(const {name} of tables)assert.equal(JSON.stringify(db.all('SELECT * FROM '+name+' ORDER BY rowid')),before.get(name));
    assert.equal(db.get<{title:string}>('SELECT title FROM books')!.title,'Private book');
    assert.throws(()=>migrateMediaDatabase(source,source),/separate/);
  }finally{await scanner.close();db.close();await rm(root,{recursive:true,force:true});}
});

test('migrated pair can move directories but cannot be paired with another reading database',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-move-')),source=join(root,'reader.db'),destination=join(root,'media.db');
  const db=new Db(source);
  db.run('CREATE TABLE media_sample(id TEXT PRIMARY KEY,value TEXT)');
  db.run("INSERT INTO media_sample VALUES('one','original')");db.close();
  try{
    migrateMediaDatabase(source,destination);
    const target=new DatabaseSync(destination);target.exec("UPDATE media_sample SET value='newer'");target.close();
    const movedSource=join(root,'moved-reader.db'),movedTarget=join(root,'moved-media.db');
    // This fixture copies database files only; flush WAL first, as an offline move must.
    const checkpoint=new DatabaseSync(source);checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)');checkpoint.close();
    await copyFile(source,movedSource);await copyFile(destination,movedTarget);
    assert.equal(migrateMediaDatabase(movedSource,movedTarget).state,'existing');
    const restored=new DatabaseSync(movedTarget);try{assert.equal(restored.prepare('SELECT value FROM media_sample').get()!.value,'newer');}finally{restored.close();}
    const other=join(root,'other.db');new Db(other).close();
    assert.throws(()=>migrateMediaDatabase(other,movedTarget),/does not match/);
    // A legacy marker upgrades in place without replaying the old source rows.
    const legacy=new DatabaseSync(destination);legacy.exec('ALTER TABLE media_storage_migration DROP COLUMN source_id; UPDATE media_storage_migration SET version=1');legacy.close();
    assert.equal(migrateMediaDatabase(source,destination).state,'existing');
    const upgraded=new DatabaseSync(destination);try{
      assert.equal(upgraded.prepare('SELECT version FROM media_storage_migration').get()!.version,2);
      assert.equal(upgraded.prepare('SELECT value FROM media_sample').get()!.value,'newer');
    }finally{upgraded.close();}
  }finally{await rm(root,{recursive:true,force:true});}
});

test('failed migration rolls back all copied data and can retry without replacing unrelated data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-migrate-fail-')),source=join(root,'reader.db'),destination=join(root,'media.db');
  const db=new Db(source);
  try{
    db.run('CREATE TABLE media_broken(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id))');
    const raw=new DatabaseSync(source);try{raw.exec('PRAGMA foreign_keys=OFF');raw.prepare("INSERT INTO media_broken VALUES('entry','missing')").run();}finally{raw.close();}
    assert.throws(()=>migrateMediaDatabase(source,destination),/foreign key/);
    const target=new DatabaseSync(destination);try{assert.equal(target.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length,0);}finally{target.close();}
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('missing','user','private','member',0,0)");
    assert.equal(migrateMediaDatabase(source,destination).state,'copied');
    const unrelated=join(root,'unrelated.db'),other=new DatabaseSync(unrelated);other.exec('CREATE TABLE important(value TEXT)');other.close();
    assert.throws(()=>migrateMediaDatabase(source,unrelated),/nonempty/);
  }finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('activation protects against replay after the independent media database is lost or emptied',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-activate-')),source=join(root,'reader.db'),target=join(root,'media.db');
  const db=new Db(source);db.run('CREATE TABLE media_sample(id TEXT PRIMARY KEY,value TEXT)');db.run("INSERT INTO media_sample VALUES('one','old')");db.close();
  try{
    migrateMediaDatabase(source,target);
    const before=new DatabaseSync(source);try{assert.equal(isMediaStorageActivated(before),false);}finally{before.close();}
    assert.equal(activateMediaDatabase(source,target).state,'existing');
    const after=new DatabaseSync(source);try{assert.equal(isMediaStorageActivated(after),true);}finally{after.close();}
    const media=new DatabaseSync(target);media.exec("UPDATE media_sample SET value='new'");media.close();
    assert.equal(activateMediaDatabase(source,target).state,'existing');
    await rename(target,join(root,'saved.db'));
    assert.throws(()=>migrateMediaDatabase(source,target),/activated media database is missing/);
    await assert.rejects(access(target),{code:'ENOENT'});
    new DatabaseSync(target).close();
    assert.throws(()=>activateMediaDatabase(source,target),/no migration marker/);
    const empty=new DatabaseSync(target);try{assert.equal(empty.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length,0);}finally{empty.close();}
    await rm(target);await rename(join(root,'saved.db'),target);
    assert.equal(activateMediaDatabase(source,target).state,'existing');
    const restored=new DatabaseSync(target);try{assert.equal(restored.prepare('SELECT value FROM media_sample').get()!.value,'new');}finally{restored.close();}
  }finally{await rm(root,{recursive:true,force:true});}
});
