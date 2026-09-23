import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { chromium } from 'playwright';
import { openDatabase } from '../../../server/src/db/index.ts';
import { buildApp } from '../../../server/src/http/app.ts';
import { Scanner } from '../../../server/src/indexer/scanner.ts';
import { UserService } from '../../../server/src/services/users.ts';
import { ShelfService } from '../../../server/src/services/shelf.ts';
import { SyncService } from '../../../server/src/services/sync.ts';
import { TtsService } from '../../../server/src/services/tts.ts';
import { BrowseService } from '../../../server/src/services/browse.ts';

const repo=resolve(import.meta.dirname,'../../..'), root=await mkdtemp(join(tmpdir(),'reader-p2-'));
const shots=join(repo,'docs/ui-review/p2');
const config={booksDir:join(root,'books'),dataDir:join(root,'data'),host:'127.0.0.1',port:0,jwtSecret:'isolated-p2-test-secret',accessTokenTtl:86400,refreshTokenTtl:86400,scanInterval:0,watchInterval:0,logLevel:'silent',publicUrl:'',corsOrigins:[],webDir:join(repo,'web/dist')};
let app,db,browser,page;
try {
 await Promise.all([mkdir(config.booksDir),mkdir(config.dataDir),mkdir(shots,{recursive:true})]);
 await writeFile(join(config.booksDir,'opds-test.txt'),'OPDS 文件正文');
 db=openDatabase(config);const ctx={config,db};app=buildApp(ctx);ctx.log=app.log;ctx.scanner=new Scanner(db,config,{info(){},warn(){}});ctx.users=new UserService(db,config);ctx.shelf=new ShelfService(db);ctx.sync=new SyncService(db,ctx.shelf);ctx.tts=new TtsService(config);ctx.browse=new BrowseService(db,config,ctx.shelf);
 await ctx.scanner.scan();
 const base=await app.listen({host:'127.0.0.1',port:0});
 const registered=await app.inject({method:'POST',url:'/api/v1/auth/register',payload:{username:'p2-reader',password:'password123'}});assert.equal(registered.statusCode,201);
 const user=db.get('SELECT id FROM users');
 const provider={descriptor:{id:'quality',label:'质量测试插件',version:'1',capabilities:['browse','detail','acquire.chapters','content.manifest','content.resource','content.alternatives'],credentialKeys:[{key:'password',label:'站点密码'}]},
  async browse(){return {items:[]};},async detail(){return {ref:'original',title:'换源质量测试',authors:['测试作者']};},
  async acquire(_ctx,request){return {kind:'chapters',publicationRef:request.entryRef};},
  async alternatives(){return {items:[{ref:'alternative',title:'换源质量测试',authors:['测试作者'],sourceName:'备选来源',latestChapter:'空白章'}]};},
  async getManifest(_ctx,ref){return {publicationRef:ref,items:[{id:'one',seq:0,title:'第一章',kind:'chapter',mediaType:'text/plain',ref:'body'},{id:'empty',seq:1,title:'空白章',kind:'chapter',mediaType:'text/plain',ref:'empty'}]};},
  async readResource(_ctx,request){return {mediaType:'text/plain',text:request.ref==='empty'?'  ':request.publicationRef==='original'?'原来的正文，换源失败时仍然保留。':'新来源的正文，供质量检测和阅读。'};}};
 ctx.sources.registry.register({pluginId:'test.quality',provider});
 await ctx.sources.create({id:'quality',pluginId:'test.quality',sourceType:'quality',name:'质量测试来源',config:{}});
 const acquired=await ctx.sources.acquire(user.id,'quality','original');assert.equal(acquired.kind,'ready');
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(12000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto(base);await page.locator('input[autocomplete=username]').fill('p2-reader');await page.locator('input[type=password]').fill('password123');await page.locator('button[type=submit]').click();await page.locator('.shelf-screen').waitFor();
 await page.goto(base+'/#/sources');await button('连接外部阅读器').click();
 await page.getByLabel('客户端名称').fill('浏览器验收客户端');await button('创建 OPDS 凭据').click();await page.getByLabel('OPDS 密码',{exact:true}).waitFor();
 const opdsUser=await page.getByLabel('OPDS 用户名',{exact:true}).inputValue(),opdsPassword=await page.getByLabel('OPDS 密码',{exact:true}).inputValue();
 const authorization='Basic '+Buffer.from(opdsUser+':'+opdsPassword).toString('base64');
 const feed=await fetch(base+'/opds',{headers:{authorization}});assert.equal(feed.status,200);assert.match(await feed.text(),/opds-test/);
 await button('关闭弹窗').click();await button('连接外部阅读器').click();await button('撤销 浏览器验收客户端').waitFor();assert.equal(await page.getByLabel('OPDS 密码',{exact:true}).count(),0);
 for(const width of [320,390,1280]) {await page.setViewportSize({width,height:844});await page.screenshot({path:join(shots,'opds-access-'+width+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await button('撤销 浏览器验收客户端').click();await button('撤销 浏览器验收客户端').waitFor({state:'hidden'});assert.equal((await fetch(base+'/opds',{headers:{authorization}})).status,401);await button('关闭弹窗').click();
 await page.getByLabel('选择来源').selectOption('quality');
 await page.locator('.source-capabilities summary').click();
 for(const width of [320,390,1280]) {await page.setViewportSize({width,height:844});await page.screenshot({path:join(shots,'capabilities-'+width+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await button('登录凭据').click();await page.getByText('最近一次访问成功',{exact:false}).waitFor();await page.locator('input[type=password]').fill('test-secret');await button('保存个人凭据').click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await button('登录凭据').click();await page.getByText('尚未验证访问',{exact:false}).waitFor();assert.equal(await page.locator('input[type=password]').inputValue(),'');
 for(const width of [320,390,1280]) {await page.setViewportSize({width,height:844});await page.screenshot({path:join(shots,'credentials-'+width+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await button('清空站点密码（保存后删除）').click();await button('保存个人凭据').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(ctx.sources.credentialStatus('quality',user.id).fields[0].configured,false);
 await page.goto(base+'/#/book/'+acquired.publicationId);await page.locator('book-content p').first().waitFor();await button('切换书源').click();await button('查看此源目录：备选来源').click();
 await page.getByLabel('切换后阅读的章节').selectOption('empty');await button('检测所选章节 / 重试').click();await page.getByRole('dialog').getByText('此章节没有可读正文',{exact:false}).waitFor();assert.equal(ctx.sources.chapters.binding(user.id,acquired.publicationId).publication_ref,'original');
 await button('确认换源并阅读').click();await page.locator('.notyf').getByText('此章节没有可读正文',{exact:false}).waitFor();assert.equal(ctx.sources.chapters.binding(user.id,acquired.publicationId).publication_ref,'original');
 await button('关闭提示').click();
 await page.getByLabel('切换后阅读的章节').selectOption('one');await button('检测所选章节 / 重试').click();await page.getByText('正文检测通过',{exact:true}).waitFor();
 for(const width of [320,390,1280]) {await page.setViewportSize({width,height:844});await page.screenshot({path:join(shots,'quality-'+width+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await button('确认换源并阅读').click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('book-content p').filter({hasText:'新来源的正文'}).waitFor();assert.equal(ctx.sources.chapters.binding(user.id,acquired.publicationId).publication_ref,'alternative');
 await button('设置').click();await button('应用电纸书预设').click();
 await page.waitForFunction(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('reader');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try {const stored=await new Promise((resolve,reject)=>{const request=db.transaction('kv','readonly').objectStore('kv').get('reader.settings.v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const value=JSON.parse(stored||'{}');return value.pageAnimation==='none'&&value.mode==='paged'&&value.theme==='light';}finally{db.close();}});
 assert.deepEqual(errors,[]);console.log('PASS P2 real HTTP + SQLite + Chromium '+browser.version()+': capability matrix, private credentials save/delete/reset, empty chapter rejection, quality preview and source switch; 320/390/1280px without overflow; e-ink preset; OPDS credential lifecycle and authenticated catalog');
} catch(error) {if(page){await page.screenshot({path:join(shots,'failure.png')});console.error((await page.locator('body').innerText()).slice(-3500));}throw error;}
finally {await browser?.close();await app?.close();db?.close();const cleanupRelative=relative(resolve(tmpdir()),resolve(root));if(!cleanupRelative||cleanupRelative.startsWith('..')||isAbsolute(cleanupRelative))throw new Error('Unsafe cleanup path');await rm(root,{recursive:true,force:true});}
