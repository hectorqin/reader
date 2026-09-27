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
    let failInitialBrowse=true;
    await page.route('**/api/v1/media/libraries/review-lib/items?*',async route=>{
      if(failInitialBrowse){failInitialBrowse=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'作品首次读取失败'}})});}
      else await route.continue();
    });
    await page.goto(baseUrl+'/#/media/video');
    await page.locator('#login-username').fill('reviewer');await page.locator('#login-password').fill('review-test-pass');await page.locator('form button[type=submit]').click();
    await page.getByRole('alert').filter({hasText:'作品首次读取失败'}).waitFor();
    assert.equal(await page.locator('.media-empty').count(),0,'browse failure must not claim empty media');
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
    await page.locator('.media-actions summary').click();await page.getByRole('button',{name:'媒体库管理',exact:true}).click();
    await page.getByRole('button',{name:'扫描与刮削',exact:true}).click();
    await page.getByText('新建批量匹配',{exact:true}).click();
    await page.locator('section[aria-label="批量刮削管理"] label').filter({hasText:'人工保留标题'}).locator('input[type=checkbox]').check();
    await page.getByRole('alert').filter({hasText:'任务状态读取失败'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'开始批量匹配',exact:true}).isDisabled(),true);
    assert.equal(await page.getByText('暂无批量刮削任务。',{exact:true}).count(),0);
    await page.getByRole('button',{name:'重新读取任务',exact:true}).click();
    await page.getByText('暂无批量刮削任务。',{exact:true}).waitFor();
    assert.equal(await page.locator('section[aria-label="批量刮削管理"] input:checked').count(),1);
    assert.equal(taskWrites,0,'read recovery must not create tasks');
    await page.getByRole('button',{name:'开始批量匹配',exact:true}).click();
    await page.getByLabel(/tmdb · 处理结束 · 已结束 1\/1 项/).waitFor();
    assert.equal(await page.locator('.media-task-create').evaluate(details=>details.open),false);
    const jobs=await get('scrape-jobs');assert.equal(jobs.items[0].items[0].state,'review');
    const summary=await get('scrape-jobs?summary=true');assert.deepEqual(summary.items[0].items,[]);assert.equal(summary.items[0].counts.review,1);
    assert.equal(resultReads,0,'collapsed jobs never fetch result pages');
    await page.getByLabel(/tmdb · 处理结束 · 已结束 1\/1 项/).click();
    await page.getByRole('alert').filter({hasText:'任务结果读取失败'}).waitFor();
    assert.equal(await page.getByText('当前没有此状态的结果。',{exact:true}).count(),0);
    await page.getByRole('button',{name:'重新读取结果',exact:true}).click();
    await page.getByRole('button',{name:'查看作品',exact:true}).waitFor();
    assert.equal(taskWrites,1,'result read recovery does not create another task');
    await page.getByRole('combobox',{name:'结果状态',exact:true}).selectOption('failed');
    await page.getByText('当前没有此状态的结果。',{exact:true}).waitFor();
    await page.getByRole('combobox',{name:'结果状态',exact:true}).selectOption('review');
    await page.getByRole('button',{name:'查看作品',exact:true}).waitFor();
    assert.equal(await page.locator('section[aria-label="任务结果"] .media-row').count(),1);
    if(process.env.MEDIA_REVIEW_VISUAL_DIR){
      for(const width of [360,390,1366])for(const theme of ['light','dark']){
        await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
        await page.getByRole('combobox',{name:'结果状态',exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:join(process.env.MEDIA_REVIEW_VISUAL_DIR,`task-results-${width}-${theme}.png`)});
        const overflow=await page.locator('.media-screen').evaluate(screen=>({overflow:screen.scrollWidth>screen.clientWidth+1,elements:[...screen.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>screen.getBoundingClientRect().right+1).slice(0,8).map(node=>({tag:node.tagName,class:node.className,text:node.textContent?.slice(0,80)}))}));
        assert.equal(overflow.overflow,false,JSON.stringify({width,theme,...overflow}));
      }
      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
    }
    await page.getByRole('button',{name:'查看作品',exact:true}).click();
    await page.getByRole('button',{name:'在线匹配元数据',exact:true}).click();
    await page.getByText('在线匹配元数据 · 2 个候选待核对',{exact:true}).waitFor();
    let failSavedRead=true;
    await page.route('**/api/v1/media/items/review-film/matches',async route=>{
      if(failSavedRead&&route.request().method()==='GET'){failSavedRead=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'test connection failure'}})});}
      else await route.continue();
    });
    await page.reload();
    await page.getByRole('button',{name:'在线匹配元数据',exact:true}).click();
    await page.getByRole('button',{name:'重试读取来源与候选',exact:true}).click();
    await page.getByText('在线匹配元数据 · 2 个候选待核对',{exact:true}).waitFor();
    const before=await get('items/review-film/matches');assert.equal(before.items.length,2);
    await page.getByRole('button',{name:'预览匹配',exact:true}).first().click();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal((await get('items/review-film')).metadata.onlineMatch,undefined);
    await page.getByRole('button',{name:'预览匹配',exact:true}).first().click();
    if(process.env.MEDIA_REVIEW_VISUAL_DIR){
      const directory=process.env.MEDIA_REVIEW_VISUAL_DIR;await mkdir(directory,{recursive:true});
      await page.getByRole('region',{name:'确认元数据匹配'}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(directory,'candidate-confirm-mobile.png')});
    }
    await page.getByRole('button',{name:'确认此匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor();
    const detail=await get('items/review-film');
    assert.equal(detail.title,'人工保留标题');assert.equal(detail.metadata.onlineMatch.externalId,'42');
    assert.equal((await get('items/review-film/matches')).items.length,0);
    await page.reload();await page.getByText('在线匹配元数据',{exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).click();
    await page.getByRole('button',{name:'移除在线匹配',exact:true}).waitFor({state:'detached'});
    const cleared=await get('items/review-film');assert.equal(cleared.metadata.onlineMatch,undefined);assert.equal(cleared.title,'人工保留标题');
    await page.evaluate(()=>{location.hash='#/media/video/long-film';});
    await page.locator('.media-hero h1').filter({hasText:'LongUnbrokenMovieTitle'}).waitFor();
    const longContent=[];
    for(const width of [360,390,1366])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      const overflow=await page.locator('.media-screen').evaluate(screen=>screen.scrollWidth>screen.clientWidth+1);
      if(process.env.MEDIA_REVIEW_VISUAL_DIR)await page.screenshot({path:join(process.env.MEDIA_REVIEW_VISUAL_DIR,`long-detail-${width}-${theme}.png`)});
      longContent.push({width,theme,overflow});assert.equal(overflow,false,`long detail overflow: ${width} ${theme}`);
    }
    let failInitialFavorites=true;
    await page.route('**/api/v1/media/favorites?*',async route=>{
      if(failInitialFavorites){failInitialFavorites=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'收藏首次读取失败'}})});}
      else await route.continue();
    });
    await page.locator('.media-actions summary').click();await page.getByRole('navigation',{name:'影音操作'}).getByRole('button',{name:'收藏',exact:true}).click();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'收藏首次读取失败'}).waitFor();
    assert.equal(await page.getByText('还没有收藏，打开作品详情即可收藏。',{exact:true}).count(),0,'failed fetch must not claim an empty collection');
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===60);
    const firstFavorites=await page.locator('.media-grid .media-tile strong').allTextContents();
    let failFavoritePage=true;
    await page.route('**/api/v1/media/favorites?*',async route=>{
      if(failFavoritePage&&new URL(route.request().url()).searchParams.get('offset')==='60'){
        failFavoritePage=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'收藏分页测试失败'}})});
      }else await route.continue();
    });
    await page.getByRole('navigation',{name:'收藏分页'}).getByRole('button',{name:'下一页',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'收藏分页测试失败'}).waitFor();
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    const nextFavorites=await page.locator('.media-grid .media-tile strong').allTextContents();
    assert.equal(new Set([...firstFavorites,...nextFavorites]).size,65);
    await page.locator('.media-grid .media-tile').first().click();
    await page.locator('.media-hero h1').filter({hasText:'收藏电影'}).waitFor();
    await page.getByRole('button',{name:'← 返回',exact:true}).click();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    assert.deepEqual(await page.locator('.media-grid .media-tile strong').allTextContents(),nextFavorites);
    assert.equal(await page.getByRole('navigation',{name:'收藏分页'}).getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);
    await page.getByRole('navigation',{name:'收藏分页'}).getByRole('button',{name:'上一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===60);
    assert.deepEqual(await page.locator('.media-grid .media-tile strong').allTextContents(),firstFavorites);
    let failInitialHistory=true;
    await page.route('**/api/v1/media/history?*',async route=>{
      if(failInitialHistory){failInitialHistory=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'历史首次读取失败'}})});}
      else await route.continue();
    });
    await page.locator('.media-actions summary').click();await page.getByRole('navigation',{name:'影音操作'}).getByRole('button',{name:'历史',exact:true}).click();
    await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'历史首次读取失败'}).waitFor();
    assert.equal(await page.getByText('暂无记录。',{exact:true}).count(),0,'failed fetch must not claim empty history');
    assert.equal(await page.locator('.media-grid .media-tile').count(),0,'failed history must not retain favorites');
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-screen>.media-row').length===60);
    const firstHistory=await page.locator('.media-screen>.media-row>button:first-child').allTextContents();
    assert.ok(firstHistory.every(text=>text.includes('资源不可用')),'unavailable history explains disabled playback');
    assert.equal(await page.getByRole('button',{name:'播放',exact:true}).first().isDisabled(),true);
    await page.getByRole('navigation',{name:'历史分页'}).getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-screen>.media-row').length===5);
    const nextHistory=await page.locator('.media-screen>.media-row>button:first-child').allTextContents();
    assert.equal(new Set([...firstHistory,...nextHistory]).size,65);
    await page.getByRole('navigation',{name:'历史分页'}).getByRole('button',{name:'上一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-screen>.media-row').length===60);
    assert.deepEqual(await page.locator('.media-screen>.media-row>button:first-child').allTextContents(),firstHistory);
    await page.setViewportSize({width:390,height:844});
    await page.locator('.media-screen>.media-row>button:first-child').nth(12).scrollIntoViewIfNeeded();
    const returnScroll=await page.evaluate(()=>({screen:document.querySelector('.media-screen').scrollTop,window:scrollY}));
    await page.locator('.media-screen>.media-row>button:first-child').nth(12).click();
    await page.locator('.media-hero h1').filter({hasText:'收藏电影'}).waitFor();
    await page.getByText('文件与技术信息',{exact:true}).click();
    await page.locator('.media-resource-info summary').click();
    await page.getByText(/文件缺失 ·/).waitFor();
    assert.equal(await page.getByRole('button',{name:'资源缺失',exact:true}).isDisabled(),true);
    await page.goBack();
    await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();
    assert.deepEqual(await page.locator('.media-screen>.media-row>button:first-child').allTextContents(),firstHistory);
    const restoredScroll=await page.evaluate(()=>({screen:document.querySelector('.media-screen').scrollTop,window:scrollY}));
    assert.ok(Math.abs(restoredScroll.screen-returnScroll.screen)<2&&Math.abs(restoredScroll.window-returnScroll.window)<2,'history return restores scroll');
    // Shrink the final favorites page while its detail is open, as another device could do.
    await page.locator('.media-actions summary').click();await page.getByRole('navigation',{name:'影音操作'}).getByRole('button',{name:'收藏',exact:true}).click();
    await page.getByRole('navigation',{name:'收藏分页'}).getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===5);
    await page.locator('.media-grid .media-tile').first().click();
    await page.locator('.media-hero h1').filter({hasText:'收藏电影'}).waitFor();
    for(let n=61;n<=65;n++){
      const response=await fetch(baseUrl+'/api/v1/media/items/favorite-'+String(n).padStart(3,'0')+'/favorite',{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({favorite:false})});assert.equal(response.status,200);
    }
    await page.getByRole('button',{name:'← 返回',exact:true}).click();
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===60);
    assert.equal(await page.getByRole('navigation',{name:'收藏分页'}).count(),0,'single-page collection hides pagination');
    await page.evaluate(()=>{location.hash='#/media/music';});
    await page.getByRole('button',{name:'曲目',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===60);
    const selectedLibraryResponse=page.waitForResponse(response=>response.url().includes('/libraries/track-lib/items?')&&response.status()===200);
    await page.getByLabel('媒体库',{exact:true}).selectOption('track-lib');
    await selectedLibraryResponse;
    await page.waitForFunction(()=>document.querySelector('.media-track-copy strong')?.textContent==='曲目001');
    async function setTrackFilters(open){const panel=page.locator('.media-track-filters');if(await panel.evaluate(panel=>panel.open)!==open)await panel.locator('summary').click();}
    async function openTrackDetail(index=0){await setTrackFilters(false);await page.locator('.media-track-detail').nth(index).click();}
    const firstTracks=await page.locator('.media-track-copy strong').allTextContents();
    const trackLayouts=[];
    for(const width of [360,390,1366])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:844});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;scrollTo(0,0);},theme);
      const layout=await page.locator('.media-track-list').evaluate(list=>({overflow:list.scrollWidth>list.clientWidth+1,rows:list.children.length,longRow:list.children[2].getBoundingClientRect().height,shortRow:list.children[0].getBoundingClientRect().height}));
      assert.equal(layout.overflow,false);assert.ok(layout.shortRow<90);assert.ok(layout.longRow>layout.shortRow,'long metadata wraps without truncating titles');
      trackLayouts.push({width,theme,...layout});
      if(process.env.MEDIA_REVIEW_VISUAL_DIR)await page.screenshot({path:join(process.env.MEDIA_REVIEW_VISUAL_DIR,`tracks-long-${width}-${theme}.png`)});
    }
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===5);
    const secondTracks=await page.locator('.media-track-copy strong').allTextContents();
    assert.equal(new Set([...firstTracks,...secondTracks]).size,65);
    await setTrackFilters(true);
    await page.getByLabel('艺人包含',{exact:true}).fill('UnbrokenArtist');
    await page.getByLabel('专辑包含',{exact:true}).fill('独立');
    await page.getByRole('button',{name:'应用筛选',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===1);
    assert.ok((await page.locator('.media-track-copy strong').textContent()).startsWith('UnbrokenTrackTitle'),'filters reset pagination to the first page');
    await openTrackDetail();
    await page.locator('.media-hero h1').filter({hasText:'UnbrokenTrackTitle'}).waitFor();

    await page.getByRole('button',{name:'← 返回',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===1);
    assert.equal(await page.getByLabel('媒体库',{exact:true}).inputValue(),'track-lib');
    assert.equal(await page.getByLabel('艺人包含',{exact:true}).inputValue(),'UnbrokenArtist');
    assert.equal(await page.getByLabel('专辑包含',{exact:true}).inputValue(),'独立');
    assert.equal(await page.locator('.media-track-filters').evaluate(panel=>panel.open),false);await setTrackFilters(true);
    const filteredAggregate=page.waitForResponse(response=>response.url().includes('/media/browse?')&&new URL(response.url()).searchParams.get('album')==='独立');
    await page.getByLabel('媒体库',{exact:true}).selectOption('');await filteredAggregate;
    assert.equal(await page.locator('.media-track-entry').count(),1);
    await page.getByRole('button',{name:'清除筛选',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===60);
    assert.equal(await page.getByLabel('艺人包含',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('专辑包含',{exact:true}).inputValue(),'');
    await page.getByLabel('媒体库',{exact:true}).selectOption('track-lib');
    await setTrackFilters(true);
    await page.waitForFunction(()=>document.querySelector('.media-track-copy strong')?.textContent==='曲目001');
    assert.deepEqual(await page.locator('.media-track-copy strong').allTextContents(),firstTracks);
    await setTrackFilters(true);await page.getByLabel('曲目排序',{exact:true}).selectOption('title-desc');
    await page.waitForFunction(()=>document.querySelector('.media-track-copy strong')?.textContent==='曲目065');
    let failTrackPage=true;
    await page.route('**/api/v1/media/libraries/track-lib/items?*',async route=>{
      if(failTrackPage&&new URL(route.request().url()).searchParams.get('offset')==='60'){
        failTrackPage=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'曲目分页读取失败'}})});
      }else await route.continue();
    });
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'曲目分页读取失败'}).waitFor();
    await page.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===5);
    assert.equal(await page.getByLabel('媒体库',{exact:true}).inputValue(),'track-lib','retry preserves selected library');
    assert.equal(await page.getByLabel('曲目排序',{exact:true}).inputValue(),'title-desc','retry preserves sorting');
    const beforeDetail=await page.locator('.media-track-copy strong').allTextContents();
    await openTrackDetail();
    await page.locator('.media-hero h1').waitFor();
    await page.goBack();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===5);
    assert.deepEqual(await page.locator('.media-track-copy strong').allTextContents(),beforeDetail);
    assert.equal(await page.getByLabel('曲目排序',{exact:true}).inputValue(),'title-desc');
    await openTrackDetail();
    await page.locator('.media-hero h1').waitFor();
    const shrinkOffsets=[];
    const shrinkTracks=async route=>{
      const response=await route.fetch(),body=await response.json();
      const offset=Number(new URL(route.request().url()).searchParams.get('offset'));
      shrinkOffsets.push(offset);await route.fulfill({response,json:{...body,total:60,items:offset>=60?[]:body.items}});
    };
    await page.route('**/api/v1/media/libraries/track-lib/items?*',shrinkTracks);
    await page.getByRole('button',{name:'← 返回',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===60);
    assert.deepEqual(shrinkOffsets,[60,0]);
    assert.equal(await page.getByLabel('曲目排序',{exact:true}).inputValue(),'title-desc');
    await page.unroute('**/api/v1/media/libraries/track-lib/items?*',shrinkTracks);
    await setTrackFilters(true);await page.getByLabel('曲目排序',{exact:true}).selectOption('title-asc');
    await page.waitForFunction(()=>document.querySelectorAll('.media-track-entry').length===60&&document.querySelector('.media-track-copy strong')?.textContent?.startsWith('UnbrokenTrackTitle'));
    await setTrackFilters(true);await page.getByLabel('曲目排序',{exact:true}).selectOption('default');
    await page.waitForFunction(()=>document.querySelector('.media-track-copy strong')?.textContent==='曲目001');
    await openTrackDetail(2);
    await page.locator('.media-hero h1').filter({hasText:'UnbrokenTrackTitle'}).waitFor();
    await page.evaluate(()=>{location.hash='#/media/music';});
    await page.getByRole('button',{name:'搜索影音',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索影音'}).fill('曲目');
    await page.locator('.media-search button').click();
    await page.waitForFunction(()=>document.querySelectorAll('[aria-label="影音搜索结果"] .media-search-result').length===60);
    await page.locator('[aria-label="影音搜索结果"] .media-search-result').nth(25).scrollIntoViewIfNeeded();
    const searchScroll=await page.locator('.media-screen').evaluate(element=>element.scrollTop);
    assert.ok(searchScroll>100,'search fixture has a real scroll position');
    await page.locator('[aria-label="影音搜索结果"] .media-search-result').nth(25).click();
    await page.locator('.media-hero h1').waitFor();
    await page.getByRole('button',{name:'← 返回',exact:true}).click();
    await page.waitForFunction(expected=>Math.abs(document.querySelector('.media-screen').scrollTop-expected)<3,searchScroll);
    assert.equal(await page.getByRole('textbox',{name:'搜索影音'}).inputValue(),'曲目');
    await page.locator('[aria-label="影音搜索结果"] .media-search-result').nth(25).click();
    await page.locator('.media-hero h1').waitFor();
    await page.goBack();
    await page.getByRole('textbox',{name:'搜索影音'}).waitFor();
    await page.waitForFunction(expected=>Math.abs(document.querySelector('.media-screen').scrollTop-expected)<3,searchScroll);
    await page.goForward();
    await page.locator('.media-hero h1').waitFor();
    await page.getByRole('button',{name:'← 返回',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索影音'}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'搜索影音'}).inputValue(),'曲目');
    await page.waitForFunction(expected=>Math.abs(document.querySelector('.media-screen').scrollTop-expected)<3,searchScroll);
    assert.deepEqual(errors,[]);
    const result={passed:true,batchReview:true,lazyTaskResults:true,resultReadFailureAndRetry:true,reloadCandidates:true,savedReadFailureAndRetry:true,cancelWithoutMutation:true,confirmedMatch:true,manualTitlePreserved:true,clearMatchPreservesOverrides:true,longContent,trackLayouts,trackPagination:true,browserErrors:errors,externalProvider:'synthetic fixture; not a live TMDB check'};
    if(process.env.MEDIA_REVIEW_VISUAL_DIR)await writeFile(join(process.env.MEDIA_REVIEW_VISUAL_DIR,'verification.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  }finally{await browser?.close();server.stdin.end('close\n');await exited;}
})().catch(error=>{console.error(error);process.exitCode=1;});
