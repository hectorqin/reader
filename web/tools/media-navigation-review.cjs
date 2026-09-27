// Production UI with a disposable HTTP/database fixture; no user data is changed.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/navigation-review');await fs.mkdir(out,{recursive:true});
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,env:{...process.env,MEDIA_REVIEW_MEMBER:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',data=>logs+=data);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let buffer='';const timer=setTimeout(()=>no(Error(logs)),30000);server.stdout.on('data',data=>{buffer+=data;for(const line of buffer.split('\n'))try{const value=JSON.parse(line);if(value.baseUrl){clearTimeout(timer);ok(value);}}catch{}});server.once('exit',()=>{clearTimeout(timer);no(Error(logs));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],shots=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function hash(value){await page.waitForFunction(value=>location.hash===value,value);}
  async function heading(value){await page.getByRole('heading',{name:value,exact:true}).waitFor();}
  async function capture(name){for(const width of [390,545,1120])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.mouse.move(0,0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' overflow');
   if(width<=700)assert.equal(await page.locator('.media-channel-entry').isVisible(),false);
   if(width>700&&await page.locator('.media-secondary-page').count()){
    assert.equal(await page.locator('.media-channel-entry a').first().isVisible(),false);
    const header=page.locator('.media-screen>.media-heading,.media-settings-heading').filter({visible:true});assert.equal(await header.count(),1);assert.ok(Math.abs((await header.boundingBox()).y)<1,'secondary title must share the desktop top row');
   }
   const key=name+'-'+width+'-'+theme;await page.screenshot({path:join(out,key+'.png')});shots.push(key);
  }}
  await page.goto(baseUrl+'/#/media/audiobook');await page.locator('#login-username').fill('reviewer');await page.locator('#login-password').fill('review-test-pass');await page.locator('form button[type=submit]').click();await page.getByLabel('切换频道',{exact:true}).waitFor();
  await capture('catalog');await page.setViewportSize({width:390,height:844});await page.getByLabel('切换频道',{exact:true}).click();await page.screenshot({path:join(out,'channel-menu-390-dark.png')});shots.push('channel-menu-390-dark');
  const menu=page.getByRole('navigation',{name:'切换内容频道',exact:true});assert.equal(await menu.getByRole('link',{name:'阅读',exact:true}).getAttribute('href'),'#/shelf');
  await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);await page.getByLabel('切换频道',{exact:true}).click();await page.getByRole('link',{name:'音乐',exact:true}).filter({visible:true}).click();await hash('#/media/music');await page.getByLabel('切换频道',{exact:true}).click();await menu.getByRole('link',{name:'影视',exact:true}).click();await hash('#/media/video');
  await page.getByLabel('更多影音操作').click();await page.getByRole('button',{name:'影音设置',exact:true}).click();await hash('#/media/video/settings');await heading('影音设置');await capture('settings');
  await page.getByRole('button',{name:/^浏览偏好/}).click();await hash('#/media/video/settings/browse');await heading('浏览偏好');await page.reload();await heading('浏览偏好');await capture('preferences');
  await page.getByLabel('封面密度',{exact:true}).selectOption('comfortable');await page.goBack();await heading('影音设置');await page.goForward();await heading('浏览偏好');assert.equal(await page.getByLabel('封面密度',{exact:true}).inputValue(),'comfortable');await page.getByRole('button',{name:'返回影音设置',exact:true}).click();await page.getByText('浏览偏好尚未保存。',{exact:true}).waitFor();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await hash('#/media/video/settings');await page.getByRole('button',{name:/^我的收藏/}).click();await hash('#/media/video/favorites?from=settings');await heading('我的收藏');await page.locator('.media-tile').first().waitFor();await capture('favorites');
  assert.equal(await page.getByLabel('更多影音操作').isVisible(),false);await page.reload();await heading('我的收藏');await page.locator('.media-tile').first().waitFor();await page.locator('.media-tile').first().click();await page.locator('.media-detail-page').waitFor();await page.getByRole('button',{name:'← 返回',exact:true}).click();await hash('#/media/video/favorites?from=settings');await heading('我的收藏');
  await page.getByRole('button',{name:'← 返回',exact:true}).click();await hash('#/media/video/settings');await heading('影音设置');
  await page.getByRole('button',{name:/^播放历史/}).click();await hash('#/media/video/history?from=settings');await heading('播放历史');await page.goBack();await heading('影音设置');await page.goForward();await heading('播放历史');await capture('history');
  await page.getByRole('button',{name:'← 返回',exact:true}).click();await page.getByRole('button',{name:/^媒体库管理/}).click();await hash('#/media/video/settings/libraries');await heading('媒体库管理');await capture('libraries');await page.getByRole('button',{name:'返回影音设置',exact:true}).click();await heading('影音设置');
  await page.getByRole('button',{name:'← 返回影音',exact:true}).click();await hash('#/media/video');await page.getByRole('button',{name:'我的收藏',exact:true}).click();await hash('#/media/video/favorites');await heading('我的收藏');await page.getByRole('button',{name:'← 返回',exact:true}).click();await hash('#/media/video');
  await page.goto(baseUrl+'/#/media/music/favorites');await heading('我的收藏');await page.getByText('还没有收藏，打开作品详情即可收藏。',{exact:true}).waitFor();await capture('favorites-empty');
  // Decode a real WAV in the browser while navigation uses the normal app/router.
  const samples=8000*30,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const part={id:'navigation-part',assetId:'navigation-asset',title:'导航测试音频',start:0,end:30,available:true};let starts=0;
  await page.route('**/api/v1/media/**',async route=>{
   const path=new URL(route.request().url()).pathname.split('/api/v1/media/')[1];let data;
   if(path==='items/navigation-song')data={id:'navigation-song',libraryId:'track-lib',kind:'track',title:'导航测试音频',metadata:{artist:'测试艺人'},overrides:{},children:[],editions:[{id:'navigation-edition',label:'测试版',parts:[part]}]};
   else if(path==='items/navigation-song/favorite')data={favorite:false};
   else if(path==='streams/navigation-audio.wav')return route.fulfill({contentType:'audio/wav',body:wav});
   else if(path==='playback'){starts++;data={id:'navigation-session',itemId:'navigation-song',partId:part.id,streamUrl:'/api/v1/media/streams/navigation-audio.wav',contentType:'audio/wav',expiresAt:Date.now()+3600000,position:0,start:0,end:30,revision:0};}
   else if(path.startsWith('playback/navigation-session'))data={position:0,revision:1,completed:false};
   else return route.continue();
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(baseUrl+'/#/media/music/navigation-song');await page.locator('.media-detail-page').waitFor();await page.getByRole('button',{name:'播放',exact:true}).first().click();await page.waitForFunction(()=>{const a=document.querySelector('.media-player audio');return a?.readyState>=2&&!a.paused;});
  const source=await page.locator('.media-player audio').evaluate(a=>a.currentSrc);await page.getByRole('button',{name:'← 返回',exact:true}).click();await hash('#/media/music');await page.setViewportSize({width:390,height:844});
  await page.getByLabel('切换频道',{exact:true}).click();await menu.getByRole('link',{name:'有声书',exact:true}).click();await hash('#/media/audiobook');await page.getByLabel('更多影音操作').click();await page.getByRole('button',{name:'影音设置',exact:true}).click();await heading('影音设置');await page.getByRole('button',{name:/^播放设置/}).click();await heading('播放设置');
  assert.equal(await page.locator('.media-player audio').evaluate(a=>a.currentSrc),source);assert.equal(await page.locator('.media-player audio').evaluate(a=>a.paused),false);assert.equal(starts,1);
  const mini=await page.locator('.media-player').boundingBox();assert.ok(mini.y+mini.height>814&&mini.y+mini.height<=844,'mini player must use the freed bottom area');
  await page.getByRole('button',{name:'打开播放器',exact:true}).click();await page.getByRole('button',{name:'← 返回浏览',exact:true}).click();await heading('播放设置');await hash('#/media/audiobook/settings/playback');
  const member=await browser.newPage();member.on('pageerror',error=>errors.push(error.message));await member.goto(baseUrl+'/#/media/video/settings/libraries');await member.locator('#login-username').fill('review-member');await member.locator('#login-password').fill('review-test-pass');await member.locator('form button[type=submit]').click();await member.waitForURL('**/#/media/video/settings');await member.getByRole('heading',{name:'影音设置',exact:true}).waitFor();assert.equal(await member.getByRole('button',{name:/^媒体库管理/}).count(),0);await member.goto(baseUrl+'/#/media/video/settings/plugins');await member.getByRole('heading',{name:'需要管理员权限',exact:true}).waitFor();await member.close();
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'verification.json'),JSON.stringify({passed:true,shots,checks:['mobile channel switch and Escape','no mobile bottom bar','settings child reload','personal origin reload and detail return','browser back/forward','desktop one header','reading link preserved','audio source/session survives channel and settings navigation','mini player bottom offset','member deep-link permissions'],browserErrors:errors},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>影音导航与路由评审</title><style>body{font:14px/1.6 system-ui;background:#f4f3ef;color:#30392c;margin:24px}img{max-width:100%;border:1px solid #ddd}section{margin:28px 0}</style><h1>频道切换与独立页面路由</h1><p>本轮按最新要求移除移动端底部频道栏。频道首页标题旁下拉切换；设置及其子页、收藏、历史有独立地址。二级页统一返回和标题，个人内容标注频道。实际客户端与临时服务、测试账号资料。</p>${shots.map(key=>`<section><h2>${key}</h2><img src="${key}.png"></section>`).join('')}</html>`);console.log(JSON.stringify({passed:true,screenshots:shots.length}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
