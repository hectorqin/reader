const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/theme-review');await fs.mkdir(out,{recursive:true});
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  assert.ok(process.env.MEDIA_REVIEW_SAMPLE_PACK,'Set MEDIA_REVIEW_SAMPLE_PACK to an acceptance pack (node server/tools/media-sample-pack.cjs <dir>)');
  const {baseUrl,sampleItems}=await new Promise((ok,no)=>{let output='';const timer=setTimeout(()=>no(Error(logs||'fixture timeout')),60000);server.stdout.on('data',d=>{output+=d;for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.baseUrl){clearTimeout(timer);ok(value);}}catch{}});server.once('exit',()=>{clearTimeout(timer);no(Error(logs));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:427,height:900},colorScheme:'light'}),errors=[],shots=[],heights=[];
  page.on('pageerror',error=>errors.push(error.message));
  const shot=async name=>{await page.screenshot({path:join(out,name+'.png')});shots.push(name);};
  const go=async hash=>page.evaluate(hash=>location.hash=hash,hash);
  const palette=selector=>page.locator(selector).first().evaluate(node=>({bg:getComputedStyle(node).getPropertyValue('--media-background').trim(),ink:getComputedStyle(node).getPropertyValue('--text').trim(),scheme:getComputedStyle(node).colorScheme}));
  // One app theme (暖陶/雾蓝/青绿 × 浅色/深色, or 跟随系统) now drives the reading side and media alike;
  // it is set in 我的 › 偏好设置 › 外观与主题.
  const settings=async()=>{await go('#/me/settings?section=theme');await page.getByRole('tab',{name:'外观与主题',exact:true,selected:true}).waitFor();};
  const themeCard=name=>page.getByRole('group',{name:'应用主题',exact:true}).getByRole('button',{name,exact:true});
  const pressed=async locator=>(await locator.getAttribute('aria-pressed'))==='true';
  const follow=page.getByRole('button',{name:'跟随系统',exact:true});
  const html=()=>page.evaluate(()=>({theme:document.documentElement.dataset.theme,mode:document.documentElement.dataset.mode}));
  await page.goto(baseUrl+'/#/me');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
  await page.getByRole('link',{name:/偏好设置/}).click();await page.getByRole('tab',{name:'外观与主题',exact:true,selected:true}).waitFor();assert.match(page.url(),/#\/me\/settings/);
  await shot('themes-mobile');await page.getByRole('link',{name:'返回我的',exact:true}).click();await page.getByRole('heading',{name:'我的',exact:true}).waitFor();
  // Old panel links still land on the theme section.
  await go('#/me/theme');await page.waitForFunction(()=>/#\/me\/settings\?section=theme/.test(location.hash));await page.getByRole('tab',{name:'外观与主题',exact:true,selected:true}).waitFor();
  if(await pressed(follow))await follow.click();assert.equal(await pressed(follow),false);
  const backgrounds=new Set();
  for(const [id,name] of [['warm','暖陶'],['blue','雾蓝'],['green','青绿']])for(const [mode,modeName] of [['light','浅色'],['dark','深色']]){
   await settings();await themeCard(name).click();await page.getByRole('group',{name:'明暗',exact:true}).getByRole('button',{name:modeName,exact:true}).click();
   assert.equal(await pressed(themeCard(name)),true);assert.deepEqual(await html(),{theme:id,mode});
   await go('#/media/music/albums');await page.locator('.media-tile').first().waitFor();await shot(`channel-${id}-${mode}`);
   const screen=await palette('.media-screen');assert.equal(screen.scheme,mode);
   assert.equal(screen.bg,await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()),'media follows the app theme');backgrounds.add(screen.bg);
  }
  assert.equal(backgrounds.size,6,'every theme/mode pair has its own background');
  await settings();await themeCard('青绿').click();await page.getByRole('group',{name:'明暗',exact:true}).getByRole('button',{name:'深色',exact:true}).click();
  await page.reload();await page.getByRole('tab',{name:'外观与主题',exact:true,selected:true}).waitFor();assert.equal(await pressed(themeCard('青绿')),true);assert.deepEqual(await html(),{theme:'green',mode:'dark'});
  await shot('themes-dark-mobile');await page.setViewportSize({width:1120,height:900});await shot('themes-desktop');await page.setViewportSize({width:427,height:900});
  const album=sampleItems.find(item=>item.kind==='album'&&item.title==='静谧时刻'),movie=sampleItems.find(item=>item.kind==='movie'&&item.title==='海岸线');assert.ok(album&&movie,'Use the real acceptance sample pack');
  await go('#/media/music/items/'+album.id);await page.getByRole('button',{name:'播放全部',exact:true}).click();await page.waitForFunction(()=>{const audio=document.querySelector('.media-player audio');return audio?.readyState>=2&&!audio.paused;});
  const source=await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc);assert.deepEqual(await palette('.media-screen'),await palette('.media-player'));await shot('player-dark');
  // Changing the theme while audio plays keeps the same source playing and repaints the player with the page.
  await settings();await themeCard('暖陶').click();await page.getByRole('group',{name:'明暗',exact:true}).getByRole('button',{name:'浅色',exact:true}).click();
  assert.deepEqual(await palette('.media-screen'),await palette('.media-player'));assert.equal((await palette('.media-player')).scheme,'light');
  assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc),source);assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.paused),false);
  await go('#/media/music/items/'+album.id);await page.getByRole('button',{name:'关闭播放器',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-player audio')?.paused!==false);
  for(const [id,mode,modeName] of [['warm','light','浅色'],['warm','dark','深色']]){
   await settings();await page.getByRole('group',{name:'明暗',exact:true}).getByRole('button',{name:modeName,exact:true}).click();
   await go('#/media/video/items/'+movie.id);await page.getByRole('button',{name:'作品操作',exact:true}).click();await page.getByRole('menuitem',{name:'版本管理',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'版本管理'});await dialog.waitFor();
   for(const width of [390,535,1120]){
    await page.setViewportSize({width,height:834});const header=await dialog.locator('.sheet-header').boundingBox();assert.ok(Math.round(header.height)<=60,'resource header must be compact (sub-pixel rem rounding tolerated): '+JSON.stringify({width,header}));heights.push({theme:id+'-'+mode,width,height:header.height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot('dialog-'+id+'-'+mode+'-'+width);
   }
   const url=page.url();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(page.url(),url);
  }
  // 跟随系统: the media screen follows the system colour scheme live, and the choice persists.
  await page.setViewportSize({width:427,height:900});await settings();await follow.click();assert.equal(await pressed(follow),true);
  await go('#/media/audiobook');await page.locator('.media-screen').first().waitFor();
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.media-screen')).colorScheme==='dark');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.media-screen')).colorScheme==='light');
  await page.reload();await settings();assert.equal(await pressed(follow),true);
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'checks.json'),JSON.stringify({shots,heights,flows:['three app themes x light/dark drive media','偏好设置 route, legacy redirect and reload','live audio retains source when theme changes','compact version dialog','follow-system colour scheme changes'],errors},null,2));
  await fs.writeFile(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>影音主题与紧凑弹窗</title><style>body{background:#f3f4f5;color:#25313a;font:15px system-ui;margin:24px}main{display:flex;flex-wrap:wrap;gap:20px;align-items:start}figure{margin:0;width:390px}figure.wide{width:100%}img{max-width:100%;border-radius:8px;border:1px solid #ccd0d6}figcaption{margin:10px 0}</style><h1>影音主题与紧凑弹窗</h1><p>真实媒体包，临时数据库。应用主题（三套 × 浅色/深色）驱动影音页面、移动端/桌面设置、播放中切换主题和紧凑弹窗标题栏。</p><main>'+shots.map(name=>`<figure class="${name.includes('desktop')||name.includes('1120')?'wide':''}"><figcaption>${name}</figcaption><img src="${name}.png"></figure>`).join('')+'</main>');
  console.log(JSON.stringify({screenshots:shots.length,heights,errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(ok=>server.exitCode!==null?ok():server.once('exit',ok));}
})().catch(error=>{console.error(error);process.exitCode=1;});
