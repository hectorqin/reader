// Same artwork, titles and track counts as the immutable reference; production components.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),fs=require('node:fs/promises'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=join(repo,'artifacts/media/v2-implementation-review/matched');await fs.mkdir(out,{recursive:true});
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
   else if(path.endsWith('/cover'))return route.fulfill({contentType:'image/png',body:artworks[id]||artworks.quiet});
   else if((path==='browse'||path.endsWith('/items'))&&unavailable)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'MEDIA_UNAVAILABLE',message:'不可用'}})});
   else if((path==='narrators'||path.endsWith('/narrators')))data={items:['周宁','陈青','许舟','南音','周野'].map((name,i)=>({name,works:i+2,editions:i+2})),total:5};
   else if(path.endsWith('/season-playback')||path.endsWith('/series-playback'))data={episodes};
   else if(path==='items/denied')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'MEDIA_FORBIDDEN',message:'无权限'}})});
   else if(path==='items/missing')data={...detail.coast,id:'missing',editions:[{...detail.coast.editions[0],parts:[{...detail.coast.editions[0].parts[0],available:false}]}]};
   else if(path==='browse'||path.endsWith('/items')){const list=url.searchParams.get('kind')==='track'?tracks:albums;data={items:list,total:list.length};}
   else if(path.startsWith('items/')&&!path.slice(6).includes('/'))data=detail[id]||tracks.find(t=>t.id===id);
   else if(path.endsWith('/album-playback'))data={tracks};
   else if(path.endsWith('/favorite'))data={favorite:false};
   else if(path==='playback'){const body=route.request().postDataJSON(),partId=body.partId||'part-0',isBook=partId.startsWith('chapter-');data={id:'review-session',itemId:isBook?'letters':'track-'+partId.split('-')[1],partId,streamUrl:'/api/v1/media/streams/review',contentType:'audio/wav',expiresAt:Date.now()+3600000,position:96,start:0,end:isBook?1476:222,revision:0};}
   else if(path.startsWith('streams/')){const match=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;return route.fulfill({status:match?206:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})},body:wav.subarray(start,end+1)});}
   else if(path.endsWith('/progress'))data={position:96,revision:1,completed:false};
   else if(path.startsWith('assets/'))data={size:24000000,available:true,probe:{status:'ready',info:{duration:222,format:'FLAC',streams:[{index:0,type:'audio',codec:'flac',channels:2}]}}};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(baseUrl+'/#/media/music/albums');await page.locator('#login-username').fill('reviewer');await page.locator('#login-password').fill('review-test-pass');await page.locator('form button[type=submit]').click();await page.locator('.media-tile img').first().waitFor();
  const views=[['music','music/albums','.media-tile'],['album','music/album/quiet','.media-album-track'],['movie','video/movie/coast','.media-detail-heading'],['show','video/show/mountains','.media-episode-grid'],['book','audiobook/book/letters','.media-edition'],['narrators','audiobook/narrators','.media-person-tile'],['denied','video/movie/denied','.media-screen-error'],['missing','video/movie/missing','.media-state-page'],['empty','video','.media-library-empty'],['unavailable','video','.media-screen-error'],['music-player','music/album/quiet','.media-album-track'],['queue','music/album/quiet','.media-album-track'],['audio-player','audiobook/book/letters','.media-edition']];
  for(const [id,path,ready] of views){if(process.env.MEDIA_V2_MATCH_ONLY&&!process.env.MEDIA_V2_MATCH_ONLY.split(',').includes(id))continue;empty=id==='empty';unavailable=id==='unavailable';await page.goto(baseUrl+'/#/media/'+path);await page.reload();await page.locator(ready).first().waitFor().catch(async e=>{console.error(await page.locator('body').innerText());await page.screenshot({path:join(out,'debug.png')});throw e;});
   if(['music-player','queue','audio-player'].includes(id)){
    await page.locator(id==='audio-player'?'.media-detail-actions .media-primary':'.media-album-actions .media-primary').click();await page.waitForFunction(()=>document.querySelector('.media-player audio')?.readyState>=2);await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.locator('.media-playing-copy').waitFor();await page.getByRole('button',{name:'暂停',exact:true}).click();
    if(id==='queue'){await page.getByRole('button',{name:'播放队列',exact:true}).click();await page.locator('.media-current-playlist').waitFor();}
   }
   for(const width of [390,1120]){
    await page.setViewportSize({width,height:width===390?844:900});await ref.evaluate(({id,width})=>{window.prototypeReview.setWidth(width);window.prototypeReview.go(id,true);document.querySelector('#frame').style.height=(width===390?844:900)+'px';},{id,width});await page.mouse.move(0,0);await page.waitForTimeout(200);
    const key=id+'-'+width;await page.screenshot({path:join(out,key+'-actual.png')});await ref.locator('#frame').screenshot({path:join(out,key+'-reference.png')});
    const metrics=await page.evaluate(()=>{const root=document.querySelector('.media-screen');return {overflow:root.scrollWidth-root.clientWidth,coverWidth:root.querySelector('.media-hero>.media-cover')?.getBoundingClientRect().width,rows:root.querySelectorAll('.media-album-track').length};});assert.ok(metrics.overflow<=1);if(id==='album')assert.equal(metrics.rows,8);if(['album','movie','show','book'].includes(id))assert.equal(metrics.coverWidth,width===390?106:158);checks.push({key,...metrics});
   }
  }
  assert.deepEqual(errors,[]);await fs.writeFile(join(out,'checks.json'),JSON.stringify({source:'Synthetic metadata with eight real rendered track rows and artwork captured from the frozen v2 prototype. Production app and authenticated HTTP transport.',checks,errors},null,2));
  await fs.writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>v2 同内容对比</title><style>body{margin:24px;font:14px system-ui;background:#f8f9f5;color:#202b24}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%}figure{margin:0}section{margin:32px 0}</style><h1>v2 · 同内容布局复核</h1><p>生产组件使用原型标题、封面、八首曲目和六张选集卡。播放进度与权限、失效操作按实际可用功能展示，不伪造播放或恢复状态。</p>${checks.map(c=>`<section><h2>${c.key}</h2><div class="pair"><figure><figcaption>已确认原型</figcaption><img src="${c.key}-reference.png"></figure><figure><figcaption>生产实现</figcaption><img src="${c.key}-actual.png"></figure></div></section>`).join('')}</html>`);console.log(JSON.stringify({matchedComparisons:checks.length,errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
