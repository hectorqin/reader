import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const root=await mkdtemp(join(tmpdir(),'reader-media-features-'));
const output=join(repo,'artifacts/ui-review/media-features');
await mkdir(join(root,'books'));await mkdir(output,{recursive:true});
const child=spawn(process.execPath,[join(repo,'server/dist/main.js')],{cwd:repo,stdio:['ignore','pipe','pipe'],env:{...process.env,BOOKS_DIR:join(root,'books'),DATA_DIR:join(root,'data'),WEB_DIR:join(repo,'web/dist'),HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',READER_TOKEN_SECRET:'media-features-browser-fixture',SCAN_INTERVAL:'0',WATCH_INTERVAL:'0'}});
const exited=new Promise(resolveExit=>child.once('exit',resolveExit));
let logs='';child.stderr.on('data',chunk=>{logs+=chunk;});
const lines=createInterface({input:child.stdout});
let browser;
try{
  const origin=await new Promise((resolveOrigin,reject)=>{
    const timer=setTimeout(()=>reject(new Error('fixture start timeout '+logs)),30000);
    lines.on('line',line=>{
      logs+=line+'\n';
      try{const match=JSON.parse(line).msg?.match(/Server listening at (http:\/\/\S+)/);if(match){clearTimeout(timer);resolveOrigin(match[1]);}}catch{}
    });
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('fixture exited '+logs));});
  });
  const call=async(path,method='GET',body,token)=>{
    const response=await fetch(origin+'/api/v1/'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
  };
  const {session}=await call('auth/register','POST',{username:'admin',password:'password123'});
  const token=session.accessToken;
  const {user:member}=await call('admin/users','POST',{username:'member',password:'password123',displayName:'Member',role:'member'},token);
  const waitState=async state=>{
    for(let attempt=0;attempt<100;attempt++){
      if((await call('auth/me','GET',undefined,token)).user.mediaState===state)return;
      await delay(100);
    }
    throw new Error('media state did not become '+state);
  };
  await waitState('ready');
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const admin=await browser.newPage({viewport:{width:1120,height:900}});
  const errors=[];
  admin.on('pageerror',error=>errors.push(error.message));
  const login=async(page,name)=>{
    await page.goto(origin);
    await page.locator('#login-username').fill(name);
    await page.locator('#login-password').fill('password123');
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.locator('.app-nav').waitFor();
  };
  await login(admin,'admin');
  const toggleUser=async(name,enabled)=>{
    await admin.goto(origin+'/#/me/admin/users');
    const card=admin.locator('.user-manager-list > li').filter({hasText:'@'+name});
    await card.getByRole('button',{name:enabled?'启用影音':'关闭影音',exact:true}).click();
    await admin.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();
    await card.getByRole('button',{name:enabled?'关闭影音':'启用影音',exact:true}).waitFor();
  };
  await toggleUser('member',false);
  assert.equal((await call('auth/me','GET',undefined,token)).user.features.media,true);
  const memberContext=await browser.newContext({viewport:{width:390,height:844}});
  const memberPage=await memberContext.newPage();
  memberPage.on('pageerror',error=>errors.push(error.message));
  const mediaRequests=[];
  memberPage.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/v1/media/'))mediaRequests.push(request.url());});
  await login(memberPage,'member');
  assert.equal(await memberPage.locator('.app-nav-list > li').count(),3);
  assert.equal(await memberPage.locator('.media-player').count(),0);
  for(const route of ['/search?q=fixture','/me/settings?section=playback','/me/stats','/media/video']){
    await memberPage.goto(origin+'/#'+route);
    await delay(250);
    assert.equal(await memberPage.locator('body').evaluate(element=>element.scrollWidth>innerWidth),false,route);
  }
  await memberPage.getByRole('heading',{name:'影音模块未启用'}).waitFor();
  assert.equal(mediaRequests.length,0);
  const memberLogin=await call('auth/login','POST',{username:'member',password:'password123'});
  const denied=await fetch(origin+'/api/v1/media/libraries',{headers:{authorization:'Bearer '+memberLogin.accessToken}});
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).error.code,'MEDIA_DISABLED');
  await toggleUser('admin',false);
  const toggleGlobal=async enabled=>{
    await admin.goto(origin+'/#/me/admin/services');
    await admin.getByLabel('配置分类',{exact:true}).selectOption('modules');
    await admin.getByRole('checkbox',{name:'启用影音模块'}).setChecked(enabled);
    await admin.getByRole('button',{name:'保存配置',exact:true}).click();
    if(!enabled)await admin.getByRole('alertdialog').getByRole('button',{name:'确认',exact:true}).click();
    await waitState(enabled?'ready':'disabled');
  };
  await toggleGlobal(false);
  await admin.reload();
  await admin.getByText('影音服务：已关闭',{exact:true}).waitFor();
  await admin.getByLabel('配置分类',{exact:true}).selectOption('modules');
  assert.equal(await admin.locator('.app-nav-list > li').count(),3);
  assert.equal(await admin.locator('.media-player').count(),0);
  for(const width of [390,1120]){
    await admin.setViewportSize({width,height:900});
    assert.equal(await admin.locator('body').evaluate(element=>element.scrollWidth>innerWidth),false);
    await admin.screenshot({path:join(output,`pure-reading-${width}.png`),fullPage:true});
  }
  await toggleGlobal(true);
  assert.equal((await call('auth/me','GET',undefined,token)).user.features.media,false);
  await toggleUser('admin',true);
  await admin.locator('.app-nav-list > li').nth(3).waitFor();
  await toggleUser('member',true);
  await memberPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await memberPage.locator('.app-nav-list > li').nth(3).waitFor();
  assert.equal((await call('admin/users','GET',undefined,token)).users.find(user=>user.id===member.id).mediaEnabled,true);
  assert.deepEqual(errors,[]);
  console.log('PASS: administrator global/user switches, self-recovery, worker restart, pure-reading routes, no media requests/player, responsive layouts, and cross-window permission refresh');
}catch(error){
  if(browser)for(const context of browser.contexts())for(const page of context.pages()){
    console.error('PAGE',page.url(),(await page.locator('body').innerText()).slice(0,3000));
    await page.screenshot({path:join(output,`failure-${browser.contexts().indexOf(context)}.png`),fullPage:true});
  }
  throw error;
}finally{
  await browser?.close();lines.close();child.kill('SIGTERM');
  await Promise.race([exited,delay(10000)]);
  if(child.exitCode===null){child.kill('SIGKILL');await exited;}
  await rm(root,{recursive:true,force:true});
}
