// Real local HTTP + built web client + Chromium. No external media or user data.
const {chromium}=require('playwright');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {spawn,execFile}=require('node:child_process');
const runFile=require('node:util').promisify(execFile);
const {pathToFileURL}=require('node:url');
const {setTimeout:delay}=require('node:timers/promises');
const assert=require('node:assert/strict');

(async()=>{
  if(process.env.MEDIA_SMOKE_FFMPEG){
    assert.ok(process.env.MEDIA_FFPROBE_PATH,'media fixture mode requires an explicit ffprobe');
    process.env.MEDIA_FFMPEG_PATH=process.env.MEDIA_SMOKE_FFMPEG;
  }
  const repo=resolve(__dirname,'../..');
  const root=await mkdtemp(join(tmpdir(),'reader-media-browser-'));
  const books=join(root,'books'),music=join(root,'music');await mkdir(books);await mkdir(music);
  const samples=44100*30,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/44100)*500),44+i*2);
  await writeFile(join(music,'test-tone.wav'),wav);
  await writeFile(join(music,'test-tone.lrc'),'[00:00.00]测试歌词第一句\n[00:05.00]测试歌词第二句\n[00:10.00]\n[00:15.00]测试歌词第三句');
  await writeFile(join(music,'cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64'));
  // A free port unless one is given: other review scripts may run at the same time.
  const port=process.env.MEDIA_SMOKE_PORT||await new Promise((ok,no)=>{const probe=require('node:net').createServer();probe.once('error',no);probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>ok(String(port)));});});
  const origin='http://127.0.0.1:'+port;
  const serverArgs=process.env.MEDIA_SMOKE_BUILT==='1'?[resolve(repo,'server/dist/main.js')]:['--import',pathToFileURL(resolve(repo,'server/node_modules/tsx/dist/loader.mjs')).href,resolve(repo,'server/src/main.ts')];
  const server=spawn(process.execPath,serverArgs,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BOOKS_DIR:books,DATA_DIR:join(root,'data'),WEB_DIR:join(repo,'web/dist'),HOST:'127.0.0.1',PORT:port,SCAN_INTERVAL:'0',WATCH_INTERVAL:'0',LOG_LEVEL:'silent'}});
  let logs='';server.stderr.on('data',d=>logs+=d);server.stdout.on('data',d=>logs+=d);let browser;
  try{
    let live=false;for(let i=0;i<300;i++){try{if((await fetch(origin+'/api/v1/instance')).ok){live=true;break;}}catch{}if(server.exitCode!==null)throw Error(logs);await delay(100);}assert.ok(live,'server startup');
    const reg=await fetch(origin+'/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'media-test',password:'media-test-pass'})});assert.equal(reg.status,201);
    const auth=await reg.json(),headers={authorization:'Bearer '+auth.session.accessToken,'content-type':'application/json'};
    for(let attempt=0;;attempt++){
      const response=await fetch(origin+'/api/v1/media/libraries',{headers});
      if(response.ok)break;
      const body=await response.json();assert.equal(body.error?.code,'MEDIA_STARTING',JSON.stringify(body));
      assert.ok(attempt<300,'media startup timeout');await delay(100);
    }
    const create=await fetch(origin+'/api/v1/media/libraries',{method:'POST',headers,body:JSON.stringify({name:'浏览器音乐测试',kind:'music',root:music,access:'all'})});assert.equal(create.status,201);const lib=await create.json();
    const scanResponse=await fetch(origin+`/api/v1/media/libraries/${lib.id}/scan`,{method:'POST',headers,body:'{}'});assert.equal(scanResponse.status,202,await scanResponse.clone().text());const scan=await scanResponse.json();
    let job;for(let i=0;i<350;i++){job=await (await fetch(origin+'/api/v1/media/jobs/'+scan.id,{headers})).json();if(job.state!=='running')break;await delay(100);}assert.equal(job.state,'complete');
    browser=await chromium.launch({headless:true,...(process.env.PROTOTYPE_CHROMIUM?{executablePath:process.env.PROTOTYPE_CHROMIUM}:{})});
    const readingPage=await browser.newPage({viewport:{width:390,height:844}}),readingMediaRequests=[],readingErrors=[];
    readingPage.on('request',request=>{if(request.url().startsWith(origin+'/api/v1/media/'))readingMediaRequests.push(request.url());});
    readingPage.on('pageerror',error=>readingErrors.push(error.message));
    await readingPage.goto(origin+'/#/shelf');
    await readingPage.locator('input[autocomplete="username"]').fill('media-test');await readingPage.locator('input[type="password"]').fill('media-test-pass');
    await readingPage.locator('form button[type=submit]').click();await readingPage.locator('.shelf-screen').waitFor();
    await readingPage.evaluate(()=>window.readerApp.flush());
    assert.equal(await readingPage.locator('.media-channel-segments').count(),0);
    assert.equal(await readingPage.locator('.media-player').isVisible(),false);
    assert.equal(await readingPage.locator('.media-player audio,.media-player video').evaluateAll(elements=>elements.every(element=>!element.getAttribute('src')&&element.paused)),true);
    assert.deepEqual(readingMediaRequests,[],'fresh reading startup and persistence do not fetch media APIs');
    assert.deepEqual(readingErrors,[]);
    // One navigation: on a phone 首页/书架/影音/我的 are tab links; 影音 opens the video channel.
    const readingNav=readingPage.getByRole('navigation',{name:'主导航',exact:true});
    assert.deepEqual(await readingNav.locator('.app-nav-list > li > .app-nav-item .app-nav-label').allTextContents(),['首页','书架','影音','我的']);
    await readingNav.getByRole('link',{name:'影音',exact:true}).click();
    await readingPage.waitForFunction(()=>location.hash.startsWith('#/media/video'));
    assert.equal(await readingPage.locator('.media-channel-segments a[aria-current=page]').textContent(),'影视');
    assert.equal(await readingNav.getByRole('link',{name:'影音',exact:true}).getAttribute('aria-current'),'page');
    await readingNav.getByRole('link',{name:'书架',exact:true}).click();
    await readingPage.locator('.shelf-screen').waitFor();
    assert.equal(await readingPage.getByRole('button',{name:/书架设置/}).count(),1);
    await readingPage.close();
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function stopPlayback(){
      // On a player page the 更多播放选项 sheet ends playback; elsewhere the mini player's close button does.
      const open=page.locator('dialog[open] .sheet-close');if(await open.count())await open.last().click();
      const mini=page.locator('.media-mini-close');
      if(!new URL(page.url()).hash.includes('/player'))await mini.click();
      else{
        const more=page.locator('.media-video-tools').getByRole('button',{name:'更多播放选项',exact:true}).or(page.locator('.media-audio-heading').getByRole('button',{name:'更多播放选项',exact:true}));
        await more.first().click();
        await page.locator('dialog[open]').last().getByRole('button',{name:'结束播放',exact:true}).click();
      }
      await page.waitForFunction(()=>!window.readerApp.player.active);
    }
    const visualDir=process.env.MEDIA_VISUAL_DIR,visualChecks=[];
    if(visualDir){
      await mkdir(visualDir,{recursive:true});
      await writeFile(join(visualDir,'verification.json'),JSON.stringify({complete:false,checks:[],browserErrors:[]},null,2));
    }
    const auditPage=async(name,focus)=>{
      if(!visualDir)return;
      if(process.env.MEDIA_VISUAL_FILTER&&!new RegExp(process.env.MEDIA_VISUAL_FILTER).test(name))return;
      await mkdir(visualDir,{recursive:true});
      const viewport=page.viewportSize(),mode=await page.evaluate(()=>document.documentElement.dataset.mode??null);
      const playing=await page.locator('.media-player audio,.media-player video').evaluateAll(elements=>elements.filter(element=>!element.paused&&!element.ended).map(element=>{const source=element.currentSrc;element.pause();return {tag:element.tagName,source};}));
      try{
        for(const [device,width,height]of [['narrow',360,800],['mobile',390,844],['desktop',1366,900]])for(const scheme of ['light','dark']){
          await page.setViewportSize({width,height});
          // ThemeController writes the light/dark choice to data-mode on <html>.
          await page.evaluate(scheme=>{document.documentElement.dataset.mode=scheme;const screen=document.querySelector('.media-screen');if(screen)screen.scrollTop=0;},scheme);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          if(focus){
            if(!await focus.isVisible())await focus.locator('xpath=ancestor::details[1]').locator(':scope > summary').click();
            await focus.evaluate(element=>element.scrollIntoView({behavior:'instant',block:'center'}));
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.equal(await focus.isVisible(),true,`${name}: review target must be expanded`);
            assert.ok(await focus.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.top>=0&&rect.bottom<innerHeight-70;}),`${name}: review target must be inside the screenshot`);
            assert.ok(await focus.evaluate(element=>{const rect=element.getBoundingClientRect(),heading=document.querySelector('.media-playback-page .media-heading');return !heading||rect.top>=heading.getBoundingClientRect().bottom;}),`${name}: review target must remain below the sticky playback heading`);
          }
          const metrics=await page.evaluate(()=>{
            const screen=document.querySelector('.media-screen');
            const covers=Array.from(document.querySelectorAll('.media-grid .media-tile .media-cover')).slice(0,2).map(cover=>cover.getBoundingClientRect().top);
            return {pageOverflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:!!screen&&screen.scrollWidth>screen.clientWidth+1,mode:document.documentElement.dataset.mode,coverTopDelta:covers.length===2?Math.abs(covers[0]-covers[1]):0};
          });
          if(name==='playback-unsupported')assert.ok(await page.locator('.media-playback-problem').evaluate(element=>{const box=element.getBoundingClientRect(),screen=document.querySelector('.media-screen').getBoundingClientRect();return box.top>=0&&box.bottom<=screen.bottom;}),'playback failure is visible on entry without scrolling');
          if(name==='series-season-picker'){
            assert.ok(await page.getByRole('combobox',{name:'选择季',exact:true}).isVisible(),'season selector is visible');
            assert.ok(await page.locator('.media-episode-grid button').evaluateAll(items=>items.every(item=>item.getBoundingClientRect().height>=44)),'episode tiles retain touch targets');
          }
          const file=`${name}-${device}-${scheme}.png`;await page.screenshot({path:join(visualDir,file)});
          if(name==='saved-queue'||name==='saved-queue-long-title'){
            assert.equal(await page.locator('.media-saved-queue-title').evaluateAll(buttons=>buttons.length>0&&buttons.every(button=>button.getBoundingClientRect().width>=44&&button.getBoundingClientRect().height>=44&&button.getAttribute('aria-label').startsWith('播放 '))),true,'saved queue title remains a labelled playback target');
            assert.equal(await page.locator('.media-saved-queue-detail').evaluateAll(buttons=>buttons.length>0&&buttons.every(button=>button.getBoundingClientRect().width>=40&&button.getAttribute('aria-label').includes('详情'))),true,'saved queue detail icons remain labelled');
            assert.equal(await page.locator('.media-saved-queue-title strong').evaluateAll(titles=>titles.length>0&&titles.every(title=>title.getBoundingClientRect().height<=parseFloat(getComputedStyle(title).lineHeight)*2+1)),true,'queue titles occupy at most two lines');
          }
          if(name==='audiobook-player'&&device!=='desktop')assert.ok(await page.locator('.media-playback-options').evaluate(element=>element.getBoundingClientRect().bottom<=innerHeight),'short-screen audiobook speed and timer stay on screen');
          visualChecks.push({page:name,device,width,height,scheme,file,...metrics});
          await writeFile(join(visualDir,'verification.json'),JSON.stringify({complete:false,checks:visualChecks},null,2));
          assert.equal(metrics.pageOverflow,false,`${name} ${device} ${scheme}: page overflow`);
          assert.equal(metrics.contentOverflow,false,`${name} ${device} ${scheme}: content overflow`);
          assert.ok(metrics.coverTopDelta<1,`${name} ${device} ${scheme}: cover alignment`);
        }
      }finally{
        await page.setViewportSize(viewport);
        await page.evaluate(({mode,playing})=>{
          if(mode===null)delete document.documentElement.dataset.mode;else document.documentElement.dataset.mode=mode;
          for(const item of playing){const media=document.querySelector('.media-player '+item.tag.toLowerCase());if(media&&media.currentSrc===item.source&&!media.ended)void media.play().catch(()=>{});}
        },{mode,playing});
      }
    };
    // Shorten only the client-advertised lifetime to exercise renewal against the real server.
    let renewalCount=0;
    page.on('response',response=>{if(response.url().endsWith('/renew')&&response.status()===200)renewalCount++;});
    await page.route('**/api/v1/media/playback',async route=>{
      const response=await route.fetch();const body=await response.json();
      if(response.status()===201)body.expiresAt=Date.now()+1000;
      await route.fulfill({response,json:body});
    });
    // Checks that describe real behaviour the current app fails are collected and
    // reported together at the end, so one regression does not hide the rest.
    const regressions=[];
    const soft=async(check,message)=>{try{await(typeof check==='function'?check():check);}catch(error){regressions.push(message+': '+String(error.message).split('\n')[0]);}};
    // MediaSelect keeps a native <select> (visually hidden) as the form control behind its themed trigger.
    const select=(label,scope=page)=>scope.locator(`select.media-select-native[aria-label="${label}"]`);
    const gridColumns=()=>page.locator('.media-grid').first().evaluate(grid=>getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    const go=async hash=>{await page.evaluate(hash=>{location.hash=hash;},hash);};
    await page.goto(origin+'/#/media/music');await page.locator('input[autocomplete="username"]').fill('media-test');await page.locator('input[type="password"]').fill('media-test-pass');await page.locator('form button[type=submit]').click();
    // Opening a channel must not surface the catalog's own cancelled request as an error.
    const catalogError=page.locator('.media-screen-error,.media-screen .callout.is-error');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.media-grid .media-cover img')).some(img=>img.complete&&img.naturalWidth>0)||document.querySelector('.media-screen-error,.media-screen .callout.is-error'));
    if(await catalogError.count()){
      regressions.push('opening the music channel after login shows an error: '+(await catalogError.first().innerText()).replace(/\s+/g,' '));
      await catalogError.first().getByRole('button',{name:'重试',exact:true}).click();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.media-grid .media-cover img')).some(img=>img.complete&&img.naturalWidth>0));
    }
    assert.equal(new URL(page.url()).hash.startsWith('#/media/music/albums'),true,'the music channel opens on its first category');
    assert.equal(await page.locator('.media-channel-segments a[aria-current=page]').textContent(),'音乐');
    const layout=await page.locator('.media-grid').evaluate(grid=>({columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.equal(layout.columns,3,'mobile uses three cover columns');
    assert.equal(layout.overflow,false,'mobile has no horizontal page overflow');
    await auditPage('music-home');
    // Exercise the mounted screen, not just an isolated error component.
    for(const [name,status,code,message,title] of [
      ['service-starting',503,'MEDIA_STARTING','影音服务正在准备，请稍后重试','影音服务正在准备'],
      ['service-unavailable',503,'MEDIA_UNAVAILABLE','影音服务不可用，请管理员检查服务日志','影音服务暂不可用'],
    ]){
      const pattern=/\/api\/v1\/media\/(?:browse|libraries\/[^/]+\/items)\?/;
      const failRead=route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code,message}})});
      await page.route(pattern,failRead);await page.reload();
      await page.getByText(title,{exact:true}).waitFor();
      assert.equal(await page.locator('.media-library-empty').count(),0,'an unread catalog is not an empty library');
      assert.equal(await page.locator('.media-grid').count(),0,'an unread catalog shows no grid');
      await auditPage(name);
      await page.unroute(pattern,failRead);
      await page.locator('.media-screen-error').getByRole('button',{name:'重试',exact:true}).click();
      await page.locator('.media-grid .media-tile').first().waitFor();
      assert.equal(await page.locator('.media-screen-error').count(),0);
    }
    for(const [name,status,code,message,title] of [
      ['detail-denied',403,'MEDIA_FORBIDDEN','无权访问此媒体库','没有访问权限'],
      ['detail-unavailable',404,'MEDIA_NOT_FOUND','作品不存在或不可访问','内容已不可用'],
    ]){
      const pattern='**/api/v1/media/items/review-unavailable';
      const failRead=route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code,message}})});
      await page.route(pattern,failRead);await page.goto(origin+'/#/media/music/items/review-unavailable');
      await page.getByText(title,{exact:true}).waitFor();
      assert.equal(await page.locator('.media-hero').count(),0,'a failed detail shows no work');
      await auditPage(name);
      await page.getByRole('link',{name:'返回频道',exact:true}).click();
      await page.locator('.media-grid .media-tile').first().waitFor();
      assert.ok(new URL(page.url()).hash.startsWith('#/media/music'));
      await page.unroute(pattern,failRead);
    }
    const tabs=page.getByRole('navigation',{name:'音乐分类',exact:true});
    await tabs.getByRole('link',{name:'曲目',exact:true}).click();
    await page.locator('.media-grid .media-tile').filter({hasText:'test-tone'}).waitFor();
    assert.ok(await page.locator('.media-grid .media-tile').first().evaluate(row=>row.getBoundingClientRect().height)<260,'track tiles remain compact');
    await auditPage('tracks');
    await page.locator('.media-grid .media-tile').filter({hasText:'test-tone'}).click();
    await page.locator('.media-hero h1').filter({hasText:'test-tone'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'曲目详情',exact:true}).count(),1);
    assert.ok(await page.locator('.media-hero .media-cover').evaluate(cover=>{const rect=cover.getBoundingClientRect();return Math.abs(rect.width-rect.height)<1;}),'music artwork is square');
    await page.waitForFunction(()=>{const img=document.querySelector('.media-hero .media-cover img');return img?.complete&&img.naturalWidth>0;});
    await auditPage('track-detail');
    // 影音浏览 is a section of 我的 › 偏好设置; each control applies immediately.
    await go('#/me/settings?section=browse');
    await page.getByRole('tab',{name:'影音浏览',exact:true,selected:true}).waitFor();
    if(process.env.MEDIA_SMOKE_SETTINGS_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_SETTINGS_SCREENSHOT});
    await auditPage('settings');
    assert.equal(await page.getByRole('button',{name:/^保存/}).count(),0,'preferences have no save button');
    await select('封面密度').selectOption('comfortable');
    await go('#/media/music/albums');await page.locator('.media-grid .media-tile').first().waitFor();
    await soft(async()=>{assert.equal(await gridColumns(),2,'columns after choosing 宽松: '+await gridColumns());await page.reload();await page.locator('.media-grid .media-tile').first().waitFor();assert.equal(await gridColumns(),2,'density survives reload');},'封面密度 宽松 shows two cover columns on a phone (the preference is saved but nothing reads it)');
    await go('#/me/settings?section=browse');
    await select('封面密度').selectOption('compact');
    await go('#/media/music/albums');await page.locator('.media-grid .media-tile').first().waitFor();
    assert.equal(await gridColumns(),3);
    // Search is its own page.
    await page.getByRole('link',{name:'搜索',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索影音'}).fill('does-not-exist');
    await page.getByRole('search').getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByText('没有匹配内容，请调整搜索词或搜索范围。',{exact:true}).waitFor();
    await auditPage('search-empty');
    await page.getByRole('button',{name:'清空关键词',exact:true}).click();
    await page.getByText('输入名称，搜索有权访问的媒体库。',{exact:true}).waitFor();
    // The channel's ⋯ menu: 收藏 / 历史 / 队列 / 媒体库管理.
    const channelMenu=async(label,channel='music')=>{await go('#/media/'+channel);await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menu',{name:'更多操作'}).getByRole('menuitem',{name:label,exact:true}).click();};
    await channelMenu('历史');
    await page.getByRole('heading',{name:'播放历史'}).waitFor();
    await page.getByText('暂无记录。',{exact:true}).waitFor();
    await auditPage('history-empty');
    const memberCreated=await fetch(origin+'/api/v1/admin/users',{method:'POST',headers,body:JSON.stringify({username:'media-member',password:'member-test-pass',displayName:'媒体成员',role:'member'})});
    assert.equal(memberCreated.status,201);
    await channelMenu('媒体库管理');
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    await page.getByRole('button',{name:'扫描与刮削',exact:true}).click();
    await page.getByRole('heading',{name:'扫描与刮削',exact:true}).waitFor();
    await page.getByRole('navigation',{name:'任务类型',exact:true}).getByRole('button',{name:'刮削',exact:true}).click();
    await page.getByRole('heading',{name:'最近任务',exact:true}).waitFor();
    assert.equal(await page.locator('details.media-task-create').evaluate(details=>details.open),true,'新建批量匹配 is open');
    assert.equal(await page.getByRole('button',{name:'开始批量匹配',exact:true}).isDisabled(),true);
    await auditPage('batch-scrape');
    const configUrl=origin+`/api/v1/media/libraries/${lib.id}/configuration`;
    const failConfiguration=async route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'媒体库配置暂时不可用'}})});
    await page.route(configUrl,failConfiguration);
    await page.getByRole('link',{name:'返回媒体库管理',exact:true}).click();
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    const libraryAction=async(name,action)=>{await page.getByRole('button',{name:'媒体库操作 '+name,exact:true}).click();await page.getByRole('menu',{name}).getByRole('menuitem',{name:action,exact:true}).click();};
    await libraryAction('浏览器音乐测试','编辑媒体库');
    await page.getByRole('button',{name:'重试读取配置',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'保存修改',exact:true}).isDisabled(),true);
    await auditPage('library-config-error',page.locator('.media-library-editor'));
    await page.unroute(configUrl,failConfiguration);
    await page.getByRole('button',{name:'重试读取配置',exact:true}).click();
    await page.locator('.media-library-path').filter({hasText:music}).waitFor();
    await page.getByLabel('媒体库名称',{exact:true}).fill('测试音乐库');
    await auditPage('library-rename');
    await page.getByLabel('媒体库名称',{exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button',{name:'取消',exact:true}).evaluate(button=>button===document.activeElement),true,'library cancel follows the name field in keyboard order');
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button',{name:'保存修改',exact:true}).evaluate(button=>button===document.activeElement),true,'library save is keyboard reachable');
    await auditPage('library-form-actions',page.locator('.media-library-editor .media-form-footer'));
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    await page.locator('.media-library-editor').waitFor({state:'detached'});
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    const renamed=await (await fetch(origin+`/api/v1/media/libraries/${lib.id}`,{headers})).json();
    assert.equal(renamed.name,'测试音乐库');
    await page.locator('.media-library-row').filter({hasText:'测试音乐库'}).getByText(/^上次扫描/).waitFor();
    await libraryAction('测试音乐库','扫描记录');
    await page.getByText('重新读取「测试音乐库」的目录并更新索引。',{exact:true}).waitFor();
    assert.equal(await select('扫描媒体库').inputValue(),lib.id);
    await page.locator('.media-scan-jobs').waitFor();
    await auditPage('library-manager');
    const jobsUrl=origin+`/api/v1/media/libraries/${lib.id}/jobs`;
    const failJobsRead=async route=>{assert.equal(route.request().method(),'GET');await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'扫描任务暂时不可用'}})});};
    await page.route(jobsUrl,failJobsRead);
    await page.getByRole('button',{name:'刷新扫描任务',exact:true}).click();
    const jobsError=page.getByRole('alert').filter({hasText:'扫描任务暂时不可用'});
    await jobsError.waitFor();
    await page.unroute(jobsUrl,failJobsRead);
    await jobsError.getByRole('button',{name:'重试',exact:true}).click();
    await jobsError.waitFor({state:'detached'});
    await page.locator('.media-scan-jobs').waitFor();
    await page.route(jobsUrl,async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[{id:'upgrade-failure-fixture',libraryId:lib.id,state:'failed',inspected:1,error:'probe-upgrade-failed'}]})}));
    await page.getByRole('button',{name:'刷新扫描任务',exact:true}).click();
    const upgradeMessage=page.getByText('技术信息升级未完成，原有资料已保留。请检查服务器 ffprobe 是否可用，再重新扫描。',{exact:true});
    await upgradeMessage.waitFor();
    await auditPage('scan-upgrade-error',upgradeMessage);
    await page.unroute(jobsUrl);
    await page.getByRole('button',{name:'刷新扫描任务',exact:true}).click();
    await upgradeMessage.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('link',{name:'返回媒体库管理',exact:true}).click();
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    await libraryAction('测试音乐库','访问权限');
    await page.getByRole('button',{name:'保存权限'}).waitFor();
    await page.getByText('保存后所有已启用用户均可访问。下方为预选名单，不限制当前访问范围，切换为指定用户时使用。',{exact:true}).waitFor();
    await auditPage('library-permissions');
    await select('访问范围').selectOption('restricted');
    await page.getByText('保存后仅管理员可以访问。',{exact:true}).waitFor();
    await auditPage('library-permissions-restricted-empty');
    await select('访问范围').selectOption('all');
    await page.getByLabel('查找用户',{exact:true}).fill('missing-user');
    await page.getByText('没有匹配的用户，已选名单保留。',{exact:true}).waitFor();
    await auditPage('library-permissions-search-empty');
    await page.getByLabel('查找用户',{exact:true}).fill('media-member');
    await page.locator('.media-user-option').filter({hasText:'media-member'}).locator('input').check();
    await select('访问范围').selectOption('restricted');
    await page.getByRole('button',{name:'保存权限'}).click();
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    const accessConfig=await (await fetch(origin+`/api/v1/media/libraries/${lib.id}/configuration`,{headers})).json();
    assert.equal(accessConfig.access,'restricted');assert.equal(accessConfig.userIds.length,1);
    await go('#/media/music/albums');
    await page.locator('.media-grid .media-tile').first().click();
    await page.locator('.media-album-track-detail').first().click();
    await page.getByRole('heading',{name:'曲目详情',exact:true}).waitFor();
    await page.getByRole('button',{name:'加入队列',exact:true}).waitFor();
    await page.locator('.media-detail-favorite').click();await page.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
    await auditPage('track-detail');
    await page.getByRole('button',{name:'加入队列',exact:true}).click();
    for(let i=0;i<50;i++){if((await (await fetch(origin+'/api/v1/media/queue',{headers})).json()).items.length===1)break;await delay(100);}
    const initialQueue=await (await fetch(origin+'/api/v1/media/queue',{headers})).json();assert.equal(initialQueue.items.length,1);
    const duplicate=await fetch(origin+'/api/v1/media/queue',{method:'POST',headers,body:JSON.stringify({partIds:[initialQueue.items[0].partId]})});assert.equal(duplicate.status,200,await duplicate.clone().text());
    await channelMenu('队列');
    await page.getByRole('heading',{name:'待播队列',exact:true}).waitFor();
    const beforeMove=await (await fetch(origin+'/api/v1/media/queue',{headers})).json();assert.equal(beforeMove.items.length,2);
    await page.waitForFunction(()=>document.querySelectorAll('.media-saved-queue-row').length===2);
    await page.getByRole('button',{name:'编辑队列',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.media-queue-actions').length===2);
    await page.getByRole('button',{name:/^上移 /}).last().click();
    for(let i=0;i<50;i++){const now=await (await fetch(origin+'/api/v1/media/queue',{headers})).json();if(now.items[0].id!==beforeMove.items[0].id)break;await delay(100);}
    const afterMove=await (await fetch(origin+'/api/v1/media/queue',{headers})).json();
    assert.deepEqual(afterMove.items.map(row=>row.id),beforeMove.items.map(row=>row.id).reverse());
    await page.waitForFunction(()=>!document.querySelector('.media-queue-actions button:disabled:not([aria-label^="上移"]):not([aria-label^="下移"])'));
    await page.locator('.media-saved-queue').getByRole('button',{name:/^移除 /}).first().click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-queue-actions').length===1);
    await page.getByRole('button',{name:'完成编辑队列',exact:true}).click();
    await auditPage('saved-queue');
    if(visualDir){
      // Synthetic title stress case; playback identity and server data are unchanged.
      const title=page.locator('.media-saved-queue-title strong').first();
      const previous=await title.evaluate(node=>{const previous=node.textContent;node.textContent='长标题LongUnbrokenQueueTitle'.repeat(8);return previous;});
      await auditPage('saved-queue-long-title');
      await title.evaluate((node,text)=>{node.textContent=text;},previous);
    }
    await page.locator('.media-saved-queue-title').first().click();
    await page.waitForFunction(()=>{const a=document.querySelector('.media-player audio');return a&&a.currentTime>.2&&!a.paused;});
    const miniLayout=await page.locator('.media-mini').evaluate(mini=>{const rect=mini.getBoundingClientRect(),nav=document.querySelector('.app-nav'),navRect=nav?.getBoundingClientRect(),navTop=navRect&&navRect.height>0&&getComputedStyle(nav).display!=='none'?navRect.top:innerHeight;return {bottom:rect.bottom,navTop,within:rect.left>=0&&rect.right<=innerWidth&&rect.height>0};});
    assert.equal(miniLayout.within,true);assert.ok(miniLayout.bottom<=miniLayout.navTop+.5,'mini player stays above the app navigation');
    if(process.env.MEDIA_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_SCREENSHOT});
    const beforePlaybackView=await page.locator('.media-player audio').evaluate(a=>({src:a.currentSrc,time:a.currentTime}));
    let failPlayingDetails=true;
    const playingDetailsPattern=/\/api\/v1\/media\/items\/[^/?]+$/;
    await page.route(playingDetailsPattern,async route=>{
      if(failPlayingDetails&&route.request().method()==='GET'){
        await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'playing detail unavailable'}})});
      }else await route.continue();
    });
    // Item reads are cached for a minute; mark them stale so the player reads the work again.
    await page.evaluate(()=>window.readerApp.api.refreshQueries());
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    await page.locator('.media-playback-page').waitFor();
    await page.waitForFunction(()=>location.hash.startsWith('#/media/music/player'));
    const artworkError=page.getByRole('alert').filter({hasText:'作品资料读取失败'});
    await artworkError.waitFor();
    await page.waitForFunction(t=>document.querySelector('.media-player audio').currentTime>t,beforePlaybackView.time);
    assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),beforePlaybackView.src);
    await auditPage('playing-artwork-error',artworkError);
    failPlayingDetails=false;
    await page.getByRole('button',{name:'重新读取作品资料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-playing-artwork img')?.complete);
    await artworkError.waitFor({state:'detached'});
    await page.unroute(playingDetailsPattern);
    assert.equal(await page.locator('.media-saved-queue').count(),0,'the player replaces the queue page');
    await page.waitForFunction(t=>document.querySelector('.media-player audio').currentTime>t,beforePlaybackView.time);
    assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),beforePlaybackView.src);
    if(process.env.MEDIA_SMOKE_PLAYER_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_PLAYER_SCREENSHOT});
    await auditPage('audio-player');
    await page.getByRole('button',{name:'歌词',exact:true}).click();
    await page.getByRole('button',{name:'测试歌词第二句',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-lyrics [aria-current=true]')?.textContent==='测试歌词第二句');
    assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),beforePlaybackView.src);
    await page.locator('.media-player audio').evaluate(a=>{a.currentTime=15.2;});
    await page.waitForFunction(()=>document.querySelector('.media-lyrics [aria-current=true]')?.textContent==='测试歌词第三句');
    if(process.env.MEDIA_SMOKE_LYRICS_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_LYRICS_SCREENSHOT});
    await auditPage('lyrics');
    await auditPage('lyrics-transport',page.locator('.media-playback-status .media-transport'));
    await page.getByRole('button',{name:'封面',exact:true}).click();
    await page.locator('.media-playing-artwork').waitFor();
    await page.getByRole('button',{name:'← 返回浏览',exact:true}).click();
    await page.getByRole('heading',{name:'待播队列',exact:true}).waitFor();
    assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),beforePlaybackView.src);

    await page.getByRole('button',{name:'暂停音频',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-player audio').paused);
    await page.getByRole('button',{name:'继续音频',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.media-player audio').paused);
    assert.equal(await page.locator('.media-playback-status').count(),0,'browse view keeps full transport out of content');
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const seekSlider=page.getByRole('slider',{name:'当前章节播放位置',exact:true});
    const seekBox=await seekSlider.boundingBox();assert.ok(seekBox);
    await page.mouse.move(seekBox.x+seekBox.width*.4,seekBox.y+seekBox.height/2);await page.mouse.down();
    await page.mouse.move(seekBox.x+seekBox.width*.7,seekBox.y+seekBox.height/2,{steps:5});
    const dragged=Number(await seekSlider.inputValue());
    await page.locator('.media-player audio').evaluate(audio=>{audio.currentTime=2;audio.dispatchEvent(new Event('timeupdate'));});
    assert.equal(Number(await seekSlider.inputValue()),dragged,'progress updates preserve the live drag');
    await page.mouse.up();
    await page.waitForFunction(position=>Math.abs(document.querySelector('.media-player audio').currentTime-position)<.2,dragged);
    const sheet=page.locator('dialog[open]').last();
    await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await sheet.getByRole('button',{name:'快进 30 秒',exact:true}).click();
    await sheet.getByRole('button',{name:'快退 15 秒',exact:true}).click();
    await sheet.locator('.sheet-close').click();
    await page.waitForFunction(position=>{const a=document.querySelector('.media-player audio');return a.paused&&Math.abs(a.currentTime-(Math.min(30,position+30)-15))<.3;},dragged);
    await page.getByRole('button',{name:'继续',exact:true}).click();
    await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await select('倍速',sheet).selectOption('1.75');
    assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.playbackRate),1.75);
    await sheet.locator('.sheet-close').click();
    await page.getByRole('button',{name:'睡眠定时',exact:true}).click();
    await sheet.locator('.media-sleep-presets button').filter({hasText:/^15/}).click();
    await page.locator('dialog[open]').waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'睡眠定时',exact:true}).textContent(),'15 分钟');
    for(let i=0;i<50&&renewalCount===0;i++)await delay(100);
    assert.ok(renewalCount>0,'authenticated playback lease renewed');
    const before=await page.locator('.media-player audio').evaluate(a=>a.currentTime);
    await go('#/shelf');
    await page.locator('.shelf-screen').waitFor();
    assert.equal(await page.locator('.media-channel-segments').count(),0,'reading does not retain media navigation nodes');
    await page.locator('.media-player').waitFor({state:'hidden'});
    await page.waitForFunction(t=>document.querySelector('.media-player audio').currentTime>t+.2,before);
    await page.evaluate(()=>window.readerApp.flush());
    const items=await (await fetch(origin+`/api/v1/media/libraries/${lib.id}/items?kind=track`,{headers})).json();
    const detail=await (await fetch(origin+'/api/v1/media/items/'+items.items[0].id,{headers})).json();
    const progress=await (await fetch(origin+'/api/v1/media/parts/'+detail.editions[0].parts[0].id+'/progress',{headers})).json();assert.ok(progress.position>0,'real playback progress persisted');
    assert.equal((await (await fetch(origin+'/api/v1/media/queue',{headers})).json()).items.length,1);
    assert.equal((await (await fetch(origin+'/api/v1/media/favorites',{headers})).json()).items.length,1);
    // Generate a real VP8/WebM fixture in Chromium; no external files or codecs required.
    const videoBytes=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const context=canvas.getContext('2d');const stream=canvas.captureStream(10);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      const done=new Promise(resolve=>{recorder.onstop=resolve;});
      let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#294535':'#57744c';context.fillRect(0,0,320,180);},100);
      recorder.start();await new Promise(resolve=>setTimeout(resolve,3000));recorder.stop();await done;
      clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
    });
    const videoRoot=join(root,'video');await mkdir(videoRoot);
    await writeFile(join(videoRoot,'Subtitle Test.webm'),Buffer.from(videoBytes));
    await writeFile(join(videoRoot,'Subtitle Test.zh-CN.srt'),'1\n00:00:00,000 --> 00:00:30,000\n本地字幕测试');
    const videoLibraryResponse=await fetch(origin+'/api/v1/media/libraries',{method:'POST',headers,body:JSON.stringify({name:'字幕测试',kind:'video',root:videoRoot,access:'all'})});
    assert.equal(videoLibraryResponse.status,201);const videoLibrary=await videoLibraryResponse.json();
    const videoScan=await (await fetch(origin+`/api/v1/media/libraries/${videoLibrary.id}/scan`,{method:'POST',headers,body:'{}'})).json();
    for(let i=0;i<350;i++){job=await (await fetch(origin+'/api/v1/media/jobs/'+videoScan.id,{headers})).json();if(job.state!=='running')break;await delay(100);}assert.equal(job.state,'complete');
    // Search: one page across channels; the scope narrows it.
    await go('#/media/search');
    const scopes=page.getByRole('navigation',{name:'搜索范围',exact:true});
    await scopes.getByRole('button',{name:'音乐',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索影音'}).fill('Subtitle Test');
    await page.getByRole('search').getByRole('button',{name:'搜索',exact:true}).click();
    await page.getByText('没有匹配内容，请调整搜索词或搜索范围。',{exact:true}).waitFor();
    await scopes.getByRole('button',{name:'全部',exact:true}).click();
    await page.locator('.media-search-result').first().click();
    await page.waitForFunction(()=>location.hash.startsWith('#/media/video/items/'));
    await page.goBack();
    await page.getByRole('textbox',{name:'搜索影音'}).waitFor();
    assert.equal(await scopes.getByRole('button',{name:'全部',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByRole('textbox',{name:'搜索影音'}).inputValue(),'Subtitle Test');
    await page.locator('.media-search-result').first().click();
    await page.waitForFunction(()=>location.hash.startsWith('#/media/video/items/'));
    await page.getByRole('heading',{name:'电影详情',exact:true}).waitFor();
    const workAction=async label=>{await page.getByRole('button',{name:'作品操作',exact:true}).click();await page.getByRole('menu',{name:'作品操作'}).getByRole('menuitem',{name:label,exact:true}).click();};
    await workAction('资源信息');
    const resourceSheet=page.locator('dialog[open]').filter({has:page.getByRole('heading',{name:'资源信息',exact:true})});
    await resourceSheet.getByText('播放兼容性取决于当前设备。',{exact:true}).waitFor();
    assert.ok((await resourceSheet.locator('.media-resource-facts').first().textContent()).includes('可用'));
    await resourceSheet.locator('.sheet-close').click();
    await workAction('编辑资料');
    await page.getByRole('heading',{name:'元数据',exact:true}).waitFor();
    await page.getByLabel('年份',{exact:true}).fill('2025');
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    await page.getByText('已保存修改。',{exact:true}).waitFor();
    const metadataItemId=await page.evaluate(()=>decodeURIComponent(location.hash.split('/').at(-2)));
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+metadataItemId,{headers})).json()).overrides.year,2025);
    await page.getByRole('button',{name:'恢复来源值',exact:true}).click();
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    await page.getByRole('button',{name:'保存修改',exact:true}).and(page.locator(':disabled')).waitFor();
    assert.equal(Object.hasOwn((await(await fetch(origin+'/api/v1/media/items/'+metadataItemId,{headers})).json()).overrides,'year'),false);
    await page.getByRole('button',{name:'返回作品详情',exact:true}).click();
    await page.getByRole('heading',{name:'电影详情',exact:true}).waitFor();
    await page.waitForFunction(()=>!(document.querySelector('.media-detail-credit')?.textContent??'').includes('2025'));
    await page.getByRole('button',{name:'播放电影',exact:true}).click();
    await page.waitForFunction(()=>{const video=document.querySelector('.media-player video');return video&&video.currentTime>0&&video.videoWidth===320;});
    assert.equal(await page.locator('.media-player video').evaluate(video=>video.playbackRate),1.75,'the playback speed carries over from audio to video');
    if(!new URL(page.url()).hash.includes('/player'))await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    await page.locator('.media-video-controls').waitFor();
    for(const viewport of [{width:1366,height:768},{width:844,height:390}]){
      await page.setViewportSize(viewport);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const layout=await page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};};
        return {viewport:[innerWidth,innerHeight],video:rect('.media-player video'),controls:rect('.media-video-controls'),overflow:document.documentElement.scrollWidth>innerWidth+1};
      });
      assert.ok(layout.video.left>=0&&layout.video.right<=viewport.width+.5&&layout.video.top>=-.5&&layout.video.bottom<=viewport.height+.5&&layout.video.height>100,'video remains visible after viewport change: '+JSON.stringify(layout));
      assert.equal(layout.overflow,false,'video page has no horizontal overflow');
      if(viewport.height<500&&process.env.MEDIA_SMOKE_LANDSCAPE_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_LANDSCAPE_SCREENSHOT});
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.media-player video').evaluate(video=>{const r=video.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.height>100;}),true,'decoded video is visible without document scrolling');
    if(process.env.MEDIA_SMOKE_VIDEO_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_VIDEO_SCREENSHOT});
    const videoTools=page.locator('.media-video-tools');
    await videoTools.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await sheet.getByText('倍速 · 1.75×',{exact:true}).waitFor();
    assert.equal(await sheet.getByRole('button',{name:'关闭定时',exact:true}).getAttribute('aria-pressed'),'false','the sleep timer set on audio is still running');
    await sheet.getByRole('button',{name:'关闭定时',exact:true}).click();
    assert.equal(await page.evaluate(()=>!window.readerApp.player.sleepAt),true,'关闭定时 clears the sleep timer');
    if(await sheet.count())await sheet.locator('.sheet-close').click();
    await videoTools.getByRole('button',{name:'字幕',exact:true}).click();
    // Exercise native TextTrack events; this validates controls, not container demux support.
    await page.locator('.media-player video').evaluate(video=>{
      const track=video.addTextTrack('subtitles','浏览器字幕轨','zh');
      track.addCue(new VTTCue(0,30,'浏览器字幕轨测试'));track.mode='disabled';
    });
    const subtitleList=sheet.getByRole('radiogroup',{name:'字幕'});
    const subtitleOption=text=>subtitleList.getByRole('radio').filter({hasText:text});
    await subtitleOption('浏览器字幕轨').click();
    await page.waitForFunction(()=>Array.from(document.querySelector('.media-player video').textTracks).find(track=>track.label==='浏览器字幕轨')?.mode==='showing');
    await subtitleOption('zh-CN').click();
    try{await page.waitForFunction(()=>{const tracks=Array.from(document.querySelector('.media-player video').textTracks);return tracks.some(track=>track.mode==='showing'&&track.cues?.[0]?.text==='本地字幕测试')&&tracks.find(track=>track.label==='浏览器字幕轨')?.mode==='disabled';});}
    catch(error){console.error(await page.locator('.media-player video').evaluate(video=>({tracks:Array.from(video.textTracks).map(track=>({label:track.label,mode:track.mode,cues:Array.from(track.cues||[]).map(cue=>cue.text)})),options:document.querySelector('[role=radiogroup][aria-label="字幕"]')?.textContent})));throw error;}
    await subtitleOption('关闭').click();
    await page.waitForFunction(()=>document.querySelectorAll('.media-player video track').length===0);
    await sheet.locator('.sheet-close').click();
    await videoTools.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await sheet.getByRole('button',{name:'结束播放',exact:true}).click();
    await page.waitForFunction(()=>!window.readerApp.player.active);
    await go('#/media/music');
    const continuation=page.locator('section.media-continue[aria-label="最近续播"]');
    await continuation.waitFor();
    assert.ok(await page.locator('.media-screen').evaluate(screen=>screen.getBoundingClientRect().width>=innerWidth-32),'mobile content uses available width even with few items');
    const scrollProbe=await page.locator('.media-screen').evaluate(screen=>{
      const spacer=document.createElement('div');spacer.style.height='2000px';screen.append(spacer);
      const overflow=getComputedStyle(screen).overflowY;screen.scrollTop=screen.scrollHeight;
      const reachable=screen.scrollTop>0&&screen.getBoundingClientRect().bottom<=innerHeight;
      spacer.remove();screen.scrollTop=0;return {overflow,reachable};
    });
    assert.equal(scrollProbe.overflow,'auto');assert.equal(scrollProbe.reachable,true,'long media content has a user-scrollable viewport');
    const themeCheck=await page.evaluate(()=>{
      const root=document.documentElement,previous=root.dataset.mode;
      const read=()=>({text:getComputedStyle(document.querySelector('.media-screen')).color,body:getComputedStyle(document.body).backgroundColor,scheme:getComputedStyle(document.querySelector('.media-screen')).colorScheme});
      root.dataset.mode='light';const light=read();root.dataset.mode='dark';const dark=read();
      if(previous===undefined)delete root.dataset.mode;else root.dataset.mode=previous;
      return {light,dark};
    });
    assert.notEqual(themeCheck.dark.text,themeCheck.light.text,'dark mode changes the text colour');
    assert.notEqual(themeCheck.dark.body,themeCheck.light.body,'dark mode changes the page background');
    assert.equal(themeCheck.dark.scheme,'dark');
    if(process.env.MEDIA_SMOKE_DARK_SCREENSHOT){
      const previous=await page.evaluate(()=>{const old=document.documentElement.dataset.mode;document.documentElement.dataset.mode='dark';return old??null;});
      await page.screenshot({path:process.env.MEDIA_SMOKE_DARK_SCREENSHOT});
      await page.evaluate(old=>{if(old===null)delete document.documentElement.dataset.mode;else document.documentElement.dataset.mode=old;},previous);
    }
    assert.equal(await continuation.evaluate(row=>{const r=row.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);
    if(process.env.MEDIA_SMOKE_CONTINUE_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_CONTINUE_SCREENSHOT});
    await continuation.getByRole('button',{name:'续播',exact:true}).click();
    await page.waitForFunction(()=>{const a=document.querySelector('.media-player audio');return a&&!a.paused&&a.currentTime>10;});
    await channelMenu('队列');
    await page.getByRole('button',{name:'清空当前频道队列',exact:true}).click();
    await page.getByRole('button',{name:'保留队列',exact:true}).click();
    assert.equal((await (await fetch(origin+'/api/v1/media/queue',{headers})).json()).items.length,1);
    await page.getByRole('button',{name:'清空当前频道队列',exact:true}).click();
    await page.getByRole('button',{name:'确认清空',exact:true}).click();
    await page.getByText('暂无记录。',{exact:true}).waitFor();
    assert.equal((await (await fetch(origin+'/api/v1/media/queue',{headers})).json()).items.length,0);
    // Exercise real files through series hierarchy and audiobook file chapters.
    const importLibrary=async(name,kind,folder)=>{
      const response=await fetch(origin+'/api/v1/media/libraries',{method:'POST',headers,body:JSON.stringify({name,kind,root:folder,access:'all'})});
      assert.equal(response.status,201);const library=await response.json();
      const started=await fetch(origin+'/api/v1/media/libraries/'+library.id+'/scan',{method:'POST',headers,body:'{}'});
      assert.equal(started.status,202);const task=await started.json();let state;
      for(let i=0;i<350;i++){state=await(await fetch(origin+'/api/v1/media/jobs/'+task.id,{headers})).json();if(state.state!=='running')break;await delay(100);}
      assert.equal(state.state,'complete');return library;
    };
    await stopPlayback();
    const albumRoot=join(root,'album-playback');await mkdir(albumRoot);
    await writeFile(join(albumRoot,'artist.nfo'),'<artist><name>测试歌手</name><biography>这段艺人简介来自本地 artist.nfo，用于验证独立人物资料。</biography></artist>');
    await writeFile(join(albumRoot,'artist.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=','base64'));
    for(const [name,disc,track]of [['last',2,1],['first',1,1],['second',1,2]]){
      await writeFile(join(albumRoot,name+'.wav'),wav);
      await writeFile(join(albumRoot,name+'.nfo'),`<album><title>${name}</title><album>连续播放专辑</album><artist>测试歌手</artist><disc>${disc}</disc><track>${track}</track></album>`);
    }
    const albumLibrary=await importLibrary('专辑连播测试','music',albumRoot);
    await go('#/media/search');await page.reload();
    await page.getByRole('textbox',{name:'搜索影音'}).fill('first');
    await page.getByRole('search').getByRole('button',{name:'搜索',exact:true}).click();
    await page.locator('.media-search-description').filter({hasText:'测试歌手'}).waitFor();
    await auditPage('search-results');
    await go('#/media/music/artists');
    await page.locator('.media-grid .media-tile').filter({hasText:'测试歌手'}).waitFor();
    await auditPage('artists');
    await page.locator('.media-grid .media-tile').filter({hasText:'测试歌手'}).click();
    await page.getByRole('heading',{name:'全部专辑',exact:true}).waitFor();
    assert.equal(await page.locator('.media-hero .media-portrait').count(),1);
    await page.getByText('这段艺人简介来自本地 artist.nfo，用于验证独立人物资料。',{exact:true}).waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector('.media-hero .media-portrait img');return image?.complete&&image.naturalWidth>0;});
    assert.equal(await page.locator('.media-detail-kind').textContent(),'音乐人');
    assert.equal(await page.locator('.media-detail-heading').textContent(),'音乐人测试歌手','artist heading does not repeat the artist as its own credit');
    await auditPage('artist-detail');
    // Synthetic long metadata exercises layout only; it is not live provider evidence.
    const artistId=await page.evaluate(()=>decodeURIComponent(location.hash.split('/').at(-1)));
    const artistDetailPattern='**/api/v1/media/items/'+artistId;
    const artistInfoFixture=async route=>{
      const response=await route.fetch(),body=await response.json();
      assert.equal(response.status(),200);
      body.metadata={...body.metadata,artistType:'Group',artistArea:'United Kingdom / 示例关联地区',artistDisambiguation:'视觉测试资料：这是用于区分同名艺人的较长说明，包含中文、English 和录音版本信息；不代表人物简介或真实来源验收。'};
      await route.fulfill({response,json:body});
    };
    await page.route(artistDetailPattern,artistInfoFixture);
    await page.evaluate(()=>window.readerApp.api.refreshQueries());await page.reload();
    const artistInfo=page.getByRole('region',{name:'艺人资料'});
    await artistInfo.waitFor();
    await auditPage('artist-info-fixture',artistInfo);
    await page.unroute(artistDetailPattern,artistInfoFixture);
    const albumItems=await(await fetch(origin+'/api/v1/media/libraries/'+albumLibrary.id+'/items?kind=album',{headers})).json();
    let albumReadFails=true;
    await page.route('**/items/*/album-playback',async route=>{
      if(albumReadFails){albumReadFails=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'暂时无法读取专辑，请重试'}})});}
      else await route.continue();
    });
    await go('#/media/music/items/'+albumItems.items[0].id);
    await page.locator('.media-album-playback [role=alert]').waitFor();
    assert.equal(await page.getByText('没有匹配的曲目。',{exact:true}).count(),0);
    await auditPage('album-read-error',page.locator('.media-album-playback [role=alert]'));
    await page.locator('.media-album-playback').getByRole('button',{name:'重新读取',exact:true}).click();
    await page.getByRole('button',{name:'播放全部',exact:true}).waitFor();
    assert.deepEqual(await page.locator('.media-album-track-title').evaluateAll(nodes=>nodes.map(node=>node.firstChild.textContent)),['first','second','last'],'tracks follow disc and track order');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.MEDIA_SMOKE_ALBUM_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_ALBUM_SCREENSHOT});
    await auditPage('album');
    if(visualDir){
      const titles=await page.locator('.media-album-track-title').evaluateAll(nodes=>nodes.map(node=>node.firstChild.textContent));
      await page.locator('.media-album-track-title').first().evaluate(node=>{node.firstChild.textContent='LongAlbumTrackTitleWithoutSpaces'.repeat(4)+' · 超长曲目标题布局验证';});
      await auditPage('album-long-title');
      await page.locator('.media-album-track-title').evaluateAll((nodes,titles)=>nodes.forEach((node,index)=>{node.firstChild.textContent=titles[index];}),titles);
    }
    await page.getByRole('button',{name:'播放全部',exact:true}).click();
    await page.waitForFunction(()=>{const a=document.querySelector('.media-player audio');return a&&!a.paused&&a.currentTime>.1;});
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-playing-title')?.textContent==='first');
    await page.locator('.media-player audio').evaluate(a=>{a.currentTime=a.duration-.2;});
    await page.waitForFunction(()=>document.querySelector('.media-playing-title')?.textContent==='second');
    await page.locator('.media-transport').getByRole('button',{name:'下一首 / 章',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-playing-title')?.textContent==='last');
    await stopPlayback();
    await go('#/media/music/albums');await page.reload();
    await select('来源库').selectOption('');
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===2);
    await select('来源库').selectOption(albumLibrary.id);
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===1);
    await select('来源库').selectOption('');
    await page.waitForFunction(()=>document.querySelectorAll('.media-grid .media-tile').length===2);
    if(process.env.MEDIA_SMOKE_ALL_LIBRARIES_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_ALL_LIBRARIES_SCREENSHOT});
    await auditPage('all-libraries');
    await select('来源库').selectOption(albumLibrary.id);
    await page.getByRole('link',{name:'打开文件夹',exact:true}).click();
    await page.locator('.media-folders .media-folder-row').first().waitFor();
    assert.ok(new URL(page.url()).hash.includes(albumLibrary.id),'folders open on the selected library');
    const seriesRoot=join(root,'series');await mkdir(seriesRoot);
    for(const episode of ['01','02'])await writeFile(join(seriesRoot,'BrowserDrama.S01E'+episode+'.webm'),Buffer.from(videoBytes));
    await writeFile(join(seriesRoot,'BrowserDrama.S02E01.webm'),Buffer.from(videoBytes));
    const seriesLibrary=await importLibrary('剧集测试','video',seriesRoot);
    const seriesItems=await(await fetch(origin+'/api/v1/media/libraries/'+seriesLibrary.id+'/items?kind=series',{headers})).json();
    assert.equal(seriesItems.items.length,1);
    // Lists are cached for a minute; libraries created through the API appear on a fresh visit.
    await go('#/media/video/series');await page.reload();
    await page.locator('.media-grid .media-tile').filter({hasText:'BrowserDrama'}).waitFor();
    await auditPage('series-home');
    let seasonReadFails=true;
    await page.route('**/items/*/season-playback',async route=>{
      if(seasonReadFails){seasonReadFails=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'暂时无法读取选集，请重试'}})});}
      else await route.continue();
    });
    await page.locator('.media-grid .media-tile').filter({hasText:'BrowserDrama'}).click();
    await page.getByRole('heading',{name:'选集',exact:true}).waitFor();
    await page.locator('.media-season-playback [role=alert]').waitFor();
    assert.equal(await page.locator('.media-episode-grid').count(),0);
    await auditPage('series-read-error',page.locator('.media-season-playback [role=alert]'));
    await page.locator('.media-season-playback').getByRole('button',{name:'重新读取',exact:true}).click();
    await page.locator('.media-episode-grid button').first().waitFor();
    assert.equal(await page.locator('.media-episode-grid button').count(),2,'the first season is shown');
    await select('选择季').selectOption({index:1});
    await page.waitForFunction(()=>document.querySelectorAll('.media-episode-grid button').length===1);
    await select('选择季').selectOption({index:0});
    await page.waitForFunction(()=>document.querySelectorAll('.media-episode-grid button').length===2);
    await auditPage('series-season-picker');
    await auditPage('series-detail');
    const wholeSeriesPlan=await(await fetch(origin+'/api/v1/media/items/'+seriesItems.items[0].id+'/series-playback',{headers})).json();
    const secondSeasonRequest=page.waitForRequest(request=>request.url()===origin+'/api/v1/media/playback'&&request.method()==='POST'&&request.postDataJSON().partId===wholeSeriesPlan.episodes[2].editions[0].parts[0].id);
    await page.getByRole('button',{name:'播放剧集',exact:true}).click();
    await secondSeasonRequest;
    await page.waitForFunction(id=>window.readerApp.player.currentItemId===id,wholeSeriesPlan.episodes[2].id);
    await stopPlayback();
    const seriesDetail=await(await fetch(origin+'/api/v1/media/items/'+seriesItems.items[0].id,{headers})).json();
    const firstSeason=seriesDetail.children.find(item=>item.ordinal===1)??seriesDetail.children[0];
    await go('#/media/video/items/'+firstSeason.id);
    await page.getByRole('heading',{name:'剧集选集',exact:true}).waitFor();
    await page.getByRole('button',{name:'顺序播放 2 集',exact:true}).waitFor();
    assert.equal(await page.locator('.media-season-row').count(),2);
    await auditPage('season-detail');
    const seasonId=firstSeason.id;
    const orderedSeason=await(await fetch(origin+'/api/v1/media/items/'+seasonId+'/season-playback',{headers})).json();
    const nextEpisodeRequest=page.waitForRequest(request=>request.url()===origin+'/api/v1/media/playback'&&request.method()==='POST'&&request.postDataJSON().partId===orderedSeason.episodes[1].editions[0].parts[0].id);
    await page.getByRole('button',{name:'顺序播放 2 集',exact:true}).click();
    await nextEpisodeRequest;
    await page.waitForFunction(id=>window.readerApp.player.currentItemId===id,orderedSeason.episodes[1].id);
    const firstEpisodeProgress=await(await fetch(origin+'/api/v1/media/parts/'+orderedSeason.episodes[0].editions[0].parts[0].id+'/progress',{headers})).json();
    assert.equal(firstEpisodeProgress.completed,true,'episode completion is saved before the next episode');
    await stopPlayback();
    await go('#/media/video/items/'+seasonId);
    await page.locator('.media-season-row>button').nth(1).click();
    await page.getByRole('heading',{name:'单集详情',exact:true}).waitFor();
    await page.getByRole('button',{name:'播放此版本',exact:true}).click();
    await page.waitForFunction(()=>{const v=document.querySelector('.media-player video');return v&&v.currentTime>.1&&v.videoWidth===320&&!v.paused;});
    await stopPlayback();
    let embeddedSubtitleDecoded=false,embeddedCoverDecoded=false;
    if(process.env.MEDIA_SMOKE_FFMPEG){
      const multiRoot=join(root,'multi-audio');await mkdir(multiRoot);
      await runFile(process.env.MEDIA_SMOKE_FFMPEG,['-nostdin','-loglevel','error',
        '-f','lavfi','-i','color=c=black:s=320x180:d=30',
        '-f','lavfi','-i','sine=frequency=440:duration=30:sample_rate=48000',
        '-f','lavfi','-i','sine=frequency=880:duration=30:sample_rate=48000',
        '-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',
        '-metadata:s:a:0','language=zho','-metadata:s:a:1','language=eng',join(multiRoot,'Two Audio Tracks.mp4')],{windowsHide:true,timeout:30000});
      const multiLibrary=await importLibrary('双音轨测试','video',multiRoot);
      const multiItems=await(await fetch(origin+'/api/v1/media/libraries/'+multiLibrary.id+'/items?kind=movie',{headers})).json();
      const openVideoControls=async()=>{if(!new URL(page.url()).hash.includes('/player'))await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.locator('.media-video-tools').waitFor();};
      await go('#/media/video/items/'+multiItems.items[0].id);
      await page.getByRole('button',{name:'播放电影',exact:true}).click();
      await page.waitForFunction(()=>{const video=document.querySelector('.media-player video');return video.currentTime>0&&video.videoWidth===320;});
      await openVideoControls();
      await page.locator('.media-video-tools').getByRole('button',{name:'音轨',exact:true}).click();
      const decoderTrackCount=await page.locator('.media-player video').evaluate(video=>video.audioTracks?.length??0);
      if(decoderTrackCount<2){
        await sheet.getByText('文件包含多个音轨，此浏览器未开放切换；可选择其他版本或设备。',{exact:true}).waitFor();
        assert.equal(await page.locator('select[aria-label="音轨"] option').count(),0,'never fabricate selectable tracks from probe metadata');
      }else{
        assert.equal(await sheet.locator('select[aria-label="音轨"] option').count(),decoderTrackCount);
      }
      console.log(JSON.stringify({multiAudioDecoded:true,decoderTrackCount,unavailableSwitchingExplained:decoderTrackCount<2}));
      await stopPlayback();
      const embeddedRoot=join(root,'embedded-subtitles');await mkdir(embeddedRoot);
      const source=join(root,'embedded.srt');await writeFile(source,'1\n00:00:00,000 --> 00:00:30,000\n内嵌字幕端到端测试\n');
      await runFile(process.env.MEDIA_SMOKE_FFMPEG,['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:d=30','-i',source,'-c:v','libx264','-pix_fmt','yuv420p','-c:s','mov_text','-metadata:s:s:0','language=zho',join(embeddedRoot,'Embedded Subtitle.mp4')],{windowsHide:true,timeout:30000});
      const library=await importLibrary('内嵌字幕测试','video',embeddedRoot);
      const items=await(await fetch(origin+'/api/v1/media/libraries/'+library.id+'/items?kind=movie',{headers})).json();assert.equal(items.items.length,1);
      await go('#/media/video/items/'+items.items[0].id);
      await page.getByRole('button',{name:'播放电影',exact:true}).waitFor();
      await auditPage('movie-detail');
      await workAction('编辑资料');
      const metadataForm=page.locator('form.media-metadata-editor');
      await metadataForm.waitFor();
      await auditPage('movie-metadata',metadataForm);
      // The label names the textarea; once filled, its value joins the accessible name.
      const plot=metadataForm.locator('label').filter({has:page.locator('.media-metadata-field-label',{hasText:/^简介$/})}).locator('textarea');
      await plot.fill('移动端表单验证：保存后的人工简介。');
      await plot.focus();await page.keyboard.press('Tab');
      const metadataSave=metadataForm.getByRole('button',{name:'保存修改',exact:true});
      assert.equal(await metadataSave.evaluate(button=>button===document.activeElement),true,'metadata save follows the final textarea in keyboard order');
      await auditPage('movie-metadata-actions',metadataSave);
      await metadataSave.focus();
      const metadataSaved=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith('/metadata')&&response.status()===200);
      await page.keyboard.press('Enter');await metadataSaved;
      const savedMetadata=await(await fetch(origin+'/api/v1/media/items/'+items.items[0].id,{headers})).json();
      assert.equal(savedMetadata.overrides.plot,'移动端表单验证：保存后的人工简介。','keyboard submission persists metadata');
      await page.getByRole('button',{name:'返回作品详情',exact:true}).click();
      await page.getByRole('button',{name:'播放电影',exact:true}).click();
      await page.waitForFunction(()=>{const video=document.querySelector('.media-player video');return video.currentTime>0&&video.videoWidth===320;});
      await openVideoControls();
      await page.locator('.media-video-tools').getByRole('button',{name:'字幕',exact:true}).click();
      await subtitleOption('zho').click();
      await page.waitForFunction(()=>Array.from(document.querySelector('.media-player video').textTracks).some(track=>track.mode==='showing'&&Array.from(track.activeCues||[]).some(cue=>cue.text==='内嵌字幕端到端测试')));
      await subtitleOption('关闭').click();
      await page.waitForFunction(()=>document.querySelectorAll('.media-player video track').length===0);
      embeddedSubtitleDecoded=true;await stopPlayback();
      const coverRoot=join(root,'embedded-cover');await mkdir(coverRoot);
      const image=join(root,'embedded-art.png');
      await runFile(process.env.MEDIA_SMOKE_FFMPEG,['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1',image],{windowsHide:true,timeout:30000});
      await runFile(process.env.MEDIA_SMOKE_FFMPEG,['-nostdin','-loglevel','error','-f','lavfi','-i','sine=duration=30','-i',image,'-map','0:a','-map','1:v','-c:a','libmp3lame','-c:v','copy','-disposition:v','attached_pic','-metadata','album=内嵌封面专辑',join(coverRoot,'Embedded Cover.mp3')],{windowsHide:true,timeout:30000});
      const coverLibrary=await importLibrary('内嵌封面测试','music',coverRoot);
      const albums=await(await fetch(origin+'/api/v1/media/libraries/'+coverLibrary.id+'/items?kind=album',{headers})).json();assert.equal(albums.items.length,1);
      assert.ok(albums.items[0].metadata.embeddedCoverAssetId);
      await go('#/media/music/items/'+albums.items[0].id);
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.media-cover img')).some(img=>img.complete&&img.naturalWidth===32&&img.naturalHeight===32));
      embeddedCoverDecoded=true;
    }
    const audiobookRoot=join(root,'audiobooks'),bookFolder=join(audiobookRoot,'浏览器有声作品');await mkdir(bookFolder,{recursive:true});
    if(process.env.MEDIA_SMOKE_FFMPEG){
      assert.ok(process.env.MEDIA_FFPROBE_PATH,'embedded chapter mode requires an explicit ffprobe');
      const input=join(root,'chapter-input.wav'),metadata=join(root,'chapters.txt');
      await writeFile(input,wav);
      await writeFile(metadata,';FFMETADATA1\nalbum=浏览器有声作品\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=15000\ntitle=01\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=15000\nEND=30000\ntitle=02\n');
      await runFile(process.env.MEDIA_SMOKE_FFMPEG,['-hide_banner','-loglevel','error','-y','-i',input,'-i',metadata,'-map','0:a','-map_metadata','1','-map_chapters','1','-c:a','aac','-b:a','64k',join(bookFolder,'book.m4b')],{windowsHide:true,timeout:30000});
    }else for(const chapter of ['01','02'])await writeFile(join(bookFolder,chapter+'.wav'),wav);
    await writeFile(join(bookFolder,'audiobook.nfo'),'<audiobook><narrator>浏览器演播者</narrator></audiobook>');
    const audiobookLibrary=await importLibrary('有声书测试','audiobook',audiobookRoot);
    const bookItems=await(await fetch(origin+'/api/v1/media/libraries/'+audiobookLibrary.id+'/items?kind=audiobook',{headers})).json();
    assert.equal(bookItems.items.length,1);
    const bookDetail=await(await fetch(origin+'/api/v1/media/items/'+bookItems.items[0].id,{headers})).json();
    assert.equal(bookDetail.editions.length,1);assert.equal(bookDetail.editions[0].parts.length,2);
    const chapters=bookDetail.editions[0].parts;assert.deepEqual(chapters.map(p=>p.title),['01','02']);
    if(process.env.MEDIA_SMOKE_FFMPEG){assert.equal(chapters[0].assetId,chapters[1].assetId);assert.equal(chapters[0].end,15);assert.equal(chapters[1].start,15);assert.equal(chapters[1].end,30);}
    const startedParts=[];page.on('request',request=>{if(request.url()===origin+'/api/v1/media/playback'&&request.method()==='POST')startedParts.push(request.postDataJSON().partId);});
    await go('#/media/audiobook');await page.reload();
    await page.locator('.media-grid .media-tile').first().waitFor();
    await auditPage('audiobook-home');
    await page.getByRole('link',{name:'打开文件夹',exact:true}).click();
    await page.locator('.media-folders .media-folder-row button').filter({hasText:'浏览器有声作品'}).click();
    await page.locator('.media-folders .media-folder-row button').first().click();
    await page.locator('.media-folders .media-folder-file').waitFor();
    assert.equal(await page.locator('.media-folder-work').count(),1,'the file belongs to one work');
    assert.equal(await page.locator('.media-folder-work .media-row').count(),process.env.MEDIA_SMOKE_FFMPEG?2:1,'the file shows only its own chapters');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.MEDIA_SMOKE_FOLDER_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_FOLDER_SCREENSHOT});
    await auditPage('folder');
    await go('#/media/audiobook/narrators');
    const narratorTile=page.locator('.media-person-tile').filter({hasText:'浏览器演播者'});
    await narratorTile.waitFor();
    await auditPage('narrator-list');
    await narratorTile.click();
    // Opening a narrator must not surface its own replaced request as an error.
    const narratorWork=page.locator('[aria-label="演播者浏览"] .media-tile'),narratorError=page.locator('.media-narrators [role=alert]');
    await narratorWork.or(narratorError).first().waitFor();
    if(await narratorError.count()){regressions.push('opening a narrator shows an error: '+(await narratorError.innerText()).replace(/\s+/g,' '));await narratorError.getByRole('button',{name:'重新加载',exact:true}).click();}
    await narratorWork.click();
    await page.getByText('浏览器演播者参与的版本',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.MEDIA_SMOKE_NARRATOR_SCREENSHOT)await page.screenshot({path:process.env.MEDIA_SMOKE_NARRATOR_SCREENSHOT});
    await auditPage('narrator');
    await page.getByRole('button',{name:'播放此版本',exact:true}).click();
    await page.waitForFunction(()=>{const audio=document.querySelector('.media-player audio');return audio&&!audio.paused&&audio.currentTime>.1;});
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    await page.getByRole('button',{name:'← 返回浏览',exact:true}).click();
    await page.locator('.media-narrators[data-view="work"]').waitFor();
    await page.getByText('浏览器演播者参与的版本',{exact:true}).waitFor();
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    await stopPlayback();
    assert.deepEqual(startedParts,[chapters[0].id],'narrator playback starts only the selected version');
    startedParts.length=0; // The following assertion covers a separate full-detail chapter run.
    await page.goBack();
    await page.getByRole('button',{name:'完整作品详情',exact:true}).click();
    await page.getByRole('heading',{name:'有声书详情',exact:true}).waitFor();
    await page.locator('.media-hero h1').waitFor();
    await auditPage('audiobook-detail');
    await page.getByRole('button',{name:'开始收听',exact:true}).click();
    await page.waitForFunction(()=>{const a=document.querySelector('.media-player audio');return a.currentTime>.1&&!a.paused;});
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    // Let playback cross the chapter boundary (which may precede the file end).
    await page.locator('.media-player audio').evaluate((a,end)=>{a.currentTime=(end??a.duration)-.3;},chapters[0].end);
    await page.waitForFunction(()=>document.querySelector('.media-playing-chapter')?.textContent.includes('第 2 / 2 章'));
    assert.deepEqual(startedParts,[chapters[0].id,chapters[1].id]);
    await page.waitForFunction(start=>{const a=document.querySelector('.media-player audio');return a.currentTime>start+.2&&!a.paused;},chapters[1].start);
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.evaluate(()=>window.readerApp.flush());
    const firstChapter=await(await fetch(origin+'/api/v1/media/parts/'+chapters[0].id+'/progress',{headers})).json();
    const secondChapter=await(await fetch(origin+'/api/v1/media/parts/'+chapters[1].id+'/progress',{headers})).json();
    assert.equal(firstChapter.completed,true);assert.ok(secondChapter.position>chapters[1].start);assert.equal(secondChapter.completed,false);
    const chapterPosition=page.getByRole('slider',{name:'当前章节播放位置',exact:true});
    assert.equal(await chapterPosition.getAttribute('min'),'0');
    assert.equal(await chapterPosition.getAttribute('max'),String(chapters[1].end-chapters[1].start));
    await chapterPosition.fill('5');await chapterPosition.dispatchEvent('change');
    await page.waitForFunction(start=>Math.abs(document.querySelector('.media-player audio').currentTime-(start+5))<.2,chapters[1].start);
    assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.controls),false);
    await auditPage('audiobook-player');
    await page.getByRole('button',{name:'全部章节',exact:true}).click();
    const chapterList=page.locator('section.media-audiobook-chapters');
    await chapterList.locator('.media-row').first().waitFor();
    assert.equal(await chapterList.locator('.media-row').count(),2);
    assert.ok((await chapterList.locator('[aria-current=true]').textContent()).includes('02'));
    await page.getByRole('button',{name:'← 返回播放',exact:true}).click();
    await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await sheet.getByRole('button',{name:'上一首 / 章',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-playing-chapter')?.textContent.includes('第 1 / 2 章'));
    await sheet.getByRole('button',{name:'下一首 / 章',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-playing-chapter')?.textContent.includes('第 2 / 2 章'));
    assert.equal(await sheet.getByRole('button',{name:'下一首 / 章',exact:true}).isDisabled(),true);
    await sheet.getByRole('button',{name:'播放队列',exact:true}).click();
    const playlist=page.locator('.media-current-playlist');
    await playlist.waitFor();
    const playlistMenu=async label=>{await page.getByRole('button',{name:'队列操作',exact:true}).click();await page.getByRole('menu',{name:'队列操作'}).getByRole('menuitem',{name:label,exact:true}).click();};
    await playlistMenu('查找曲目');
    await page.getByLabel('查找曲目或章节',{exact:true}).fill('01');
    assert.equal(await playlist.locator('li').count(),1);
    await playlist.locator('.media-playlist-select').click();
    await page.waitForFunction(()=>document.querySelector('.media-current-playlist [aria-current=true]')?.textContent.includes('01'));
    await page.getByRole('button',{name:'定位当前播放',exact:true}).click();
    assert.equal(await page.getByLabel('查找曲目或章节',{exact:true}).inputValue(),'');
    assert.equal(await playlist.locator('li').count(),2);
    assert.equal(await playlist.locator('[aria-current="true"]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await playlist.locator('.media-playlist-select').nth(1).click();
    await page.waitForFunction(()=>document.querySelector('.media-current-playlist [aria-current=true]')?.textContent.includes('02'));
    const jumpedChapter=await(await fetch(origin+'/api/v1/media/parts/'+chapters[0].id+'/progress',{headers})).json();
    assert.equal(jumpedChapter.completed,false,'manual playlist jump does not complete the outgoing chapter');
    // Start the edits early in the chapter, so it is still playing when they are checked.
    await page.locator('.media-player audio').evaluate((audio,start)=>{audio.currentTime=start+.5;},chapters[1].start);
    const sourceBeforeEdit=await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc);
    // The list must show an edit as soon as the player applies it; reopening the panel is the fallback.
    const playlistShows=async(check,message)=>{
      try{await page.waitForFunction(check,undefined,{timeout:3000});}
      catch{
        regressions.push(message+': '+JSON.stringify(await page.evaluate(()=>({shown:Array.from(document.querySelectorAll('.media-current-playlist li strong')).map(node=>node.textContent),player:window.readerApp.player.currentPlaylist.map(entry=>entry.title)}))));
        await page.getByRole('button',{name:'← 返回播放',exact:true}).click();
        await page.getByRole('button',{name:'更多播放选项',exact:true}).click();await sheet.getByRole('button',{name:'播放队列',exact:true}).click();
        await playlist.waitFor();await page.waitForFunction(check);
      }
    };
    await playlistMenu('编辑队列');
    await playlist.locator('li').nth(1).getByRole('button',{name:/^上移 /}).click();
    await playlistShows(()=>document.querySelector('.media-current-playlist li:first-child .media-playlist-select')?.getAttribute('aria-current')==='true','moving a playlist entry updates the current playlist');
    if(!await playlist.locator('.media-playlist-remove').count())await playlistMenu('编辑队列');
    await playlist.locator('li').nth(1).getByRole('button',{name:/^移除 /}).click();
    await playlistShows(()=>document.querySelectorAll('.media-current-playlist li').length===1,'removing a playlist entry updates the current playlist');
    assert.equal(await playlist.locator('[aria-current="true"]').count(),1,'the remaining current track stays visible');
    assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc),sourceBeforeEdit);
    assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.paused),false,'editing preserves active playback');
    await page.getByRole('button',{name:'← 返回播放',exact:true}).click();
    await page.locator('.media-playing-artwork').waitFor();
    assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc),sourceBeforeEdit,'returning to playback preserves the media session');
    await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await sheet.getByRole('button',{name:'保存为待播队列',exact:true}).click();
    await sheet.getByRole('button',{name:'确认保存队列',exact:true}).click();
    await sheet.getByText('已保存，可在“更多 → 队列”中继续播放。',{exact:true}).waitFor();
    const savedLiveQueue=await(await fetch(origin+'/api/v1/media/queue',{headers})).json();
    assert.deepEqual(savedLiveQueue.items.filter(entry=>entry.kind==='audiobook').map(entry=>entry.partId),[chapters[1].id]);
    assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc),sourceBeforeEdit);
    await sheet.locator('.sheet-close').click();

    await stopPlayback();
    await go('#/media/audiobook/items/'+bookItems.items[0].id);
    await page.getByRole('heading',{name:'有声书详情',exact:true}).waitFor();
    // The detail's chapter preview starts a chapter directly, resuming its saved position.
    await page.locator('.media-edition .media-row').filter({hasText:'02'}).getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(position=>{const a=document.querySelector('.media-player audio');return !a.paused&&a.currentTime>=position;},secondChapter.position);
    await stopPlayback();
    const assignmentRoot=join(root,'assignment');await mkdir(assignmentRoot);
    for(const name of ['Source','Target'])await writeFile(join(assignmentRoot,name+'.webm'),Buffer.from(videoBytes));
    const assignmentLibrary=await importLibrary('版本归属测试','video',assignmentRoot);
    const assignmentItems=await(await fetch(origin+'/api/v1/media/libraries/'+assignmentLibrary.id+'/items?kind=movie',{headers})).json();
    const sourceItem=assignmentItems.items.find(item=>item.title==='Source'),targetItem=assignmentItems.items.find(item=>item.title==='Target');
    assert.ok(sourceItem);assert.ok(targetItem);
    const sourceBefore=await(await fetch(origin+'/api/v1/media/items/'+sourceItem.id,{headers})).json();
    // 结构整理 (admin, from the detail's ⋯ menu for episodes/tracks; reachable by address for every work) lists each version's tools.
    const editionCard=label=>page.locator('.media-manager-card').filter({has:page.getByRole('heading',{name:label,exact:true,level:4})});
    const openTool=async(card,tool)=>{const admin=card.locator('details.media-edition-admin');if(!await admin.evaluate(node=>node.open))await admin.locator(':scope > summary').click();const details=admin.locator('details').filter({has:page.locator(':scope > summary',{hasText:tool})});if(!await details.evaluate(node=>node.open))await details.locator(':scope > summary').click();return details;};
    await go('#/media/video/items/'+sourceItem.id+'/structure');await page.reload();
    await page.getByRole('heading',{name:'结构整理',exact:true}).waitFor();
    const sourceCard=editionCard(sourceBefore.editions[0].label);
    await sourceCard.locator('details.media-edition-admin>summary').click();
    await auditPage('edition-management');
    await openTool(sourceCard,'纠正版本归属');
    await sourceCard.locator('.media-edition-assignment .media-row').filter({hasText:'Target'}).getByRole('button',{name:'选择此作品',exact:true}).click();
    await page.getByRole('region',{name:'确认版本归属'}).waitFor();
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+sourceItem.id,{headers})).json()).editions.length,1,'preview must not mutate assignment');
    await page.getByRole('button',{name:'确认修改归属',exact:true}).click();
    await page.locator('.media-hero h1').filter({hasText:'Target'}).waitFor();
    const targetAfter=await(await fetch(origin+'/api/v1/media/items/'+targetItem.id,{headers})).json();
    assert.equal(targetAfter.editions.length,2);
    assert.deepEqual(targetAfter.editions.find(edition=>edition.id===sourceBefore.editions[0].id).parts,sourceBefore.editions[0].parts);
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+sourceItem.id,{headers})).json()).editions.length,0);
    for(const edition of targetAfter.editions){
      const response=await fetch(origin+'/api/v1/media/editions/'+edition.id,{method:'PATCH',headers,body:JSON.stringify({label:edition.id===sourceBefore.editions[0].id?'待合并版本':'保留版本',expectedLabel:edition.label})});
      assert.equal(response.status,200);
    }
    // A work with two versions offers the choice on its detail page.
    await page.evaluate(()=>window.readerApp.api.refreshQueries());await page.reload();
    await workAction('版本管理');
    assert.deepEqual((await select('播放版本',sheet).locator('option').allTextContents()).sort(),['保留版本','待合并版本'].sort());
    await sheet.locator('.sheet-close').click();
    await go('#/media/video/items/'+targetItem.id+'/structure');
    const mergeCard=editionCard('待合并版本');
    await mergeCard.waitFor();
    const mergeTool=await openTool(mergeCard,'拆分或合并版本');
    await select('整理方式',mergeTool).selectOption('merge');
    const keepId=targetAfter.editions.find(edition=>edition.id!==sourceBefore.editions[0].id).id;
    await select('目标版本',mergeTool).selectOption(keepId);
    await mergeTool.getByRole('button',{name:'预览整理结果',exact:true}).click();
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+targetItem.id,{headers})).json()).editions.length,2);
    await mergeTool.getByRole('button',{name:'确认整理',exact:true}).click();
    // After a version write the page shows the server's result; a reload is the fallback.
    const showsWrite=async(wait,message)=>{try{await wait(5000);}catch{regressions.push(message);await page.evaluate(()=>window.readerApp.api.refreshQueries());await page.reload();await wait(30000);}};
    await showsWrite(timeout=>mergeCard.waitFor({state:'detached',timeout}),'merging a version updates 结构整理 (cached item detail is not invalidated by /media/editions/* writes)');
    const merged=await(await fetch(origin+'/api/v1/media/items/'+targetItem.id,{headers})).json();assert.equal(merged.editions.length,1);assert.equal(merged.editions[0].parts.length,2);
    const keptCard=editionCard('保留版本');
    const ordering=(await openTool(keptCard,'调整章节顺序')).getByRole('region',{name:'章节排序',exact:true});
    await ordering.getByRole('button',{name:'下移 '+merged.editions[0].parts[0].title,exact:true}).click();
    const savedOrder=page.waitForResponse(response=>response.url().endsWith('/editions/'+keepId+'/order')&&response.request().method()==='PUT');
    await ordering.getByRole('button',{name:'保存章节顺序',exact:true}).click();
    assert.equal((await savedOrder).status(),200);
    const reordered=await(await fetch(origin+'/api/v1/media/items/'+targetItem.id,{headers})).json();
    assert.deepEqual(reordered.editions[0].parts.map(part=>part.id),merged.editions[0].parts.map(part=>part.id).reverse());
    await showsWrite(async timeout=>{if(!await keptCard.getByRole('region',{name:'章节排序',exact:true}).count())await openTool(keptCard,'调整章节顺序');await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="章节排序"] button')).some(button=>button.textContent==='保存章节顺序'&&button.disabled),undefined,{timeout});},'saving the chapter order shows it as saved');
    const splitter=await openTool(keptCard,'拆分或合并版本');
    await splitter.getByLabel('新版本名称',{exact:true}).fill('拆出版本');
    await splitter.getByRole('region',{name:'拆分或合并版本',exact:true}).getByRole('checkbox').first().check();
    await splitter.getByRole('button',{name:'预览整理结果',exact:true}).click();
    await splitter.getByRole('button',{name:'确认整理',exact:true}).click();
    await showsWrite(timeout=>editionCard('拆出版本').waitFor({timeout}),'splitting a version updates 结构整理');
    const split=await(await fetch(origin+'/api/v1/media/items/'+targetItem.id,{headers})).json();assert.equal(split.editions.length,2);
    assert.deepEqual(new Set(split.editions.flatMap(edition=>edition.parts.map(part=>part.id))),new Set(merged.editions[0].parts.map(part=>part.id)));
    const assignment=await openTool(editionCard('拆出版本'),'纠正版本归属');
    await assignment.getByText('目标作品不存在？新建作品',{exact:true}).click();
    await assignment.getByLabel('新作品标题',{exact:true}).fill('人工新建电影');
    await assignment.getByRole('button',{name:'预览新建作品',exact:true}).click();
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+targetItem.id,{headers})).json()).editions.length,2);
    await assignment.getByRole('button',{name:'确认新建并关联',exact:true}).click();
    await page.locator('.media-hero h1').filter({hasText:'人工新建电影'}).waitFor();
    const createdItemId=await page.evaluate(()=>decodeURIComponent(location.hash.split('/').at(-1)));
    const createdItem=await(await fetch(origin+'/api/v1/media/items/'+createdItemId,{headers})).json();
    assert.equal(createdItem.title,'人工新建电影');
    assert.deepEqual(createdItem.editions[0].parts,split.editions.find(edition=>edition.label==='拆出版本').parts);
    await page.reload();await page.locator('.media-hero h1').filter({hasText:'人工新建电影'}).waitFor();
    await auditPage('new-work');
    // A committed library must survive failure of the separate scan request.
    const createRoot=join(root,'create-recovery');await mkdir(createRoot);
    await channelMenu('媒体库管理');
    await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
    const librariesBefore=(await(await fetch(origin+'/api/v1/media/libraries',{headers})).json()).items.length;
    const creationRequestIds=[];
    const loseCreationResponse=async route=>{
      if(route.request().method()!=='POST')return route.continue();
      creationRequestIds.push(route.request().postDataJSON().requestId);
      const response=await route.fetch();assert.equal(response.status(),201);
      if(creationRequestIds.length===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'模拟创建响应丢失'}})});
      await route.fulfill({response});
    };
    await page.route(origin+'/api/v1/media/libraries',loseCreationResponse);
    const failNewScan=async route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'模拟扫描提交失败'}})});
    await page.route('**/api/v1/media/libraries/*/scan',failNewScan);
    await page.getByRole('button',{name:'新建媒体库',exact:true}).first().click();
    await page.getByRole('heading',{name:'新建媒体库',exact:true}).waitFor();
    const creator=page.locator('.media-library-create');
    assert.equal(await select('内容类型',creator).inputValue(),'music','a library created from a channel defaults to that channel');
    await creator.getByLabel('名称',{exact:true}).fill('创建恢复验证');
    await creator.getByLabel('服务器目录',{exact:true}).fill(createRoot);
    await creator.getByRole('button',{name:'创建并扫描',exact:true}).click();
    await creator.getByText('模拟创建响应丢失',{exact:true}).waitFor();
    assert.equal((await(await fetch(origin+'/api/v1/media/libraries',{headers})).json()).items.length,librariesBefore+1);
    await creator.getByRole('button',{name:'创建并扫描',exact:true}).click();
    await creator.getByText('模拟扫描提交失败',{exact:true}).waitFor();
    assert.equal(creationRequestIds.length,2);assert.ok(creationRequestIds[0]);assert.equal(creationRequestIds[0],creationRequestIds[1]);
    await page.unroute(origin+'/api/v1/media/libraries',loseCreationResponse);
    await creator.getByRole('alert').waitFor();
    assert.ok((await creator.textContent()).includes('已创建'));
    assert.equal(await creator.locator('form').count(),0);
    await auditPage('library-created-scan-error',creator);
    const librariesCreated=(await(await fetch(origin+'/api/v1/media/libraries',{headers})).json()).items;
    assert.equal(librariesCreated.length,librariesBefore+1);
    const createdLibrary=librariesCreated.find(item=>item.name==='创建恢复验证');assert.ok(createdLibrary);
    await page.unroute('**/api/v1/media/libraries/*/scan',failNewScan);
    await creator.getByRole('button',{name:'启动此库扫描',exact:true}).click();
    await page.getByText('重新读取「创建恢复验证」的目录并更新索引。',{exact:true}).waitFor();
    await page.locator('.media-scan-jobs .media-task-copy').first().waitFor();
    assert.equal((await(await fetch(origin+'/api/v1/media/libraries',{headers})).json()).items.length,librariesBefore+1);
    assert.equal((await(await fetch(origin+`/api/v1/media/libraries/${createdLibrary.id}/jobs`,{headers})).json()).items.length,1);
    const organizeRoot=join(root,'music-parenting');await mkdir(organizeRoot);
    for(const name of ['甲','乙']){
      await mkdir(join(organizeRoot,name));await writeFile(join(organizeRoot,name,'tone.wav'),wav);
      await writeFile(join(organizeRoot,name,'tone.nfo'),`<album><title>${name}曲目</title><album>${name}专辑</album><artist>${name}歌手</artist></album>`);
    }
    const organizeLibrary=await importLibrary('音乐归属测试','music',organizeRoot);
    const organizeTracks=(await(await fetch(origin+`/api/v1/media/libraries/${organizeLibrary.id}/items?kind=track`,{headers})).json()).items;
    const sourceTrack=organizeTracks.find(item=>item.title==='甲曲目'),targetTrack=organizeTracks.find(item=>item.title==='乙曲目');assert.ok(sourceTrack&&targetTrack);
    const beforeParent=await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json();
    // 结构整理 is in the track's ⋯ menu.
    await go('#/media/music/items/'+sourceTrack.id);
    await page.getByRole('heading',{name:'曲目详情',exact:true}).waitFor();
    await workAction('结构整理');
    await page.getByRole('heading',{name:'结构整理',exact:true}).waitFor();
    await page.getByRole('button',{name:'调整所属专辑',exact:true}).click();
    const parentEditor=page.locator('.media-parent-editor').filter({has:page.getByRole('heading',{name:'调整所属专辑',exact:true})});
    await parentEditor.getByRole('button',{name:'预览新建专辑',exact:true}).waitFor();
    await auditPage('music-parent-select',parentEditor.locator('form').last());
    await parentEditor.locator('.media-row').filter({hasText:'乙专辑'}).getByRole('button',{name:'选择',exact:true}).click();
    await auditPage('music-parent-preview',parentEditor.locator('.media-parent-preview'));
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json()).parentId,sourceTrack.parentId,'preview does not mutate parent');
    await parentEditor.getByRole('button',{name:'确认调整归属',exact:true}).click();
    const parentToggle=page.locator('.media-parent-editor').getByRole('button',{name:'调整所属专辑',exact:true});
    await parentToggle.waitFor();
    const afterParent=await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json();
    assert.equal(afterParent.parentId,targetTrack.parentId);
    assert.deepEqual(afterParent.editions,beforeParent.editions,'moving a track does not rebuild editions or parts');
    const staleParent=await fetch(origin+'/api/v1/media/items/'+sourceTrack.id+'/parent',{method:'PUT',headers,body:JSON.stringify({targetParentId:sourceTrack.parentId,expectedParentId:sourceTrack.parentId})});assert.equal(staleParent.status,409);
    await parentToggle.click();
    await parentEditor.getByRole('textbox',{name:'新建专辑名称',exact:true}).fill('人工整理专辑');
    await parentEditor.getByRole('button',{name:'预览新建专辑',exact:true}).click();
    await auditPage('music-parent-create',parentEditor.locator('.media-parent-preview'));
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json()).parentId,targetTrack.parentId);
    await parentEditor.getByRole('button',{name:'取消新建',exact:true}).click();
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json()).parentId,targetTrack.parentId);
    await parentEditor.getByRole('button',{name:'预览新建专辑',exact:true}).click();
    await parentEditor.getByRole('button',{name:'确认新建并调整归属',exact:true}).click();
    await parentToggle.waitFor();
    const createdParentTrack=await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json();
    const createdParent=await(await fetch(origin+'/api/v1/media/items/'+createdParentTrack.parentId,{headers})).json();
    assert.equal(createdParent.title,'人工整理专辑');assert.deepEqual(createdParentTrack.editions,beforeParent.editions);
    const staleCreate=await fetch(origin+'/api/v1/media/items/'+sourceTrack.id+'/parent',{method:'POST',headers,body:JSON.stringify({title:'人工整理专辑',expectedParentId:targetTrack.parentId})});assert.equal(staleCreate.status,409);
    await parentToggle.click();
    await parentEditor.getByRole('textbox',{name:'新建专辑名称',exact:true}).fill('冲突时不应创建的专辑');
    await parentEditor.getByRole('button',{name:'预览新建专辑',exact:true}).click();
    const concurrentMove=await fetch(origin+'/api/v1/media/items/'+sourceTrack.id+'/parent',{method:'PUT',headers,body:JSON.stringify({targetParentId:targetTrack.parentId,expectedParentId:createdParentTrack.parentId})});assert.equal(concurrentMove.status,200);
    await parentEditor.getByRole('button',{name:'确认新建并调整归属',exact:true}).click();
    await parentEditor.getByRole('button',{name:'刷新当前归属',exact:true}).waitFor();
    await auditPage('music-parent-conflict',parentEditor.locator('[role="status"]'));
    assert.equal(await parentEditor.getByRole('button',{name:/^(预览新建专辑|确认新建并调整归属)$/}).isDisabled(),true,'a conflict blocks saving until refreshed');
    await parentEditor.getByRole('button',{name:'刷新当前归属',exact:true}).click();
    await parentEditor.getByRole('button',{name:'刷新当前归属',exact:true}).waitFor({state:'detached'});
    const afterConflictAlbums=(await(await fetch(origin+`/api/v1/media/libraries/${organizeLibrary.id}/items?kind=album`,{headers})).json()).items;
    assert.equal(afterConflictAlbums.some(item=>item.title==='冲突时不应创建的专辑'),false);
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+sourceTrack.id,{headers})).json()).parentId,targetTrack.parentId);
    const episodeToMove=await(await fetch(origin+'/api/v1/media/items/'+wholeSeriesPlan.episodes[0].id,{headers})).json();
    const seriesBefore=await(await fetch(origin+'/api/v1/media/items/'+seriesItems.items[0].id,{headers})).json();
    const destinationSeason=seriesBefore.children.find(item=>item.ordinal===2);assert.ok(destinationSeason);
    await go('#/media/video/items/'+episodeToMove.id);
    await page.getByRole('heading',{name:'单集详情',exact:true}).waitFor();
    await workAction('结构整理');
    await page.getByRole('heading',{name:'结构整理',exact:true}).waitFor();
    await page.getByRole('button',{name:'调整归属与集号',exact:true}).click();
    await page.getByRole('button',{name:'选择剧集',exact:true}).click();
    await select('目标季').selectOption(destinationSeason.id);
    await page.getByRole('spinbutton',{name:'集号',exact:true}).fill('2');
    await auditPage('video-hierarchy-select',page.getByRole('spinbutton',{name:'集号',exact:true}));
    await page.getByRole('button',{name:'预览季集整理',exact:true}).click();
    await auditPage('video-hierarchy-preview',page.locator('.media-parent-preview'));
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+episodeToMove.id,{headers})).json()).parentId,episodeToMove.parentId);
    await page.getByRole('button',{name:'确认季集整理',exact:true}).click();
    await page.getByRole('button',{name:'调整归属与集号',exact:true}).waitFor();
    const movedEpisode=await(await fetch(origin+'/api/v1/media/items/'+episodeToMove.id,{headers})).json();
    assert.equal(movedEpisode.parentId,destinationSeason.id);assert.equal(movedEpisode.ordinal,2);
    assert.deepEqual(movedEpisode.editions,episodeToMove.editions);
    const staleHierarchy=await fetch(origin+'/api/v1/media/items/'+episodeToMove.id+'/hierarchy',{method:'PUT',headers,body:JSON.stringify({targetParentId:destinationSeason.id,ordinal:3,expectedParentId:episodeToMove.parentId,expectedOrdinal:episodeToMove.ordinal})});assert.equal(staleHierarchy.status,409);
    await page.getByRole('button',{name:'调整归属与集号',exact:true}).click();
    if(await page.getByRole('button',{name:'重新选择剧集',exact:true}).count())await page.getByRole('button',{name:'重新选择剧集',exact:true}).click();
    await page.getByRole('button',{name:'新建剧集并整理',exact:true}).click();
    await page.getByRole('textbox',{name:'新剧集名称',exact:true}).fill('人工整理剧集');
    await page.getByRole('spinbutton',{name:'新季号',exact:true}).fill('0');
    await page.getByRole('button',{name:'预览新建归属',exact:true}).click();
    await auditPage('video-hierarchy-create',page.locator('.media-parent-preview'));
    assert.equal((await(await fetch(origin+'/api/v1/media/items/'+episodeToMove.id,{headers})).json()).parentId,destinationSeason.id);
    await page.getByRole('button',{name:'确认季集整理',exact:true}).click();
    await page.getByRole('button',{name:'调整归属与集号',exact:true}).waitFor();
    const newHierarchyEpisode=await(await fetch(origin+'/api/v1/media/items/'+episodeToMove.id,{headers})).json();
    const newHierarchySeason=await(await fetch(origin+'/api/v1/media/items/'+newHierarchyEpisode.parentId,{headers})).json();
    const newHierarchyShow=await(await fetch(origin+'/api/v1/media/items/'+newHierarchySeason.parentId,{headers})).json();
    assert.equal(newHierarchySeason.ordinal,0);assert.equal(newHierarchyShow.title,'人工整理剧集');assert.deepEqual(newHierarchyEpisode.editions,episodeToMove.editions);
    await go('#/media/music');await page.reload();
    await channelMenu('收藏');
    await page.getByRole('heading',{name:'我的收藏',exact:true}).waitFor();
    await page.locator('.media-favorite-row').first().waitFor();
    await auditPage('favorites-populated');
    await channelMenu('历史');
    await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();
    await page.locator('.media-history-row').first().waitFor();
    await auditPage('history-populated');
    const missingRoot=join(root,'missing-recovery');await mkdir(missingRoot);const missingFile=join(missingRoot,'recover.wav');await writeFile(missingFile,wav);
    const missingLibrary=await importLibrary('资源恢复测试','music',missingRoot);
    const missingTrack=(await(await fetch(origin+`/api/v1/media/libraries/${missingLibrary.id}/items?kind=track`,{headers})).json()).items[0];
    const rescanMissing=async()=>{
      const response=await fetch(origin+`/api/v1/media/libraries/${missingLibrary.id}/scan`,{method:'POST',headers,body:'{}'});assert.equal(response.status,202);const job=await response.json();
      let state;for(let i=0;i<300;i++){state=await(await fetch(origin+'/api/v1/media/jobs/'+job.id,{headers})).json();if(state.state!=='running')break;await delay(100);}assert.equal(state.state,'complete');
    };
    const missingBefore=await(await fetch(origin+'/api/v1/media/items/'+missingTrack.id,{headers})).json();
    await rm(missingFile);await rescanMissing();
    await go('#/media/music/items/'+missingTrack.id);
    const missingState=page.locator('.media-missing-edition');
    const refreshMissing=missingState.getByRole('button',{name:'刷新资源状态',exact:true});await refreshMissing.waitFor();
    assert.equal(await page.getByRole('button',{name:'播放音频',exact:true}).count(),0,'a missing file offers no playback');
    await auditPage('resource-missing',missingState);
    await writeFile(missingFile,wav);await rescanMissing();
    await refreshMissing.click();
    await showsWrite(timeout=>page.getByRole('button',{name:'播放音频',exact:true}).waitFor({timeout}),'刷新资源状态 reads the restored file (the cached item detail is returned instead)');
    assert.equal(await missingState.count(),0);
    const missingAfter=await(await fetch(origin+'/api/v1/media/items/'+missingTrack.id,{headers})).json();
    assert.deepEqual(missingAfter.editions.map(e=>e.parts.map(p=>p.id)),missingBefore.editions.map(e=>e.parts.map(p=>p.id)));
    const invalidRoot=join(root,'invalid-playback');await mkdir(invalidRoot);await writeFile(join(invalidRoot,'invalid.mp3'),'This is deliberately not a decodable audio file.');
    const invalidLibrary=await importLibrary('无法解码测试','music',invalidRoot);
    const invalidTrack=(await(await fetch(origin+`/api/v1/media/libraries/${invalidLibrary.id}/items?kind=track`,{headers})).json()).items[0];
    await go('#/media/music/items/'+invalidTrack.id);
    await page.getByRole('button',{name:'播放音频',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.media-player audio')?.error?.code===4);
    await page.getByRole('button',{name:'打开播放控制',exact:true}).click();
    const unsupportedMessage=page.locator('.media-playback-problem');
    await unsupportedMessage.filter({hasText:'当前设备无法直接播放'}).waitFor();
    assert.ok((await unsupportedMessage.textContent()).includes('当前不提供转码'));
    assert.ok(await unsupportedMessage.evaluate(element=>{const box=element.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}),'playback failure is visible on entry without scrolling');
    await auditPage('playback-unsupported');
    await stopPlayback();
    await go('#/media/music/items/'+invalidTrack.id);
    await page.getByRole('button',{name:'播放音频',exact:true}).waitFor();
    assert.equal(await page.locator('.media-player').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    if(regressions.length)console.error(JSON.stringify({regressions},null,2));
    assert.deepEqual(regressions,[],'media smoke regressions');
    if(visualDir){await writeFile(join(visualDir,'verification.json'),JSON.stringify({complete:true,checks:visualChecks,browserErrors:errors},null,2));}
    console.log(JSON.stringify({passed:true,editionAssignment:true,realAudioDecoded:true,realVideoDecoded:true,seriesHierarchyAndPlayback:true,audiobookChapterAdvanceAndResume:true,embeddedChapters:!!process.env.MEDIA_SMOKE_FFMPEG,embeddedSubtitleDecoded,embeddedCoverDecoded,subtitlesDecoded:true,localCoverDecoded:true,backgroundAcrossReading:true,renewalCount,progress:progress.position,browserErrors:errors,visualChecks:visualChecks.length}));
  }finally{if(browser)await browser.close();server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));await rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
