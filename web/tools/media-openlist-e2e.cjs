/* Real production UI and reader routes; only the OpenList upstream is a local test server. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {createServer}=require('node:http');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');

function sampleWav(){
  const rate=22050,frames=rate*8,buffer=Buffer.alloc(44+frames*2);
  buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++)buffer.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/rate)*1200),44+i*2);
  return buffer;
}
(async()=>{
  const repo=resolve(__dirname,'../..'),out=resolve(process.env.MEDIA_OPENLIST_REVIEW_OUTPUT||join(repo,'artifacts/media/openlist-e2e-review'));
  await fs.mkdir(out,{recursive:true});
  const audio=sampleWav(),files=new Map([
    ['/音乐/track.wav',audio],
    ['/音乐/track.nfo',Buffer.from('<album><title>云端练习曲</title><album>远方来信</album><artist>林间</artist></album>')],
    ['/音乐/track.lrc',Buffer.from('[00:00.00]云端练习曲\n[00:02.00]OpenList 本机模拟上游验收')],
  ]);
  const state={origin:'',token:'openlist-e2e-token',password:'openlist-e2e-directory-password',calls:[],rawAuth:false};
  const upstream=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,state.origin);
      if(url.pathname.startsWith('/mounted/api/fs/')){
        let raw='';for await(const chunk of req)raw+=chunk;
        const body=JSON.parse(raw);state.calls.push({path:url.pathname,method:req.method,remotePath:body.path});
        res.setHeader('content-type','application/json');
        if(req.method!=='POST'||req.headers.authorization!==state.token||body.password!==state.password){res.end(JSON.stringify({code:403,message:'fixture authorization failed'}));return;}
        const item=(path,data)=>({name:path.split('/').at(-1),is_dir:false,size:data.length,modified:'2026-09-27T00:00:00Z'});
        if(url.pathname.endsWith('/list')){
          if(body.path!=='/音乐'){res.end(JSON.stringify({code:404}));return;}
          const content=[...files].map(([path,data])=>item(path,data));res.end(JSON.stringify({code:200,data:{total:content.length,content:content.slice((body.page-1)*body.per_page,body.page*body.per_page)}}));return;
        }
        const data=files.get(body.path);res.end(JSON.stringify(data?{code:200,data:{...item(body.path,data),raw_url:state.origin+'/raw?path='+encodeURIComponent(body.path)}}:{code:404}));return;
      }
      if(url.pathname!=='/raw'){res.writeHead(404);res.end();return;}
      state.rawAuth ||= !!req.headers.authorization;
      const data=files.get(url.searchParams.get('path'));if(!data){res.writeHead(404);res.end();return;}
      state.calls.push({path:'/raw',range:req.headers.range||null});
      const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
      const type=url.searchParams.get('path').endsWith('.wav')?'audio/wav':'text/plain; charset=utf-8';
      if(match){const start=Number(match[1]),end=match[2]?Number(match[2]):data.length-1;res.writeHead(206,{'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':end-start+1,'content-type':type,'accept-ranges':'bytes'});res.end(data.subarray(start,end+1));}
      else{res.writeHead(200,{'content-length':data.length,'content-type':type,'accept-ranges':'bytes'});res.end(data);}
    }catch(error){res.writeHead(500);res.end('fixture failed');}
  });
  await new Promise(ok=>upstream.listen(0,'127.0.0.1',ok));state.origin='http://127.0.0.1:'+upstream.address().port;
  const service=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,env:{...process.env,MEDIA_REVIEW_TIMEOUT_MS:'300000'},stdio:['pipe','pipe','pipe']});
  let browser,logs='',page;service.stderr.on('data',data=>logs+=data);
  const checks=[],screenshots=[],errors=[];
  try{
    const {baseUrl}=await new Promise((ok,no)=>{let output='';service.stdout.on('data',data=>{output+=data;for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.baseUrl)ok(value);}catch{}});service.once('exit',()=>no(Error(logs||'fixture exited')));});
    browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});
    page=await browser.newPage({viewport:{width:1120,height:900}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    let authorization='';page.on('request',request=>{if(request.url().startsWith(baseUrl+'/api/v1/media/')&&request.headers().authorization)authorization=request.headers().authorization;});
    const api=async(path)=>{const response=await page.request.get(baseUrl+'/api/v1/media/'+path,{headers:{authorization}});assert.ok(response.ok(),'reader API '+path+' returned '+response.status());return response.json();};
    const choose=async(name,option)=>{await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();};
    const go=async(hash)=>{await page.evaluate(value=>{location.hash=value;},hash);};
    const shot=async(name)=>{await page.screenshot({path:join(out,name+'.png')});screenshots.push(name);};
    await page.goto(baseUrl+'/#/media/music/settings/libraries/new');
    await page.locator('#login-username').fill('reviewer');await page.locator('#login-password').fill('review-test-pass');await page.locator('form button[type=submit]').click();
    await page.getByRole('heading',{name:'新建媒体库',exact:true}).waitFor();await page.locator('input[name=name]').fill('OpenList 音乐验收');await choose('内容类型','音乐');await choose('接入方式','OpenList');
    await page.locator('input[name=baseUrl]').fill(state.origin+'/mounted/');await page.locator('input[name=token]').fill(state.token);await page.locator('input[name=password]').fill(state.password);await page.locator('input[name=root]').fill('/音乐/');await choose('访问范围','所有用户');await shot('01-create-openlist');
    const creation=page.waitForResponse(response=>response.request().method()==='POST'&&response.url()===baseUrl+'/api/v1/media/libraries');
    await page.getByRole('button',{name:'创建并扫描',exact:true}).click();const createdResponse=await creation;
    assert.equal(createdResponse.status(),201);const payload=createdResponse.request().postDataJSON(),library=await createdResponse.json();
    assert.equal(payload.storage,'openlist');assert.equal(payload.kind,'music');assert.equal(payload.access,'all');assert.equal(payload.root,'/音乐/');assert.equal(payload.openlist.baseUrl,state.origin+'/mounted/');assert.equal(payload.openlist.token,state.token);assert.equal(payload.openlist.password,state.password);assert.ok(payload.requestId);
    checks.push('生产页面表单向真实 Reader 接口提交 OpenList 连接、音乐类型、访问范围和防重复创建的请求标识。');
    let jobs;for(let attempt=0;attempt<50;attempt++){jobs=await api('libraries/'+library.id+'/jobs');if(jobs.items[0]?.state==='complete'||jobs.items[0]?.state==='failed')break;await new Promise(ok=>setTimeout(ok,200));}
    assert.equal(jobs.items[0]?.state,'complete',JSON.stringify(jobs));
    const config=await api('libraries/'+library.id+'/configuration');assert.equal(config.storage,'openlist');assert.equal(config.root,'/音乐');assert.equal(config.openlist.baseUrl,state.origin+'/mounted');assert.equal(config.openlist.hasToken,true);assert.equal(config.openlist.hasPassword,true);assert.ok(!JSON.stringify(config).includes(state.token));assert.ok(!JSON.stringify(config).includes(state.password));
    const catalog=await api('libraries/'+library.id+'/items?kind=track&offset=0&limit=50');assert.equal(catalog.items.length,1);assert.equal(catalog.items[0].title,'云端练习曲');
    checks.push('真实扫描任务完成并读取远程 NFO；服务地址和目录按规范保存，配置接口只返回凭据是否已配置，不回显令牌或密码。');
    await go('#/media/music/tracks?library='+library.id);await page.getByRole('button',{name:'播放 云端练习曲',exact:true}).waitFor();await shot('02-scanned-track');
    await page.getByRole('button',{name:'播放 云端练习曲',exact:true}).click();
    await page.waitForFunction(()=>{const audio=document.querySelector('.media-player audio');return audio?.readyState>=2&&!audio.paused&&audio.currentTime>0;});
    const source=await page.locator('.media-player audio').getAttribute('src');assert.ok(source);const streamUrl=new URL(source,baseUrl).href;
    assert.equal(new URL(streamUrl).origin,baseUrl);assert.ok(!streamUrl.startsWith(state.origin));
    const range=await page.request.get(streamUrl,{headers:{range:'bytes=44-63'}});assert.equal(range.status(),206);assert.equal(range.headers()['content-range'],`bytes 44-63/${audio.length}`);assert.deepEqual(await range.body(),audio.subarray(44,64));
    checks.push('Chromium 通过 Reader 代理成功解码并播放生成的 WAV；指定范围读取精确返回 20 字节、206 状态和正确的 Content-Range。');
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.locator('.media-audio-heading strong').waitFor();await shot('03-remote-audio-playing');
    await go('#/media/music/settings/libraries/'+library.id+'/edit');await page.locator('input[name=token]').waitFor();assert.equal(await page.locator('input[name=token]').inputValue(),'');assert.equal(await page.locator('input[name=password]').inputValue(),'');assert.match(await page.locator('input[name=token]').getAttribute('placeholder'),/已配置/);
    await page.locator('input[name=name]').fill('OpenList 音乐验收（改名）');
    const rename=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url()===baseUrl+'/api/v1/media/libraries/'+library.id);await page.getByRole('button',{name:'保存修改',exact:true}).click();const renamed=await rename;assert.equal(renamed.status(),200);assert.deepEqual(renamed.request().postDataJSON(),{name:'OpenList 音乐验收（改名）'});
    const retained=await api('libraries/'+library.id+'/configuration');assert.equal(retained.openlist.hasToken,true);assert.equal(retained.openlist.hasPassword,true);
    await go('#/media/music/settings/libraries/'+library.id+'/edit');await page.locator('input[name=token]').waitFor();state.token='openlist-e2e-rotated-token';await page.locator('input[name=token]').fill(state.token);
    const rotation=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url()===baseUrl+'/api/v1/media/libraries/'+library.id);await page.getByRole('button',{name:'保存修改',exact:true}).click();const rotated=await rotation;assert.equal(rotated.status(),200);assert.deepEqual(rotated.request().postDataJSON().openlist,{token:state.token});
    const current=await api('libraries/'+library.id+'/configuration');assert.equal(current.openlist.hasToken,true);assert.equal(current.openlist.hasPassword,true);assert.ok(!JSON.stringify(current).includes(state.token));
    const afterRotate=await page.request.get(streamUrl,{headers:{range:'bytes=64-83'}});assert.equal(afterRotate.status(),206);assert.deepEqual(await afterRotate.body(),audio.subarray(64,84));
    await go('#/media/music/settings/libraries/'+library.id+'/edit');await page.locator('input[name=token]').waitFor();await shot('04-redacted-edit');
    checks.push('编辑页不回显凭据；改名时保留原令牌与目录密码，单独更新令牌后保留目录密码，后续真实范围读取继续成功。');
    assert.equal(state.rawAuth,false);assert.deepEqual(errors,[]);checks.push('OpenList 授权头没有转发给原始媒体下载地址；浏览器没有页面运行错误。');
    const result={date:new Date().toISOString(),scope:'生产构建页面及真实 Reader HTTP 接口、数据库、扫描与播放服务；OpenList 上游由本机模拟，未使用 page.route 模拟业务接口。',checks,screenshots,upstreamCalls:state.calls.length,upstreamRanges:state.calls.filter(call=>call.range).map(call=>call.range),errors};
    await fs.writeFile(join(out,'checks.json'),JSON.stringify(result,null,2));
    await fs.writeFile(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>OpenList 浏览器验收</title><style>body{font:15px system-ui;background:#f8f9f5;color:#202b24;padding:24px;max-width:1200px;margin:auto}img{max-width:100%;border:1px solid #dfe5d9}figure{margin:24px 0}li{margin:8px 0}</style><h1>OpenList 创建、扫描与播放验收</h1><p>生产构建页面、真实 Reader 服务与临时数据库。OpenList 上游为本机模拟服务；音频为程序生成的 8 秒 WAV。未拦截或模拟 Reader 业务 API。</p><ul>'+checks.map(value=>'<li>'+value+'</li>').join('')+'</ul>'+screenshots.map(name=>'<figure><figcaption>'+name+'</figcaption><img src="'+name+'.png"></figure>').join(''));
    console.log(JSON.stringify({checks:checks.length,screenshots:screenshots.length,upstreamCalls:state.calls.length,errors}));
  }catch(error){if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
  finally{if(browser)await browser.close();service.stdin.end();await new Promise(ok=>service.exitCode!==null?ok():service.once('exit',ok));upstream.closeAllConnections();await new Promise(ok=>upstream.close(ok));}
})().catch(error=>{console.error(error);process.exitCode=1;});
