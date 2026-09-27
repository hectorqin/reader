import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaCatalog } from '../src/media/catalog.ts';
import { MediaScraping } from '../src/media/scraping.ts';
import type { MetadataProvider } from '../src/media/metadata-providers.ts';

test('automatic matching requires unique corroborated evidence and rechecks provider detail',async()=>{
  const db=new Db(':memory:');
  try{
    const catalog=new MediaCatalog(db,new MediaLibraries(db)),actor={id:'admin',role:'admin'} as const;
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','movies','video','/media','all',0,0)");
    db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('item','lib','movie','item','Movie',?)",JSON.stringify({year:2024}));
    let count=1,year=2024,detailCalls=0;
    const provider:MetadataProvider={id:'tmdb',label:'test',kinds:['movie'],configured:true,
      async search(){return Array.from({length:count},(_,i)=>({externalId:String(i),title:'Movie',year:2024}));},
      async detail(_kind,id){detailCalls++;return {externalId:id,fields:{title:'Movie',year},sourceUrl:'https://www.themoviedb.org/movie/'+id};}};
    const scraping=new MediaScraping(db,catalog,[provider]);
    await assert.rejects(scraping.autoMatch({id:'member',role:'member'},'item','tmdb'),{statusCode:403});
    count=0;assert.equal((await scraping.autoMatch(actor,'item','tmdb')).status,'unmatched');assert.equal(detailCalls,0);
    assert.equal(catalog.detail(actor,'item').metadata.onlineMatch,undefined);
    count=2;assert.equal((await scraping.autoMatch(actor,'item','tmdb')).status,'review');assert.equal(detailCalls,0);
    count=1;year=2000;assert.equal((await scraping.autoMatch(actor,'item','tmdb')).status,'review');
    assert.equal(catalog.detail(actor,'item').metadata.onlineMatch,undefined);
    year=2024;assert.equal((await scraping.autoMatch(actor,'item','tmdb')).status,'matched');
    const before=detailCalls;assert.equal((await scraping.autoMatch(actor,'item','tmdb')).status,'unchanged');assert.equal(detailCalls,before);
    scraping.clear(actor,'item');catalog.override(actor,'item',{year:1999});
    assert.equal((await scraping.autoMatch(actor,'item','tmdb')).status,'review');
  }finally{db.close();}
});
