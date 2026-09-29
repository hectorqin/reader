import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Db} from '../src/db/index.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaDirectoryRules} from '../src/media/directory-rules.ts';
import {MediaRecognitionReview} from '../src/media/recognition-review.ts';
import {MediaUserState} from '../src/media/user-state.ts';
import {MediaPlayback} from '../src/media/playback.ts';
import {cleanVideoTitle,recognizeVideo,seasonDirectory,type VideoRule} from '../src/media/video-recognition.ts';

const raw=(title='original')=>({title,sources:{title:'filename' as const},externalIds:{},warnings:[]});
test('video parsing separates release tokens from meaningful numerals and resolves seasons conservatively',()=>{
  for(const title of ['1917','2001 太空漫游','速度与激情 9','12.5'])assert.equal(cleanVideoTitle(title).title,title);
  assert.equal(cleanVideoTitle('[字幕组] Film.1080p.WEB-DL.H.265.10bit.AAC').title,'Film');
  assert.equal(cleanVideoTitle('001. Film').title,'001 Film');
  assert.equal(cleanVideoTitle('001. Film',true).title,'Film');
  assert.equal(cleanVideoTitle('猫和老鼠 - 001',true).title,'猫和老鼠');
  assert.equal(cleanVideoTitle('22复仇者联盟4：终局之战',true).title,'复仇者联盟4：终局之战');
  const flatSeries=recognizeVideo('猫和老鼠/猫和老鼠157集4K蓝光TV版/猫和老鼠 - 001.mp4',raw(),[{path:'猫和老鼠/猫和老鼠157集4K蓝光TV版',mode:'series',title:'猫和老鼠'}]);
  assert.equal(flatSeries.kind,'episode');assert.equal(flatSeries.metadata.show,'猫和老鼠');assert.equal(flatSeries.metadata.season,1);assert.equal(flatSeries.metadata.episode,1);
  assert.equal(seasonDirectory('第二十一季'),21);assert.equal(seasonDirectory('Specials'),0);
  const peppa=recognizeVideo('动画/小猪佩奇/小猪佩奇第1季/小猪佩奇第一季.Peppa.Pig.Season.1.E01.4K.WEB-DL.H265.AAC-OurTV.mp4',raw(),[{path:'动画/小猪佩奇',mode:'series',title:'小猪佩奇'}]);
  assert.equal(peppa.kind,'episode');assert.equal(peppa.metadata.season,1);assert.equal(peppa.metadata.episode,1);
  for(const [ref,season,episode] of [
    ['Drama/Drama_S01E01_1080p.mp4',1,1],['Drama/Drama.1x02.mkv',1,2],
    ['Drama/Season 02/EP03.mp4',2,3],['Drama/第三季/004.mp4',3,4],
    ['Drama/Drama 第一季第二集.mp4',1,2],['Drama/Specials/E01.mp4',0,1],
  ] as const){const result=recognizeVideo(ref,raw(),[]);assert.equal(result.kind,'episode',ref);assert.equal(result.metadata.season,season,ref);assert.equal(result.metadata.episode,episode,ref);assert.equal(result.metadata.show,'Drama',ref);}
  for(const ref of ['Drama.S01E01E02.mp4','Drama.S01E01-E02.mp4','Drama.S01E01-02.mp4','Drama/第1-2集.mp4'])assert.equal(recognizeVideo(ref,raw(),[]).confidence,'review',ref);
  assert.equal(recognizeVideo('Film (2020).1080p.mkv',raw(),[]).metadata.title,'Film');
  assert.equal(recognizeVideo('1917.mp4',raw(),[]).metadata.title,'1917');
  const rules:VideoRule[]=[{path:'Drama',mode:'series',title:'剧名',season:1},{path:'Drama/S02',mode:'season',season:2}];
  assert.equal(recognizeVideo('Drama/S02/01.mp4',raw(),rules).metadata.show,'剧名');
  assert.equal(recognizeVideo('Drama/S02/01.mp4',raw(),rules).metadata.season,2);
  assert.equal(recognizeVideo('Drama/01.mp4',raw(),rules).metadata.season,1);
  assert.equal(recognizeVideo('Drama/Drama.S03E01.mp4',raw(),rules).metadata.season,1);
  assert.equal(recognizeVideo('Drama/01.mp4',raw(),[{path:'Drama',mode:'ignore'}]).kind,'ignore');
  assert.equal(recognizeVideo('Drama2/01.mp4',raw(),[{path:'Drama',mode:'ignore'}]).kind,'movie');
  assert.equal(recognizeVideo('Drama/Season 01/01.mp4',raw(),[{path:'Drama',mode:'ignore'},{path:'Drama/Season 01',mode:'auto'}]).kind,'episode');
  const nfo={...raw('正片标题'),show:'NFO剧名',season:4,episode:5,sources:{title:'nfo' as const,show:'nfo' as const,season:'nfo' as const,episode:'nfo' as const}};
  const result=recognizeVideo('Drama/Season 01/01.mp4',nfo,[]);assert.equal(result.metadata.show,'NFO剧名');assert.equal(result.metadata.season,4);assert.equal(result.metadata.title,'正片标题');
});

async function fixture(t:{after:(fn:()=>Promise<void>)=>void},refs:string[]){
  const root=await mkdtemp(join(tmpdir(),'media-recognition-')),db=new Db(':memory:'),libraries=new MediaLibraries(db),actor={id:'admin',role:'admin'} as const;
  const scanner=new MediaScanner(db,libraries,async()=>({status:'unavailable',info:null}));
  new MediaUserState(db,libraries,scanner.catalog);
  new MediaPlayback(db,libraries);
  const rules=new MediaDirectoryRules(db),review=new MediaRecognitionReview(db,libraries,scanner.catalog,rules);
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('admin','admin','unused','admin',0,0)");
  for(const ref of refs){await mkdir(join(root,ref,'..'),{recursive:true});await writeFile(join(root,ref),'fixture');}
  const library=await libraries.create(actor,{name:'video',kind:'video',root,access:'all'});
  const scan=async()=>{const job=scanner.start(actor,library.id);await scanner.wait(library.id);assert.equal(db.get<{state:string}>('SELECT state FROM media_scan_jobs WHERE id=?',job.id)?.state,'complete');};
  const save=(path:string,rule:VideoRule|null)=>rules.save(actor,libraries,library.id,path,rule,rules.version(library.id));
  return {root,db,libraries,actor,scanner,rules,review,library,scan,save};
}

test('directory reidentification is explicit, preserves playback state and rejects stale or foreign previews',async t=>{
  const {db,actor,library,scan,save,review,rules,libraries}=await fixture(t,['Show/01.mp4','Show/02.mp4']);
  await scan();
  const before=db.get<{id:string;item_id:string;asset_id:string;edition_id:string}>(`SELECT p.id,p.asset_id,p.edition_id,e.item_id FROM media_parts p JOIN media_editions e ON e.id=p.edition_id JOIN media_assets a ON a.id=p.asset_id WHERE a.ref='Show/01.mp4'`)!;
  db.run('INSERT INTO media_progress VALUES(?,?,5,0,1,?,0)',actor.id,before.id,'session');
  db.run('INSERT INTO media_queue VALUES(?,?,?,0,0)','q',actor.id,before.id);
  db.run('INSERT INTO media_favorites VALUES(?,?,0)',actor.id,before.item_id);
  const oldRevision=rules.version(library.id);save('Show',{path:'Show',mode:'series',title:'剧名',season:1});
  assert.throws(()=>rules.save(actor,libraries,library.id,'Show',null,oldRevision),{code:'MEDIA_RULE_CHANGED'});
  await scan();
  assert.equal(db.get<{kind:string;title:string}>('SELECT kind,title FROM media_items WHERE id=?',before.item_id)?.kind,'movie');
  assert.equal(db.get<{title:string}>('SELECT title FROM media_items WHERE id=?',before.item_id)?.title,'01');
  let preview=await review.preview(actor,library.id,'Show');assert.equal(preview.items.length,2);assert.ok(preview.items.every(item=>item.status==='ready'));
  assert.throws(()=>review.apply({id:'other',role:'admin'},library.id,'Show',preview.id,[before.asset_id]),{code:'MEDIA_RECOGNITION_EXPIRED'});
  save('Show',{path:'Show',mode:'series',title:'剧名',season:2});
  assert.throws(()=>review.apply(actor,library.id,'Show',preview.id,[before.asset_id]),{code:'MEDIA_RECOGNITION_CHANGED'});
  preview=await review.preview(actor,library.id,'Show');
  db.run("CREATE TRIGGER fail_recognition BEFORE UPDATE ON media_items BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
  assert.throws(()=>review.apply(actor,library.id,'Show',preview.id,[before.asset_id]),/fixture rollback/);
  assert.equal(db.get<{kind:string}>('SELECT kind FROM media_items WHERE id=?',before.item_id)?.kind,'movie');db.run('DROP TRIGGER fail_recognition');
  review.apply(actor,library.id,'Show',preview.id,preview.items.map(item=>item.assetId));
  assert.equal(db.get<{kind:string}>('SELECT kind FROM media_items WHERE id=?',before.item_id)?.kind,'episode');
  assert.equal(db.get<{edition_id:string}>('SELECT edition_id FROM media_parts WHERE id=?',before.id)?.edition_id,before.edition_id);
  for(const table of ['media_progress','media_queue','media_favorites'])assert.equal(db.get<{n:number}>(`SELECT count(*) n FROM ${table}`)?.n,1);
  assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
  assert.throws(()=>rules.get({id:'member',role:'member'},libraries,library.id,''),{code:'ADMIN_REQUIRED'});
  assert.throws(()=>rules.get(actor,libraries,library.id,'../'),{code:'MEDIA_FOLDER_PATH'});
  preview=await review.preview(actor,library.id,'Show');db.run('UPDATE media_recognition_previews SET expires_at=0');
  assert.throws(()=>review.apply(actor,library.id,'Show',preview.id,[before.asset_id]),{code:'MEDIA_RECOGNITION_EXPIRED'});
});

test('parent directory rules are inherited by descendants and explicit series rules override filename title and season',async t=>{
  const {db,actor,library,rules,libraries}=await fixture(t,['Show/第7季/001.mp4']);
  const saved=rules.save(actor,libraries,library.id,'Show',{path:'Show',mode:'series',title:'固定剧名',season:2,stripLeadingNumber:true},rules.version(library.id));
  const detail=rules.get(actor,libraries,library.id,'Show/第7季');
  assert.equal(detail.inherited?.title,'固定剧名');assert.equal(detail.inherited?.season,2);assert.equal(saved.revision,rules.version(library.id));
  const result=recognizeVideo('Show/第7季/001.mp4',raw(),rules.list(library.id));
  assert.equal(result.kind,'episode');assert.equal(result.metadata.show,'固定剧名');assert.equal(result.metadata.season,2);assert.equal(result.metadata.episode,1);
});

test('inherited NFO and season directories group seasons; ignore preserves existing assets and curation is protected',async t=>{
  const {root,db,actor,library,scan,save,review,scanner}=await fixture(t,['Show/Season 01/E01.mp4','Show/Season 02/E01.mp4','Skipped/Film.mp4']);
  await writeFile(join(root,'Show/tvshow.nfo'),'<tvshow><title>NFO剧名</title><year>2020</year></tvshow>');
  await writeFile(join(root,'Show/Season 02/season.nfo'),'<season><seasonnumber>3</seasonnumber></season>');
  await scan();assert.equal(db.get<{n:number}>("SELECT count(*) n FROM media_items WHERE kind='series'")?.n,1);
  assert.deepEqual(db.all<{ordinal:number}>("SELECT ordinal FROM media_items WHERE kind='season' ORDER BY ordinal").map(row=>row.ordinal),[1,3]);
  save('Skipped',{path:'Skipped',mode:'ignore'});await writeFile(join(root,'Skipped/New.mp4'),'new');await scan();
  assert.equal(db.get<{available:number}>("SELECT available FROM media_assets WHERE ref='Skipped/Film.mp4'")?.available,1);
  db.run("UPDATE media_assets SET available=0 WHERE ref='Skipped/Film.mp4'");await scan();
  assert.equal(db.get<{available:number}>("SELECT available FROM media_assets WHERE ref='Skipped/Film.mp4'")?.available,1);
  assert.equal(db.get("SELECT id FROM media_assets WHERE ref='Skipped/New.mp4'"),undefined);
  const series=db.get<{id:string}>("SELECT id FROM media_items WHERE kind='series'")!;scanner.catalog.override(actor,series.id,{title:'手动剧名'});
  const preview=await review.preview(actor,library.id,'Show');assert.ok(preview.items.every(row=>row.status==='protected'));
  assert.throws(()=>review.apply(actor,library.id,'Show',preview.id,[preview.items[0]!.assetId]));
  save('Skipped',null);await scan();assert.ok(db.get("SELECT id FROM media_assets WHERE ref='Skipped/New.mp4'"));
});

test('merging multiple files into the same episode requires selection and preserves favorites and parts',async t=>{
  const {db,actor,library,scan,save,review}=await fixture(t,['Show/01 1080p.mp4','Show/01 720p.mp4']);await scan();
  const parts=db.all<{id:string}>('SELECT id FROM media_parts ORDER BY id');
  for(const item of db.all<{id:string}>("SELECT id FROM media_items WHERE kind='movie'"))db.run('INSERT INTO media_favorites VALUES(?,?,0)',actor.id,item.id);
  save('Show',{path:'Show',mode:'series',title:'剧名',season:1});
  const preview=await review.preview(actor,library.id,'Show');assert.ok(preview.items.every(row=>row.status==='review'));
  review.apply(actor,library.id,'Show',preview.id,preview.items.map(row=>row.assetId));
  assert.equal(db.get<{n:number}>("SELECT count(*) n FROM media_items WHERE kind='episode'")?.n,1);
  assert.equal(db.get<{n:number}>('SELECT count(*) n FROM media_editions')?.n,2);
  assert.equal(db.get<{n:number}>('SELECT count(*) n FROM media_favorites')?.n,1);
  assert.deepEqual(db.all('SELECT id FROM media_parts ORDER BY id'),parts);assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
});
