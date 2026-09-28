const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {createServer}=require('node:http');
const {mkdtemp,mkdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve,relative,isAbsolute}=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const assert=require('node:assert/strict');

(async()=>{
  const repo=resolve(__dirname,'../..'),root=await mkdtemp(join(tmpdir(),'reader-settings-ui-'));
  await mkdir(join(root,'books'));
  const wav=Buffer.alloc(2044);wav.write('RIFF');wav.writeUInt32LE(2036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2000,40);
  const upstream=createServer((req,res)=>{if(req.url.startsWith('/voices')){res.setHeader('content-type','application/json');res.end('[{"id":"sample","name":"测试音色"}]');}else{res.setHeader('content-type','audio/wav');res.end(wav);}});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const tts='http://127.0.0.1:'+upstream.address().port;
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const origin='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,[join(repo,'server/dist/main.js')],{cwd:repo,windowsHide:true,stdio:'ignore',env:{...process.env,BOOKS_DIR:join(root,'books'),DATA_DIR:join(root,'data'),WEB_DIR:join(repo,'web/dist'),HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'silent',SCAN_INTERVAL:'0',WATCH_INTERVAL:'0'}});
  let browser;
  try{
    for(let i=0;;i++){try{if((await fetch(origin+'/api/v1/health')).ok)break;}catch{}assert.ok(i<100&&server.exitCode===null,'fixture starts');await delay(100);}
    const result=await fetch(origin+'/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'settings-admin',password:'settings-test-password'})});assert.equal(result.status,201);
    const token=(await result.json()).session.accessToken,headers={authorization:'Bearer '+token,'content-type':'application/json'};
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.locator('#login-username').fill('settings-admin');await page.locator('#login-password').fill('settings-test-password');await page.locator('form button[type=submit]').click();
    async function open(){await page.getByRole('button',{name:'系统设置',exact:true}).click();await page.getByRole('button',{name:'服务配置',exact:true}).click();await page.getByLabel('配置分类').selectOption('tts');}
    await open();await page.getByLabel('启用 HTTP 朗读',{exact:true}).check();await page.getByLabel('语音合成接口',{exact:true}).fill(tts+'/tts');await page.getByLabel('音色列表接口（可选）',{exact:true}).fill(tts+'/voices');
    await page.getByRole('button',{name:'检测连接并获取音色',exact:true}).click();await page.locator('#business-tts-voices option').waitFor({state:'attached'});
    await page.getByRole('button',{name:'生成试听音频',exact:true}).click();await page.locator('audio[aria-label="HTTP 朗读试听"]').waitFor();
    const saved=page.waitForResponse(response=>response.url().endsWith('/admin/settings/tts')&&response.request().method()==='PATCH');await page.getByRole('button',{name:'保存配置',exact:true}).click();assert.equal((await saved).status(),200);
    assert.equal((await (await fetch(origin+'/api/v1/tts/voices',{headers})).json()).http,true);
    await page.reload();await open();assert.equal(await page.getByLabel('语音合成接口',{exact:true}).inputValue(),tts+'/tts');
    const overflow=await page.locator('.business-settings').evaluate(element=>element.scrollWidth>element.clientWidth+2);assert.equal(overflow,false,'mobile settings do not overflow');
    const artifacts=join(repo,'artifacts/business-settings');await mkdir(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'http-tts-mobile.png')});
    await page.getByLabel('配置分类').selectOption('tmdb');await page.getByLabel('启用 TMDB',{exact:true}).check();await page.getByLabel('读取令牌',{exact:true}).fill('test-token');
    const tmdbSaved=page.waitForResponse(response=>response.url().endsWith('/admin/settings/tmdb')&&response.request().method()==='PATCH');await page.getByRole('button',{name:'保存配置',exact:true}).click();assert.equal((await tmdbSaved).status(),200);
    const provider=await (await fetch(origin+'/api/v1/media/metadata/providers',{headers})).json();assert.equal(provider.items.find(item=>item.id==='tmdb').configured,true,'isolated media worker sees configuration without restarting');
    assert.equal(await page.getByLabel('读取令牌',{exact:true}).inputValue(),'');
    await page.screenshot({path:join(artifacts,'tmdb-mobile.png')});
    await page.getByLabel('配置分类').selectOption('playback');
    assert.equal(await page.getByLabel('OpenList 播放方式',{exact:true}).inputValue(),'auto');
    await page.getByLabel('OpenList 播放方式',{exact:true}).selectOption('proxy');
    const playbackSaved=page.waitForResponse(response=>response.url().endsWith('/admin/settings/playback')&&response.request().method()==='PATCH');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();assert.equal((await playbackSaved).status(),200);
    await page.reload();await open();await page.getByLabel('配置分类').selectOption('playback');
    assert.equal(await page.getByLabel('OpenList 播放方式',{exact:true}).inputValue(),'proxy');assert.deepEqual(errors,[]);
    console.log('PASS: mobile settings, draft TTS test and audio, save/reload, secret redaction, and live media worker configuration');
  }finally{
    await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
    const rel=relative(resolve(tmpdir()),resolve(root));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Unsafe fixture path');await rm(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
