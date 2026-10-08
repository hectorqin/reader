const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/theme-review');await fs.mkdir(out,{recursive:true});
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl,sampleItems}=await new Promise((ok,no)=>{let output='';const timer=setTimeout(()=>no(Error(logs||'fixture timeout')),60000);server.stdout.on('data',d=>{output+=d;for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.baseUrl){clearTimeout(timer);ok(value);}}catch{}});server.once('exit',()=>{clearTimeout(timer);no(Error(logs));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:427,height:900},colorScheme:'light'}),errors=[],shots=[],heights=[];
  page.on('pageerror',error=>errors.push(error.message));
  const shot=async name=>{await page.screenshot({path:join(out,name+'.png')});shots.push(name);};
  const go=async hash=>page.evaluate(hash=>location.hash=hash,hash);
  const palette=selector=>page.locator(selector).evaluate(node=>({bg:getComputedStyle(node).getPropertyValue('--media-background').trim(),ink:getComputedStyle(node).getPropertyValue('--text').trim(),scheme:getComputedStyle(node).colorScheme}));
  await page.goto(baseUrl+'/#/media/music/settings');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
  await page.getByRole('button',{name:/主题外观/}).click();await page.getByRole('heading',{name:'主题外观',exact:true}).waitFor();assert.match(page.url(),/music\/settings\/theme/);
  await shot('themes-mobile');await page.getByRole('button',{name:'返回影音设置',exact:true}).click();await page.getByRole('heading',{name:'影音设置',exact:true}).waitFor();await page.getByRole('button',{name:/主题外观/}).click();
  const readingTheme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));
  for(const [id,name] of [['forest','原野'],['sand','暖砂'],['ocean','雾蓝'],['rose','蔷薇'],['midnight','深海'],['graphite','石墨']]){
   await page.getByRole('button',{name,exact:true}).click();assert.equal(await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('body').getAttribute('data-media-theme'),id);
   await go('#/media/music/albums');await page.locator('.media-tile').first().waitFor();await shot('channel-'+id);
   assert.deepEqual(await palette('.media-screen'),await palette('.media-channel-entry'));
   await go('#/media/music/settings/theme');await page.getByRole('heading',{name:'主题外观',exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'深海',exact:true}).click();await page.reload();await page.getByRole('button',{name:'深海',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'深海',exact:true}).getAttribute('aria-pressed'),'true');
  await shot('themes-dark-mobile');await page.setViewportSize({width:1120,height:900});await shot('themes-desktop');await page.setViewportSize({width:427,height:900});
  const album=sampleItems.find(item=>item.kind==='album'&&item.title==='静谧时刻'),movie=sampleItems.find(item=>item.kind==='movie'&&item.title==='海岸线');assert.ok(album&&movie,'Use the real acceptance sample pack');
  await go('#/media/music/items/'+album.id);await page.getByRole('button',{name:'播放全部',exact:true}).click();await page.waitForFunction(()=>{const audio=document.querySelector('.media-player audio');return audio?.readyState>=2&&!audio.paused;});
  const source=await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc);assert.deepEqual(await palette('.media-screen'),await palette('.media-player'));await page.getByRole('button',{name:'播放全部',exact:true}).hover();assert.equal(await page.getByRole('button',{name:'播放全部',exact:true}).evaluate(button=>getComputedStyle(button).backgroundColor),'rgb(142, 201, 238)');await page.mouse.move(0,0);await shot('player-dark');
  await go('#/media/video/settings/theme');await page.getByRole('button',{name:'深海',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'深海',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'暖砂',exact:true}).click();assert.deepEqual(await palette('.media-screen'),await palette('.media-player'));assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.currentSrc),source);assert.equal(await page.locator('.media-player audio').evaluate(audio=>audio.paused),false);
  await page.getByRole('button',{name:'关闭播放器',exact:true}).click();
  for(const [id,name] of [['sand','暖砂'],['midnight','深海']]){
   await go('#/media/video/settings/theme');await page.getByRole('button',{name,exact:true}).click();
   await go('#/media/video/items/'+movie.id);await page.locator('summary[aria-label="作品操作"]').click();await page.getByRole('button',{name:'版本管理',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'版本管理'});await dialog.waitFor();
   for(const width of [390,535,1120]){
    await page.setViewportSize({width,height:834});const header=await dialog.locator('.source-modal-header').boundingBox();assert.ok(header.height<=60,'resource header must be compact');heights.push({theme:id,width,height:header.height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot('dialog-'+id+'-'+width);
   }
   const url=page.url();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(page.url(),url);
  }
  await page.setViewportSize({width:427,height:900});await go('#/media/audiobook/settings/theme');await page.getByRole('button',{name:/跟随系统/}).click();await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.media-screen')).colorScheme==='dark');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.media-screen')).colorScheme==='light');
  await page.getByRole('button',{name:'石墨',exact:true}).click();
  await go('#/shelf');await page.waitForFunction(()=>!document.body.hasAttribute('data-media-theme'));assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-theme')),readingTheme);assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--media-theme-text')),'');
  await go('#/media/audiobook/settings/theme');await page.getByRole('button',{name:'石墨',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'石墨',exact:true}).getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'checks.json'),JSON.stringify({shots,heights,flows:['all six palettes','settings route and reload','cross-channel theme persistence','live audio retains source when theme changes','system color scheme changes','return to reading removes only media appearance'],errors},null,2));
  await fs.writeFile(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>影音主题与紧凑弹窗</title><style>body{background:#f3f4f5;color:#25313a;font:15px system-ui;margin:24px}main{display:flex;flex-wrap:wrap;gap:20px;align-items:start}figure{margin:0;width:390px}figure.wide{width:100%}img{max-width:100%;border-radius:8px;border:1px solid #ccd0d6}figcaption{margin:10px 0}</style><h1>影音主题与紧凑弹窗</h1><p>真实媒体包，临时数据库。包含六套主题、移动端/桌面设置、播放中切换主题和 56px 弹窗标题栏。</p><main>'+shots.map(name=>`<figure class="${name.includes('desktop')||name.includes('1120')?'wide':''}"><figcaption>${name}</figcaption><img src="${name}.png"></figure>`).join('')+'</main>');
  console.log(JSON.stringify({screenshots:shots.length,heights,errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(ok=>server.exitCode!==null?ok():server.once('exit',ok));}
})().catch(error=>{console.error(error);process.exitCode=1;});
