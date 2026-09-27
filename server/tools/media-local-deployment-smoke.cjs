// Exercise the same HTTP/restart protocol without claiming Docker mount or UID coverage.
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const {fixtureWav,exerciseDeployment}=require('./media-deployment-protocol.cjs');
(async()=>{
  assert.ok(process.env.MEDIA_FFPROBE_PATH,'Set MEDIA_FFPROBE_PATH to a working ffprobe. Build server and web first.');
  const root=await mkdtemp(join(tmpdir(),'reader-local-deployment-')),repo=resolve(__dirname,'../..');
  let child,exited,logs='';
  const stop=async()=>{if(child&&child.exitCode===null){child.kill();await exited;}child=undefined;};
  const start=async()=>{
    child=spawn(process.execPath,[join(repo,'server/dist/main.js')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BOOKS_DIR:join(root,'books'),DATA_DIR:join(root,'data'),WEB_DIR:join(repo,'web/dist'),HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',SCAN_INTERVAL:'0',WATCH_INTERVAL:'0'}});
    exited=new Promise(resolve=>child.once('exit',resolve));
    child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-10000);});
    const lines=createInterface({input:child.stdout});
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('startup timeout '+logs)),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);lines.close();reject(Error('server exited '+code+' '+logs));});
      lines.on('line',line=>{logs=(logs+line+'\n').slice(-10000);try{
        const match=/Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(JSON.parse(line).msg);
        if(match){clearTimeout(timer);resolve(match[1]);}
      }catch{}});
    });
  };
  try{
    for(const dir of ['books','media','data'])await mkdir(join(root,dir));
    const wav=fixtureWav();
    await writeFile(join(root,'media','deployment-tone.wav'),wav);
    await writeFile(join(root,'books','reading.txt'),'第一章\n部署重启阅读验证\n'.repeat(20));
    const checks=await exerciseDeployment({origin:await start(),mediaRoot:join(root,'media'),wav,restart:async()=>{await stop();return start();}});
    console.log(JSON.stringify({passed:true,scope:'compiled local main; disposable data; process restart; no Docker/mount/UID/NAS/device validation',...checks}));
  }finally{await stop();await rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
