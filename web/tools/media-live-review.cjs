// Real browser/HTTP/database + live MusicBrainz; writes only to the disposable fixture.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {once}=require('node:events');
const {writeFile}=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  if(!process.env.MEDIA_MUSICBRAINZ_USER_AGENT)throw Error('Set MEDIA_MUSICBRAINZ_USER_AGENT before running the live check.');
  const repo=resolve(__dirname,'../..'),report={passed:false,startedAt:new Date().toISOString(),checks:[],failedChecks:[],browserErrors:[]};
  const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,MEDIA_REVIEW_LIVE_MUSICBRAINZ:'1'}});
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
    await page.goto(baseUrl+'/#/media/music/live-track');
    await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
    await page.getByText('在线匹配元数据',{exact:true}).click();
    await page.getByLabel('刮削搜索词',{exact:true}).fill('Yesterday');
    await page.getByLabel('刮削艺人限定',{exact:true}).fill('The Beatles');
    await page.getByRole('button',{name:'搜索候选',exact:true}).click();
    await page.getByRole('button',{name:'预览匹配',exact:true}).first().waitFor();
    const candidates=(await get('items/live-track/matches')).items;
    const selected=candidates.find(candidate=>candidate.title==='Yesterday'&&candidate.artist==='The Beatles');
    assert.ok(selected);report.checks.push({operation:'artist-constrained-browser-search',count:candidates.length,id:selected.externalId});
    await page.reload();
    await page.locator('.media-metadata-matcher summary').filter({hasText:'个候选待核对'}).click();
    await page.locator('.media-metadata-matcher .media-row').filter({hasText:selected.externalId}).getByRole('button',{name:'预览匹配',exact:true}).click();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal((await get('items/live-track')).metadata.onlineMatch,undefined);
    await page.locator('.media-metadata-matcher .media-row').filter({hasText:selected.externalId}).getByRole('button',{name:'预览匹配',exact:true}).click();
    await page.getByRole('button',{name:'确认此匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor();
    const matched=await get('items/live-track');assert.equal(matched.title,'Yesterday · 本地标题');assert.equal(matched.metadata.artist,'The Beatles');assert.equal(matched.metadata.onlineMatch.externalId,selected.externalId);
    assert.equal((await get('items/live-track/matches')).items.length,0);
    report.checks.push({operation:'reload-preview-cancel-confirm',id:selected.externalId,manualTitlePreserved:true});
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor({state:'detached'});
    const cleared=await get('items/live-track');assert.equal(cleared.metadata.onlineMatch,undefined);assert.equal(cleared.title,'Yesterday · 本地标题');assert.equal(cleared.metadata.artist,'The Beatles');
    report.checks.push({operation:'remove-match',localMetadataPreserved:true});
    await page.evaluate(()=>{location.hash='#/media/music/live-album';});
    await page.locator('.media-hero h1').filter({hasText:'Abbey Road'}).waitFor();
    await page.getByText('在线匹配元数据',{exact:true}).click();
    await page.getByLabel('刮削艺人限定',{exact:true}).fill('The Beatles');
    await page.getByRole('button',{name:'搜索候选',exact:true}).click();
    await page.getByRole('button',{name:'预览匹配',exact:true}).first().waitFor();
    const albums=(await get('items/live-album/matches')).items;
    const album=albums.find(candidate=>candidate.externalId==='9162580e-5df4-32de-80cc-f45a8d8a9b1d');assert.ok(album);
    await page.locator('.media-metadata-matcher .media-row').filter({hasText:album.externalId}).getByRole('button',{name:'预览匹配',exact:true}).click();
    await page.getByRole('button',{name:'确认此匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor();
    await page.locator('.media-hero').scrollIntoViewIfNeeded();
    const denied=await fetch(baseUrl+'/api/v1/media/items/live-album/cover');assert.equal(denied.status,401);
    report.checks.push({operation:'album-cover-requires-authentication',status:denied.status});
    try{
      const cover=await fetch(baseUrl+'/api/v1/media/items/live-album/cover',{headers:{authorization:'Bearer '+session.accessToken},signal:AbortSignal.timeout(25000)});
      if(!cover.ok){const body=await cover.json();throw Error(`cover HTTP ${cover.status}: ${body.error?.code||'unknown'} — ${body.error?.message||''}`);}
      assert.equal(cover.status,200);assert.match(cover.headers.get('content-type'),/^image\//);assert.equal(cover.headers.get('cache-control'),'private, no-store');
      const bytes=(await cover.arrayBuffer()).byteLength;assert.ok(bytes>100);
      // A prior browser request may have failed while the server's later request succeeded.
      const retry=page.getByRole('button',{name:'重试封面',exact:true});
      if(await retry.isVisible())await retry.click();
      await page.waitForFunction(()=>{const img=document.querySelector('.media-hero .media-cover img');return img?.complete&&img.naturalWidth>0;},undefined,{timeout:25000});
      const dimensions=await page.locator('.media-hero .media-cover img').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
      report.checks.push({operation:'live-album-cover',id:album.externalId,...dimensions,bytes});
    }catch(error){
      report.failedChecks.push({operation:'live-album-cover',id:album.externalId,error:String(error)});
    }
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor({state:'detached'});
    await page.locator('.media-hero .media-cover img').waitFor({state:'detached'});
    const removedCover=await fetch(baseUrl+'/api/v1/media/items/live-album/cover',{headers:{authorization:'Bearer '+session.accessToken}});assert.equal(removedCover.status,404);
    const removedAlbum=await get('items/live-album');assert.equal(removedAlbum.metadata.onlineMatch,undefined);assert.equal(removedAlbum.metadata.musicBrainzCoverGroupId,undefined);
    report.checks.push({operation:'remove-album-match-removes-cover',status:removedCover.status});
    assert.deepEqual(report.browserErrors,[]);report.passed=report.failedChecks.length===0;
    if(!report.passed)process.exitCode=1;
  }catch(error){report.error=String(error);process.exitCode=1;}
  finally{
    await browser?.close();server.stdin.end('close\n');await exited;
    report.finishedAt=new Date().toISOString();
    if(process.env.MEDIA_LIVE_REVIEW_REPORT)await writeFile(process.env.MEDIA_LIVE_REVIEW_REPORT,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
