/** Real compiled main and local enumeration; cached or first-probe fixtures. Never touches user data. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {Db} from '../src/db/index.ts';
import {loadConfig} from '../src/config/index.ts';
import {Scanner} from '../src/indexer/scanner.ts';
import {MediaScanner} from '../src/media/scanner.ts';
import {MediaLibraries} from '../src/media/libraries.ts';
import {LocalMediaStorage} from '../src/media/storage/local.ts';
import {MEDIA_PROBE_VERSION} from '../src/media/probe.ts';
import {signAccessToken} from '../src/services/tokens.ts';

const firstProbe=process.argv.includes('--first-probe');
if(firstProbe)assert.ok(process.env.MEDIA_FFPROBE_PATH,'--first-probe requires MEDIA_FFPROBE_PATH');
const count=firstProbe?100:process.argv.includes('--large')?50000:1000;
const wav=Buffer.alloc(44+8000*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
for(let sample=0;sample<8000;sample++)wav.writeInt16LE(Math.round(Math.sin(sample*2*Math.PI*440/8000)*4000),44+sample*2);
const root=await mkdtemp(join(tmpdir(),'media-production-benchmark-')),books=join(root,'books'),assets=join(root,'assets'),data=join(root,'data');
await mkdir(books);await mkdir(assets);await mkdir(data);
await writeFile(join(books,'reading.txt'),'阅读回归测试\n'.repeat(100));
process.env.BOOKS_DIR=books;process.env.DATA_DIR=data;process.env.READER_TOKEN_SECRET='production-benchmark-secret';
const config=loadConfig(),db=new Db(join(data,'reader.db'));
let child:ReturnType<typeof spawn>|undefined,logs='';
try{
  db.run("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES('reader','reader','unused','admin',0,0)");
  await new Scanner(db,config,{info(){},warn(){}}).scan();
  const book=db.get<{id:string}>('SELECT id FROM books')!.id;
  db.run("INSERT OR IGNORE INTO user_books(user_id,book_id,added_at) VALUES('reader',?,0)",book);
  const libraries=new MediaLibraries(db),scanner=new MediaScanner(db,libraries);await scanner.close();
  db.run("INSERT INTO media_libraries(id,name,kind,root,access,created_at,updated_at) VALUES('music','Music','music',?,'all',0,0)",assets);
  for(let start=0;start<count;start+=100){
    const directory=join(assets,'album-'+Math.floor(start/100));await mkdir(directory);
    await Promise.all(Array.from({length:Math.min(100,count-start)},(_,offset)=>writeFile(join(directory,`track-${start+offset}.${firstProbe?'wav':'mp3'}`),firstProbe?wav:'cached-probe-fixture')));
  }
  const storage=await LocalMediaStorage.create(assets),entries=[];
  for await(const entry of storage.list())entries.push(entry);
  if(!firstProbe)db.transaction(()=>{
    for(const entry of entries){
      const info={schemaVersion:MEDIA_PROBE_VERSION,format:'mp3',duration:60,streams:[],chapters:[],tags:{artist:'Artist',album:entry.ref.split('/')[0],title:entry.name}};
      db.run("INSERT INTO media_assets(id,library_id,ref,size,modified_at,file_identity,probe_status,technical_json) VALUES(?,'music',?,?,?,?,'ready',?)",entry.ref,entry.ref,entry.size,entry.modifiedAt,entry.fileIdentity,JSON.stringify(info));
    }
  });
  console.log(JSON.stringify({phase:'prepared',count,firstProbe}));
  child=spawn(process.execPath,[resolve('dist/main.js')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',SCAN_INTERVAL:'0',WATCH_INTERVAL:'0',WEB_DIR:''}});
  child.stderr!.on('data',value=>{logs+=value;});
  const lines=createInterface({input:child.stdout!});
  const origin=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('startup timeout '+logs)),60000);
    child!.once('error',reject);child!.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code+' '+logs));});
    lines.on('line',line=>{logs=(logs+line+'\n').slice(-10000);try{const record=JSON.parse(line);const match=/Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(record.msg);if(match){clearTimeout(timer);resolve(match[1]!);}}catch{}});
  });
  const token=signAccessToken(config,{id:'reader',role:'admin'}).token;
  const request=async(path:string,method='GET',body?:unknown)=>{
    const start=performance.now(),response=await fetch(origin+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
    const payload=await response.json();assert.equal(response.status,method==='POST'?202:200,JSON.stringify(payload));return {ms:performance.now()-start,payload};
  };
  let sequence=0;
  const read=async()=>{
    const locator='page-'+(++sequence);
    const [shelf,saved]=await Promise.all([request('/api/v1/books'),request('/api/v1/sync/progress/'+book,'PUT',{locator,percentage:.5,updatedAt:Date.now()+sequence})]);
    assert.equal(shelf.payload.items[0].id,book);assert.equal(saved.payload.progress.locator,locator);
    assert.equal((await request('/api/v1/sync/progress/'+book)).payload.progress.locator,locator);
    return {shelf:shelf.ms,save:saved.ms};
  };
  const baseline=[];for(let i=0;i<3;i++)baseline.push(await read());
  // Listening now means reading is ready; wait explicitly for media migration.
  for(let attempt=0;;attempt++){
    const response=await fetch(origin+'/api/v1/media/libraries',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
    if(response.ok)break;
    const body=await response.json();assert.equal(body.error?.code,'MEDIA_STARTING',JSON.stringify(body));
    assert.ok(attempt<3000,'media startup timeout');await read();await delay(100);
  }
  const start=performance.now(),job=(await request('/api/v1/media/libraries/music/scan','POST',{})).payload;
  const samples:Array<{shelf:number;save:number}>=[];let running=true;
  const readings=(async()=>{while(running){samples.push(await read());await delay(20);}})();
  let state=job,lastReport=performance.now();
  try{
    while(state.state==='running'){
      assert.ok(performance.now()-start<1800000,'scan timeout');await delay(1000);
      state=(await request('/api/v1/media/jobs/'+job.id)).payload;
      if(performance.now()-lastReport>10000){console.log(JSON.stringify({phase:'scanning',inspected:state.inspected,count,readingSamples:samples.length}));lastReport=performance.now();}
    }
    assert.equal(state.state,'complete');assert.equal(state.inspected,count);
  }finally{running=false;await readings;}
  const catalog=(await request('/api/v1/media/libraries/music/items?kind=track&limit=1')).payload;
  assert.equal(catalog.total,count);assert.equal(db.get<{n:number}>('SELECT count(*) n FROM media_items')!.n,0);
  if(firstProbe){
    const resources=(await request('/api/v1/media/libraries/music/assets?limit=100')).payload;
    assert.equal(resources.items.length,count);
    for(const resource of resources.items){assert.equal(resource.probe.status,'ready');assert.ok(Math.abs(resource.probe.info.duration-1)<.01);assert.ok(resource.probe.info.streams.some((stream:{codec:string})=>stream.codec==='pcm_s16le'));}
  }
  const percentile=(key:'shelf'|'save',p:number)=>{const sorted=samples.map(row=>row[key]).sort((a,b)=>a-b);return Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]!);};
  console.log(JSON.stringify({count,scanMs:Math.round(performance.now()-start),readingSamples:samples.length,baseline,shelfP95Ms:percentile('shelf',.95),shelfMaxMs:percentile('shelf',1),saveP95Ms:percentile('save',.95),saveMaxMs:percentile('save',1),scope:firstProbe?'compiled main and proxy; 100 real one-second PCM WAV files; empty probe cache; real ffprobe and duration/codec assertions; no decoding/NAS/OS cold-cache coverage':'compiled main and proxy; real local files and enumeration; preseeded probe cache; no first probe/decoding/NAS/cold-cache coverage'}));
}finally{
  if(child&&child.exitCode===null){const exit=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await exit;}
  db.close();await rm(root,{recursive:true,force:true});
}
