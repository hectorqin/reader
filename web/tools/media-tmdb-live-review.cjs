// Real browser/HTTP/database + live TMDB; writes only to the disposable fixture.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {once}=require('node:events');
const {writeFile,mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  if(!process.env.MEDIA_TMDB_TOKEN&&!process.env.MEDIA_TMDB_API_KEY)throw Error('Configure TMDB credentials before running the live check.');
  const repo=resolve(__dirname,'../..'),report={passed:false,startedAt:new Date().toISOString(),checks:[],failedChecks:[],browserErrors:[]};
  const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,MEDIA_REVIEW_LIVE_TMDB:'1'}});
  const exited=once(server,'exit');let browser,stderr='';server.stderr.on('data',data=>stderr+=data);
  try{
    const {baseUrl}=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timed out: '+stderr)),30000);
      server.once('error',error=>{clearTimeout(timer);reject(error);});server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited: '+stderr));});
      server.stdout.on('data',data=>{output+=data;for(const line of output.split('\n')){try{const value=JSON.parse(line);if(value.baseUrl){clearTimeout(timer);resolve(value);}}catch{}}});
    });
    browser=await chromium.launch({headless:true,...(process.env.PROTOTYPE_CHROMIUM?{executablePath:process.env.PROTOTYPE_CHROMIUM}:{})});
    const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',error=>report.browserErrors.push(error.message));
    const login=await fetch(baseUrl+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'reviewer',password:'review-test-pass'})});
    assert.equal(login.status,200);const session=await login.json();
    const get=async path=>{const response=await fetch(baseUrl+'/api/v1/media/'+path,{headers:{authorization:'Bearer '+session.accessToken}});assert.equal(response.status,200);return response.json();};
    await page.goto(baseUrl+'/#/media/video/review-film');
    await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
    await page.getByText('在线匹配元数据',{exact:true}).click();
    await page.getByLabel('刮削搜索词',{exact:true}).fill('Inception');
    await page.getByRole('button',{name:'搜索候选',exact:true}).click();
    await page.getByRole('button',{name:'预览匹配',exact:true}).first().waitFor({timeout:30000});
    const candidates=(await get('items/review-film/matches')).items;
    const selected=candidates.find(candidate=>candidate.externalId==='27205');assert.ok(selected);
    report.checks.push({operation:'browser-search',count:candidates.length,id:selected.externalId});
    await page.reload();
    await page.locator('.media-metadata-matcher summary').filter({hasText:'个候选待核对'}).click();
    const candidate=()=>page.locator('.media-metadata-matcher .media-row').filter({hasText:selected.externalId});
    await candidate().getByRole('button',{name:'预览匹配',exact:true}).click();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal((await get('items/review-film')).metadata.onlineMatch,undefined);
    await candidate().getByRole('button',{name:'预览匹配',exact:true}).click();
    await page.getByRole('button',{name:'确认此匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor({timeout:30000});
    const matched=await get('items/review-film');
    assert.equal(matched.title,'人工保留标题');assert.equal(matched.metadata.year,2010);
    assert.equal(matched.metadata.onlineMatch.externalId,'27205');
    assert.equal((await get('items/review-film/matches')).items.length,0);
    report.checks.push({operation:'persist-reload-preview-cancel-confirm',manualTitlePreserved:true,year:matched.metadata.year});
    const coverPath=baseUrl+'/api/v1/media/items/review-film/cover';
    assert.equal((await fetch(coverPath)).status,401);
    const cover=await fetch(coverPath,{headers:{authorization:'Bearer '+session.accessToken},signal:AbortSignal.timeout(25000)});
    assert.equal(cover.status,200);assert.equal(cover.headers.get('cache-control'),'private, no-store');
    const bytes=(await cover.arrayBuffer()).byteLength;assert.ok(bytes>100);
    const retry=page.getByRole('button',{name:'重试封面',exact:true});if(await retry.isVisible())await retry.click();
    await page.locator('.media-hero').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{const img=document.querySelector('.media-hero .media-cover img');return img?.complete&&img.naturalWidth>0;},undefined,{timeout:25000});
    const dimensions=await page.locator('.media-hero .media-cover img').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
    report.checks.push({operation:'authenticated-cover-browser-decode',bytes,...dimensions});
    await mkdir(join(repo,'artifacts/media'),{recursive:true});
    await page.screenshot({path:join(repo,'artifacts/media/tmdb-live-matched-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor({state:'detached'});
    await page.locator('.media-hero .media-cover img').waitFor({state:'detached'});
    const removed=await get('items/review-film');assert.equal(removed.metadata.onlineMatch,undefined);
    assert.equal(removed.metadata.tmdbPosterPath,undefined);assert.equal(removed.title,'人工保留标题');
    assert.equal((await fetch(coverPath,{headers:{authorization:'Bearer '+session.accessToken}})).status,404);
    report.checks.push({operation:'remove-match-cover-and-preserve-manual-title'});
    assert.deepEqual(report.browserErrors,[]);report.passed=report.failedChecks.length===0;
    if(!report.passed)process.exitCode=1;
  }catch(error){report.error=String(error);process.exitCode=1;}
  finally{
    await browser?.close();server.stdin.end('close\n');await exited;
    report.finishedAt=new Date().toISOString();
    const redact=text=>[process.env.MEDIA_TMDB_TOKEN,process.env.MEDIA_TMDB_API_KEY].reduce((safe,key)=>key?safe.split(key).join('[redacted]'):safe,text);
    if(process.env.MEDIA_LIVE_REVIEW_REPORT)await writeFile(process.env.MEDIA_LIVE_REVIEW_REPORT,redact(JSON.stringify(report,null,2)));
    console.log(redact(JSON.stringify(report)));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
