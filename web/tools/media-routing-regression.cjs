const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..');const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let text='';server.stdout.on('data',d=>{text+=d;for(const line of text.split('\n'))try{const v=JSON.parse(line);if(v.baseUrl)ok(v);}catch{}});server.once('exit',()=>no(Error(logs)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:545,height:834}});
  const artist={id:'route-artist',libraryId:'track-lib',kind:'artist',title:'自然录音',parentId:null,metadata:{},overrides:{},children:[],editions:[]};
  const album={id:'route-album',libraryId:'track-lib',kind:'album',title:'午后散步',parentId:artist.id,metadata:{artist:'自然录音',year:2026},overrides:{},children:[],editions:[]};artist.children=[album];
  await page.route('**/api/v1/media/**',async route=>{const u=new URL(route.request().url()),path=u.pathname.split('/api/v1/media/')[1];let data;
   if(path==='browse'||path.endsWith('/items'))data={items:[u.searchParams.get('kind')==='artist'?artist:album],total:1};
   else if(path==='items/'+album.id)data=album;else if(path==='items/'+artist.id)data=artist;
   else if(path.endsWith('/favorite'))data={favorite:false};else return route.continue();
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(baseUrl+'/#/media/music');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();await page.getByRole('button',{name:'专辑',exact:true}).waitFor();
  const albumsUrl=page.url();await page.getByRole('button',{name:'歌手',exact:true}).click();await page.getByText('自然录音',{exact:true}).first().waitFor();const artistsUrl=page.url();
  await page.getByRole('button',{name:'专辑',exact:true}).click();await page.locator('.media-tile').first().click();await page.getByRole('heading',{name:'专辑详情',exact:true}).waitFor();
  const globalMenu=await page.getByLabel('更多影音操作',{exact:true}).count();
  const menu=page.locator('.media-item-actions');await menu.locator('summary').click();assert.equal(await menu.evaluate(e=>e.open),true);
  await page.getByRole('heading',{name:'午后散步',exact:true}).click();const outsideCloses=!(await menu.evaluate(e=>e.open));
  await menu.locator('summary').click();await page.keyboard.press('Escape');assert.equal(await menu.evaluate(e=>e.open),false);
  const detailUrl=page.url();assert.match(detailUrl,/music\/album\/route-album/);
  await page.reload();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await page.getByRole('button',{name:'← 返回',exact:true}).click();await page.locator('.media-tabs [aria-current=page]').waitFor();
  const albumReturnsToItsList=new URL(page.url()).hash===new URL(albumsUrl).hash&&await page.locator('.media-tabs [aria-current=page]').innerText()==='专辑';
  await page.locator('.media-tile').first().click();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await page.goBack();await page.locator('.media-tabs [aria-current=page]').waitFor();assert.equal(await page.locator('.media-tabs [aria-current=page]').innerText(),'专辑');
  await page.goForward();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await page.locator('.media-item-actions summary').click();await page.getByRole('button',{name:'管理元数据',exact:true}).click();await page.getByRole('heading',{name:'元数据',exact:true}).waitFor();assert.match(page.url(),/items\/route-album\/metadata/);
  await page.getByRole('button',{name:'在线匹配',exact:true}).click();await page.getByRole('heading',{name:'匹配作品',exact:true}).waitFor();assert.match(page.url(),/items\/route-album\/match/);
  await page.getByRole('button',{name:'返回作品详情',exact:true}).click();await page.getByRole('heading',{name:'午后散步',exact:true}).waitFor();
  await page.evaluate(()=>location.hash='#/media/music/settings');await page.getByRole('heading',{name:'影音设置',exact:true}).waitFor();await page.getByRole('button',{name:/^浏览偏好/}).click();await page.getByRole('heading',{name:'浏览偏好',exact:true}).waitFor();await page.getByRole('button',{name:'返回影音设置',exact:true}).click();await page.getByRole('heading',{name:'影音设置',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'#/media/music/settings');
  await page.getByRole('button',{name:/^媒体库管理/}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();const managerUrl=page.url();await page.getByRole('button',{name:'新建媒体库',exact:true}).click();await page.getByRole('heading',{name:'新建媒体库',exact:true}).waitFor();assert.match(page.url(),/settings\/libraries\/new/);await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();assert.equal(page.url(),managerUrl);
  await page.locator('.media-library-actions summary').first().click();await page.getByRole('button',{name:'编辑媒体库',exact:true}).filter({visible:true}).click();await page.getByRole('heading',{name:'编辑媒体库',exact:true}).waitFor();assert.match(page.url(),/settings\/libraries\/[^/]+\/edit/);await page.reload();await page.getByRole('heading',{name:'编辑媒体库',exact:true}).waitFor();await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();assert.equal(page.url(),managerUrl);
  await page.locator('.media-library-actions summary').first().click();await page.getByRole('button',{name:'权限',exact:true}).filter({visible:true}).click();await page.getByRole('heading',{name:'访问权限',exact:true}).waitFor();assert.match(page.url(),/\/permissions/);await page.getByRole('button',{name:'返回媒体库',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
  const result={distinctCategoryUrls:albumsUrl!==artistsUrl,detailHasNoGlobalMenu:!globalMenu,outsideCloses,albumReturnsToItsList,reloadAndHistory:true,metadataRoutes:true,libraryRoutes:true,settingsBack:true};console.log(JSON.stringify(result));assert.ok(Object.values(result).every(Boolean),'Navigation regression: '+JSON.stringify(result));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
