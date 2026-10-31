const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{join,resolve}=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{
 const repo=resolve(__dirname,'../..'),out=process.env.MEDIA_REVIEW_OUTPUT||join(repo,'artifacts/media/playback-review');await fs.mkdir(out,{recursive:true});// The fixture only scans real media when MEDIA_REVIEW_SAMPLE_PACK names an acceptance pack (server/tools/media-sample-pack.cjs).
 // Without one, build the minimal subset this review plays (album 静谧时刻 with LRC, movie 海岸线 with SRT) using ffmpeg.
 let samplePack=process.env.MEDIA_REVIEW_SAMPLE_PACK,tempPack='';
 if(!samplePack){samplePack=tempPack=await fs.mkdtemp(join(require('node:os').tmpdir(),'media-playback-pack-'));await buildPack(samplePack);}
 const server=spawn(process.execPath,['--import',pathToFileURL(join(repo,'server/node_modules/tsx/dist/loader.mjs')).href,join(repo,'server/tools/media-review-fixture.ts')],{cwd:repo,env:{...process.env,MEDIA_REVIEW_SAMPLE_PACK:samplePack},windowsHide:true,stdio:['pipe','pipe','pipe']});let browser,logs='';server.stderr.on('data',d=>logs+=d);
 try{
  const {baseUrl,sampleItems}=await new Promise((ok,no)=>{let output='';server.stdout.on('data',d=>{output+=d;for(const line of output.split('\n'))try{const v=JSON.parse(line);if(v.baseUrl)ok(v);}catch{}});server.once('exit',()=>no(Error(logs)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const context=await browser.newContext({viewport:{width:535,height:834}}),page=await context.newPage(),errors=[],shots=[];let sessions=0;
  page.on('pageerror',error=>errors.push(error.message));let lastSession=null;const failures=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/media/playback'))sessions++;});page.on('response',async response=>{if(response.request().method()==='POST'&&response.url().endsWith('/media/playback')&&response.ok())lastSession=await response.json().catch(()=>lastSession);});
  const shot=async name=>{if(name.startsWith('video')){await page.locator('.dplayer-host').hover();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.dplayer-controller')).opacity==='1');await page.waitForFunction(()=>document.querySelector('.media-player video').readyState>=2);}else await page.mouse.move(0,0);await page.screenshot({path:join(out,name+'.png')});shots.push(name);};
  const go=hash=>page.evaluate(hash=>location.hash=hash,hash);
  const ready=kind=>page.waitForFunction(kind=>{const media=document.querySelector('.media-player '+kind);return media?.readyState>=1;},kind);
  const saved=()=>page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().includes('/progress')&&response.ok());
  const album=sampleItems.find(item=>item.kind==='album'&&item.title==='静谧时刻'),movie=sampleItems.find(item=>item.kind==='movie'&&item.title==='海岸线');assert.ok(album&&movie);
  await page.goto(baseUrl+'/#/media/music/items/'+album.id);await page.locator('input[autocomplete="username"]').fill('reviewer');await page.locator('input[type="password"]').fill('review-test-pass');await page.locator('form button[type=submit]').click();await page.getByRole('button',{name:'播放全部',exact:true}).click();
  await page.waitForFunction(()=>{const audio=document.querySelector('.media-player audio');return audio?.readyState>=2&&!audio.paused;});await page.getByRole('button',{name:'打开播放控制',exact:true}).click();await page.locator('.media-audio-heading strong').waitFor();
  const playerLocation=new URL('http://route'+new URL(page.url()).hash.slice(1));assert.equal(playerLocation.pathname,'/media/music/player');assert.ok(playerLocation.searchParams.get('item'));assert.ok(playerLocation.searchParams.get('part'));assert.ok(!page.url().includes('return='));
  const source=await page.locator('.media-player audio').getAttribute('src');
  await page.getByRole('button',{name:'歌词',exact:true}).click();await page.locator('.media-lyrics-lines button').first().waitFor();assert.ok(page.url().includes('/lyrics'));
  assert.equal(await page.locator('.media-lyrics-lines').evaluate(node=>getComputedStyle(node).scrollbarWidth),'none');
  const progress=saved();await page.locator('.media-lyrics-lines button').nth(2).click();await progress;await shot('lyrics-mobile');
  await page.getByRole('button',{name:'睡眠定时',exact:true}).click();await page.getByRole('dialog',{name:'睡眠定时'}).waitFor();assert.equal(await page.getByRole('dialog').locator('select').count(),0);await shot('sleep-timer-mobile');
  await page.getByRole('button',{name:/^30\s*分钟$/,exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.match(await page.getByRole('button',{name:'睡眠定时',exact:true}).innerText(),/30 分钟/);
  await page.getByRole('button',{name:'睡眠定时',exact:true}).click();await page.getByRole('button',{name:'关闭定时',exact:true}).click();
  await page.getByRole('button',{name:'播放队列',exact:true}).click();await page.waitForURL(url=>new URL('http://route'+url.hash.slice(1)).pathname.endsWith('/queue'));await page.getByRole('button',{name:'← 返回播放',exact:true}).click();await page.waitForURL(url=>new URL('http://route'+url.hash.slice(1)).pathname==='/media/music/player');await page.locator('.media-audio-heading strong').filter({hasText:'音乐播放'}).waitFor();
  assert.equal(await page.locator('.media-player audio').getAttribute('src'),source);assert.equal(sessions,1,'panel navigation must not reopen playback');
  // Next track: the audio element moves to the next part. The route is expected to name the playing part (docs/media-navigation.md); checked softly so the restore flow below still runs.
  const before=await page.locator('.media-player audio').getAttribute('src'),firstPart=lastSession?.partId;await page.getByRole('button',{name:'下一首 / 章',exact:true}).click();await page.waitForFunction(before=>document.querySelector('.media-player audio')?.getAttribute('src')!==before,before);await ready('audio');
  assert.ok(lastSession&&lastSession.partId!==firstPart,'next track opens a new playback session');assert.equal(sessions,2);
  {const routed=new URL('http://route'+new URL(page.url()).hash.slice(1));if(routed.searchParams.get('part')!==lastSession.partId)failures.push(`after 下一首 the player route is ${new URL(page.url()).hash} (expected item=${lastSession.itemId}&part=${lastSession.partId})`);}
  const audioUrl=baseUrl+'/#/media/music/player?item='+encodeURIComponent(lastSession.itemId)+'&part='+encodeURIComponent(lastSession.partId);
  const audioPage=page.url(),saveNext=saved();await page.locator('.media-player audio').evaluate(audio=>{audio.currentTime=24;audio.pause();});await saveNext;
  await page.reload();const empty=page.locator('.media-player-empty');await page.locator('.media-audio-heading strong').or(empty).first().waitFor({timeout:8000});
  if(await empty.isVisible()){failures.push(`reloading ${new URL(audioPage).hash} after 歌词/队列 navigation shows 当前没有播放内容: the player route no longer names item/part`);await page.goto(audioUrl);await page.locator('.media-audio-heading strong').waitFor();}
  else assert.equal(page.url(),audioPage);
  await ready('audio');assert.ok(await page.locator('.media-player audio').evaluate(audio=>audio.currentTime>=23&&audio.paused),'audio progress restored, paused');await shot('audio-restored-mobile');
  const direct=await page.context().newPage();await direct.goto(audioUrl.replace('/player?','/player/lyrics?'));await direct.locator('.media-audio-heading strong').waitFor();await direct.waitForFunction(()=>document.querySelector('.media-player audio')?.readyState>=1);await direct.locator('.media-lyrics-lines').waitFor();
  await direct.getByRole('button',{name:'← 返回播放',exact:true}).click();await direct.waitForURL(url=>new URL('http://route'+url.hash.slice(1)).pathname==='/media/music/player');
  {const routed=new URL('http://route'+new URL(direct.url()).hash.slice(1));if(!routed.searchParams.get('item')||!routed.searchParams.get('part'))failures.push(`a direct lyrics link returns to ${new URL(direct.url()).hash}, dropping item/part`);}await direct.close();
  await go('#/media/video/items/'+movie.id);await page.getByRole('button',{name:'播放电影',exact:true}).click();await page.locator('.dplayer-host').waitFor();await ready('video');await page.waitForURL(url=>{const routed=new URL('http://route'+url.hash.slice(1));return routed.pathname==='/media/video/player'&&routed.searchParams.get('item')&&routed.searchParams.get('part');});
  assert.equal(await page.locator('.dplayer-controller').count(),1);assert.equal(await page.locator('.media-video-timeline').count(),0);await shot('video-mobile');
  await page.setViewportSize({width:390,height:844});await shot('video-mobile-narrow');assert.ok(await page.locator('.dplayer-host').evaluate(node=>node.scrollWidth<=node.clientWidth+1));assert.equal(await page.locator('.dplayer-volume-bar-wrap').isVisible(),false);assert.ok((await page.locator('.dplayer-bar-wrap').boundingBox()).width>=80);await page.setViewportSize({width:535,height:834});
  const videoUrl=page.url(),videoSource=await page.locator('.media-player video').getAttribute('src');await page.getByRole('button',{name:'字幕',exact:true}).click();await page.getByRole('dialog',{name:'字幕'}).waitFor();await page.locator('dialog[open] .sheet-close').last().click();assert.equal(await page.locator('.media-player video').getAttribute('src'),videoSource);
  await page.setViewportSize({width:1120,height:900});await shot('video-desktop');
  await page.locator('.dplayer-host').hover();await page.locator('.dplayer-full-icon').click();await page.waitForFunction(()=>!!document.fullscreenElement);await shot('video-fullscreen');await page.locator('.dplayer-host').hover();await page.locator('.dplayer-full-icon').click();await page.waitForFunction(()=>!document.fullscreenElement);
  const saveVideo=saved();await page.locator('.media-player video').evaluate(video=>{video.currentTime=20;video.pause();});await saveVideo;await page.reload();await page.locator('.dplayer-host').waitFor();await ready('video');assert.equal(page.url(),videoUrl);assert.ok(await page.locator('.media-player video').evaluate(video=>video.currentTime>=19&&video.paused));await shot('video-restored-desktop');
  await page.locator('.dplayer-play-icon').click();await page.waitForFunction(()=>!document.querySelector('.media-player video').paused);
  // DPlayer's own hotkey (the Plyr-era 'k' shortcut no longer exists): Space toggles once the player has been interacted with.
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('.media-player video').paused);
  await page.keyboard.press('Space');await page.waitForFunction(()=>!document.querySelector('.media-player video').paused);
  await go('#/media/video/player?item='+encodeURIComponent(movie.id)+'&part=missing');await page.getByRole('alert').filter({hasText:'播放资源已变化'}).waitFor();// The explanation is the page; whatever else plays stays in the mini player, not expanded over it.
  if(await page.locator('.media-player.media-player-expanded').isVisible())failures.push('an invalid part link (part=missing) while another video plays: the 播放资源已变化 alert renders behind the still-visible expanded player');await shot('invalid-resource-desktop');
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  await fs.writeFile(join(out,'checks.json'),JSON.stringify({shots,failures,flows:['resource IDs in clean playback URLs','lyrics seek and hidden scrollbar','timer presets','continuous playback across panels','next track updates route','audio reload and direct-link restore','DPlayer local assets and fullscreen','video subtitle menu retains source','video reload restores progress paused','DPlayer Space hotkey toggles playback','invalid resource shows error'],sessions,errors},null,2));
  await fs.writeFile(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>播放页验收</title><style>body{font:15px system-ui;background:#f4f4f1;color:#273323;padding:20px}img{max-width:100%;border:1px solid #ccc}figure{margin:24px 0}</style><h1>播放页实际截图</h1><p>真实媒体、临时数据库。DPlayer 控件、歌词、定时和刷新恢复。</p>'+shots.map(name=>`<figure><figcaption>${name}</figcaption><img src="${name}.png"></figure>`).join(''));
  console.log(JSON.stringify({screenshots:shots.length,sessions,errors}));
 }finally{if(browser)await browser.close();server.stdin.end();await new Promise(ok=>server.exitCode!==null?ok():server.once('exit',ok));if(tempPack)await fs.rm(tempPack,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
async function buildPack(root){
 const {execFileSync}=require('node:child_process'),ffmpeg=process.env.MEDIA_TEST_FFMPEG||'ffmpeg',encode=args=>execFileSync(ffmpeg,['-nostdin','-loglevel','error','-y',...args],{stdio:'inherit',timeout:120000});
 const album=join(root,'music','静谧时刻'),film=join(root,'video','海岸线 (2026)');
 await fs.mkdir(album,{recursive:true});await fs.mkdir(film,{recursive:true});await fs.mkdir(join(root,'audiobooks'));
 for(const [track,title] of [[1,'森林来信'],[2,'返程']]){
  const file=join(album,`0${track} ${title}.mp3`);
  encode(['-f','lavfi','-i',`sine=frequency=${track===1?262:330}:sample_rate=44100:duration=60`,'-af','volume=0.05','-c:a','libmp3lame','-b:a','96k','-metadata',`title=${title}`,'-metadata','album=静谧时刻','-metadata','artist=样例乐坊 1','-metadata','album_artist=样例乐坊 1','-metadata',`track=${track}`,'-metadata','date=2026',file]);
  await fs.writeFile(file.replace(/\.mp3$/,'.lrc'),`[00:00.00]${title} · 原创合成旋律\n[00:08.00]这是用于验收的同步歌词\n[00:16.00]点击这一行，检查跳转播放\n[00:30.00]切换封面与歌词，声音保持连续\n[00:45.00]下一首与队列功能验收\n`);
 }
 const stem=join(film,'海岸线 (2026)');
 encode(['-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=45','-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=45','-af','volume=0.04','-c:v','libx264','-preset','veryfast','-crf','30','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart','-shortest',stem+'.mp4']);
 await fs.writeFile(stem+'.nfo','<?xml version="1.0" encoding="UTF-8"?><movie><title>海岸线</title><year>2026</year><plot>原创生成的验收片段。</plot></movie>');
 await fs.writeFile(stem+'.zh.srt','1\n00:00:00,000 --> 00:00:12,000\n海岸线 · 中文字幕正常显示\n\n2\n00:00:12,000 --> 00:00:28,000\n拖动进度条，检查字幕是否同步\n\n3\n00:00:28,000 --> 00:00:44,500\n返回阅读后，再检查播放状态与续播\n');
}
