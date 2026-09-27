import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {DatabaseMediaAccounts} from '../src/media/accounts.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaPlayback} from '../src/media/playback.ts';
import {MediaBackgroundGrants} from '../src/media/background-grants.ts';

test('independent account authority immediately revokes media tickets and background grants despite stale local users',async()=>{
  const core=new Db(':memory:'),media=new Db(':memory:');
  const accounts=new DatabaseMediaAccounts(core),libraries=new MediaLibraries(media,true,accounts),scanner=new MediaScanner(media,libraries);
  const playback=new MediaPlayback(media,libraries,accounts),background=new MediaBackgroundGrants(media,libraries,accounts);
  const actor={id:'member',role:'member'} as const;
  try{
    for(const db of [core,media])db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','unused','member',0,0)");
    core.run("UPDATE users SET auth_version=7 WHERE id='member'");
    media.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','lib','music','/fixture','all',0,0)");
    media.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('item','lib','track','item','Title','{}')");
    media.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,probe_status) VALUES('asset','lib','a.mp3',1,0,'ready')");
    media.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES('edition','item','edition','Default')");
    media.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) VALUES('part','edition','asset','part','Part',0)");
    const session=playback.create(actor,'part'),grant=background.create(actor,['part']);
    const ticket=new URL(session.streamUrl,'http://fixture').searchParams.get('ticket')!;
    assert.equal(media.get<{auth_version:number}>('SELECT auth_version FROM media_playback_sessions WHERE id=?',session.id)!.auth_version,7);
    assert.equal(background.authorizePart(grant.token,'part').id,actor.id);
    assert.equal(playback.authorizeStream(session.id,ticket).actor.id,actor.id);
    core.run("UPDATE users SET role='admin' WHERE id='member'");
    assert.equal(playback.authorizeStream(session.id,ticket).actor.role,'admin');
    assert.equal(background.authorizePart(grant.token,'part').role,'admin');
    core.run("UPDATE users SET auth_version=8 WHERE id='member'");
    assert.throws(()=>playback.authorizeStream(session.id,ticket),{code:'MEDIA_TICKET'});
    assert.throws(()=>playback.renew(actor,session.id),{code:'MEDIA_TICKET'});
    assert.throws(()=>background.authorizePart(grant.token,'part'),{code:'MEDIA_BACKGROUND_INVALID'});
    core.run("UPDATE users SET disabled=1 WHERE id='member'");
    assert.throws(()=>playback.create(actor,'part'),{statusCode:401});
    assert.throws(()=>background.create(actor,['part']),{statusCode:401});
    assert.throws(()=>libraries.setAccess({id:'admin',role:'admin'},'lib','restricted',['member']),{statusCode:400});
    core.run("UPDATE users SET disabled=0 WHERE id='member'");
    libraries.setAccess({id:'admin',role:'admin'},'lib','restricted',['member']);
    core.run("UPDATE users SET disabled=1 WHERE id='member'");
    libraries.setAccess({id:'admin',role:'admin'},'lib','restricted',['member']);
    core.run("DELETE FROM users WHERE id='member'");
    assert.throws(()=>libraries.setAccess({id:'admin',role:'admin'},'lib','restricted',['member']),{statusCode:400});
    assert.throws(()=>background.create(actor,['part']),{statusCode:401});
    assert.equal(media.get<{disabled:number}>('SELECT disabled FROM users WHERE id=?',actor.id)!.disabled,0,'stale local row never grants authority');
  }finally{await scanner.close();media.close();core.close();}
});
