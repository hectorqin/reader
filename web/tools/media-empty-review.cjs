// Real browser empty-state checks; only the library listing (fixture libraries hidden) and channel browse are synthetic.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/empty-library-review');await fs.mkdir(out,{recursive:true});
 const sampleDir=await fs.mkdtemp(join(require('node:os').tmpdir(),'reader-empty-review-'));
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let buffer='';const timer=setTimeout(()=>no(Error(logs)),30000);server.stdout.on('data',d=>{buffer+=d;for(const line of buffer.split('\n')){try{const v=JSON.parse(line);if(v.baseUrl){clearTimeout(timer);ok(v);}}catch{}}});server.once('exit',()=>{clearTimeout(timer);no(Error(logs));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
  // The fixture always seeds its own libraries; hide them (and their catalog) so the
  // browser sees a server without media. Libraries this review creates stay visible.
  const fixtureLibraries=new Set(['review-lib','track-lib','track-empty-lib']);
  await page.route('**/api/v1/media/libraries',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,items:body.items.filter(item=>!fixtureLibraries.has(item.id))}});});
  await page.route('**/api/v1/media/browse?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({items:[],total:0})}));
  await page.goto(baseUrl+'/#/media/video');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();
  for(const channel of ['video','music','audiobook']){
   await page.evaluate(channel=>location.hash='#/media/'+channel,channel);await page.locator('.media-library-empty').waitFor();
   // No library yet: no source selector, folder entry or category tabs to act on.
   assert.equal(await page.getByLabel('来源库',{exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'打开文件夹',exact:true}).count(),0);assert.equal(await page.locator('.media-tabs').count(),0);
   for(const width of [360,390,1120])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.mouse.move(0,0);
    const box=await page.locator('.media-library-empty button').boundingBox();assert.ok(box&&box.y>0&&box.y+box.height<760);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const file=`${channel}-${width}-${theme}.png`;await page.screenshot({path:join(out,file)});checks.push({channel,width,theme,file});
   }
  }
  await page.setViewportSize({width:390,height:844});
  // Create entry and cancel: the untouched form leaves without a confirmation, back to 媒体库管理, then back to the channel.
  await page.evaluate(()=>location.hash='#/media/video');await page.getByRole('button',{name:'添加媒体库',exact:true}).click();
  await page.getByRole('heading',{name:'新建媒体库',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();await page.getByRole('heading',{name:'还没有媒体库',exact:true}).waitFor();
  await page.getByRole('link',{name:'返回频道',exact:true}).click();await page.locator('.media-library-empty').waitFor();
  // Personal pages stay reachable from the channel ⋯ menu and do not show the library empty state.
  await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'历史',exact:true}).click();
  await page.getByRole('heading',{name:'播放历史',exact:true}).waitFor();assert.equal(await page.locator('.media-library-empty').count(),0);
  await page.getByRole('link',{name:'返回频道',exact:true}).click();await page.locator('.media-library-empty').waitFor();
  // Exercise creation, scanning and task navigation against the disposable server.
  await page.getByRole('button',{name:'添加媒体库',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('验收空目录');await page.getByLabel('服务器目录',{exact:true}).fill(sampleDir);
  await page.getByRole('button',{name:'创建并扫描',exact:true}).click();await page.getByRole('heading',{name:'扫描与刮削',exact:true}).waitFor();
  const job=page.locator('.media-scan-job').filter({hasText:'验收空目录'});await job.locator('.media-task-state',{hasText:'已完成'}).waitFor();assert.match(await job.locator('small').first().textContent(),/^已检查 0 个文件/);
  await page.getByRole('link',{name:'返回媒体库管理',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();await page.getByText('1 个媒体库',{exact:true}).waitFor();
  // An existing but empty library keeps its selector and offers management, not a misleading create action.
  await page.getByRole('link',{name:'返回频道',exact:true}).click();await page.getByRole('button',{name:'管理媒体库',exact:true}).waitFor();
  assert.equal(await page.getByLabel('来源库',{exact:true}).locator('option:checked').textContent(),'验收空目录');
  assert.equal(await page.getByRole('button',{name:'添加媒体库',exact:true}).count(),0);
  await page.getByRole('button',{name:'管理媒体库',exact:true}).click();await page.getByRole('heading',{name:'媒体库管理',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'verification.json'),JSON.stringify({passed:true,checks,browserErrors:errors,createEntryAndCancel:true,createScanAndReturn:true,personalNavigationAfterCreationExit:true,existingLibraryManagement:true},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>媒体库空状态</title><style>body{font:14px system-ui;background:#e9e9e4;margin:24px;color:#30392c}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}img{width:100%;border:1px solid #ddd}figure{margin:0}</style><h1>媒体库空状态</h1><p>真实应用截图。尚未建库时隐藏空筛选器，以主按钮进入创建表单；已建库但无内容时可进入管理；普通用户不显示管理员操作。</p><div class="grid">${checks.map(r=>`<figure><p>${r.channel} · ${r.width} · ${r.theme}</p><img src="${r.file}"></figure>`).join('')}</div></html>`);
  console.log(JSON.stringify({passed:true,screenshots:checks.length,browserErrors:errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));if(require('node:path').dirname(sampleDir)===resolve(require('node:os').tmpdir())&&require('node:path').basename(sampleDir).startsWith('reader-empty-review-'))await fs.rm(sampleDir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
