// Disposable compiled server and actual media for Android device checks.
const assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {join,resolve,dirname,basename}=require('node:path');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const exec=promisify(execFile);

function tone(seconds,frequency){
  const samples=8000*seconds,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(1200*Math.sin(2*Math.PI*frequency*i/8000)),44+i*2);
  return wav;
}
(async()=>{
  assert.ok(process.env.MEDIA_FFPROBE_PATH,'Set MEDIA_FFPROBE_PATH to a working ffprobe.');
  assert.ok(process.env.MEDIA_TEST_FFMPEG,'Set MEDIA_TEST_FFMPEG to ffmpeg with lavfi/libx264/AAC support.');
  const repo=resolve(__dirname,'../..'),root=await mkdtemp(join(tmpdir(),'reader-device-check-'));
  let child,exit,stopRequested;
  const stopped=new Promise(done=>{stopRequested=done;});
  const stop=()=>stopRequested();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const expiry=setTimeout(stop,2*60*60*1000);
  try{
    const paths={music:join(root,'music'),audiobook:join(root,'audiobook'),video:join(root,'video')};
    for(const dir of [join(root,'books'),...Object.values(paths)])await mkdir(dir,{recursive:true});
    await writeFile(join(root,'books','Reading check.txt'),'第一章\n阅读界面保留验证。\n'.repeat(50));
    const album=join(paths.music,'Device album'),book=join(paths.audiobook,'Device audiobook');
    await mkdir(album);await mkdir(book);
    for(const [name,hz] of [['01 First',440],['02 Second',660]]){
      await writeFile(join(album,name+'.wav'),tone(90,hz));
      await writeFile(join(book,name+'.wav'),tone(90,hz));
    }
    const season=join(paths.video,'Device Show','Season 01');await mkdir(season,{recursive:true});
    for(const file of [join(paths.video,'Device Movie.mp4'),join(season,'Device Show S01E01.mp4'),join(season,'Device Show S01E02.mp4')]){
      await exec(process.env.MEDIA_TEST_FFMPEG,['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:d=90','-f','lavfi','-i','sine=frequency=440:duration=90','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',file],{windowsHide:true,timeout:60000});
      await writeFile(file.replace(/\.mp4$/,'.zh.srt'),'1\n00:00:00,000 --> 00:01:20,000\nAndroid 字幕验证\n');
    }
    let logs='';
    child=spawn(process.execPath,[join(repo,'server/dist/main.js')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BOOKS_DIR:join(root,'books'),DATA_DIR:join(root,'data'),WEB_DIR:join(repo,'web/dist'),HOST:'127.0.0.1',PORT:'0',SCAN_INTERVAL:'0',WATCH_INTERVAL:'0',LOG_LEVEL:'info'}});
    exit=new Promise(done=>child.once('exit',done));
    child.stderr.on('data',data=>{logs=(logs+data).slice(-8000);});
    const origin=await new Promise((done,fail)=>{
      const timer=setTimeout(()=>fail(Error('Server startup timeout: '+logs)),30000);let buffer='';
      child.once('error',error=>{clearTimeout(timer);fail(error);});
      child.once('exit',()=>{clearTimeout(timer);fail(Error('Server exited: '+logs));});
      child.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const match=/Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(JSON.parse(line).msg);if(match){clearTimeout(timer);done(match[1]);}}catch{}}});
    });
    let token;
    const api=async(path,method='GET',body)=>{
      const response=await fetch(origin+'/api/v1/'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${data.error?.code||''}`);return data;
    };
    const password=randomUUID(),username='device-check';
    token=(await api('auth/register','POST',{username,password})).session.accessToken;
    const deadline=Date.now()+310000;
    for(;;){
      const response=await fetch(origin+'/api/v1/media/libraries',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
      const data=await response.json();if(response.ok)break;
      assert.equal(data.error?.code,'MEDIA_STARTING');assert.ok(Date.now()<deadline,'Media startup timeout');await delay(250);
    }
    const libraries=[];
    for(const [kind,path] of Object.entries(paths)){
      const library=await api('media/libraries','POST',{name:'Device '+kind,kind,root:path,access:'all'});
      const scan=await api(`media/libraries/${library.id}/scan`,'POST',{});let job;
      for(let i=0;i<240;i++){job=await api('media/jobs/'+scan.id);if(job.state!=='running')break;await delay(250);}
      assert.equal(job.state,'complete');libraries.push(library);
    }
    const counts={};
    for(const [channel,kind] of [['video','movie'],['video','series'],['music','track'],['audiobook','audiobook']]){
      const result=await api(`media/browse?channel=${channel}&kind=${kind}`);assert.ok(result.total>0,kind+' was indexed');counts[kind]=result.total;
    }
    const tracks=await api('media/browse?channel=music&kind=track');
    const detail=await api('media/items/'+tracks.items[0].id);const part=detail.editions[0].parts[0];assert.equal(part.end,90);
    const playback=await api('media/playback','POST',{partId:part.id});
    const stream=await fetch(origin+playback.streamUrl,{headers:{range:'bytes=0-43'},signal:AbortSignal.timeout(5000)});
    assert.equal(stream.status,206);assert.equal(Buffer.from(await stream.arrayBuffer()).toString('ascii',0,4),'RIFF');
    const checks={compiledServer:true,counts,realWavSeconds:90,range:true,deviceVerified:false};
    if(process.argv.includes('--check'))console.log(JSON.stringify({passed:true,...checks}));
    else{
      // Credentials belong only to this disposable local fixture; no access token is printed.
      console.log(JSON.stringify({ready:true,origin,emulatorOrigin:origin.replace('127.0.0.1','10.0.2.2'),username,password,...checks}));
      await Promise.race([stopped,exit.then(()=>{throw Error('Fixture server exited unexpectedly');})]);
    }
  }finally{
    clearTimeout(expiry);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    if(child&&child.exitCode===null){child.kill();await exit;}
    assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('reader-device-check-'));
    await rm(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
