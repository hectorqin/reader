import { chromium } from 'playwright';
import { createReviewServer } from './server.mjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
let savedName = '示例配置';
function extensionPage(body) {
 if (body) { assert.equal(body.action, 'save'); savedName = body.values.name; }
 return {title:'我的远程书源', forms:[], ...(body ? {notice:'配置已保存'} : {}), tabs:[
  {id:'settings', title:'基本配置', forms:[{id:'save', title:'来源设置', submit:'保存配置', fields:[{key:'name',label:'配置名称',type:'text',value:savedName}],values:{}}]},
  {id:'logs', title:'运行日志', forms:[], outputs:[{title:'最近执行',text:'<script>throw new Error("unsafe")</script>\n运行完成',format:'log'}]}
 ]};
}
const server=createReviewServer({port:5299});const base=await server.listen();
const browser=await chromium.launch({...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),headless:true});
const book={id:'extension-book',title:'多书源示例',author:'示例作者',format:'chapters',source:'provider:example',tags:[],manualFields:[],updatedAt:1};
const content=revision=>({kind:'text',total:2,revision,groups:[{id:'all',seq:0,offset:0,count:2,title:'章节'}],items:['one','two'].map((id,seq)=>({id,seq,title:seq?'第二章 远行':'第一章 初见',href:'chapter:'+revision+id,resourceRef:'resource:'+revision+id,kind:'chapter',format:'html',mediaType:'text/plain'}))});
let revision='old',fail=true;
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;let json;
  if(p.includes('/sources/catalog/pages/library')) {const body=req.method()==='POST'?req.postDataJSON():null;json=extensionPage(body);}
  else if(p==='/api/v1/sources/types') json={types:[{id:'example',pluginId:'reader.source.example',label:'远程书源库',capabilities:['search','search.filters']}]};
  else if(p==='/api/v1/sources') json={sources:[{id:'catalog',pluginId:'reader.source.example',sourceType:'example',name:'我的远程书源',enabled:true,descriptor:{capabilities:['search','search.filters'],extensions:{pages:[{id:'library',title:'来源配置'}]}}}]};
  else if(p==='/api/v1/subscriptions')json={subscriptions:[]};
  else if(p==='/api/v1/plugins')json={plugins:[]};
  else if(p.endsWith('/search-filters'))json=[{key:'group',label:'分组',type:'select',options:[{value:'',label:'全部分组'},{value:'fiction',label:'小说'}]},{key:'source',label:'书源',type:'select',options:[{value:'',label:'全部书源'},{value:'a',label:'示例书源 A'}]}];
  else if(p==='/api/v1/sources/catalog/search')return route.fulfill({contentType:'text/event-stream',body:'event: results\ndata: '+JSON.stringify({title:'示例书源 A',items:[{ref:'candidate',title:book.title,authors:[book.author],description:'【示例书源 A】'}]})+'\n\nevent: done\ndata: {}\n\n'});
  else if(p==='/api/v1/books/extension-book')json={book,progress:null};
  else if(p.endsWith('/extension-book/manifest'))json={book,files:[],contentUrl:'',coverUrl:null,content:content(revision),...content(revision)};
  else if(p.endsWith('/extension-book/source-options'))json={canSwitch:true};
  else if(p.endsWith('/extension-book/alternatives'))json={title:'其它书源',items:[{ref:'candidate',title:book.title,authors:[book.author],description:'【示例书源 B】'}]};
  else if(p.endsWith('/extension-book/switch-preview'))json={chapters:[{id:'new-one',title:'第一章 初见'},{id:'new-two',title:'第二章 远行'}]};
  else if(p.endsWith('/extension-book/switch-source')) {
   if(fail)return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:{code:'SOURCE_ERROR',message:'测试：新源暂时不可用'}})});
   revision='new';json={content:content(revision),href:'chapter:newtwo'};
  }
  else if(p.endsWith('/extension-book/assets'))return route.fulfill({contentType:'text/plain',body:'这是'+(revision==='old'?'旧书源':'新书源')+'的正文。\n\n'+ '阅读中的示例文本。'.repeat(100)});
  if(json!==undefined)return route.fulfill({contentType:'application/json',body:JSON.stringify(json)});
  return route.continue();
 });
 await page.goto(base); await page.locator('input[autocomplete="username"]').fill('review');await page.locator('input[type="password"]').fill('password12');await page.locator('button[type=submit]').click();await page.locator('.shelf-screen').waitFor();
 await page.goto(base+'/#/sources');await page.getByRole('tab',{name:'书源管理',exact:true}).click();await page.getByRole('button',{name:'管理',exact:true}).click();await page.getByRole('link',{name:'来源配置'}).click();await page.getByRole('heading',{name:'我的远程书源',exact:true}).waitFor();
 assert.equal(new URL(page.url()).hash,'#/sources/catalog/library');
 assert.equal(await page.getByRole('tab').count(),2);
 await page.getByLabel('配置名称').fill('修改后的配置');
 await page.getByRole('tab',{name:'运行日志',exact:true}).click();
 assert.match(await page.getByLabel('最近执行').textContent(), /<script>/);
 assert.equal(await page.locator('.extension-output script').count(),0);
 await page.getByRole('tab',{name:'基本配置',exact:true}).click();
 assert.equal(await page.getByLabel('配置名称').inputValue(),'修改后的配置');
 await page.getByRole('button',{name:'保存配置',exact:true}).click();
 await page.getByRole('status').filter({hasText:'配置已保存'}).waitFor();
 assert.equal(savedName,'修改后的配置');
 assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false);
 await mkdir('docs/ui-review',{recursive:true});await page.screenshot({path:'docs/ui-review/plugin-config-mobile.png'});
 for (const width of [1024, 1366, 1920]) {
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(await page.locator('.sources-body').evaluate(el=>el.getBoundingClientRect().width >= Math.min(innerWidth - 48, 1280)), 'desktop source page uses the shared content measure');
  assert.ok(await page.getByRole('tab').first().evaluate(el=>el.getBoundingClientRect().width<240), 'desktop tabs stay compact');
  await page.screenshot({path:`docs/ui-review/plugin-config-desktop-${width}.png`,animations:'disabled'});
  const bounds = selector => page.locator(selector).first().evaluate(el => {const r=el.getBoundingClientRect(); return {left:r.left,width:r.width};});
  const config = await bounds('.sources-body');
  const card = await bounds('.sources-body .sources-card');
  assert.ok(Math.abs(card.left - config.left - 14.4) < 1 && Math.abs(card.width - config.width + 28.8) < 1, 'nested plugin cards align with the content gutter');
  await page.goto(base+'/#/library'); await page.locator('.library-browse-body').waitFor();
  assert.deepEqual(await bounds('.library-browse-body'),config,'library and plugin configuration share the same width and position');
  const libraryHeader = await bounds('.collection-header');
  await page.goto(base+'/#/sources'); await page.locator('.sources-hub').waitFor();
  assert.deepEqual(await bounds('.sources-body'),config,'source hub and library share the same width and position');
  assert.deepEqual(await bounds('.sources-header'),libraryHeader,'source and library headings align');
  await page.screenshot({path:`docs/ui-review/sources-hub-desktop-${width}.png`,animations:'disabled'});
  await page.goto(base+'/#/sources/catalog/library'); await page.getByRole('heading',{name:'我的远程书源',exact:true}).waitFor();
 }
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/#/sources');await page.getByRole('combobox',{name:'选择来源',exact:true}).selectOption('catalog');await page.locator('.sources-search select').first().selectOption('fiction');await page.locator('input[type=search]').fill('多书源');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByText('【示例书源 A】',{exact:true}).waitFor();
 assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false);await page.screenshot({path:'docs/ui-review/plugin-search-mobile.png'});
 await page.goto(base+'/#/book/extension-book');await page.getByRole('button',{name:'目录',exact:true}).click();await page.getByRole('button',{name:'切换书源',exact:true}).click();await page.getByRole('button',{name:'查看此源目录',exact:true}).click();await page.locator('section[aria-label="切换书源"] select').selectOption('new-two');await page.screenshot({path:'docs/ui-review/plugin-switch-mobile.png'});
 await page.getByRole('button',{name:'确认换源并阅读',exact:true}).click();await page.getByText('测试：新源暂时不可用',{exact:true}).waitFor();assert.match(await page.locator('book-content .book-flow').textContent(),/旧书源/);
 fail=false;await page.getByRole('button',{name:'确认换源并阅读',exact:true}).click();await page.getByText('已切换书源，从所选章节开头继续阅读',{exact:true}).waitFor();assert.match(await page.locator('book-content .book-flow').textContent(),/新书源/);assert.deepEqual(errors,[]);
 console.log('PASS production Chromium: mobile/desktop config, generic settings, safe log output, generic filters, failed switch preserves view, successful switch lands on selected chapter');
} finally {await browser.close();await server.close();}
