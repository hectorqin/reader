/** Repeatable synthetic catalog workload; excludes scanning, HTTP, rendering and real media. */
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaCatalog } from '../src/media/catalog.ts';

const root=await mkdtemp(join(tmpdir(),'media-catalog-benchmark-'));
const db=new Db(join(root,'catalog.db'));
try{
  const catalog=new MediaCatalog(db,new MediaLibraries(db));
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('member','member','unused','member',0,0)");
  for(const [id,access] of [['public','all'],['private','restricted']])db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES(?,?,'music',?,?,0,0)",id!,id!,root,access!);
  db.run(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000)
    INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json)
    SELECT printf('item-%06d',n),CASE WHEN n%5=0 THEN 'private' ELSE 'public' END,'track',cast(n AS TEXT),printf('Track %06d',n),'{}' FROM seq`);
  db.run("INSERT INTO media_metadata_overrides(item_id,field,value_json,updated_at) SELECT id,'title',json_quote('Edited '||title),0 FROM media_items WHERE cast(local_key AS INTEGER)%7=0");
  db.run("UPDATE media_items SET metadata_json=json_object('artist','Artist '||(cast(local_key AS INTEGER)%10),'album','Album '||(cast(local_key AS INTEGER)%100))");
  db.run("INSERT INTO media_online_metadata(item_id,provider,external_id,source_url,fields_json,confirmed_by,confirmed_at) SELECT id,'musicbrainz',id,'https://musicbrainz.org',json_object('artist','Remote Artist 3'),'benchmark',0 FROM media_items WHERE cast(local_key AS INTEGER)%11=0");
  db.run("INSERT INTO media_metadata_overrides(item_id,field,value_json,updated_at) SELECT id,'artist',json_quote('Manual Artist 3'),0 FROM media_items WHERE cast(local_key AS INTEGER)%13=0");
  const member={id:'member',role:'member'} as const;
  const run=(offset:number)=>catalog.browse(member,'music','track',{offset,limit:60});
  const first=run(0);assert.equal(first.total,80000);assert.equal(first.items.length,60);assert.ok(first.items.every(item=>item.libraryId==='public'));
  const measurements=[];
  for(const [name,action] of [
    ['browse-first',()=>run(0)],['browse-deep',()=>run(60000)],
    ['search-edited',()=>catalog.search(member,'Edited',{channel:'music',kind:'track'})],
  ] as const){
    const times=[];
    for(let i=0;i<6;i++){const start=performance.now();const result=action();times.push(performance.now()-start);assert.equal(result.items.length,60);assert.ok(result.items.every(item=>item.libraryId==='public'));}
    const warmed=times.slice(1).sort((a,b)=>a-b);
    measurements.push({name,firstMs:Math.round(times[0]!),medianMs:Math.round(warmed[2]!),maxMs:Math.round(warmed[4]!)});
  }
  const expected=(artist:string,album:string)=>{
    const ids=new Set<string>();
    for(let n=1;n<=100000;n++){
      if(n%5===0)continue;
      const effectiveArtist=n%13===0?'Manual Artist 3':n%11===0?'Remote Artist 3':`Artist ${n%10}`;
      if(effectiveArtist.includes(artist)&&`Album ${n%100}`.includes(album))ids.add(`item-${String(n).padStart(6,'0')}`);
    }
    return ids;
  };
  for(const [name,artist,album,offset,singleLibrary] of [
    ['filter-artist','Artist 3','',0,false],['filter-combined','Artist 3','Album 3',0,false],
    ['filter-combined-page','Artist 3','Album 3',60,false],['filter-manual','Manual Artist 3','',0,false],
    ['filter-single-library','Artist 3','Album 3',0,true],
  ] as const){
    const ids=expected(artist,album),times=[];
    for(let i=0;i<6;i++){
      const start=performance.now(),options={kind:'track' as const,artist,album,offset,limit:60};
      const result=singleLibrary?catalog.list(member,'public',options):catalog.browse(member,'music','track',options);
      times.push(performance.now()-start);
      assert.equal(result.total,ids.size);assert.equal(result.items.length,60);
      assert.ok(result.items.every(item=>item.libraryId==='public'&&ids.has(item.id)));
    }
    const warmed=times.slice(1).sort((a,b)=>a-b);
    measurements.push({name,firstMs:Math.round(times[0]!),medianMs:Math.round(warmed[2]!),maxMs:Math.round(warmed[4]!)});
  }
  console.log(JSON.stringify({rows:100000,visibleRows:80000,titleOverrides:14285,artistOverrides:7692,onlineMetadata:9090,samples:6,database:'temporary file, warm OS cache',node:process.version,platform:process.platform,measurements}));
}finally{db.close();await rm(root,{recursive:true,force:true});}
