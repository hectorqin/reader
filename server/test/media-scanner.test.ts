import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';
import type { MediaProbe } from '../src/media/probe.ts';
import {MEDIA_PROBE_VERSION} from '../src/media/probe.ts';
import type { MediaStorage } from '../src/media/storage/types.ts';

test('remote scan overlaps bounded metadata reads and exposes diagnostic history',async t=>{
  const root=await mkdtemp(join(tmpdir(),'scan-concurrency-')),db=new Db(':memory:');
  const libraries=new MediaLibraries(db),actor={id:'admin',role:'admin'} as const;
  const library=await libraries.create(actor,{name:'Remote',kind:'video',root,access:'all'});
  const entries=Array.from({length:8},(_,i)=>({ref:`film-${i}.mp4`,name:`film-${i}.mp4`,size:1,modifiedAt:0,fileIdentity:null}));
  let active=0,peak=0,fail=false;
  const storage:MediaStorage={
    async *list(){yield* entries;},
    async stat(){throw Error('remote scan must use its directory snapshot');},
    async siblings(ref){
      active++;peak=Math.max(peak,active);
      const live=scanner.job(actor,db.get<{id:string}>('SELECT id FROM media_scan_jobs ORDER BY rowid DESC LIMIT 1')!.id);
      assert.ok(live.diagnostics?.active.some(operation=>operation.phase==='metadata'));
      await new Promise(resolve=>setTimeout(resolve,10));active--;
      if(fail&&ref===entries[0]!.ref)throw Object.assign(new Error('secret upstream URL must not be logged'),{code:'MEDIA_OPENLIST_UNAVAILABLE'});
      return entries;
    },
    async siblingNames(){return new Set(entries.map(entry=>entry.name));},
    async open(){throw Error('unexpected open');},
  };
  t.mock.method(libraries,'storage',async()=>storage);
  const scanner=new MediaScanner(db,libraries);
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  const job=scanner.start(actor,library.id);await scanner.wait(library.id);
  assert.equal(scanner.job(actor,job.id).state,'complete');
  assert.ok(peak>1&&peak<=4,`expected bounded parallel checks, observed ${peak}`);
  const diagnostics=scanner.job(actor,job.id).diagnostics!;
  assert.equal(diagnostics.timings.stat,0);assert.ok(diagnostics.timings.metadata>0);assert.ok(diagnostics.logs.some(log=>log.message==='扫描完成'));
  assert.deepEqual(diagnostics.active,[]);
  const before=scanner.assets(actor,library.id);
  fail=true;const failed=scanner.start(actor,library.id);await scanner.wait(library.id);
  assert.equal(scanner.job(actor,failed.id).state,'failed');assert.equal(active,0);
  assert.equal(db.get<{n:number}>('SELECT count(*) n FROM media_scan_stage')!.n,0);
  assert.deepEqual(scanner.assets(actor,library.id),before);
  const failedDiagnostics=scanner.job(actor,failed.id).diagnostics!;
  assert.ok(failedDiagnostics.logs.some(log=>log.message.includes('操作中断：metadata')));
  assert.ok(!JSON.stringify(failedDiagnostics).includes('secret upstream'));
});

test('publication skips unchanged catalog writes but replays sidecars, legacy fingerprints and restored files atomically',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-publication-delta-')),db=new Db(':memory:'),libraries=new MediaLibraries(db);
  const actor={id:'admin',role:'admin'} as const;
  const library=await libraries.create(actor,{name:'Films',kind:'video',root,access:'all'});
  const scanner=new MediaScanner(db,libraries,async()=>({status:'ready',info:{duration:20,format:'mp4',streams:[],tags:{title:'Original'},chapters:[]}}));
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  const ingest=scanner.catalog.ingest.bind(scanner.catalog);
  let calls=0,fail=false;
  t.mock.method(scanner.catalog,'ingest',(...args:Parameters<typeof ingest>)=>{
    calls++;ingest(...args);if(fail)throw Error('publication fault after ingest');
  });
  const scan=async()=>{const job=scanner.start(actor,library.id);await scanner.wait(library.id);return scanner.job(actor,job.id);};
  await writeFile(join(root,'film.mp4'),'fixture');
  assert.equal((await scan()).state,'complete');assert.equal(calls,1);
  const id=scanner.assets(actor,library.id).items[0]!.id;
  const item=scanner.catalog.list(actor,library.id).items[0]!;
  const parts=db.all('SELECT * FROM media_parts');
  assert.equal((await scan()).state,'complete');assert.equal(calls,1,'unchanged input does not call ingest');
  scanner.catalog.override(actor,item.id,{title:'Manual'});
  await scan();assert.equal(calls,1);assert.equal(scanner.catalog.detail(actor,item.id).title,'Manual');
  await writeFile(join(root,'film.nfo'),'<movie><title>Sidecar changed</title></movie>');
  await scan();assert.equal(calls,2,'sidecar change must replay even when media bytes do not change');
  assert.equal(db.get<{title:string}>('SELECT title FROM media_items WHERE id=?',item.id)!.title,'Sidecar changed');
  assert.equal(scanner.catalog.detail(actor,item.id).title,'Manual');
  db.run('UPDATE media_assets SET publication_fingerprint=NULL WHERE id=?',id);
  await scan();assert.equal(calls,3,'pre-fingerprint database is upgraded');
  await scan();assert.equal(calls,3);
  // A missing resource is reactivated using full ingest; identity and manual title survive.
  await rm(join(root,'film.mp4'));await scan();assert.equal(scanner.asset(actor,id).available,false);
  await writeFile(join(root,'film.mp4'),'fixture');await scan();assert.equal(calls,4);
  assert.equal(scanner.asset(actor,id).available,true);
  assert.deepEqual(db.all('SELECT * FROM media_parts').map(row=>({...row})),parts.map(row=>({...row,title:'Sidecar changed'})));
  const before=db.get('SELECT * FROM media_assets WHERE id=?',id);
  await writeFile(join(root,'film.nfo'),'<movie><title>Failed replacement</title></movie>');
  fail=true;assert.equal((await scan()).state,'failed');
  assert.deepEqual(db.get('SELECT * FROM media_assets WHERE id=?',id),before,'failed publish rolls fingerprint and asset changes back');
  assert.equal(db.get<{title:string}>('SELECT title FROM media_items WHERE id=?',item.id)!.title,'Sidecar changed');
  fail=false;assert.equal((await scan()).state,'complete');
  assert.equal(db.get<{title:string}>('SELECT title FROM media_items WHERE id=?',item.id)!.title,'Failed replacement');
  assert.equal(scanner.catalog.detail(actor,item.id).title,'Manual');
});

test('legacy probe cache is refreshed once without changing resource or part identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-probe-upgrade-')),db=new Db(':memory:');
  const libraries=new MediaLibraries(db),actor={id:'admin',role:'admin'} as const;
  const lib=await libraries.create(actor,{name:'Films',kind:'video',root,access:'all'});
  let calls=0;
  const scanner=new MediaScanner(db,libraries,async()=>{calls++;return {status:'ready',info:{duration:1,format:'mp4',tags:{},chapters:[],streams:[{index:0,type:'video',codec:'h264',attachedPicture:false,profile:'High',level:31}]}};});
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'film.mp4'),'fixture');
  const scan=async()=>{const job=scanner.start(actor,lib.id);await scanner.wait(lib.id);assert.equal(scanner.job(actor,job.id).state,'complete');};
  await scan();
  const asset=scanner.assets(actor,lib.id).items[0]!,parts=db.all('SELECT id,asset_id FROM media_parts');
  const legacy={...asset.probe.info!};delete legacy.schemaVersion;delete legacy.streams[0]!.profile;delete legacy.streams[0]!.level;
  db.run('UPDATE media_assets SET technical_json=? WHERE id=?',JSON.stringify(legacy),asset.id);
  await scan();assert.equal(calls,2);
  const upgraded=scanner.asset(actor,asset.id);
  assert.equal(upgraded.probe.info!.schemaVersion,MEDIA_PROBE_VERSION);
  assert.equal(upgraded.probe.info!.streams[0]!.profile,'High');
  assert.deepEqual(db.all('SELECT id,asset_id FROM media_parts'),parts);
  await scan();assert.equal(calls,2,'current unchanged cache reuses the probe');
});

test('publication resource maps retain ambiguous identity and size checks when resolving moves',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-move-map-')),db=new Db(':memory:'),libraries=new MediaLibraries(db);
  const actor={id:'admin',role:'admin'} as const,lib=await libraries.create(actor,{name:'Music',kind:'music',root,access:'all'});
  const scanner=new MediaScanner(db,libraries);
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  let sequence=0;
  const publish=(entries:Array<{ref:string;identity:string;size?:number}>)=>{
    const job='job-'+(++sequence);
    db.run("INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES(?,?,'running',0)",job,lib.id);
    for(const entry of entries){
      const payload={ref:entry.ref,fileIdentity:entry.identity,size:entry.size??1,modifiedAt:0,metadata:{title:entry.ref},probe:{status:'unavailable',info:null}};
      db.run('INSERT INTO media_scan_stage VALUES(?,?,?)',job,entry.ref,JSON.stringify(payload));
    }
    Reflect.apply(Reflect.get(scanner,'publish'),scanner,[lib.id,job]);
    return scanner.assets(actor,lib.id).items;
  };
  const initial=publish([{ref:'a.mp3',identity:'shared'},{ref:'b.mp3',identity:'shared'},{ref:'unique.mp3',identity:'unique'},{ref:'changed.mp3',identity:'changed'}]);
  const id=(ref:string)=>initial.find(asset=>asset.ref===ref)!.id;
  const moved=publish([{ref:'c.mp3',identity:'shared'},{ref:'moved.mp3',identity:'unique'},{ref:'bigger.mp3',identity:'changed',size:2}]);
  assert.equal(moved.find(asset=>asset.ref==='moved.mp3')!.id,id('unique.mp3'));
  assert.ok(![id('a.mp3'),id('b.mp3')].includes(moved.find(asset=>asset.ref==='c.mp3')!.id),'ambiguous old identities are not merged');
  assert.notEqual(moved.find(asset=>asset.ref==='bigger.mp3')!.id,id('changed.mp3'),'changed size is not evidence of a move');
  assert.ok(moved.filter(asset=>['a.mp3','b.mp3','changed.mp3'].includes(asset.ref)).every(asset=>!asset.available));
  const duplicate=publish([{ref:'one.mp3',identity:'unique'},{ref:'two.mp3',identity:'unique'}]);
  const active=duplicate.filter(asset=>asset.available);
  assert.equal(active.length,2);assert.equal(new Set(active.map(asset=>asset.id)).size,2);
  assert.ok(active.every(asset=>asset.id!==id('unique.mp3')),'ambiguous staged identities do not consume one old resource twice');
});

test('scan preserves identity on rename, missing history, and the previous snapshot on failure',async t=>{
  const base=await mkdtemp(join(tmpdir(),'media-scan-')),root=join(base,'library');await mkdir(root);
  const db=new Db(':memory:');const libraries=new MediaLibraries(db);
  const admin={id:'admin',role:'admin'} as const;
  const library=await libraries.create(admin,{name:'Films',kind:'video',root,access:'all'});
  let fail=false,calls=0;
  const probe:MediaProbe=async()=>{calls++;if(fail)throw new Error('probe interrupted');return {status:'ready',info:{duration:60,format:'mp4',streams:[],tags:{title:'Film'},chapters:[]}};};
  const scanner=new MediaScanner(db,libraries,probe);
  t.after(async()=>{await scanner.close();db.close();await rm(base,{recursive:true,force:true});});
  await writeFile(join(root,'film.mp4'),'media');await writeFile(join(root,'ignore.txt'),'text');
  const first=scanner.start(admin,library.id);assert.throws(()=>scanner.start(admin,library.id),{statusCode:409});await scanner.wait(library.id);
  assert.equal(scanner.job(admin,first.id).state,'complete');assert.equal(scanner.assets(admin,library.id).total,1);
  const original=scanner.assets(admin,library.id).items[0]!;
  scanner.start(admin,library.id);await scanner.wait(library.id);assert.equal(calls,1);
  await rename(join(root,'film.mp4'),join(root,'renamed.mp4'));
  scanner.start(admin,library.id);await scanner.wait(library.id);
  assert.equal(scanner.assets(admin,library.id).items[0]!.id,original.id);
  await writeFile(join(root,'new.mp4'),'new');fail=true;
  const failed=scanner.start(admin,library.id);await scanner.wait(library.id);
  assert.equal(scanner.job(admin,failed.id).state,'failed');assert.equal(scanner.assets(admin,library.id).total,1);assert.equal(scanner.asset(admin,original.id).available,true);
  fail=false;await rm(join(root,'renamed.mp4'));
  scanner.start(admin,library.id);await scanner.wait(library.id);assert.equal(scanner.asset(admin,original.id).available,false);
  await rename(root,join(base,'unmounted'));
  const offline=scanner.start(admin,library.id);await scanner.wait(library.id);assert.equal(scanner.job(admin,offline.id).error,'directory-unavailable');
  assert.equal(scanner.assets(admin,library.id).items.filter(a=>a.available).length,1);
});

test('probe unavailable still imports audio and restart cleans unfinished staging',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-audio-'));const db=new Db(':memory:');const libraries=new MediaLibraries(db);
  const admin={id:'admin',role:'admin'} as const;
  const library=await libraries.create(admin,{name:'Audio',kind:'audiobook',root,access:'all'});
  const scanner=new MediaScanner(db,libraries,async()=>({status:'unavailable',info:null}));
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'book.m4b'),'audio');await writeFile(join(root,'movie.mp4'),'video');
  scanner.start(admin,library.id);await scanner.wait(library.id);
  assert.equal(scanner.assets(admin,library.id).total,1);assert.equal(scanner.assets(admin,library.id).items[0]!.probe.status,'unavailable');
  db.run("INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES('interrupted',?,'running',0)",library.id);
  db.run("INSERT INTO media_scan_stage VALUES('interrupted','a','{}')");
  const restarted=new MediaScanner(db,libraries);
  assert.equal(restarted.job(admin,'interrupted').error,'server-restarted');assert.equal(db.all('SELECT * FROM media_scan_stage').length,0);
});

test('failed cache upgrade preserves the published chapters until probing recovers',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-probe-upgrade-failure-')),db=new Db(':memory:');
  const libraries=new MediaLibraries(db),actor={id:'admin',role:'admin'} as const;
  const lib=await libraries.create(actor,{name:'Books',kind:'audiobook',root,access:'all'});
  let available=true;
  const scanner=new MediaScanner(db,libraries,async()=>available?{status:'ready',info:{duration:60,format:'m4b',streams:[],tags:{},chapters:[{start:0,end:30,title:'第一章'},{start:30,end:60,title:'第二章'}]}}:{status:'unavailable',info:null});
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'book.m4b'),'fixture');
  scanner.start(actor,lib.id);await scanner.wait(lib.id);
  const asset=scanner.assets(actor,lib.id).items[0]!,legacy={...asset.probe.info!};delete legacy.schemaVersion;
  db.run('UPDATE media_assets SET technical_json=? WHERE id=?',JSON.stringify(legacy),asset.id);
  const snapshot=db.all('SELECT * FROM media_parts');
  available=false;const failed=scanner.start(actor,lib.id);await scanner.wait(lib.id);
  assert.equal(scanner.job(actor,failed.id).state,'failed');
  assert.equal(scanner.job(actor,failed.id).error,'probe-upgrade-failed');
  assert.deepEqual(db.all('SELECT * FROM media_parts'),snapshot);
  assert.deepEqual(scanner.asset(actor,asset.id).probe.info,legacy);
  available=true;const recovered=scanner.start(actor,lib.id);await scanner.wait(lib.id);
  assert.equal(scanner.job(actor,recovered.id).state,'complete');
  assert.equal(scanner.asset(actor,asset.id).probe.info!.schemaVersion,MEDIA_PROBE_VERSION);
  assert.deepEqual(db.all<{id:string}>('SELECT id FROM media_parts').map(row=>row.id).sort(),snapshot.map(row=>row.id).sort());
});

test('explicit cancellation preserves published resources and cannot cancel a later job',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-cancel-')),db=new Db(':memory:');
  const libraries=new MediaLibraries(db),admin={id:'admin',role:'admin'} as const;
  const lib=await libraries.create(admin,{name:'Films',kind:'video',root,access:'all'});
  let slow=false,entered:()=>void=()=>{};
  const scanner=new MediaScanner(db,libraries,async(_file,signal)=>{
    if(slow)await new Promise<void>((resolve,reject)=>{entered();if(signal?.aborted)reject(new Error('aborted'));else signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
    return {status:'ready',info:{duration:60,format:'mp4',streams:[],tags:{},chapters:[]}};
  });
  t.after(async()=>{await scanner.close();db.close();await rm(root,{recursive:true,force:true});});
  await writeFile(join(root,'first.mp4'),'original');scanner.start(admin,lib.id);await scanner.wait(lib.id);
  const snapshot=scanner.assets(admin,lib.id);
  await writeFile(join(root,'second.mp4'),'new');slow=true;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const job=scanner.start(admin,lib.id);await started;
  assert.throws(()=>scanner.cancel({id:'member',role:'member'},job.id),{statusCode:403});
  scanner.cancel(admin,job.id);await scanner.wait(lib.id);
  assert.equal(scanner.job(admin,job.id).state,'cancelled');
  assert.deepEqual(scanner.assets(admin,lib.id),snapshot);
  assert.equal(db.all('SELECT * FROM media_scan_stage').length,0);
  const nextStarted=new Promise<void>(resolve=>{entered=resolve;});
  const next=scanner.start(admin,lib.id);await nextStarted;
  scanner.cancel(admin,job.id);
  assert.equal(scanner.job(admin,next.id).state,'running');
  scanner.cancel(admin,next.id);await scanner.wait(lib.id);
});
