// Creates persistent local acceptance media. No external content or application DB writes.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),run=require('node:util').promisify(execFile);
const {chromium}=require('../../web/node_modules/playwright');
const JSZip=require('../../server/node_modules/jszip');
const {createHash}=require('node:crypto');
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const movies=['海岸线','城市之间','长夜微光','午后邮局','山谷回声','蓝色星期天'];
const albums=['静谧时刻','回声','午后散步','无声之海','昨日晴空','夜色温柔'];
const books=['山间来信','时间的纹理','夜航笔记'];
const colors=['#66765a','#8c694e','#4b6977','#7a6556','#626976','#70806b'];
(async()=>{
 const output=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Usage: node server/tools/media-sample-pack.cjs <new-output-directory>');
 const ffmpeg=process.env.MEDIA_TEST_FFMPEG,ffprobe=process.env.MEDIA_FFPROBE_PATH;if(!ffmpeg||!ffprobe)throw Error('Set MEDIA_TEST_FFMPEG and MEDIA_FFPROBE_PATH.');
 await fs.mkdir(output); // Refuse to overwrite an existing pack.
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'reader-samples-'));let browser;
 const files=[];const encode=async(args)=>run(ffmpeg,['-nostdin','-loglevel','error',...args],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 const nfo=async(file,root,fields)=>fs.writeFile(file,`<?xml version="1.0" encoding="UTF-8"?><${root}>${Object.entries(fields).map(([k,v])=>`<${k}>${xml(v)}</${k}>`).join('')}</${root}>`);
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PROTOTYPE_CHROMIUM});const page=await browser.newPage();
  async function poster(file,title,index,square=false,wide=false){
   const width=wide?640:480,height=wide?360:square?480:720;await page.setViewportSize({width,height});
   await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${colors[index%6]};color:#f4ebd8;font:16px "Microsoft YaHei",sans-serif}.orb{position:absolute;width:370px;height:370px;border:1px solid #f6e7ca55;border-radius:50%;right:-90px;top:18%}.hill{position:absolute;left:-180px;bottom:-180px;width:1000px;height:450px;border-radius:50%;background:linear-gradient(130deg,#e8d8ac88,#17312c);transform:rotate(-20deg)}main{position:absolute;inset:34px;display:flex;flex-direction:column;justify-content:space-between}small{font-size:11px;letter-spacing:3px;opacity:.75}h1{font:normal ${wide?44:48}px/1.5 SimSun,serif;letter-spacing:6px;max-width:100%;margin:0}.sub{font-size:13px;letter-spacing:2px;opacity:.8}</style><div class="orb"></div><div class="hill"></div><main><small>READER · ACCEPTANCE ${String(index+1).padStart(2,'0')}</small><h1>${xml(title)}</h1><span class="sub">${wide?'本地播放测试 · 画面 / 声音 / 字幕':'私人收藏 / 验收样例'}</span></main>`);
   await page.screenshot({path:file,type:'png'});
  }
  await Promise.all(['video','music','audiobooks','empty','edge-cases'].map(d=>fs.mkdir(path.join(output,d))));
  for(let i=0;i<10;i++){
   const series=i>=6,season=series?Math.floor((i-6)/2)+1:0,episode=series?(i-6)%2+1:0;
   const title=series?['启程','山路','归来','星光'][i-6]:movies[i];
   const dir=series?path.join(output,'video','远山之路',`Season 0${season}`):path.join(output,'video',`${title} (2026)`);await fs.mkdir(dir,{recursive:true});
   const stem=series?`远山之路 S0${season}E0${episode}`:`${title} (2026)`;
   const frame=path.join(temp,`frame-${i}.png`);await poster(frame,title,i,false,true);await poster(path.join(dir,stem+'-poster.png'),series?'远山之路':title,i);
   const file=path.join(dir,stem+'.mp4');
   await encode(['-loop','1','-framerate','24','-i',frame,'-f','lavfi','-i',`sine=frequency=${220+i*22}:sample_rate=44100:duration=45`,'-vf',"zoompan=z='min(zoom+0.0003,1.1)':d=1:s=640x360:fps=24",'-af','volume=0.04','-t','45','-c:v','libx264','-preset','veryfast','-crf','27','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart',file]);files.push(file);
   await nfo(path.join(dir,stem+'.nfo'),series?'episodedetails':'movie',{title,year:2026,plot:'原创生成的验收片段，用于测试封面、播放进度、外置中文字幕与文件夹浏览。不是完整影视作品。',...(series?{showtitle:'远山之路',season,episode}:{})});
   await fs.writeFile(path.join(dir,stem+'.zh.srt'),`1\n00:00:00,000 --> 00:00:12,000\n${title} · 中文字幕正常显示\n\n2\n00:00:12,000 --> 00:00:28,000\n拖动进度条，检查字幕是否同步\n\n3\n00:00:28,000 --> 00:00:44,500\n返回阅读后，再检查播放状态与续播\n`);
   console.log('video '+(i+1)+'/10');
  }
  for(let i=0;i<6;i++){
   const dir=path.join(output,'music',albums[i]);await fs.mkdir(dir);await poster(path.join(dir,'cover.png'),albums[i],i,true);
   for(let track=1;track<=2;track++){
    const title=track===1?['森林来信','远处的钟','街角阳光','潮汐','晴空','月色'][i]:'返程';const file=path.join(dir,`0${track} ${title}.${i===5?'flac':'mp3'}`),frequency=[261.63,293.66,329.63,392,440,523.25][i];
    const melody=`0.09*sin(2*PI*${frequency}*pow(2\\,mod(floor(t/0.5)\\,8)/12)*t)*exp(-3*mod(t\\,0.5))+0.025*sin(2*PI*${frequency/2}*t)`;
    await encode(['-f','lavfi','-i',`aevalsrc=${melody}:s=44100:d=60`,'-af','afade=t=in:d=1,afade=t=out:st=58:d=2',...(i===5?['-c:a','flac']:['-c:a','libmp3lame','-b:a','128k']),'-metadata',`title=${title}`,'-metadata',`album=${albums[i]}`,'-metadata',`artist=样例乐坊 ${i+1}`,'-metadata',`album_artist=样例乐坊 ${i+1}`,'-metadata',`track=${track}`,'-metadata','date=2026',file]);files.push(file);
    await fs.writeFile(file.replace(/\.(mp3|flac)$/,'.lrc'),`[00:00.00]${title} · 原创合成旋律\n[00:08.00]这是用于验收的同步歌词\n[00:16.00]点击这一行，检查跳转播放\n[00:30.00]切换封面与歌词，声音保持连续\n[00:45.00]下一首与队列功能验收\n`);
   }
  }
  const chapters=['第一章 清晨的信','第二章 山谷漫步','第三章 回家的路'],speech=[];
  for(let b=0;b<3;b++)for(let c=0;c<3;c++)speech.push({path:path.join(temp,`voice-${b}-${c}.wav`),text:`${books[b]}。${chapters[c]}。这是一段为阅读应用编写的验收故事，使用系统语音合成。清晨，窗前的树叶轻轻摇晃。我们沿着小路走向山谷，听见溪水越过石头。请尝试暂停、继续、调整语速，并切换到下一章。故事的进度应当被保存。愿这一段安静的声音，陪你完成今天的测试。`});
  const manifest=path.join(temp,'speech.json');await fs.writeFile(manifest,JSON.stringify(speech));
  await run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'media-sample-voice.ps1'),'-Manifest',manifest],{windowsHide:true,timeout:120000});
  for(let b=0;b<3;b++){
   const dir=path.join(output,'audiobooks',books[b]);await fs.mkdir(dir);await poster(path.join(dir,'cover.png'),books[b],b);
   for(let c=0;c<3;c++){
    const stem=chapters[c],file=path.join(dir,stem+'.mp3');await encode(['-i',path.join(temp,`voice-${b}-${c}.wav`),'-af','apad','-t','45','-c:a','libmp3lame','-b:a','96k','-metadata',`title=${stem}`,'-metadata',`album=${books[b]}`,'-metadata',`track=${c+1}`,file]);files.push(file);
    await nfo(path.join(dir,stem+'.nfo'),'audiobook',{title:stem,album:books[b],author:'Reader 原创验收文本',narrator:'慧慧（系统合成）',edition:'分章版',track:c+1,plot:'供验收的中文合成朗读，支持章节、倍速、定时和进度恢复。'});
   }
   if(b===0){
    const metadata=path.join(temp,'chapters.txt');await fs.writeFile(metadata,';FFMETADATA1\n'+chapters.map((title,c)=>`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${c*45000}\nEND=${(c+1)*45000}\ntitle=${title}\n`).join(''));
    const file=path.join(dir,'整本内嵌章节.m4b');await encode(['-i',path.join(dir,chapters[0]+'.mp3'),'-i',path.join(dir,chapters[1]+'.mp3'),'-i',path.join(dir,chapters[2]+'.mp3'),'-f','ffmetadata','-i',metadata,'-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]','-map','[a]','-map_metadata','3','-map_chapters','3','-c:a','aac','-b:a','96k',file]);files.push(file);
    await nfo(path.join(dir,'整本内嵌章节.nfo'),'audiobook',{title:'山间来信',album:'山间来信',author:'Reader 原创验收文本',narrator:'慧慧（系统合成）',edition:'整本章节版'});
   }
  }
  await fs.writeFile(path.join(output,'edge-cases','故意损坏的音频.mp3'),'Intentionally invalid audio for playback failure acceptance.');
  await fs.writeFile(path.join(output,'empty','请勿放媒体文件.txt'),'此目录用于验证“已建库但没有内容”的空状态。');
  const report=[];for(const file of files){const {stdout}=await run(ffprobe,['-v','error','-show_format','-show_streams','-show_chapters','-of','json',file],{windowsHide:true,maxBuffer:1024*1024});const info=JSON.parse(stdout);if(!(Number(info.format.duration)>0))throw Error('No duration: '+file);const bytes=await fs.readFile(file);report.push({file:path.relative(output,file).replaceAll('\\','/'),bytes:bytes.length,seconds:Number(info.format.duration),codecs:info.streams.map(s=>s.codec_name),chapters:info.chapters.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),source:'Original synthetic test media; Chinese voice by installed Microsoft Huihui Desktop',files:report},null,2));
  await fs.writeFile(path.join(output,'README.md'),`# Reader 本地影音验收包\n\n这是原创生成的测试素材，不是完整电影或商业音乐。视频为图形片段和低音量提示音，音乐为合成旋律，有声书为原创短文的系统合成朗读。\n\n## Windows 导入\n\n在应用分别进入影视、音乐、有声书，选择添加媒体库或更多 → 媒体库管理，填写下面的服务器目录，点击创建并扫描。无需 TMDB 密钥；本地 NFO、音频标签、封面足以展示内容。\n\n| 名称 | 类型 | 目录 | 预期 |\n|---|---|---|---|\n| 验收影视 | 影视 | ${path.join(output,'video')} | 6 部电影 + 1 部剧集（2 季 / 4 集） |\n| 验收音乐 | 音乐 | ${path.join(output,'music')} | 6 张专辑 / 12 首，MP3 与 FLAC |\n| 验收有声书 | 有声书 | ${path.join(output,'audiobooks')} | 3 部 / 各 3 章；山间来信另有整本 M4B 章节版 |\n\n服务端启动进程需要可以执行 ffprobe。若使用仓库源码，可设置 MEDIA_FFPROBE_PATH 和 MEDIA_FFMPEG_PATH 后启动服务。\n\n## 推荐验收\n\n1. 先看三频道封面、标题、搜索、专辑与分季结构。\n2. 电影播放至第 15 秒，开启中文字幕，拖动进度后核对字幕；剧集播放到结尾检查下一集。\n3. 音乐进入歌词并点第 30 秒的句子；测试上一首、下一首、队列、音量。\n4. 有声书切换倍速和定时；分别检查分章版和整本章节版。\n5. 播放中返回阅读，再进入影音，核对进度和后台状态。\n6. 刷新页面，检查历史与续播。\n7. 单独将 empty 目录建成媒体库，检查空内容提示；不要删除自己的真实库来测试。\n8. 可选：把 edge-cases 单独建成测试音乐库，检查损坏文件的失败提示；它不计入正常素材数量。\n\n在线刮削候选、真实影片编码兼容性、联网来源及长时间播放需要另外验收。解压到其他目录后，请使用实际绝对路径。\n`);
  const zip=new JSZip();async function pack(dir,rel=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const r=rel?rel+'/'+entry.name:entry.name;if(entry.isDirectory()){zip.folder(r);await pack(path.join(dir,entry.name),r);}else zip.file(r,await fs.readFile(path.join(dir,entry.name)));}}await pack(output);await fs.writeFile(output+'.zip',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:3}}));
  console.log(JSON.stringify({output,archive:output+'.zip',normalMedia:files.length,totalBytes:report.reduce((s,r)=>s+r.bytes,0)}));
 }finally{if(browser)await browser.close();if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('reader-samples-'))await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
