import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaCatalog} from '../src/media/catalog.ts';
import {MediaScraping} from '../src/media/scraping.ts';
import {MediaScrapeJobs} from '../src/media/scrape-jobs.ts';

test('summaries omit results, server pages filtered results, and retry selects all unfinished items',async()=>{
  const db=new Db(':memory:'),actor={id:'admin',role:'admin'} as const;
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','x','admin',0,0)");
  const catalog=new MediaCatalog(db,new MediaLibraries(db));
  const scraping=new MediaScraping(db,catalog,[{id:'tmdb',label:'test',configured:true,kinds:['movie'],async search(){return [];},async detail(){throw Error('no candidates');}}]);
  const jobs=new MediaScrapeJobs(db,catalog,scraping);
  try{
    db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','movies','video','/media','all',0,0)");
    db.run("INSERT INTO media_scrape_jobs VALUES('old','admin','tmdb','complete',0)");
    for(let i=0;i<65;i++){
      const id='item'+i,state=i<60?'review':['failed','failed','interrupted','cancelled','matched'][i-60]!;
      db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES(?,'lib','movie',?,?,'{}')",id,id,'Title '+i);
      db.run('INSERT INTO media_scrape_job_items VALUES(?,?,?,?,NULL)','old',id,i,state);
    }
    const summary=jobs.summaries(actor).items[0]!;
    assert.deepEqual(summary.items,[]);assert.equal(summary.total,65);assert.equal(summary.counts.review,60);
    const first=jobs.results(actor,'old'),second=jobs.results(actor,'old',{offset:50});
    assert.equal(first.total,65);assert.equal(first.items.length,50);assert.equal(second.items.length,15);
    assert.equal(new Set([...first.items,...second.items].map(row=>row.itemId)).size,65);
    const failed=jobs.results(actor,'old',{state:'failed',limit:1});assert.equal(failed.total,2);assert.equal(failed.items[0]!.itemId,'item60');
    assert.equal(jobs.results(actor,'old',{state:'unmatched'}).total,0);
    assert.throws(()=>jobs.results({id:'member',role:'member'},'old'),{statusCode:403});
    assert.throws(()=>jobs.results(actor,'missing'),{statusCode:404});
    for(const query of [{state:'unknown'},{limit:51},{offset:-1}])assert.throws(()=>jobs.results(actor,'old',query),{statusCode:400});
    const retried=jobs.retry(actor,'old');assert.deepEqual(retried.items.map(row=>row.itemId),['item60','item61','item62','item63']);
    assert.throws(()=>jobs.retry(actor,retried.id),{statusCode:409});
    await jobs.wait(retried.id);assert.throws(()=>jobs.retry(actor,retried.id),{statusCode:400});
    assert.equal(jobs.get(actor,'old').items.length,65,'legacy full detail remains available');
  }finally{await jobs.close();db.close();}
});

for(const change of ['cancel','disable','demote'] as const)test(`batch ignores late search results after ${change} and preserves saved candidates`,async()=>{
  const db=new Db(':memory:'),actor={id:'admin',role:'admin'} as const;
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','x','admin',0,0)");
  const catalog=new MediaCatalog(db,new MediaLibraries(db));
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','movies','video','/media','all',0,0)");
  db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('one','lib','movie','one','One','{}')");
  let hold=false,release!:()=>void,entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const scraping=new MediaScraping(db,catalog,[{id:'tmdb',label:'test',configured:true,kinds:['movie'],
    async search(){if(hold)await new Promise<void>(resolve=>{release=resolve;entered();});return [{externalId:hold?'new':'old',title:'候选'}];},
    async detail(){throw new Error('must not confirm');}}]);
  const jobs=new MediaScrapeJobs(db,catalog,scraping);
  try{
    await scraping.search(actor,'one','tmdb','One');
    const previous=scraping.candidates(actor,'one');
    hold=true;const job=jobs.start(actor,'tmdb',['one']);await ready;
    if(change==='cancel')jobs.cancel(actor,job.id);
    else if(change==='disable')db.run("UPDATE users SET disabled=1 WHERE id='admin'");
    else db.run("UPDATE users SET role='member' WHERE id='admin'");
    release();await jobs.wait(job.id);
    assert.equal(jobs.get(actor,job.id).items[0]!.state,change==='cancel'?'cancelled':'failed');
    assert.deepEqual(scraping.candidates(actor,'one'),previous);
    assert.equal(catalog.detail(actor,'one').metadata.onlineMatch,undefined);
  }finally{release?.();await jobs.close();db.close();}
});

test('batch stores individual results, rejects overlap, and cancels before publication',async()=>{
  const db=new Db(':memory:');
  const actor={id:'admin',role:'admin'} as const;
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','x','admin',0,0)");
  const catalog=new MediaCatalog(db,new MediaLibraries(db));
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('lib','movies','video','/media','all',0,0)");
  for(const id of ['one','two','empty'])db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES(?,'lib','movie',?,?,?)",id,id,id,JSON.stringify({year:2024}));
  let hold=false,release!:()=>void,entered!:()=>void;
  const scraping=new MediaScraping(db,catalog,[{id:'tmdb',label:'test',configured:true,kinds:['movie'],
    async search(_kind,query){return query==='empty'?[]:[{externalId:query,title:query,year:2024}];},
    async detail(_kind,id){if(hold)await new Promise<void>(resolve=>{release=resolve;entered();});return {externalId:id,fields:{title:id,year:2024},sourceUrl:'https://www.themoviedb.org/movie/'+id};}}]);
  const jobs=new MediaScrapeJobs(db,catalog,scraping);
  try{
    const first=jobs.start(actor,'tmdb',['one','two','empty']);
    assert.throws(()=>jobs.start(actor,'tmdb',['one']),{statusCode:409});
    await jobs.wait(first.id);assert.deepEqual(jobs.get(actor,first.id).items.map(row=>row.state),['matched','matched','unmatched']);
    assert.equal(jobs.get(actor,first.id).state,'complete');
    assert.equal(catalog.detail(actor,'empty').metadata.onlineMatch,undefined);
    catalog.override(actor,'two',{title:'人工作品名'});
    assert.equal(jobs.get(actor,first.id).items[1]!.title,'人工作品名');
    catalog.override(actor,'two',{title:null});
    db.run("UPDATE media_online_metadata SET fields_json=? WHERE item_id='two'",JSON.stringify({title:'在线作品名'}));
    assert.equal(jobs.get(actor,first.id).items[1]!.title,'在线作品名');
    scraping.clear(actor,'one');hold=true;
    const ready=new Promise<void>(resolve=>{entered=resolve;});
    const second=jobs.start(actor,'tmdb',['one']);await ready;jobs.cancel(actor,second.id);release();await jobs.wait(second.id);
    assert.equal(jobs.get(actor,second.id).state,'cancelled');assert.equal(catalog.detail(actor,'one').metadata.onlineMatch,undefined);
    const readyAgain=new Promise<void>(resolve=>{entered=resolve;});
    const third=jobs.start(actor,'tmdb',['one']);await readyAgain;db.run("UPDATE users SET disabled=1 WHERE id='admin'");release();await jobs.wait(third.id);
    assert.equal(catalog.detail(actor,'one').metadata.onlineMatch,undefined);
    db.run("INSERT INTO media_scrape_jobs VALUES('old','admin','tmdb','running',0)");
    db.run("INSERT INTO media_scrape_job_items VALUES('old','one',0,'running',NULL)");
    const restarted=new MediaScrapeJobs(db,catalog,scraping);assert.equal(restarted.get(actor,'old').state,'interrupted');
  }finally{await jobs.close();db.close();}
});
