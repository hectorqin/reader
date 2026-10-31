// Production UI with a disposable HTTP/database fixture; no user data is changed.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/navigation-review');await fs.mkdir(out,{recursive:true});
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,env:{...process.env,MEDIA_REVIEW_MEMBER:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',data=>logs+=data);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let buffer='';const timer=setTimeout(()=>no(Error(logs)),30000);server.stdout.on('data',data=>{buffer+=data;for(const line of buffer.split('\n'))try{const value=JSON.parse(line);if(value.baseUrl){clearTimeout(timer);ok(value);}}catch{}});server.once('exit',()=>{clearTimeout(timer);no(Error(logs));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],shots=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  const route=()=>page.evaluate(()=>location.hash);
  // A channel with exactly one library adds ?library= to its catalog address; compare the path unless a query is expected.
  async function hash(value){await page.waitForFunction(value=>(value.includes('?')?location.hash:location.hash.split('?')[0])===value,value);}
  async function heading(value){await page.getByRole('heading',{name:value,exact:true}).waitFor();}
  const nav=page.locator('nav.app-nav[aria-label="主导航"]'),segments=page.getByRole('navigation',{name:'切换内容频道',exact:true});
  async function more(label){await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();}
  // One AppNav: bottom tabs on phones (hidden on pushed pages, which own a back arrow), a sidebar from 701px.
  async function capture(name,{top}){for(const width of [390,545,1120])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.mouse.move(0,0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' overflow');
   const box=await nav.boundingBox();
   if(width<=700){
    if(top){assert.ok(box&&Math.abs(box.y+box.height-844)<1&&box.width>=width-1,name+' phone tab bar at the bottom');assert.equal(await page.locator('.app-nav-sub').isVisible(),false,name+' channel links stay out of the tab bar');}
    else{assert.equal(await nav.isVisible(),false,name+' pushed page hides the tab bar');assert.ok(await page.locator('.media-back-button').filter({visible:true}).count()>=1,name+' pushed page has its own back arrow');}
   }else{
    assert.ok(box&&box.x<1&&box.height>=843,name+' desktop sidebar');assert.equal(await nav.locator('.app-nav-sub').isVisible(),true,name+' sidebar lists the media channels');
    const header=page.locator('.media-screen>.media-heading').filter({visible:true});assert.equal(await header.count(),1,name+' one page header');
    if(!top)assert.ok(Math.abs((await header.boundingBox()).y)<1,name+' page title shares the desktop top row');
   }
   const key=name+'-'+width+'-'+theme;await page.screenshot({path:join(out,key+'.png')});shots.push(key);
  }await page.setViewportSize({width:390,height:844});}

  await page.goto(baseUrl+'/#/media/audiobook');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
  await hash('#/media/audiobook/books');await segments.waitFor();
  assert.equal(await segments.getByRole('link',{name:'有声书',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await nav.getByRole('link',{name:'影音',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await nav.getByRole('link',{name:'书架',exact:true}).getAttribute('href'),'#/shelf','reading stays one tab away');
  await capture('catalog',{top:true});

  // Channel switch: the segmented control on phones, the sidebar's sub-items on desktop.
  await segments.getByRole('link',{name:'音乐',exact:true}).click();await hash('#/media/music/albums');
  await segments.getByRole('link',{name:'影视',exact:true}).click();await hash('#/media/video');
  await page.setViewportSize({width:1120,height:844});
  await nav.locator('.app-nav-sub').getByRole('link',{name:'有声书',exact:true}).click();await hash('#/media/audiobook/books');
  assert.equal(await nav.locator('.app-nav-sub').getByRole('link',{name:'有声书',exact:true}).getAttribute('aria-current'),'page');
  await nav.locator('.app-nav-sub').getByRole('link',{name:'影视',exact:true}).click();await hash('#/media/video');
  await page.setViewportSize({width:390,height:844});

  // The catalog's ⋯ menu closes with Escape and leads to the personal pages.
  await page.getByRole('button',{name:'更多操作',exact:true}).click();const menu=page.getByRole('menu',{name:'更多操作',exact:true});await menu.waitFor();
  await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});

  // 影音设置 is gone: old addresses land on the one 偏好设置 page in 我的, which applies instantly.
  await page.evaluate(()=>location.hash='#/media/video/settings');await hash('#/me/settings');await heading('偏好设置');
  // The four kinds are tabs of one page; 外观与主题 is selected by default.
  for(const section of ['外观与主题','书架','影音浏览','播放'])await page.getByRole('tab',{name:section,exact:true}).waitFor();
  await page.getByRole('tab',{name:'外观与主题',exact:true,selected:true}).waitFor();
  await capture('settings',{top:false});
  await page.evaluate(()=>location.hash='#/media/video/settings/browse');await hash('#/me/settings?section=browse');await heading('偏好设置');
  await page.reload();await page.getByRole('tab',{name:'影音浏览',exact:true,selected:true}).waitFor();assert.equal(await route(),'#/me/settings?section=browse');
  await page.getByRole('combobox',{name:'封面密度',exact:true}).click();await page.getByRole('listbox',{name:'封面密度',exact:true}).getByRole('option',{name:'宽松（手机两列）',exact:true}).click();
  await page.reload();await page.getByRole('tab',{name:'影音浏览',exact:true,selected:true}).waitFor();assert.match(await page.getByRole('combobox',{name:'封面密度',exact:true}).innerText(),/宽松/,'browse preference applies without a save step');
  await capture('preferences',{top:false});
  await page.getByRole('link',{name:'返回我的',exact:true}).click();await hash('#/me');
  await page.getByRole('link',{name:/^偏好设置/}).click();await hash('#/me/settings');await page.goBack();await hash('#/me');await page.goForward();await heading('偏好设置');

  // Favorites from the catalog menu: reload keeps the page, detail returns to it.
  await page.evaluate(()=>location.hash='#/media/video');await segments.waitFor();
  await more('收藏');await hash('#/media/favorites');await heading('我的收藏');await page.locator('.media-favorite-row').first().waitFor();
  await capture('favorites',{top:false});
  assert.equal(await page.getByRole('button',{name:'更多操作',exact:true}).count(),0,'secondary pages have no channel menu');
  await page.reload();await heading('我的收藏');await page.locator('.media-favorite-row').first().click();await page.locator('.media-detail-shell').waitFor();
  await page.getByRole('link',{name:'返回上一页',exact:true}).click();await hash('#/media/favorites');await heading('我的收藏');
  await page.getByRole('link',{name:'返回影视',exact:true}).click();await hash('#/media/video');

  await more('历史');await hash('#/media/video/history');await heading('播放历史');
  await page.goBack();await hash('#/media/video');await page.goForward();await heading('播放历史');
  await capture('history',{top:false});
  await page.getByRole('link',{name:'返回频道',exact:true}).click();await hash('#/media/video');

  await more('媒体库管理');await hash('#/media/video/settings/libraries');await heading('媒体库管理');
  await capture('libraries',{top:false});
  await page.getByRole('link',{name:'返回频道',exact:true}).click();await hash('#/media/video');
  await page.evaluate(()=>location.hash='#/me');await page.getByRole('link',{name:'媒体库',exact:true}).click();await hash('#/media/video/settings/libraries');await heading('媒体库管理');
  await page.getByRole('link',{name:'返回我的',exact:true}).click();await hash('#/me');

  await page.goto(baseUrl+'/#/media/music/favorites');await heading('我的收藏');
  await page.getByText('暂无这类收藏。',{exact:true}).waitFor();await capture('favorites-empty',{top:false});

  // Decode a real WAV in the browser while navigation uses the normal app/router.
  const samples=8000*30,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const part={id:'navigation-part',assetId:'navigation-asset',title:'导航测试音频',start:0,end:30,available:true};let starts=0;
  await page.route('**/api/v1/media/**',async route=>{
   const path=new URL(route.request().url()).pathname.split('/api/v1/media/')[1];let data;
   if(path==='items/navigation-song')data={id:'navigation-song',libraryId:'track-lib',kind:'track',title:'导航测试音频',metadata:{artist:'测试艺人'},overrides:{},children:[],editions:[{id:'navigation-edition',label:'测试版',parts:[part]}]};
   else if(path==='items/navigation-song/favorite')data={favorite:false};
   else if(path==='streams/navigation-audio.wav')return route.fulfill({contentType:'audio/wav',body:wav});
   else if(path==='playback'&&route.request().method()==='POST'){starts++;data={id:'navigation-session',itemId:'navigation-song',partId:part.id,streamUrl:'/api/v1/media/streams/navigation-audio.wav',contentType:'audio/wav',expiresAt:Date.now()+3600000,position:0,start:0,end:30,revision:0};}
   else if(path.startsWith('playback/navigation-session'))data={position:0,revision:1,completed:false};
   else return route.continue();
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(baseUrl+'/#/media/music/items/navigation-song');await page.locator('.media-detail-page').waitFor();
  await page.getByRole('button',{name:'播放音频',exact:true}).click();await page.waitForFunction(()=>{const a=document.querySelector('.media-player audio');return a?.readyState>=2&&!a.paused;});
  const source=await page.locator('.media-player audio').evaluate(a=>a.currentSrc);
  await page.getByRole('link',{name:'返回频道',exact:true}).click();await hash('#/media/music/albums');
  await segments.getByRole('link',{name:'有声书',exact:true}).click();await hash('#/media/audiobook/books');
  await nav.getByRole('link',{name:'我的',exact:true}).click();await hash('#/me');await page.getByRole('link',{name:/^偏好设置/}).click();await page.getByRole('tab',{name:'播放',exact:true}).click();await page.getByRole('tab',{name:'播放',exact:true,selected:true}).waitFor();
  await page.getByRole('heading',{name:'当前播放',exact:true}).waitFor();
  assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),source);assert.equal(await page.locator('.media-player audio').evaluate(a=>a.paused),false);assert.equal(starts,1);
  await page.getByRole('button',{name:'打开播放器',exact:true}).click();await page.waitForFunction(()=>/^#\/media\/[^/]+\/player/.test(location.hash));await page.locator('.media-audio-heading').waitFor();
  // Checked softly so the rest of the review still runs; reported at the end.
  const playerHash=await route(),headers=await page.locator('.media-heading').filter({visible:true}).count();
  if(!playerHash.startsWith('#/media/music/player')||headers!==1)failures.push(`偏好设置 → 打开播放器 for a music track opened ${playerHash} with ${headers} visible player headers (expected #/media/music/player and one header)`);
  await page.screenshot({path:join(out,'settings-open-player-390-light.png')});shots.push('settings-open-player-390-light');await page.goBack();await heading('偏好设置');
  // The mini player belongs to media pages: above the tab bar on a top-level page, in the freed bottom area on a pushed one.
  await page.goBack();await hash('#/me');await page.goBack();await hash('#/media/audiobook/books');
  let mini=await page.locator('.media-player').boundingBox(),bar=await nav.boundingBox();assert.ok(mini&&bar&&mini.y+mini.height<=bar.y+1,'mini player sits above the phone tab bar');
  await more('历史');await hash('#/media/audiobook/history');await heading('播放历史');
  mini=await page.locator('.media-player').boundingBox();assert.ok(mini.y+mini.height>814&&mini.y+mini.height<=844,'mini player must use the freed bottom area');
  await page.screenshot({path:join(out,'mini-player-pushed-390-light.png')});shots.push('mini-player-pushed-390-light');
  await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.waitForFunction(()=>/^#\/media\/[^/]+\/player/.test(location.hash));
  await page.getByRole('button',{name:'← 返回浏览',exact:true}).click();await heading('播放历史');await hash('#/media/audiobook/history');
  assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),source);assert.equal(starts,1);

  // Members neither see nor reach library management.
  const member=await browser.newPage();member.on('pageerror',error=>errors.push(error.message));
  await member.goto(baseUrl+'/#/me');await member.locator('input[autocomplete="username"]').fill('review-member');await member.locator('input[type="password"]').fill('review-test-pass');await member.locator('form button[type=submit]').click();
  await member.getByRole('link',{name:/^偏好设置/}).waitFor();assert.equal(await member.getByRole('link',{name:'媒体库',exact:true}).count(),0);
  await member.goto(baseUrl+'/#/media/video/settings/libraries');await member.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();await member.getByText('需要管理员权限。',{exact:true}).waitFor();
  await member.close();

  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  await fs.writeFile(join(out,'verification.json'),JSON.stringify({passed:true,shots,checks:['phone tab bar on top-level pages, back arrow on pushed pages','desktop sidebar with channel sub-items and one header row','segmented and sidebar channel switch','catalog menu Escape','old media settings addresses redirect to 偏好设置','instant-apply browse preference survives reload','favorites reload and detail return','browser back/forward','library management from catalog menu and 我的','audio source/session survives channel and settings navigation','mini player bottom offset','member deep-link permissions'],browserErrors:errors},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>影音导航与路由评审</title><style>body{font:14px/1.6 system-ui;background:#f4f3ef;color:#30392c;margin:24px}img{max-width:100%;border:1px solid #ddd}section{margin:28px 0}</style><h1>应用导航与独立页面路由</h1><p>手机底部标签栏、宽屏侧边栏；分类页顶部三段切换频道。偏好设置在我的，收藏、历史、媒体库管理有独立地址。实际客户端与临时服务、测试账号资料。</p>${shots.map(key=>`<section><h2>${key}</h2><img src="${key}.png"></section>`).join('')}</html>`);
  console.log(JSON.stringify({passed:true,screenshots:shots.length}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
