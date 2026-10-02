// Production UI against the frozen v2 prototype. All server writes use a disposable DB.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
async function saveShot(capture){for(let attempt=0;;attempt++){try{return await capture();}catch(error){if(!['UNKNOWN','EBUSY','EPERM'].includes(error.code)||attempt>=4)throw error;await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}}}
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/v2-implementation-review');await fs.mkdir(out,{recursive:true});
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,env:{...process.env,MEDIA_REVIEW_TIMEOUT_MS:'900000'},stdio:['pipe','pipe','pipe']});
 let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const fixture=await new Promise((ok,no)=>{let data='';server.stdout.on('data',d=>{data+=d;for(const line of data.split('\n'))try{const v=JSON.parse(line);if(v.baseUrl)ok(v);}catch{}});server.once('exit',()=>no(Error(logs)));});
  const {baseUrl,sampleItems}=fixture;assert.ok(sampleItems.length,'MEDIA_REVIEW_SAMPLE_PACK must point to acceptance media');
  const find=(kind,title)=>sampleItems.find(i=>i.kind===kind&&(!title||i.title===title));
  const movie=find('movie','海岸线'),album=find('album','静谧时刻'),artist=find('artist'),book=find('audiobook'),series=find('series'),episode=find('episode');
  assert.ok(movie&&album&&artist&&book&&series&&episode);
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});
  const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:'light'}),ref=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await ref.goto(pathToFileURL(join(repo,'docs/prototypes/media/v2-review/index.html')).href);await ref.waitForFunction(()=>!!window.prototypeReview);
  const go=async hash=>{await page.evaluate(hash=>location.hash=hash,hash);await page.waitForTimeout(180);};
  await page.goto(baseUrl+'/#/media/music/settings');await page.locator('#login-username').fill('reviewer');await page.locator('#login-password').fill('review-test-pass');await page.locator('form button[type=submit]').click();await page.locator('.media-settings-intro').waitFor();
  async function shot(id,width=390,theme='forest',label=''){
   const height=width>700?900:844;await page.setViewportSize({width,height});
   await ref.evaluate(({id,width,theme,height})=>{window.prototypeReview.setWidth(width);window.prototypeReview.setTheme(theme==='midnight'?'dark':theme);window.prototypeReview.go(id,true);document.querySelector('#frame').style.height=height+'px';},{id,width,theme,height});
   await page.evaluate(()=>{const s=document.querySelector('.media-screen');s.scrollTop=0;return document.fonts.ready;});await page.mouse.move(0,0);await page.waitForTimeout(120);
   const key=id+'-'+width+'-'+theme+(label?'-'+label:'');
   const metrics=await page.evaluate(()=>{const s=document.querySelector('.media-screen'),h=s.querySelector('.media-heading,.media-settings-heading');return {overflow:s.scrollWidth-s.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,header:h?.getBoundingClientRect().height,background:getComputedStyle(s).backgroundColor,coverWidth:s.querySelector('.media-playing-artwork .media-cover')?.getBoundingClientRect().width,playWidth:s.querySelector('.media-toggle-play')?.getBoundingClientRect().width,optionsBottom:s.querySelector('.media-playback-options')?.getBoundingClientRect().bottom};});
   await saveShot(()=>page.screenshot({path:join(out,key+'-actual.png')}));await saveShot(()=>ref.locator('#frame').screenshot({path:join(out,key+'-reference.png')}));
   if(['music-player','audio-player','lyrics'].includes(id)){assert.equal(metrics.playWidth,64,key+' primary control');assert.ok(metrics.optionsBottom<=height,key+' controls below viewport');}
   const layout=await page.evaluate(()=>{
    const rect=s=>{const e=document.querySelector(s);if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const tab=document.querySelector('.media-tabs'),title=document.querySelector('.media-page-heading h1,.media-page-heading h2,.media-audio-heading>strong');
    return {library:rect('.media-library-filter'),count:rect('.media-browse-tools>span,.media-person-toolbar>span'),tabsScrollbar:tab?getComputedStyle(tab).scrollbarWidth:null,titleSize:title?getComputedStyle(title).fontSize:null,synopsis:rect('.media-detail-description'),chapters:rect('.media-edition'),episodes:rect('.media-episode-grid'),episodeColumns:document.querySelector('.media-episode-grid')?getComputedStyle(document.querySelector('.media-episode-grid')).gridTemplateColumns.split(' ').length:null,episodeLabels:[...document.querySelectorAll('.media-episode-grid>button strong')].map(e=>e.textContent),queue:rect('.media-current-playlist'),contentActions:rect('[aria-label="当前内容操作"]'),stateIcon:rect('.media-state-icon,.media-empty-emblem'),stateTitle:document.querySelector('.media-state-page h2,.media-screen-error.is-page>strong,.media-library-empty h2')?.textContent};
   });
   if(layout.library&&layout.count)assert.ok(layout.library.x+layout.library.width<=layout.count.x+1,key+' library filter must be left of count');
   if(layout.tabsScrollbar)assert.equal(layout.tabsScrollbar,'none',key+' tabs must hide scrollbars');
   if(layout.titleSize)assert.equal(layout.titleSize,'16px',key+' secondary heading size');
   if(id==='narrators')assert.ok(layout.library,key+' narrator library selector');
   if(id==='book'&&layout.synopsis)assert.ok(layout.synopsis.y<layout.chapters.y,key+' synopsis before chapters');
   if(id==='show'){assert.equal(layout.episodeColumns,width>700?3:2);assert.ok(layout.episodeLabels.every(t=>/第 \d+ 集/.test(t)));assert.ok(layout.synopsis.y<layout.episodes.y);}
   if(id==='queue')assert.ok(layout.queue.width>=Math.min(850,width-32)-1,key+' queue fills content width');
   if(['music-player','audio-player'].includes(id))assert.ok(layout.contentActions,key+' current content menu');
   if(['empty','missing','denied','unavailable'].includes(id)){assert.equal(layout.stateIcon.width,72);assert.equal(layout.stateIcon.height,72);}
   checks.push({id,key,width,theme,url:new URL(page.url()).hash,...metrics,layout});
   assert.ok(metrics.overflow<=1&&metrics.documentOverflow<=1,key+' overflows '+JSON.stringify(metrics));
  }
  const routes=[
   ['video',`video?library=${movie.libraryId}`,'.media-tile'],['movies',`video/movies?library=${movie.libraryId}`,'.media-tile'],['series',`video/series?library=${movie.libraryId}`,'.media-tile'],
   ['movie',`video/movie/${movie.id}`,'.media-detail-heading'],['show',`video/show/${series.id}`,'.media-detail-heading'],
   ['music',`music/albums?library=${album.libraryId}`,'.media-tile'],['artists',`music/artists?library=${album.libraryId}`,'.media-tile'],['tracks',`music/tracks?library=${album.libraryId}`,'.media-track-entry'],
   ['album',`music/album/${album.id}`,'.media-album-track'],['artist',`music/artist/${artist.id}`,'.media-detail-heading'],
   ['audiobooks',`audiobook/books?library=${book.libraryId}`,'.media-tile'],['narrators',`audiobook/narrators?library=${book.libraryId}`,'.media-person-tile'],['book',`audiobook/book/${book.id}`,'.media-detail-heading'],
   ['chapters',`audiobook/items/${book.id}/chapters`,'.media-audiobook-chapters'],['search','search?q=海&scope=all','.media-search-result'],
   ['favorites','video/favorites','.media-favorite-list'],['history','video/history','.media-history-row'],['folders',`music/folders?library=${album.libraryId}`,'.media-folder-row'],
   ['settings','music/settings','.media-settings-intro'],['themes','music/settings/theme','.media-theme-card'],['browse-settings','music/settings/browse','.media-settings-panel'],['playback-settings','music/settings/playback','.media-settings-panel'],
   ['libraries','music/settings/libraries','.media-library-row'],['library-edit','video/settings/libraries/new','.media-library-create'],['permissions',`video/settings/libraries/${movie.libraryId}/permissions`,'.media-permissions-form'],
   ['tasks','video/settings/tasks','.media-manager'],['metadata',`video/items/${movie.id}/metadata`,'.media-metadata-host'],['match',`video/items/${movie.id}/match`,'.media-metadata-host'],['plugins','video/settings/plugins','.media-settings'],['account','music/settings/account','.media-account-panel'],
  ];
  for(const [channel,item] of [['music',album],['audiobook',book]]){await go('#/media/'+channel+'/'+(channel==='music'?'album/':'book/')+item.id);await page.locator('.media-detail-favorite').waitFor();await page.locator('.media-detail-favorite').click();await page.waitForFunction(()=>document.querySelector('.media-detail-favorite')?.getAttribute('aria-pressed')==='true');}
  const wanted=process.env.MEDIA_V2_ONLY?.split(',');
  for(const [id,route,ready] of routes){if(wanted&&!wanted.includes(id))continue;await go('#/media/'+route);await page.locator(ready).first().waitFor();if(id==='match'){await page.getByRole('button',{name:'搜索候选',exact:true}).click();await page.getByRole('button',{name:'预览匹配',exact:true}).first().waitFor();}for(const width of [390,1120])await shot(id,width);console.log('reviewed '+id);}
  if(!wanted||wanted.includes('players')){
   await go('#/media/audiobook/narrators?library='+book.libraryId);await page.locator('.media-person-tile').first().click();await page.locator('.media-person-hero').waitFor();await shot('narrator');await shot('narrator',1120);
   await page.route('**/api/v1/media/libraries',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({items:[]})}));
   await page.goto(baseUrl+'/#/media/video');await page.locator('.media-library-empty').waitFor();await shot('empty');await page.unroute('**/api/v1/media/libraries');await page.reload();await page.locator('.media-tabs:not([hidden])').waitFor();
   await go('#/media/video/movie/favorite-001');await page.locator('.media-missing-edition').waitFor();await shot('missing');
   for(const [id,status,code] of [['denied',403,'MEDIA_FORBIDDEN'],['unavailable',503,'MEDIA_UNAVAILABLE']]){
    const pattern=id==='unavailable'?/\/api\/v1\/media\/(browse|libraries\/[^/]+\/items)\?/:'**/api/v1/media/items/review-'+id;
    await page.route(pattern,route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code,message:id==='denied'?'当前账号没有此媒体库的访问权限':'暂时无法读取影音服务'}})}));
    await go(id==='unavailable'?'#/media/video':'#/media/video/movie/review-'+id);if(id==='unavailable')await page.reload();await page.locator('.media-screen-error.is-page').waitFor();await shot(id);await page.unroute(pattern);
   }
   const pending=[];await page.route('**/api/v1/media/browse?**',route=>pending.push(route));
   await go('#/media/music/albums');await page.locator('.media-read-loading').waitFor();await shot('loading');
   for(const route of pending)await route.continue().catch(()=>{});await page.unroute('**/api/v1/media/browse?**');
   await go('#/media/music/album/'+album.id);await page.getByRole('button',{name:'播放全部',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-player audio')?.readyState>=2);await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.locator('.media-playing-artwork').waitFor();
   for(const width of [360,390,1120])await shot('music-player',width);
   await page.getByRole('button',{name:'歌词',exact:true}).click();await page.locator('.media-lyrics-lines').waitFor();await shot('lyrics');assert.equal(await page.locator('.media-lyrics-lines').evaluate(e=>getComputedStyle(e).scrollbarWidth),'none');
   await page.getByRole('button',{name:'睡眠定时',exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:join(out,'timer-actual.png')});await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'播放队列',exact:true}).click();await page.locator('.media-current-playlist').waitFor();await shot('queue');
   await go('#/media/audiobook/book/'+book.id);await page.locator('.media-detail-actions .media-primary').click();await page.waitForFunction(()=>document.querySelector('.media-player audio')?.readyState>=2);await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.locator('.media-playing-artwork').waitFor();await shot('audio-player');await shot('audio-player',1120);
   for(const [id,item] of [['video-player',movie],['episode-player',episode]]){await go('#/media/video/'+(item===movie?'movie/':'episode/')+item.id);await page.locator('.media-detail-actions .media-primary').click();await page.locator('.dplayer-video').waitFor();await page.waitForFunction(()=>document.querySelector('.media-player video')?.readyState>=2);for(const width of [390,1120])await shot(id,width);}
  }
  if(!wanted||wanted.includes('players')){
   await go('#/media/music/settings/theme');await page.getByRole('button',{name:'深海',exact:true}).click();await go('#/media/music/albums?library='+album.libraryId);await page.locator('.media-tile').first().waitFor();await shot('music',390,'midnight');
   await go('#/media/music/settings/theme');await page.getByRole('button',{name:'原野',exact:true}).click();
  }
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'checks.json'),JSON.stringify({complete:true,fixture:'Real local acceptance media and disposable server; reference content differs where the library lacks prototype metadata. Video internals use unchanged Plyr.',checks,errors},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>影音 v2 实施验收</title><style>body{margin:24px;background:#f8f9f5;color:#202b24;font:14px/1.6 system-ui}h1{font-size:24px}section{margin:32px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1600px}figure{margin:0;min-width:0}img{width:100%;border:1px solid #dfe5d9}figcaption{margin:8px 0}nav{display:flex;flex-wrap:wrap;gap:12px}a{color:#466638}@media(max-width:600px){body{margin:12px}.pair{gap:8px}}</style><h1>影音 v2 · 原型与实际页面</h1><p>左侧为已确认的 v2 原型，右侧为生产构建。尺寸与主题一致；实际页面使用本地验收资源，条目数量、封面及元数据可能不同。Plyr 自带控件按用户要求保留。</p><nav>${checks.map(r=>`<a href="#${r.key}">${r.id} ${r.width}</a>`).join('')}</nav>${checks.map(r=>`<section id="${r.key}"><h2>${r.id} · ${r.width}px</h2><div class="pair"><figure><figcaption>v2 原型</figcaption><img loading="lazy" src="${r.key}-reference.png"></figure><figure><figcaption>实际页面</figcaption><img loading="lazy" src="${r.key}-actual.png"></figure></div></section>`).join('')}</html>`);
  console.log(JSON.stringify({comparisons:checks.length,errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
