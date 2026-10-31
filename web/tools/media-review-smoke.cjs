// Actual web UI + HTTP/database. Synthetic metadata responses do not prove upstream quality.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdir,writeFile}=require('node:fs/promises');
const {once}=require('node:events');
const assert=require('node:assert/strict');
(async()=>{
  const repo=resolve(__dirname,'../..');
  const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const exited=once(server,'exit');let browser,stderr='';server.stderr.on('data',data=>stderr+=data);
  try{
    if(process.env.MEDIA_REVIEW_VISUAL_DIR){await mkdir(process.env.MEDIA_REVIEW_VISUAL_DIR,{recursive:true});await writeFile(join(process.env.MEDIA_REVIEW_VISUAL_DIR,'verification.json'),JSON.stringify({passed:false,state:'running'}));}
    const {baseUrl}=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timed out: '+stderr)),30000);
      server.once('error',error=>{clearTimeout(timer);reject(error);});
      server.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited: '+stderr));});
      server.stdout.on('data',data=>{output+=data;for(const line of output.split('\n')){try{const value=JSON.parse(line);if(value.baseUrl){clearTimeout(timer);resolve(value);}}catch{}}});
    });
    browser=await chromium.launch({headless:true,...(process.env.PROTOTYPE_CHROMIUM?{executablePath:process.env.PROTOTYPE_CHROMIUM}:{})});
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const login=await fetch(baseUrl+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'reviewer',password:'review-test-pass'})});
    assert.equal(login.status,200);const session=await login.json();
    const headers={authorization:'Bearer '+session.accessToken};
    const get=async path=>{const response=await fetch(baseUrl+'/api/v1/media/'+path,{headers});assert.equal(response.status,200);return response.json();};
    // MediaSelect keeps a native <select> (visually hidden) as the form control behind its themed trigger.
    // Checks that describe real behaviour the current app fails are collected and
    // reported together at the end, so one regression does not hide the rest.
    const regressions=[];
    const soft=async(promise,message)=>{try{await promise;}catch(error){regressions.push(message+': '+error.message.split('\n')[0]);}};
    const select=label=>page.locator(`select.media-select-native[aria-label="${label}"]`);
    // Fail every catalog read until the error has been seen: the catalog may read all
    // libraries first and the single library once the library list has arrived.
    let failBrowse=true;
    await page.route(/\/api\/v1\/media\/(?:browse|libraries\/review-lib\/items)\?/,async route=>{
      if(failBrowse)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'作品首次读取失败'}})});
      else await route.continue();
    });
    await page.goto(baseUrl+'/#/media/video/movies');
    await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
    await page.getByRole('alert').filter({hasText:'作品首次读取失败'}).waitFor();
    assert.equal(await page.locator('.media-library-empty,.media-empty').count(),0,'browse failure must not claim empty media');
    failBrowse=false;
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.locator('.media-grid .media-tile').first().waitFor();
    let failTaskRead=true,taskWrites=0,resultReads=0,failResultRead=true;
    await page.route('**/api/v1/media/scrape-jobs/*/results?*',async route=>{
      resultReads++;
      if(failResultRead){failResultRead=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'result read failure'}})});}
      else await route.continue();
    });
    await page.route(/\/api\/v1\/media\/scrape-jobs(?:\?[^/]*)?$/,async route=>{
      if(route.request().method()==='POST')taskWrites++;
      if(failTaskRead&&route.request().method()==='GET'){
        failTaskRead=false;
        await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'task read failure'}})});
      }else await route.continue();
    });
    // 媒体库管理 → 扫描与刮削 → 刮削.
    await page.evaluate(()=>{location.hash='#/media/video/settings/libraries';});
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    await page.getByRole('button',{name:'扫描与刮削',exact:true}).click();
    await page.getByRole('heading',{name:'扫描与刮削',exact:true}).waitFor();
    await page.getByRole('navigation',{name:'任务类型',exact:true}).getByRole('button',{name:'刮削',exact:true}).click();
    const scrape=page.locator('section[aria-label="批量刮削管理"]');
    // Providers and the item page load independently; choose once both have settled.
    await page.waitForFunction(()=>document.querySelector('select.media-select-native[aria-label="刮削来源"]')?.value==='tmdb');
    await scrape.locator('.media-scrape-item-list label').filter({hasText:'人工保留标题'}).waitFor();
    await scrape.locator('label').filter({hasText:'人工保留标题'}).locator('input[type=checkbox]').check();
    await page.getByRole('alert').filter({hasText:'任务状态读取失败'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'开始批量匹配',exact:true}).isDisabled(),true);
    assert.equal(await page.getByText('暂无批量刮削任务。',{exact:true}).count(),0);
    await page.getByRole('button',{name:'重新读取任务',exact:true}).click();
    await page.getByText('暂无批量刮削任务。',{exact:true}).waitFor();
    assert.equal(await scrape.locator('.media-scrape-item-list input:checked').count(),1);
    assert.equal(taskWrites,0,'read recovery must not create tasks');
    await page.getByRole('button',{name:'开始批量匹配',exact:true}).click();
    const finishedJob=page.locator('summary[aria-label^="tmdb · 处理结束 · 已结束 1/1 项"]');
    await finishedJob.waitFor();
    assert.equal(await page.locator('.media-task-create').evaluate(details=>details.open),false);
    const jobs=await get('scrape-jobs');assert.equal(jobs.items[0].items[0].state,'review');
    const summary=await get('scrape-jobs?summary=true');assert.deepEqual(summary.items[0].items,[]);assert.equal(summary.items[0].counts.review,1);
    assert.equal(resultReads,0,'collapsed jobs never fetch result pages');
    await finishedJob.click();
    await page.getByRole('alert').filter({hasText:'任务结果读取失败'}).waitFor();
    assert.equal(await page.getByText('当前没有此状态的结果。',{exact:true}).count(),0);
    await page.getByRole('button',{name:'重新读取结果',exact:true}).click();
    await page.getByRole('button',{name:'查看作品',exact:true}).waitFor();
    assert.equal(taskWrites,1,'result read recovery does not create another task');
    await select('结果状态').selectOption('failed');
    await page.getByText('当前没有此状态的结果。',{exact:true}).waitFor();
    await select('结果状态').selectOption('review');
    await page.getByRole('button',{name:'查看作品',exact:true}).waitFor();
    assert.equal(await page.locator('section[aria-label="任务结果"] .media-row').count(),1);
    if(process.env.MEDIA_REVIEW_VISUAL_DIR){
      for(const width of [360,390,1366])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.mode=theme;},theme);
        await page.getByRole('combobox',{name:'结果状态',exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:join(process.env.MEDIA_REVIEW_VISUAL_DIR,`task-results-${width}-${theme}.png`)});
        const overflow=await page.locator('.media-screen').evaluate(screen=>({overflow:screen.scrollWidth>screen.clientWidth+1,elements:[...screen.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>screen.getBoundingClientRect().right+1).slice(0,8).map(node=>({tag:node.tagName,class:node.className,text:node.textContent?.slice(0,80)}))}));
        assert.equal(overflow.overflow,false,JSON.stringify({width,theme,...overflow}));
      }
      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.mode='light';});
    }
    await page.getByRole('button',{name:'查看作品',exact:true}).click();
    await page.locator('.media-hero h1').filter({hasText:'人工保留标题'}).waitFor();
    // Online matching is its own page, reached from the detail's ⋯ menu.
    await page.getByRole('button',{name:'作品操作',exact:true}).click();
    await page.getByRole('menuitem',{name:'匹配元数据',exact:true}).click();
    await page.getByText('在线匹配元数据 · 2 个候选待核对',{exact:true}).waitFor();
    let failSavedRead=true;
    await page.route('**/api/v1/media/items/review-film/matches',async route=>{
      if(failSavedRead&&route.request().method()==='GET'){failSavedRead=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'test connection failure'}})});}
      else await route.continue();
    });
    await page.reload();
    await page.getByRole('button',{name:'重试读取来源与候选',exact:true}).click();
    await page.getByText('在线匹配元数据 · 2 个候选待核对',{exact:true}).waitFor();
    const before=await get('items/review-film/matches');assert.equal(before.items.length,2);
    const confirmSheet=page.getByRole('alertdialog',{name:'确认元数据匹配'});
    await page.getByRole('button',{name:/^选择：/}).first().click();
    await confirmSheet.waitFor();
    await confirmSheet.getByRole('button',{name:'取消',exact:true}).click();
    await confirmSheet.waitFor({state:'detached'});
    assert.equal((await get('items/review-film')).metadata.onlineMatch,undefined);
    await page.getByRole('button',{name:/^选择：/}).first().click();
    if(process.env.MEDIA_REVIEW_VISUAL_DIR){
      const directory=process.env.MEDIA_REVIEW_VISUAL_DIR;await mkdir(directory,{recursive:true});
      await page.screenshot({path:join(directory,'candidate-confirm-mobile.png')});
    }
    await confirmSheet.getByRole('button',{name:'确认此匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor();
    const detail=await get('items/review-film');
    assert.equal(detail.title,'人工保留标题');assert.equal(detail.metadata.onlineMatch.externalId,'42');
    assert.equal((await get('items/review-film/matches')).items.length,0);
    await page.reload();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).click();
    await page.getByRole('alertdialog',{name:'移除在线匹配'}).getByRole('button',{name:'移除匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor({state:'detached'});
    const cleared=await get('items/review-film');assert.equal(cleared.metadata.onlineMatch,undefined);assert.equal(cleared.title,'人工保留标题');
    await page.evaluate(()=>{location.hash='#/media/video/items/long-film';});
    await page.locator('.media-hero h1').filter({hasText:'LongUnbrokenMovieTitle'}).waitFor();
    const longContent=[];
    for(const width of [360,390,1366])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.mode=theme;},theme);
      const overflow=await page.locator('.media-screen').evaluate(screen=>screen.scrollWidth>screen.clientWidth+1);
      if(process.env.MEDIA_REVIEW_VISUAL_DIR)await page.screenshot({path:join(process.env.MEDIA_REVIEW_VISUAL_DIR,`long-detail-${width}-${theme}.png`)});
      longContent.push({width,theme,overflow});assert.equal(overflow,false,`long detail overflow: ${width} ${theme}`);
    }
    await page.setViewportSize({width:390,height:844});
    const favoriteTitles=()=>page.locator('.media-favorite-row strong').allTextContents();
    const favoritePager=page.getByRole('navigation',{name:'收藏分页'});
    let failInitialFavorites=true;
    await page.route('**/api/v1/media/favorites?*',async route=>{
      if(failInitialFavorites){failInitialFavorites=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'收藏首次读取失败'}})});}
      else await route.continue();
    });
    await page.evaluate(()=>{location.hash='#/media/video';});
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await page.getByRole('menuitem',{name:'收藏',exact:true}).click();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'收藏首次读取失败'}).waitFor();
    assert.equal(await page.getByText('还没有收藏，打开作品详情即可收藏。',{exact:true}).count(),0,'failed fetch must not claim an empty collection');
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===60);
    const firstFavorites=await favoriteTitles();
    await favoritePager.getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===5);
    const nextFavorites=await favoriteTitles();
    assert.equal(new Set([...firstFavorites,...nextFavorites]).size,65);
    assert.match(page.url(),/offset=60/,'the favorites page lives in the URL');
    await page.locator('.media-favorite-row').first().click();
    await page.locator('.media-missing-edition h2').filter({hasText:'收藏电影'}).waitFor();
    await page.getByRole('link',{name:'返回上一页',exact:true}).click();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===5);
    assert.deepEqual(await favoriteTitles(),nextFavorites);
    assert.equal(await favoritePager.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);
    await favoritePager.getByRole('button',{name:'上一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===60);
    assert.deepEqual(await favoriteTitles(),firstFavorites);
    const historyRows=page.locator('.media-history-row');
    const historyTitles=()=>page.locator('.media-history-row .media-personal-title').allTextContents();
    const historyPager=page.getByRole('navigation',{name:'分页',exact:true});
    let failInitialHistory=true;
    await page.route('**/api/v1/media/history?*',async route=>{
      if(failInitialHistory){failInitialHistory=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'历史首次读取失败'}})});}
      else await route.continue();
    });
    await page.evaluate(()=>{location.hash='#/media/video';});
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await page.getByRole('menuitem',{name:'历史',exact:true}).click();
    await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'历史首次读取失败'}).waitFor();
    assert.equal(await page.getByText('暂无记录。',{exact:true}).count(),0,'failed fetch must not claim empty history');
    assert.equal(await page.locator('.media-favorite-row').count(),0,'failed history must not retain favorites');
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-history-row').length===60);
    const firstHistory=await historyTitles();
    const unavailable=await historyRows.evaluateAll(rows=>rows.filter(row=>row.textContent.includes('资源不可用')).length);
    assert.ok(unavailable>=59,'unavailable history explains disabled playback');
    assert.equal(await page.locator('.media-history-row').filter({hasText:'资源不可用'}).first().getByRole('button',{name:'播放',exact:true}).isDisabled(),true);
    await historyPager.getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-history-row').length>0&&document.querySelectorAll('.media-history-row').length<60);
    const nextHistory=await historyTitles();
    assert.equal(new Set([...firstHistory,...nextHistory]).size,firstHistory.length+nextHistory.length,'history pages do not repeat rows');
    await historyPager.getByRole('button',{name:'上一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-history-row').length===60);
    assert.deepEqual(await historyTitles(),firstHistory);
    const unavailableRow=historyRows.filter({hasText:'资源不可用'}).nth(12);
    await unavailableRow.scrollIntoViewIfNeeded();
    const returnScroll=await page.evaluate(()=>({screen:document.querySelector('.media-screen').scrollTop,window:scrollY}));
    assert.ok(returnScroll.screen+returnScroll.window>100,'history fixture has a real scroll position');
    const unavailableTitle=await unavailableRow.locator('.media-personal-title').textContent();
    await unavailableRow.locator('.media-personal-title').click();
    // A detail whose only version has no file says so instead of offering playback.
    await page.locator('.media-missing-edition h2').filter({hasText:unavailableTitle+' · 文件暂不可用'}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^(播放电影|播放此版本)$/}).count(),0,'missing files offer no playback');
    await page.goBack();
    await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.media-history-row').length===60);
    assert.deepEqual(await historyTitles(),firstHistory);
    await soft(page.waitForFunction(expected=>{const now={screen:document.querySelector('.media-screen').scrollTop,window:scrollY};return Math.abs(now.screen-expected.screen)<2&&Math.abs(now.window-expected.window)<2;},returnScroll,{timeout:5000}).catch(async()=>{throw Error(JSON.stringify({expected:returnScroll,actual:await page.evaluate(()=>({screen:document.querySelector('.media-screen').scrollTop,window:scrollY}))}));}),'history return restores scroll');
    // Shrink the final favorites page while its detail is open, as another device could do.
    await page.evaluate(()=>{location.hash='#/media/favorites?offset=60';});
    await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===5);
    await page.locator('.media-favorite-row').first().click();
    await page.locator('.media-missing-edition h2').filter({hasText:'收藏电影'}).waitFor();
    for(let n=61;n<=65;n++){
      const response=await fetch(baseUrl+'/api/v1/media/items/favorite-'+String(n).padStart(3,'0')+'/favorite',{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({favorite:false})});assert.equal(response.status,200);
    }
    // Lists are cached for a minute, so read the page again as a fresh visit would.
    await page.getByRole('link',{name:'返回上一页',exact:true}).click();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await soft(page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===60,undefined,{timeout:5000}).catch(async()=>{throw Error(JSON.stringify({url:page.url(),rows:await page.locator('.media-favorite-row').count(),text:(await page.locator('.media-favorites').textContent())?.slice(0,120)}));}),'a favorites page emptied elsewhere falls back to the last page');
    await page.evaluate(()=>{location.hash='#/media/favorites';});
    await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===60);
    assert.equal(await favoritePager.count(),0,'single-page collection hides pagination');
    // Tracks: one grid, a library choice and a sort; the page and sort live in the URL.
    await page.evaluate(()=>{location.hash='#/media/music/tracks';});
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===60);
    const tileTitles=()=>page.locator('.media-grid .media-tile strong').allTextContents();
    const selectedLibraryResponse=page.waitForResponse(response=>response.url().includes('/libraries/track-lib/items?')&&response.status()===200);
    await select('来源库').selectOption('track-lib');
    await selectedLibraryResponse;
    await page.waitForFunction(()=>document.querySelector('.media-grid .media-tile strong')?.textContent==='曲目001');
    const firstTracks=await tileTitles();
    const trackLayouts=[];
    for(const width of [360,390,1366])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.mode=theme;scrollTo(0,0);},theme);
      const layout=await page.locator('.media-screen').evaluate(screen=>({overflow:screen.scrollWidth>screen.clientWidth+1,page:document.documentElement.scrollWidth>innerWidth+1,tiles:screen.querySelectorAll('.media-grid .media-tile').length}));
      assert.equal(layout.overflow,false);assert.equal(layout.page,false,'long track metadata does not widen the page');
      trackLayouts.push({width,theme,...layout});
      if(process.env.MEDIA_REVIEW_VISUAL_DIR)await page.screenshot({path:join(process.env.MEDIA_REVIEW_VISUAL_DIR,`tracks-long-${width}-${theme}.png`)});
    }
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.mode='light';});
    const catalogPager=page.getByRole('navigation',{name:'分页',exact:true});
    await catalogPager.getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    const secondTracks=await tileTitles();
    assert.equal(new Set([...firstTracks,...secondTracks]).size,65);
    const setSort=async value=>{const filters=page.locator('.media-browse-filters');if(!await filters.evaluate(panel=>panel.open))await filters.locator('summary').click();await select('排序').selectOption(value);if(await filters.evaluate(panel=>panel.open))await filters.locator('summary').click();};
    await setSort('title-desc');
    await page.waitForFunction(()=>document.querySelector('.media-grid .media-tile strong')?.textContent==='曲目065');
    assert.equal(new URL(page.url()).hash.includes('offset='),false,'changing the sort returns to the first page');
    let failTrackPage=true;
    await page.route('**/api/v1/media/libraries/track-lib/items?*',async route=>{
      if(failTrackPage&&new URL(route.request().url()).searchParams.get('offset')==='60'){
        failTrackPage=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'曲目分页读取失败'}})});
      }else await route.continue();
    });
    await catalogPager.getByRole('button',{name:'下一页',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'曲目分页读取失败'}).waitFor();
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    assert.equal(await select('来源库').inputValue(),'track-lib','retry preserves selected library');
    assert.equal(await select('排序').inputValue(),'title-desc','retry preserves sorting');
    const beforeDetail=await tileTitles();
    await page.locator('.media-grid .media-tile').first().click();
    await page.locator('.media-hero h1').waitFor();
    await page.goBack();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    assert.deepEqual(await tileTitles(),beforeDetail);
    assert.equal(await select('排序').inputValue(),'title-desc');
    await page.locator('.media-grid .media-tile').first().click();
    await page.locator('.media-hero h1').waitFor();
    // The list shrank while the detail was open: going back to a page past the end shows the last page that exists.
    const shrinkOffsets=[];
    const shrinkTracks=async route=>{
      const response=await route.fetch(),body=await response.json();
      const offset=Number(new URL(route.request().url()).searchParams.get('offset'));
      shrinkOffsets.push(offset);await route.fulfill({response,json:{...body,total:60,items:offset>=60?[]:body.items}});
    };
    await page.route('**/api/v1/media/libraries/track-lib/items?*',shrinkTracks);
    await page.goBack();await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    await page.reload(); // the cached page is a minute fresh; a new visit reads it again
    await soft(page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===60,undefined,{timeout:5000}).catch(async()=>{throw Error(JSON.stringify({url:page.url(),shrinkOffsets,tiles:await page.locator('.media-grid .media-tile').count(),empty:await page.locator('.media-library-empty').count()}));}),'a catalog page emptied elsewhere falls back to the last page');
    assert.equal(await select('排序').inputValue(),'title-desc');
    await page.unroute('**/api/v1/media/libraries/track-lib/items?*',shrinkTracks);
    await setSort('title-asc');
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===60&&document.querySelector('.media-grid .media-tile strong')?.textContent?.startsWith('UnbrokenTrackTitle'));
    await setSort('default');
    await page.waitForFunction(()=>document.querySelector('.media-grid .media-tile strong')?.textContent==='曲目001');
    await page.locator('.media-grid .media-tile').nth(2).click();
    await page.locator('.media-hero h1').filter({hasText:'UnbrokenTrackTitle'}).waitFor();
    // Search keeps its query, results and scroll position across a detail and back.
    await page.evaluate(()=>{location.hash='#/media/search';});
    await page.getByRole('textbox',{name:'搜索影音'}).fill('曲目');
    await page.getByRole('search').getByRole('button',{name:'搜索',exact:true}).click();
    const results=page.locator('[aria-label="影音搜索结果"] .media-search-result');
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="影音搜索结果"] .media-search-result').length===60);
    await results.nth(25).scrollIntoViewIfNeeded();
    const searchScroll=await page.locator('.media-screen').evaluate(element=>element.scrollTop);
    assert.ok(searchScroll>100,'search fixture has a real scroll position');
    await results.nth(25).click();
    await page.locator('.media-hero h1').waitFor();
    // The detail's back arrow returns to the search it was opened from, like favorites and history do.
    const backLink=page.locator('.media-detail-shell .media-back-button');
    await soft((async()=>{
      const label=await backLink.getAttribute('aria-label');
      await backLink.click();
      await page.getByRole('textbox',{name:'搜索影音'}).waitFor({timeout:5000}).catch(()=>{throw Error(JSON.stringify({label,url:page.url()}));});
      assert.equal(await page.getByRole('textbox',{name:'搜索影音'}).inputValue(),'曲目');
      await page.waitForFunction(expected=>Math.abs(document.querySelector('.media-screen').scrollTop-expected)<3,searchScroll,{timeout:5000});
    })(),'search result detail back arrow returns to the search');
    if(!new URL(page.url()).hash.startsWith('#/media/search')){await page.goBack();await page.locator('.media-hero h1').waitFor();await page.goBack();await page.getByRole('textbox',{name:'搜索影音'}).waitFor();}
    const searchScrollNow=()=>page.locator('.media-screen').evaluate(element=>element.scrollTop);
    const expectSearchScroll=(expected,message)=>soft(page.waitForFunction(expected=>Math.abs(document.querySelector('.media-screen').scrollTop-expected)<3,expected,{timeout:5000}).catch(async()=>{throw Error(JSON.stringify({expected,actual:await searchScrollNow()}));}),message);
    await results.nth(25).scrollIntoViewIfNeeded();
    const historyScroll=await searchScrollNow();assert.ok(historyScroll>100);
    await results.nth(25).click();
    await page.locator('.media-hero h1').waitFor();
    await page.goBack();
    await page.getByRole('textbox',{name:'搜索影音'}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="影音搜索结果"] .media-search-result').length===60);
    await expectSearchScroll(historyScroll,'browser back to the search restores its scroll');
    await page.goForward();
    await page.locator('.media-hero h1').waitFor();
    await page.goBack();
    await page.getByRole('textbox',{name:'搜索影音'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'搜索影音'}).inputValue(),'曲目');
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="影音搜索结果"] .media-search-result').length===60);
    await expectSearchScroll(historyScroll,'back after forward restores the search scroll');
    assert.deepEqual(errors,[]);
    if(regressions.length)console.error(JSON.stringify({regressions},null,2));
    assert.deepEqual(regressions,[],'media review regressions');
    const result={passed:true,batchReview:true,lazyTaskResults:true,resultReadFailureAndRetry:true,reloadCandidates:true,savedReadFailureAndRetry:true,cancelWithoutMutation:true,confirmedMatch:true,manualTitlePreserved:true,clearMatchPreservesOverrides:true,longContent,trackLayouts,trackPagination:true,trackSort:true,searchReturn:true,browserErrors:errors,externalProvider:'synthetic fixture; not a live TMDB check'};
    if(process.env.MEDIA_REVIEW_VISUAL_DIR)await writeFile(join(process.env.MEDIA_REVIEW_VISUAL_DIR,'verification.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  }finally{await browser?.close();server.stdin.end('close\n');await exited;}
})().catch(error=>{console.error(error);process.exitCode=1;});
