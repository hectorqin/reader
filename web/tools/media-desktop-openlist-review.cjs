// Same artwork, titles and track counts as the immutable reference; production components.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs/promises'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/desktop-openlist-review');await fs.mkdir(out,{recursive:true});
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,windowsHide:true,env:{...process.env,MEDIA_REVIEW_SAMPLE_PACK:'',MEDIA_REVIEW_TIMEOUT_MS:'900000'},stdio:['pipe','pipe','pipe']});
 let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl}=await new Promise((ok,no)=>{let data='';server.stdout.on('data',d=>{data+=d;for(const line of data.split('\n'))try{const v=JSON.parse(line);if(v.baseUrl)ok(v);}catch{}});server.once('exit',()=>no(Error(logs)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});
  const ref=await browser.newPage({viewport:{width:1500,height:1100}}),page=await browser.newPage({viewport:{width:390,height:844},colorScheme:'light'}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));await ref.goto(pathToFileURL(join(repo,'docs/prototypes/media/v2-review/index.html')).href);await ref.waitForFunction(()=>!!window.prototypeReview);
  const artworks={};
  const item=(id,kind,title,metadata={},parentId=null)=>({id,libraryId:['movie','series','season','episode'].includes(kind)?'video':kind==='audiobook'?'books':'music',kind,title,parentId,metadata,overrides:{}});
  const album=item('quiet','album','静谧时刻',{artist:'北岸',year:2024,coverRef:'review',plot:'从清晨的风到夜里的溪流，记录安静日常中的声音。',sources:{title:'tag'}},'north');
  const artist=item('north','artist','北岸',{plot:'以木吉他与自然录音为底色，记录生活中的细小回声。',coverRef:'review'});
  const movie=item('coast','movie','海岸线',{year:2024,genre:'剧情',country:'中国大陆',coverRef:'review',plot:'一位久别故乡的年轻人沿着海岸返回，在旧港口与山间小镇之间，重新寻找记忆中家的方向。',sources:{title:'nfo'}});
  const names=['森林来信','清晨的风','松林深处','雨落屋檐','溪流之间','暮色将至','夜鸟','回到山谷'],seconds=[222,248,206,292,222,248,206,292];
  const tracks=names.map((title,i)=>({...item('track-'+i,'track',title,{artist:'北岸',album:'静谧时刻',coverRef:'review'},album.id),disc:1,track:i+1,editions:[{id:'edition-'+i,label:'原版',parts:[{id:'part-'+i,assetId:'asset-'+i,title,start:0,end:seconds[i],available:true}]}],children:[]}));
  const albums=[album,...[['回声','山川乐队'],['午后散步','南风'],['无声之海','浅湾'],['昨日晴空','林末'],['夜色温柔','北岸']].map(([title,artist],i)=>item('album-'+i,'album',title,{artist,coverRef:'review'}))];
  const detail={quiet:{...album,children:tracks,editions:[]},north:{...artist,children:[album],editions:[]},coast:{...movie,children:[],editions:[{id:'original',label:'原版',parts:[{id:'film-part',assetId:'film-asset',title:movie.title,start:0,end:6480,available:true}]}]}};
  const show=item('mountains','series','远山之路',{year:2024,genre:'剧情',coverRef:'review',plot:movie.metadata.plot});
  const seasons=[1,2].map(n=>item('season-'+n,'season','第 '+n+' 季',{},show.id));
  const episodes=['出发','重逢','山间的清晨','旧桥','回声','归途'].map((title,i)=>({...item('ep-'+i,'episode',title,{},seasons[0].id),editions:[{id:'ev-'+i,label:'原版',parts:[{id:'epart-'+i,assetId:'ea-'+i,title,start:0,end:2540,available:true}]}]}));
  const chapterNames=['寄往山里的第一封信','沿着河流向前','一棵树的四季','旧屋的窗','雨后的访客','山间的清晨','风吹过山谷','回家的路'];
  const book={...item('letters','audiobook','山间来信',{author:'林间',narrator:'周宁',coverRef:'review',plot:'一封封寄往山里的信，记录季节更替、远行与归来。跟随温暖的讲述，在日常细微处发现生活的纹理。'}),children:[],editions:[{id:'narration',label:'周宁演播版',parts:Array.from({length:18},(_,i)=>({id:'chapter-'+i,assetId:'ba-'+i,title:chapterNames[i%8],start:0,end:1476,available:true}))}]};
  Object.assign(detail,{mountains:{...show,children:seasons,editions:[]},letters:book});
  let empty=false,unavailable=false;
  await ref.evaluate(()=>{window.prototypeReview.setWidth(390);window.prototypeReview.go('music',true);});
  for(let i=0;i<6;i++)artworks[albums[i].id]=await ref.locator('#app .grid .cover').nth(i).screenshot();
  await ref.evaluate(()=>window.prototypeReview.go('movie',true));artworks.coast=await ref.locator('#app .hero>.cover').screenshot();
  await ref.evaluate(()=>window.prototypeReview.go('artist',true));artworks.north=await ref.locator('#app .hero>.avatar').screenshot();
  for(const [id,view,selector] of [['mountains','show','.hero>.cover'],['letters','book','.hero>.cover'],['track-0','music-player','.player-art']]){await ref.evaluate(view=>window.prototypeReview.go(view,true),view);artworks[id]=await ref.locator('#app '+selector).screenshot();}
  const wav=Buffer.alloc(44+8000*2*222);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  await page.route('**/api/v1/media/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.split('/api/v1/media/')[1],id=path.split('/')[1];let data={items:[],total:0};
   if(path==='libraries')data={items:empty?[]:[{id:'books',name:'有声书',kind:'audiobook',access:'all'},{id:'music',name:'音乐收藏',kind:'music',access:'all'},{id:'video',name:'家庭影院',kind:'video',access:'all'}]};
   else if(path==='favorites'){let entries=[movie,album,book,artist];const channel=url.searchParams.get('channel');if(channel)entries=entries.filter(entry=>entry.libraryId===({video:'video',music:'music',audiobook:'books'})[channel]);data={items:entries,total:entries.length};}
   else if(path.endsWith('/cover'))return route.fulfill({contentType:'image/png',body:artworks[id]||artworks.quiet});
   else if((path==='browse'||path.endsWith('/items'))&&unavailable)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'MEDIA_UNAVAILABLE',message:'不可用'}})});
   else if((path==='narrators'||path.endsWith('/narrators')))data={items:['周宁','陈青','许舟','南音','周野'].map((name,i)=>({name,works:i+2,editions:i+2})),total:5};
   else if(path.endsWith('/season-playback')||path.endsWith('/series-playback'))data={episodes};
   else if(path==='items/denied')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'MEDIA_FORBIDDEN',message:'无权限'}})});
   else if(path==='items/missing')data={...detail.coast,id:'missing',editions:[{...detail.coast.editions[0],parts:[{...detail.coast.editions[0].parts[0],available:false}]}]};
   else if(path==='browse'||path.endsWith('/items')){const list=url.searchParams.get('channel')==='video'||url.searchParams.get('kind')==='video'?[movie,show]:url.searchParams.get('kind')==='track'?tracks:albums;data={items:list,total:list.length};}
   else if(path.startsWith('items/')&&!path.slice(6).includes('/'))data=detail[id]||tracks.find(t=>t.id===id);
   else if(path.endsWith('/album-playback'))data={tracks};
   else if(path.endsWith('/favorite'))data={favorite:false};
   else if(path==='playback'){const body=route.request().postDataJSON(),partId=body.partId||'part-0',isBook=partId.startsWith('chapter-');data={id:'review-session',itemId:isBook?'letters':'track-'+partId.split('-')[1],partId,streamUrl:'/api/v1/media/streams/review',contentType:'audio/wav',expiresAt:Date.now()+3600000,position:96,start:0,end:isBook?1476:222,revision:0};}
   else if(path.startsWith('streams/')){const match=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;return route.fulfill({status:match?206:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})},body:wav.subarray(start,end+1)});}
   else if(path.endsWith('/progress'))data={position:96,revision:1,completed:false};
   else if(path.startsWith('assets/'))data={size:24000000,available:true,probe:{status:'ready',info:{duration:222,format:'FLAC',streams:[{index:0,type:'audio',codec:'flac',channels:2}]}}};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(baseUrl+'/#/media/music/albums');await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();await page.locator('.media-tile img').first().waitFor();

  const captures=[];
  async function screenshot(key,title,reference){
    await page.mouse.move(0,0);await page.waitForTimeout(100);await page.screenshot({path:join(out,key+'-actual.png')});
    if(reference){await ref.evaluate(({reference,width})=>{window.prototypeReview.setWidth(width);window.prototypeReview.go(reference,true);document.querySelector('#frame').style.height='900px';},{reference,width:page.viewportSize().width});await ref.locator('#frame').screenshot({path:join(out,key+'-reference.png')});}
    captures.push({key,title,reference:!!reference});
    const overflow=await page.locator('.media-screen').evaluate(el=>el.scrollWidth-el.clientWidth);assert.ok(overflow<=1,key+' overflow '+overflow);checks.push({key,overflow});
  }
  for(const width of [390,1120,1308]){
    await page.setViewportSize({width,height:900});await page.goto(baseUrl+'/#/media/music/albums');await page.locator('.media-tile img').first().waitFor();
    await screenshot('tabs-'+width,'频道分类 · '+width,width===1308?null:'music');
    const tabs=await page.locator('.media-tabs').evaluate(el=>{const b=el.querySelector('button'),r=el.getBoundingClientRect(),br=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,buttonTop:br.top,buttonBottom:br.bottom,scrollbar:getComputedStyle(el).scrollbarWidth,border:getComputedStyle(b).borderBottomWidth};});
    assert.equal(tabs.height,44);assert.equal(tabs.buttonTop,tabs.top);assert.ok(tabs.buttonBottom<=tabs.bottom+1);assert.equal(tabs.scrollbar,'none');assert.equal(tabs.border,'2px');checks.push({key:'tab-geometry-'+width,...tabs});
    if(width>700)assert.equal(tabs.top,73);
    await page.getByRole('combobox',{name:'媒体库',exact:true}).click();await page.getByRole('listbox',{name:'媒体库',exact:true}).waitFor();
    const menu=await page.getByRole('listbox',{name:'媒体库',exact:true}).boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=width&&menu.y+menu.height<=900);
    await screenshot('library-select-'+width,'媒体库下拉 · '+width);
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('listbox').count(),0);
    await page.getByRole('combobox',{name:'媒体库',exact:true}).click();await page.locator('.media-tabs button').first().click();assert.equal(await page.getByRole('listbox').count(),0);
    await page.goto(baseUrl+'/#/media/video/favorites');await page.locator('.media-favorite-row').first().waitFor();assert.equal(new URL(page.url()).hash,'#/media/favorites');
    await screenshot('favorites-'+width,'收藏列表 · '+width,width===1308?null:'favorites');
    const list=await page.locator('.media-favorites').boundingBox();if(width>900){assert.equal(Math.round(list.width),850);assert.ok(Math.abs(list.x+list.width/2-width/2)<1);}
    await page.getByRole('button',{name:'筛选收藏',exact:true}).click();await page.getByRole('dialog').waitFor();await screenshot('favorite-filter-'+width,'收藏类型筛选 · '+width);
    await page.getByRole('group',{name:'收藏类型'}).getByRole('button',{name:'音乐',exact:true}).click();await page.waitForURL('**/#/media/favorites?scope=music');await page.waitForFunction(()=>document.querySelectorAll('.media-favorite-row').length===2);await page.reload();await page.locator('.media-favorite-row').first().waitFor();assert.equal(await page.locator('.media-favorite-row').count(),2);
    await page.goto(baseUrl+'/#/media/video/settings/libraries/new');await page.locator('.media-library-create').waitFor();
    await page.getByRole('combobox',{name:'接入方式',exact:true}).click();await page.getByRole('option',{name:'OpenList',exact:true}).click();
    await page.locator('input[name=name]').fill('云端影院');await page.locator('input[name=baseUrl]').fill('https://openlist.example.com');await page.locator('input[name=root]').fill('/影视');
    await screenshot('openlist-'+width,'新建 OpenList 媒体库 · '+width);
    await page.getByRole('combobox',{name:'访问范围',exact:true}).click();await screenshot('access-select-'+width,'表单下拉 · '+width);await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1120,height:900});await page.goto(baseUrl+'/#/media/video');await page.locator('.media-tile').first().waitFor();await screenshot('video-desktop','影视频道顶部分类');
  await page.goto(baseUrl+'/#/media/music/settings/theme');await page.getByRole('button',{name:/深海/}).click();await page.goto(baseUrl+'/#/media/music/albums');await page.getByRole('combobox',{name:'媒体库',exact:true}).click();await screenshot('select-dark','深海主题下拉');
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'checks.json'),JSON.stringify({checks,captures,errors},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桌面分类、收藏与 OpenList 验收</title><style>body{margin:24px auto;padding:0 24px;max-width:1400px;font:14px/1.6 system-ui;background:#f8f9f5;color:#202b24}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}img{max-width:100%;border:1px solid #dfe5d9}figure{margin:0}section{margin:32px 0}figcaption{margin-bottom:8px;color:#66715f}</style><h1>桌面分类、收藏与 OpenList 验收</h1><p>使用生产构建。对照冻结 v2 原型的分类栏与收藏布局；下拉和 OpenList 接入表单为本次新增。展示数据是临时验收数据，未写入用户媒体库。OpenList 接入另由接口集成测试验证，页面中地址为示例。</p>${captures.map(c=>`<section><h2>${c.title}</h2><div class="pair">${c.reference?`<figure><figcaption>冻结的 v2 原型</figcaption><img src="${c.key}-reference.png"></figure>`:''}<figure><figcaption>本次实现</figcaption><img src="${c.key}-actual.png"></figure></div></section>`).join('')}</html>`);console.log(JSON.stringify({captures:captures.length,errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
