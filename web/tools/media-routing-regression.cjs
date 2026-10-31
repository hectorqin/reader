const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..');const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let text='';server.stdout.on('data',d=>{text+=d;for(const line of text.split('\n'))try{const v=JSON.parse(line);if(v.baseUrl)ok(v);}catch{}});server.once('exit',()=>no(Error(logs)));});
  browser=await chromium.launch({headless:true,...(process.env.PROTOTYPE_CHROMIUM?{executablePath:process.env.PROTOTYPE_CHROMIUM}:{})});const page=await browser.newPage({viewport:{width:545,height:834}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const artist={id:'route-artist',libraryId:'track-lib',kind:'artist',title:'自然录音',parentId:null,metadata:{},overrides:{},children:[],editions:[]};
  const album={id:'route-album',libraryId:'track-lib',kind:'album',title:'午后散步',parentId:artist.id,metadata:{artist:'自然录音',year:2026},overrides:{},children:[],editions:[]};artist.children=[album];
  await page.route('**/api/v1/media/**',async route=>{const u=new URL(route.request().url()),path=u.pathname.split('/api/v1/media/')[1];let data;
   if(path==='browse'||path.endsWith('/items'))data={items:[u.searchParams.get('kind')==='artist'?artist:album],total:1};
   else if(path==='items/'+album.id)data=album;else if(path==='items/'+artist.id)data=artist;
   else if(path==='items/'+album.id+'/album-playback')data={tracks:[]};
   else if(path.endsWith('/favorite'))data={favorite:false};else return route.continue();
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  // Log in on the route under test: the login page renders on any hash, then shows that route.
  await page.goto(baseUrl+'/#/media/music');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
  const tabs=page.getByRole('navigation',{name:'音乐分类',exact:true});
  await tabs.getByRole('link',{name:'专辑',exact:true}).waitFor();
  // A channel's bare path is its first category.
  await page.waitForFunction(()=>location.hash.startsWith('#/media/music/albums'));
  await page.locator('.media-tile').filter({hasText:'午后散步'}).waitFor();
  const albumsUrl=page.url();
  await tabs.getByRole('link',{name:'歌手',exact:true}).click();await page.locator('.media-tile').filter({hasText:'自然录音'}).waitFor();const artistsUrl=page.url();
  await tabs.getByRole('link',{name:'专辑',exact:true}).click();await page.locator('.media-tile').filter({hasText:'午后散步'}).click();
  await page.getByRole('heading',{name:'专辑详情',exact:true}).waitFor();
  // A detail page has its own actions, not the channel menu (收藏/历史/队列/媒体库管理).
  const globalMenu=await page.getByRole('button',{name:'更多操作',exact:true}).count();
  const trigger=page.getByRole('button',{name:'作品操作',exact:true}),menu=page.getByRole('menu',{name:'作品操作'});
  await trigger.click();await menu.waitFor();
  await page.getByRole('heading',{name:'午后散步',exact:true}).click();const outsideCloses=await menu.count()===0;
  await trigger.click();await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
  assert.equal(await trigger.evaluate(button=>button===document.activeElement),true,'Escape returns focus to the trigger');
  const detailUrl=page.url();assert.match(detailUrl,/#\/media\/music\/items\/route-album/);
  await page.reload();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await page.getByRole('link',{name:/^返回/}).first().click();await page.locator('.media-tile').filter({hasText:'午后散步'}).waitFor();
  const currentTab=async()=>{const tab=tabs.locator('[aria-current=page]');return await tab.count()?tab.innerText():null;};
  // The albums list is /media/music/albums (the bare channel redirects there); its tab must read as current.
  const backHash=new URL(page.url()).hash,backTab=await currentTab();
  const albumReturnsToItsList=backHash===new URL(albumsUrl).hash&&backTab==='专辑';
  await page.locator('.media-tile').first().click();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await page.goBack();await page.locator('.media-tile').filter({hasText:'午后散步'}).waitFor();
  const historyBackMarksAlbumTab=await currentTab()==='专辑';
  await page.goForward();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await trigger.click();await menu.getByRole('menuitem',{name:'编辑资料',exact:true}).click();await page.getByRole('heading',{name:'元数据',exact:true}).waitFor();assert.match(page.url(),/items\/route-album\/metadata/);
  await page.getByRole('button',{name:'在线匹配',exact:true}).click();await page.getByRole('heading',{name:'匹配作品',exact:true}).waitFor();assert.match(page.url(),/items\/route-album\/match/);
  await page.getByRole('button',{name:'返回作品详情',exact:true}).click();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();assert.match(page.url(),/items\/route-album$/);
  // 影音设置 is gone: old links land on the one preferences page in 我的.
  await page.evaluate(()=>location.hash='#/media/music/settings');await page.waitForFunction(()=>location.hash.startsWith('#/me/settings'));
  await page.getByRole('tab',{name:'外观与主题',exact:true,selected:true}).waitFor();
  await page.evaluate(()=>location.hash='#/media/music/settings/browse');await page.waitForFunction(()=>location.hash.startsWith('#/me/settings'));
  // Library administration keeps its own routes.
  await page.evaluate(()=>location.hash='#/media/music/settings/libraries');await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();const managerUrl=page.url();
  await page.getByRole('button',{name:'新建媒体库',exact:true}).first().click();await page.getByRole('heading',{name:'新建媒体库',exact:true}).waitFor();assert.match(page.url(),/settings\/libraries\/new/);
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();assert.equal(page.url(),managerUrl);
  const libraryMenu=page.locator('button.media-library-actions').first();
  await libraryMenu.click();await page.getByRole('menuitem',{name:'编辑媒体库',exact:true}).click();await page.getByRole('heading',{name:'编辑媒体库',exact:true}).waitFor();assert.match(page.url(),/settings\/libraries\/[^/]+\/edit/);
  await page.reload();await page.getByRole('heading',{name:'编辑媒体库',exact:true}).waitFor();await page.getByRole('button',{name:'返回媒体库管理',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();assert.equal(page.url(),managerUrl);
  await libraryMenu.click();await page.getByRole('menuitem',{name:'访问权限',exact:true}).click();await page.getByRole('heading',{name:'访问权限',exact:true}).waitFor();assert.match(page.url(),/\/permissions/);
  await page.getByRole('button',{name:'返回媒体库管理',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();assert.equal(page.url(),managerUrl);
  assert.deepEqual(errors,[]);
  const result={distinctCategoryUrls:albumsUrl!==artistsUrl,detailHasNoChannelMenu:!globalMenu,outsideCloses,albumReturnsToItsList,historyBackMarksAlbumTab,reloadAndHistory:true,metadataRoutes:true,libraryRoutes:true,legacySettingsRedirect:true};console.log(JSON.stringify({...result,backHash,backTab}));assert.ok(Object.values(result).every(Boolean),'Navigation regression: '+JSON.stringify(result));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
