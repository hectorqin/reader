import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaCatalog} from '../src/media/catalog.ts';
import {MediaScanner} from '../src/media/scanner.ts';

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

test('recently added orders works by their newest available file, counting episodes under a series',()=>{
  const db=new Db(':memory:');
  try{
    const libraries=new MediaLibraries(db);new MediaScanner(db,libraries);
    const catalog=new MediaCatalog(db,libraries),member={id:'member',role:'member'} as const;
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','lib','video','/lib','all',0,0)");
    const item=(id:string,kind:string,parent:string|null)=>db.run("INSERT INTO media_items(id,library_id,kind,parent_id,local_key,title,metadata_json) VALUES(?,'lib',?,?,?,?,'{}')",id,kind,parent,id,id);
    const file=(itemId:string,mtime:number,available=1)=>{
      db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) VALUES(?,'lib',?,1,?,?,'ready')",itemId+'-a',itemId+'.mp4',mtime,available);
      db.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES(?,?,'e','')",itemId+'-e',itemId);
      db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) VALUES(?,?,?,'p','',0)",itemId+'-p',itemId+'-e',itemId+'-a');
    };
    item('old-movie','movie',null);file('old-movie',100);
    item('new-movie','movie',null);file('new-movie',300);
    item('show','series',null);item('s1','season','show');item('ep1','episode','s1');file('ep1',50);item('ep2','episode','s1');file('ep2',400);
    item('gone','movie',null);file('gone',999,0);
    item('empty','movie',null);
    assert.deepEqual(catalog.browse(member,'video','video',{sort:'added'}).items.map(row=>row.id),['show','new-movie','old-movie','empty','gone']);
  }finally{db.close();}
});
