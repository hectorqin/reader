import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaCatalog } from '../src/media/catalog.ts';

test('track filters use effective metadata before permissions, totals and pagination',()=>{
  const db=new Db(':memory:');
  try{
    const catalog=new MediaCatalog(db,new MediaLibraries(db)),admin={id:'admin',role:'admin'} as const,member={id:'member',role:'member'} as const;
    for(const [id,access] of [['public','all'],['private','restricted']])db.run('INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,\'music\',?,?,0,0)',id!,id!,'/'+id,access!);
    for(const [id,lib] of [['a','public'],['b','public'],['c','public'],['secret','private']])db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES(?,?,'track',?,?,?)",id!,lib!,id!,id!,JSON.stringify({artist:'Local',album:'100%_Album'}));
    db.run("INSERT INTO media_online_metadata(item_id,provider,external_id,source_url,fields_json,confirmed_by,confirmed_at) VALUES('b','musicbrainz','b','https://musicbrainz.org',?,'admin',0)",JSON.stringify({artist:'Online',album:'Other'}));
    catalog.override(admin,'c',{artist:'Corrected',album:'Other'});
    assert.equal(catalog.browse(member,'music','track',{artist:'local'}).total,1);
    assert.equal(catalog.browse(admin,'music','track',{artist:'local'}).total,2);
    assert.equal(catalog.browse(member,'music','track',{album:'%_'}).items[0]!.id,'a');
    const page=catalog.browse(member,'music','track',{album:'other',offset:1,limit:1});
    assert.equal(page.total,2);assert.equal(page.items[0]!.id,'c');
    assert.deepEqual(catalog.list(member,'public',{kind:'track',artist:'online',album:'other'}).items.map(item=>item.id),['b']);
    assert.equal(catalog.list(member,'public',{kind:'track',artist:'online',album:'%_'}).total,0);
    catalog.override(admin,'b',{artist:''});
    assert.equal(catalog.browse(member,'music','track',{artist:'online'}).total,0,'blank override must not fall back to provider');
    assert.throws(()=>catalog.browse(admin,'music','album',{artist:'local'}),{statusCode:400});
  }finally{db.close();}
});

test('search filters permissions before counting and paging, and respects effective titles',()=>{
  const db=new Db(':memory:');
  try {
    const libraries=new MediaLibraries(db),catalog=new MediaCatalog(db,libraries);
    const admin={id:'admin',role:'admin'} as const,member={id:'member',role:'member'} as const;
    db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','unused','member',0,0)");
    for(const [id,kind,access] of [['public','video','all'],['private','music','restricted'],['granted','audiobook','restricted']])
      db.run('INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,?,?,?,0,0)',id!,id!,kind!,'/secret/'+id,access!);
    db.run("INSERT INTO media_library_users(library_id,user_id) VALUES('granted','member')");
    for(const [id,library,kind,title] of [['1','private','track','A Same'],['2','public','movie','B Same'],['3','granted','audiobook','C Same'],['4','public','movie','D Same'],['5','public','movie','100%_literal']])
      db.run('INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES(?,?,?,?,?,?)',id!,library!,kind!,id!,title!,'{}');
    assert.equal(catalog.search(admin,'same').total,4);
    const page=catalog.search(member,'SAME',{limit:1,offset:1});
    assert.equal(page.total,3);assert.equal(page.items[0]!.id,'3');
    assert.equal(page.items[0]!.channel,'audiobook');assert.equal(page.items[0]!.libraryName,'granted');
    assert.equal(JSON.stringify(page).includes('/secret'),false);
    assert.equal(catalog.search(member,'same',{channel:'music'}).total,0);
    assert.equal(catalog.search(member,'same',{channel:'video'}).total,2);
    const movies=catalog.search(member,'same',{kind:'movie',offset:1,limit:1});
    assert.equal(movies.total,2);assert.equal(movies.items[0]!.id,'4');
    assert.equal(catalog.search(member,'same',{kind:'track'}).total,0);
    assert.equal(catalog.search(admin,'same',{kind:'track'}).total,1);
    assert.equal(catalog.search(member,'%_').total,1);
    const browse=catalog.browse(member,'video','movie',{offset:1,limit:1});
    assert.equal(browse.total,3);assert.equal(browse.items[0]!.id,'2');
    assert.equal(browse.items[0]!.libraryName,'public');
    assert.equal(catalog.browse(member,'music','track').total,0);
    assert.equal(catalog.browse(admin,'music','track').total,1);
    assert.throws(()=>catalog.browse(member,'video','track'),{code:'MEDIA_BROWSE_KIND'});
    catalog.override(admin,'2',{title:'手工修正'});
    assert.equal(catalog.search(member,'same').total,2);
    assert.equal(catalog.search(member,'手工').items[0]!.id,'2');
    libraries.setAccess(admin,'granted','restricted',[]);
    assert.equal(catalog.search(member,'same').total,1);
    assert.equal(catalog.search(member,'same',{offset:1}).items.length,0);
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('second','第二库','video','/secret/second','all',0,0)");
    db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('duplicate','second','movie','dup','D Same','{}')");
    const aggregate=catalog.browse(member,'video','movie');
    assert.equal(aggregate.total,4);
    assert.equal(aggregate.items.filter(item=>item.title==='D Same').length,2,'equal names in separate libraries retain independent identities');
    assert.deepEqual(catalog.browse(member,'video','movie',{offset:2,limit:2}).items,aggregate.items.slice(2,4));
    libraries.setAccess(admin,'second','restricted',[]);
    assert.equal(catalog.browse(member,'video','movie').total,3);
    assert.equal(catalog.browse(member,'video','movie').items.some(item=>item.libraryId==='second'),false);
    catalog.override(admin,'4',{title:'AAA'});
    catalog.override(admin,'2',{title:'ZZZ'});
    const ascending=catalog.browse(member,'video','movie',{sort:'title-asc'});
    assert.deepEqual(ascending.items.map(item=>item.title),['100%_literal','AAA','ZZZ']);
    assert.deepEqual(catalog.browse(member,'video','movie',{sort:'title-desc',offset:1,limit:1}).items.map(item=>item.title),['AAA']);
    assert.deepEqual(catalog.list(member,'public',{kind:'movie',sort:'title-asc'}).items.map(item=>item.id),ascending.items.map(item=>item.id));
  } finally {db.close();}
});
