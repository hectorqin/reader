import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaUserState} from '../src/media/user-state.ts';
import {MediaPlayback} from '../src/media/playback.ts';
test('favorites filter channel and grants before paging beyond the legacy cap',async()=>{
  const db=new Db(':memory:'),libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries);
  try{
    const state=new MediaUserState(db,libraries,scanner.catalog),actor={id:'member',role:'member'} as const;
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','x','member',0,0)");
    for(const [id,kind,access]of [['music','music','all'],['video','video','all'],['private','video','restricted']])db.run('INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,?,?,?,0,0)',id!,id!,kind!,'/fixture/'+id,access!);
    db.run(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<620)
      INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) SELECT printf('%04d',n),CASE WHEN n<=550 THEN 'music' WHEN n<=615 THEN 'video' ELSE 'private' END,CASE WHEN n<=550 THEN 'track' ELSE 'movie' END,cast(n AS TEXT),cast(n AS TEXT),'{}' FROM seq`);
    db.run("INSERT INTO media_favorites SELECT 'member',id,0 FROM media_items");
    const first=state.favorites(actor,{channel:'video',limit:60}),second=state.favorites(actor,{channel:'video',limit:60,offset:60});
    assert.equal(first.total,65);assert.equal(first.items.length,60);assert.equal(second.items.length,5);
    assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,65);
    assert.ok([...first.items,...second.items].every(item=>item.libraryId==='video'));
    assert.equal(state.favorites(actor,{channel:'music',offset:540,limit:60}).items.length,10);
    new MediaPlayback(db,libraries);
    db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) SELECT id,library_id,id,1,0,CASE WHEN id='0551' THEN 0 ELSE 1 END,'ready' FROM media_items");
    db.run("INSERT INTO media_editions(id,item_id,local_key,label) SELECT id,id,id,'版本' FROM media_items");
    db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) SELECT id,id,id,id,title,0 FROM media_items");
    db.run("INSERT INTO media_progress(user_id,part_id,position,revision,session_id,updated_at) SELECT 'member',id,5,1,'fixture',0 FROM media_items");
    const history=state.history(actor,{channel:'video',limit:60}),historyNext=state.history(actor,{channel:'video',limit:60,offset:60});
    assert.equal(history.total,65);assert.equal(history.items.length,60);assert.equal(historyNext.items.length,5);
    assert.equal(new Set([...history.items,...historyNext.items].map(row=>row.partId)).size,65);
    assert.equal(history.items[0]!.available,0,'missing resource history is retained');
    assert.ok(history.items.every(row=>row.libraryId==='video'));
    // Recent hidden and other-channel rows must not consume slots in the visible page.
    db.run("UPDATE media_progress SET updated_at=100 WHERE part_id IN ('0616','0001')");
    db.run("UPDATE media_progress SET updated_at=20 WHERE part_id IN ('0552','0553')");
    db.run("UPDATE media_parts SET active=0 WHERE id='0552'");
    db.run("INSERT INTO media_online_metadata(item_id,provider,external_id,source_url,fields_json,confirmed_by,confirmed_at) VALUES('0552','tmdb','52','https://example.test/52','{\"title\":\"在线标题\"}','member',0)");
    scanner.catalog.override({id:'member',role:'admin'},'0553',{title:'人工标题'});
    const recent=state.history(actor,{channel:'video',limit:2});
    assert.equal(recent.total,65);
    assert.deepEqual(recent.items.map(row=>[row.partId,row.title,row.available]),[['0552','在线标题',0],['0553','人工标题',1]]);
    assert.deepEqual(state.history(actor,{channel:'video',offset:1,limit:2}).items.map(row=>row.partId),['0553','0551']);
    assert.deepEqual(state.history(actor,{channel:'video',offset:65}).items,[]);
    libraries.setAccess({id:'admin',role:'admin'},'video','restricted',[]);
    assert.deepEqual(state.favorites(actor,{channel:'video'}),{items:[],total:0});
    assert.deepEqual(state.history(actor,{channel:'video'}),{items:[],total:0});
  }finally{await scanner.close();db.close();}
});
