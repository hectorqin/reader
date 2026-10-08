const {chromium}=require('../../../../web/node_modules/playwright');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
 const dir=__dirname,output=resolve(dir,'../../../../artifacts/media/prototype-v2'),out=join(output,'screenshots');await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});
 const page=await browser.newPage({viewport:{width:1500,height:1120},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(pathToFileURL(join(dir,'index.html')).href);await page.waitForFunction(()=>!!window.prototypeReview);
  const ids=await page.evaluate(()=>window.prototypeReview.pages),layout=[];
  for(const width of [360,390,1120]){
   await page.evaluate(w=>window.prototypeReview.setWidth(w),width);
   for(const id of ids){
    await page.evaluate(id=>window.prototypeReview.go(id,true),id);
    const result=await page.locator('#app').evaluate(app=>({overflow:app.scrollWidth-app.clientWidth,main:app.querySelector('.main').scrollWidth-app.querySelector('.main').clientWidth,heading:app.querySelector('header').textContent}));
    assert.ok(result.overflow<=1&&result.main<=1,`${id} at ${width}: ${JSON.stringify(result)}`);layout.push({id,width});
   }
  }
  const shots=[];
  async function shot(id,width=390,theme='forest',sheet){await page.evaluate(({id,width,theme,sheet})=>{window.prototypeReview.setWidth(width);window.prototypeReview.setTheme(theme);window.prototypeReview.go(id,true);if(sheet)window.prototypeReview.openSheet(sheet);},{id,width,theme,sheet});await page.screenshot({path:join(out,`${id}-${width}-${theme}${sheet?'-'+sheet:''}-page.png`)});await page.locator('#frame').screenshot({path:join(out,`${id}-${width}-${theme}${sheet?'-'+sheet:''}.png`)});shots.push({id,width,theme,sheet,name:`${id}-${width}-${theme}${sheet?'-'+sheet:''}.png`});}
  for(const id of ['video','movie','show','music','album','artist','music-player','lyrics','queue','audiobooks','book','audio-player','search','favorites','settings','themes','libraries','tasks','empty','unavailable','video-player','episode-player','narrators','narrator','chapters','history','folders','browse-settings','playback-settings','library-edit','permissions','match','metadata','plugins','account','loading','missing','denied'])await shot(id);
  for(const id of ['video','movie','album','music-player','video-player','episode-player','settings'])await shot(id,1120);
  await shot('music-player',390,'forest','timer');await shot('movie',390,'forest','files');await shot('music-player',390,'dark');await shot('video',390,'dark');await shot('video-player',360);
  await page.evaluate(()=>{window.prototypeReview.setWidth(390);window.prototypeReview.setTheme('forest');window.prototypeReview.go('video',true);});
  await page.locator('.channel-title').click();await page.getByRole('menu',{name:'切换频道'}).waitFor();await page.locator('#review-title').click();assert.equal(await page.getByRole('menu').count(),0);
  await page.locator('.channel-title').click();await page.locator('.popover [data-action="go:music"]').click();assert.ok(page.url().endsWith('/media/music/albums'));
  await page.locator('.tile[data-go="album"]').first().click();assert.equal(await page.locator('.channel-title').count(),0);assert.ok(page.url().endsWith('/media/music/items/quiet'));
  await page.locator('[data-action="start:music"]').click();await page.locator('[data-action="go:lyrics"]').click();assert.ok(page.url().includes('/media/music/player/lyrics?item=quiet&part=quiet-1'));
  await page.locator('[data-action="sheet:timer"]').click();await page.getByRole('dialog',{name:'睡眠定时'}).waitFor();await page.locator('[data-action="timer:30"]').click();assert.equal(await page.getByRole('dialog').count(),0);assert.match(await page.locator('[data-action="sheet:timer"]').innerText(),/30/);assert.equal(await page.locator('[data-action="sheet:timer"]').evaluate(e=>document.activeElement===e),true);
  await page.locator('[data-action="go:queue"]').click();assert.ok(page.url().includes('/media/music/player/queue?item=quiet&part=quiet-1'));await page.locator('[data-action="back"]').click();await page.waitForURL(u=>u.hash.includes('/media/music/player/lyrics?item=quiet&part=quiet-1'));await page.reload();await page.locator('.lyric-lines').waitFor();assert.equal(await page.locator('.lyric-lines').evaluate(n=>getComputedStyle(n).scrollbarWidth),'none');
  await page.evaluate(()=>window.prototypeReview.go('movie',true));await page.locator('[data-action="popover:resource"]').click();await page.locator('[data-action="sheet:files"]').click();await page.getByRole('dialog',{name:'文件与技术信息'}).waitFor();const headerHeight=await page.locator('.sheet-head').evaluate(e=>e.getBoundingClientRect().height);assert.ok(headerHeight<=58);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>window.prototypeReview.go('themes',true));await page.locator('[data-action="theme:dark"]').click();assert.equal(await page.locator('#app').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);await fs.writeFile(join(output,'checks.json'),JSON.stringify({pages:ids.length,layoutCases:layout.length,screenshots:shots.length,errors,checks:['360/390/1120 no horizontal overflow','primary channel dropdown and outside dismissal','secondary page has no channel dropdown','album and player independent hashes','lyrics queue back and reload','timer preset selection','resource dialog compact header and Escape','theme preview'],shots},null,2));
  await fs.writeFile(join(output,'gallery.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>影音 v2 原型</title><style>body{background:#edf0e9;color:#283625;font:14px/1.6 system-ui;margin:24px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0}img{width:100%}.desktop{grid-column:1/-1}</style><h1>影音 v2 · 冻结设计基准</h1><p>原型示例截图，功能结果以生产页面验收为准。</p><a href="../../../docs/prototypes/media/v2-review/index.html">交互原型</a><div class="gallery">${shots.map(s=>`<figure class="${s.width>700?'desktop':''}"><figcaption>${s.id} · ${s.width}px · ${s.theme}${s.sheet?' · '+s.sheet:''}</figcaption><img loading="lazy" src="screenshots/${s.name}" alt="${s.id}"></figure>`).join('')}</div></html>`);
  // Keep only frame captures in the deliverable; full-page captures help failures but aren't part of the gallery.
  for(const file of await fs.readdir(out))if(file.endsWith('-page.png'))await fs.unlink(join(out,file));
  console.log(JSON.stringify({pages:ids.length,layoutCases:layout.length,screenshots:shots.length,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
