import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaCatalog} from '../src/media/catalog.ts';

test('video home pages movies and series together without episodes or inaccessible libraries',()=>{
  const db=new Db(':memory:');
  try{
    const catalog=new MediaCatalog(db,new MediaLibraries(db)),member={id:'member',role:'member'} as const,admin={id:'admin',role:'admin'} as const;
    for(const [id,access] of [['public','all'],['private','restricted']])db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,'video',?,?,0,0)",id!,id!,'/'+id,access!);
    for(let i=0;i<65;i++)db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES(?,'public',?,?,?,'{}')",'item-'+i,i===63?'season':i===64?'episode':i%3===0?'series':'movie','key-'+i,String(i).padStart(3,'0'));
    db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('secret','private','movie','secret','000 hidden','{}')");
    const first=catalog.browse(member,'video','video',{limit:60}),last=catalog.browse(member,'video','video',{offset:60,limit:60});
    assert.equal(first.total,63);assert.equal(first.items.length,60);assert.equal(last.items.length,3);
    assert.equal(new Set([...first.items,...last.items].map(item=>item.id)).size,63);
    assert.ok([...first.items,...last.items].every(item=>['movie','series'].includes(item.kind)&&item.libraryId==='public'));
    assert.equal(catalog.browse(admin,'video','video').total,64);
    assert.equal(catalog.list(member,'public',{kind:'video',offset:60,limit:60}).items.length,3);
    assert.throws(()=>catalog.list(member,'private',{kind:'video'}),{statusCode:404});
    assert.throws(()=>catalog.browse(member,'music','video'),{code:'MEDIA_BROWSE_KIND'});
    catalog.override(admin,'item-0',{title:'zzz'});
    assert.equal(catalog.browse(member,'video','video',{sort:'title-desc',limit:1}).items[0]!.id,'item-0');
  }finally{db.close();}
});
