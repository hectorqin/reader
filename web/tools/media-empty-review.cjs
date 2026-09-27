// Real browser empty-state checks; only library listing is synthetic.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/empty-library-review');await fs.mkdir(out,{recursive:true});
 const sampleDir=await fs.mkdtemp(join(require('node:os').tmpdir(),'reader-empty-review-'));
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let buffer='';const timer=setTimeout(()=>no(Error(logs)),30000);server.stdout.on('data',d=>{buffer+=d;for(const line of buffer.split('\n')){try{const v=JSON.parse(line);if(v.baseUrl){clearTimeout(timer);ok(v);}}catch{}}});server.once('exit',()=>{clearTimeout(timer);no(Error(logs));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
  let existing=false;
  await page.route('**/api/v1/media/libraries',async route=>{if(route.request().method()!=='GET')return route.continue();await route.fulfill({contentType:'application/json',body:JSON.stringify({items:existing?[{id:'review-lib',name:'空测试库',kind:'video',access:'all'}]:[]})});});
  await page.route('**/api/v1/media/libraries/review-lib/items?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({items:[],total:0})}));
  await page.goto(baseUrl+'/#/media/video');await page.locator('#login-username').fill('reviewer');await page.locator('#login-password').fill('review-test-pass');await page.locator('form button[type=submit]').click();
  for(const channel of ['video','music','audiobook']){
   await page.evaluate(channel=>location.hash='#/media/'+channel,channel);await page.locator('.media-library-empty').waitFor();
   assert.equal(await page.getByLabel('媒体库',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'文件夹',exact:true}).count(),0);
   for(const width of [360,390,1120])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.mouse.move(0,0);
    const box=await page.locator('.media-library-empty button').boundingBox();assert.ok(box&&box.y>0&&box.y+box.height<760);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const file=`${channel}-${width}-${theme}.png`;await page.screenshot({path:join(out,file)});checks.push({channel,width,theme,file});
   }
  }
  await page.evaluate(()=>location.hash='#/media/video');await page.getByRole('button',{name:'添加影视媒体库',exact:true}).click();
  await page.getByRole('heading',{name:'新建媒体库',exact:true}).waitFor();await page.getByRole('button',{name:'← 返回内容',exact:true}).click();await page.locator('.media-library-empty').waitFor();
  // Exercise creation, scanning and task navigation against the disposable server.
  await page.getByRole('button',{name:'添加影视媒体库',exact:true}).click();
  await page.getByRole('button',{name:'← 返回内容',exact:true}).click();await page.getByLabel('更多影音操作').click();await page.getByRole('button',{name:'历史',exact:true}).click();
  await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();assert.equal(await page.locator('.media-library-onboarding').count(),0);
  await page.getByRole('button',{name:'← 返回',exact:true}).click();await page.getByRole('button',{name:'添加影视媒体库',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('验收空目录');await page.getByLabel('服务器目录',{exact:true}).fill(sampleDir);
  await page.getByRole('button',{name:'创建并扫描',exact:true}).click();await page.getByRole('heading',{name:'扫描与刮削',exact:true}).waitFor();
  await page.getByText('已完成 · 已检查 0',{exact:true}).waitFor();
  await page.getByLabel('更多影音操作').click();await page.getByRole('button',{name:'返回内容',exact:true}).click();
  assert.equal(await page.getByLabel('媒体库',{exact:true}).locator('option:checked').textContent(),'验收空目录');
  // Existing empty libraries keep their selector and offer management, not a misleading create action.
  existing=true;await page.reload();await page.getByRole('button',{name:'管理媒体库',exact:true}).waitFor();assert.equal(await page.getByLabel('媒体库',{exact:true}).count(),1);
  await page.getByRole('button',{name:'管理媒体库',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'verification.json'),JSON.stringify({passed:true,checks,browserErrors:errors,createEntryAndCancel:true,createScanAndReturn:true,personalNavigationAfterCreationExit:true,existingLibraryManagement:true},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>媒体库空状态</title><style>body{font:14px system-ui;background:#e9e9e4;margin:24px;color:#30392c}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}img{width:100%;border:1px solid #ddd}figure{margin:0}</style><h1>媒体库空状态</h1><p>真实应用截图。尚未建库时隐藏空筛选器，以主按钮进入创建表单；已建库但无内容时可进入管理；普通用户不显示管理员操作。</p><div class="grid">${checks.map(r=>`<figure><p>${r.channel} · ${r.width} · ${r.theme}</p><img src="${r.file}"></figure>`).join('')}</div></html>`);
  console.log(JSON.stringify({passed:true,screenshots:checks.length,browserErrors:errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));if(require('node:path').dirname(sampleDir)===resolve(require('node:os').tmpdir())&&require('node:path').basename(sampleDir).startsWith('reader-empty-review-'))await fs.rm(sampleDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
