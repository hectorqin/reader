import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Db } from '../src/db/index.ts';
import { MediaLibraries } from '../src/media/libraries.ts';
import { MediaScanner } from '../src/media/scanner.ts';

const admin={id:'admin',role:'admin'} as const,member={id:'member',role:'member'} as const;

test('batch scans cap concurrent probes, skip active libraries and cancel queued jobs without probing',async t=>{
  const base=await mkdtemp(join(tmpdir(),'media-batch-')),db=new Db(':memory:'),libraries=new MediaLibraries(db);
  let active=0,maximum=0;
  const releases:Array<()=>void>=[],seen:string[]=[];
  const scanner=new MediaScanner(db,libraries,async(file,signal)=>{
    seen.push(file);active++;maximum=Math.max(maximum,active);
    try{await new Promise<void>((resolve,reject)=>{releases.push(resolve);if(signal?.aborted)reject(Error('aborted'));else signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});}
    finally{active--;}
    return {status:'unavailable',info:null};
  });
  t.after(async()=>{await scanner.close();db.close();await rm(base,{recursive:true,force:true});});
  const libs=[];
  for(let i=0;i<5;i++){const root=join(base,String(i));await mkdir(root);await writeFile(join(root,'sample.mp4'),'fixture');libs.push(await libraries.create(admin,{name:'Film '+i,kind:'video',root,access:'all'}));}
  assert.throws(()=>scanner.startAll(member),{statusCode:403});assert.throws(()=>scanner.latestJobs(member),{statusCode:403});
  const first=scanner.start(admin,libs[0]!.id),batch=scanner.startAll(admin);
  assert.deepEqual(batch.skipped,[libs[0]!.id]);assert.equal(batch.items.length,4);
  assert.equal(scanner.latestJobs(admin).filter(job=>job.state==='running').length,2);
  assert.equal(scanner.latestJobs(admin).filter(job=>job.state==='queued').length,3);
  assert.equal(scanner.startAll(admin).skipped.length,5);
  const cancelled=batch.items.find(job=>job.state==='queued')!;
  assert.equal(scanner.cancel(admin,cancelled.id).state,'cancelled');await scanner.wait(cancelled.libraryId);
  const deadline=Date.now()+5000;
  while(seen.length<2&&Date.now()<deadline)await delay(5);
  assert.equal(seen.length,2);assert.equal(active,2);
  releases[0]!();
  while(seen.length<3&&Date.now()<deadline)await delay(5);
  assert.equal(seen.length,3);assert.equal(maximum,2);
  // Closing cancels both active and remaining queued work, without starting more probes.
  await scanner.close();assert.equal(seen.length,3);assert.equal(active,0);
  const jobs=scanner.latestJobs(admin);assert.equal(jobs.length,5);
  assert.ok(jobs.every(job=>['complete','cancelled'].includes(job.state)));
  assert.ok(jobs.find(job=>job.id===first.id));
  const restored=new MediaScanner(db,libraries);await restored.close();
});

test('restart fails queued and running jobs; latest summary selects newest per library',async t=>{
  const root=await mkdtemp(join(tmpdir(),'media-scan-restart-')),db=new Db(':memory:'),libraries=new MediaLibraries(db);
  const scanner=new MediaScanner(db,libraries),lib=await libraries.create(admin,{name:'Films',kind:'video',root,access:'all'});
  await scanner.close();
  t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
  db.run("INSERT INTO media_scan_jobs(id,library_id,state,started_at) VALUES('running',?,'running',1),('queued',?,'queued',1)",lib.id,lib.id);
  const restarted=new MediaScanner(db,libraries);
  for(const id of ['running','queued']){assert.equal(restarted.job(admin,id).state,'failed');assert.equal(restarted.job(admin,id).error,'server-restarted');}
  assert.equal(restarted.latestJobs(admin).length,1);assert.equal(restarted.latestJobs(admin)[0]!.id,'queued');await restarted.close();
});

test('library summaries count indexed works, all audiobook editions and missing assets without exposing roots to members',async t=>{
  const base=await mkdtemp(join(tmpdir(),'media-summaries-')),db=new Db(':memory:'),libraries=new MediaLibraries(db);
  const scanner=new MediaScanner(db,libraries,async()=>({status:'ready',info:{duration:60,format:'m4b',streams:[],tags:{album:'故事'},chapters:[{start:0,end:30,title:'第一章'},{start:30,end:60,title:'第二章'}]}}));
  t.after(async()=>{await scanner.close();db.close();await rm(base,{recursive:true,force:true});});
  const root=join(base,'audio');await mkdir(root);await writeFile(join(root,'story.m4b'),'fixture');
  const audio=await libraries.create(admin,{name:'Audio',kind:'audiobook',root,access:'all'});
  const empty=await libraries.create(admin,{name:'Empty',kind:'music',root:base,access:'all'});
  scanner.start(admin,audio.id);await scanner.wait(audio.id);
  const edition=db.get<{id:string;item_id:string}>('SELECT id,item_id FROM media_editions')!;
  db.run("INSERT INTO media_editions(id,item_id,local_key,label) VALUES('extra-edition',?,'extra','第二版')",edition.item_id);
  const part=db.get<{asset_id:string}>('SELECT asset_id FROM media_parts')!;
  db.run("INSERT INTO media_parts(id,edition_id,asset_id,local_key,title,ordinal,start_seconds,end_seconds,active) VALUES('extra-part','extra-edition',?,'extra','新版章节',0,0,60,1)",part.asset_id);
  db.run("UPDATE media_assets SET available=0 WHERE id=?",part.asset_id);
  assert.throws(()=>scanner.catalog.librarySummaries(member),{statusCode:403});
  const result=scanner.catalog.librarySummaries(admin).items;
  assert.deepEqual(result.find(row=>row.id===empty.id),{id:empty.id,root:base,counts:{},chapters:0,missingFiles:0});
  assert.deepEqual(result.find(row=>row.id===audio.id),{id:audio.id,root,counts:{audiobook:1},chapters:3,missingFiles:1});
});
