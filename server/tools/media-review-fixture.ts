/** Disposable HTTP fixture: real routes/database; only the remote metadata provider is synthetic. */
import Fastify from 'fastify';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Db } from '../src/db/index.ts';
import { loadConfig } from '../src/config/index.ts';
import { UserService } from '../src/services/users.ts';
import { registerMediaRoutes } from '../src/http/routes/media.ts';
import { registerAuthRoutes } from '../src/http/routes/auth.ts';
import { registerWebRoutes } from '../src/http/routes/web.ts';
import { registerErrorHandler } from '../src/http/errors.ts';
import type { AppContext } from '../src/http/context.ts';
import {MetadataHttp,MusicBrainzProvider,TmdbProvider} from '../src/media/metadata-providers.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';

const root=await mkdtemp(join(tmpdir(),'media-review-'));
await mkdir(join(root,'books'));
const playableFixture=await readFile(resolve('server/tools/fixtures/media-review.mp4'));
await writeFile(join(root,'review-film.mp4'), playableFixture);
process.env.BOOKS_DIR=join(root,'books');process.env.DATA_DIR=join(root,'data');
process.env.WEB_DIR=resolve('web/dist');process.env.READER_TOKEN_SECRET='review-fixture-only';
const config=loadConfig(),db=new Db(':memory:'),app=Fastify({logger:false});
const users=new UserService(db,config);
await users.create({username:'reviewer',password:'review-test-pass'});
let reviewMemberId='';
if(process.env.MEDIA_REVIEW_MEMBER==='1')reviewMemberId=(await users.create({username:'review-member',password:'review-test-pass',displayName:'林间',role:'member'})).id;
const ctx={config,db,users} as AppContext;
registerErrorHandler(app);registerAuthRoutes(app,ctx);
registerMediaRoutes(app,ctx,{metadataProviders:process.env.MEDIA_REVIEW_LIVE_TMDB==='1'?[new TmdbProvider(new MetadataHttp())]:process.env.MEDIA_REVIEW_LIVE_MUSICBRAINZ==='1'?[new MusicBrainzProvider(new MetadataHttp())]:[{
  id:'tmdb',label:'TMDB（测试响应）',configured:true,kinds:['movie'],
  async search(){return [{externalId:'42',title:'候选电影甲',year:2024},{externalId:'43',title:'候选电影乙',year:2023}];},
  async detail(_kind,id){return {externalId:id,fields:{title:id==='42'?'候选电影甲':'候选电影乙',year:2024,plot:'来自测试来源的简介'},sourceUrl:'https://www.themoviedb.org/movie/'+id};},
}]});
registerWebRoutes(app,ctx);
db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('review-lib','候选审阅测试库','video',?,'all',0,0)",root);
db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('review-film','review-lib','movie','film','本地电影','{}')");
// A playable disposable part keeps the browser review on the real playback path
// (detail -> POST /playback -> player) instead of requiring a production asset.
db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) VALUES('review-film-asset','review-lib','review-film.mp4',?,0,1,'ready')",playableFixture.length);
db.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES('review-film-edition','review-film','review-film','测试版本')");
db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal,start_seconds,end_seconds) VALUES('review-film-part','review-film-edition','review-film-asset','file','正片',0,0,2)");
db.run("INSERT INTO media_metadata_overrides(item_id,field,value_json,updated_at) VALUES('review-film','title',?,0)",JSON.stringify('人工保留标题'));
db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('long-film','review-lib','movie','long-film',?,'{}')",'LongUnbrokenMovieTitle'.repeat(8));
db.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES('long-edition','long-film','long',?)",'LongUnbrokenEditionName'.repeat(8));
db.run(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<65)
  INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) SELECT printf('favorite-%03d',n),'review-lib','movie',printf('favorite-%03d',n),printf('收藏电影%03d',n),'{}' FROM seq`);
db.run("INSERT INTO media_favorites(user_id,item_id,created_at) SELECT u.id,i.id,0 FROM users u CROSS JOIN media_items i WHERE u.username='reviewer' AND i.id LIKE 'favorite-%'");
db.run("UPDATE media_items SET ordinal=-1 WHERE id='review-film'");
db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,available,probe_status) SELECT id,library_id,id,1,0,0,'ready' FROM media_items WHERE id LIKE 'favorite-%'");
db.run("INSERT INTO media_editions(id,item_id,local_key,label) SELECT id,id,id,'历史版本' FROM media_items WHERE id LIKE 'favorite-%'");
db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal) SELECT id,id,id,id,'历史章节',0 FROM media_items WHERE id LIKE 'favorite-%'");
db.run("INSERT INTO media_progress(user_id,part_id,position,revision,session_id,updated_at) SELECT u.id,i.id,5,1,'fixture',0 FROM users u CROSS JOIN media_items i WHERE u.username='reviewer' AND i.id LIKE 'favorite-%'");
db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('track-lib','曲目长列表测试库','music',?,'all',0,0)",root);
db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('track-empty-lib','空音乐测试库','music',?,'all',0,0)",root);
db.run(`WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<65)
  INSERT INTO media_items(id,library_id,kind,local_key,title,ordinal,metadata_json) SELECT printf('track-%03d',n),'track-lib','track',printf('track-%03d',n),printf('曲目%03d',n),n,'{"artist":"测试艺人"}' FROM seq`);
db.run("UPDATE media_items SET title=?,metadata_json=? WHERE id='track-003'",'UnbrokenTrackTitle'.repeat(10),JSON.stringify({artist:'UnbrokenArtistName'.repeat(10),album:'独立专辑'}));
if(process.env.MEDIA_REVIEW_LIVE_MUSICBRAINZ==='1'){
  db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('live-album','track-lib','album','live-album','Abbey Road',?)",JSON.stringify({artist:'The Beatles'}));
  db.run("INSERT INTO media_items(id,library_id,kind,local_key,title,metadata_json) VALUES('live-track','track-lib','track','live-track','Yesterday',?)",JSON.stringify({artist:'The Beatles'}));
  db.run("INSERT INTO media_metadata_overrides(item_id,field,value_json,updated_at) VALUES('live-track','title',?,0)",JSON.stringify('Yesterday · 本地标题'));
}
const sampleItems:unknown[]=[];
if(process.env.MEDIA_REVIEW_SAMPLE_PACK){
  const libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries),actor={id:'reviewer',role:'admin'} as const;
  try{
    for(const [folder,kind] of [['music','music'],['video','video'],['audiobooks','audiobook']] as const){
      const library=await libraries.create(actor,{name:kind==='music'?'音乐收藏':kind==='video'?'家庭影院':'床头故事',kind,root:join(process.env.MEDIA_REVIEW_SAMPLE_PACK,folder),access:'all'});
      const job=scanner.start(actor,library.id);await scanner.wait(library.id);
      if(scanner.job(actor,job.id).state!=='complete')throw Error('Acceptance scan failed: '+folder);
      sampleItems.push(...db.all('SELECT id,kind,title,library_id libraryId,metadata_json metadata FROM media_items WHERE library_id=?',library.id));
    }
  }finally{await scanner.close();}
}
const baseUrl=await app.listen({host:'127.0.0.1',port:0});
process.stdout.write(JSON.stringify({baseUrl,reviewRoot:root,reviewMemberId,users:users.list(),sampleItems})+'\n');
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();db.close();await rm(root,{recursive:true,force:true});process.exit(0);}
process.stdin.resume();process.stdin.once('data',()=>void close());process.stdin.once('end',()=>void close());
setTimeout(()=>void close(),Math.min(900000,Math.max(120000,Number(process.env.MEDIA_REVIEW_TIMEOUT_MS)||120000))).unref();
