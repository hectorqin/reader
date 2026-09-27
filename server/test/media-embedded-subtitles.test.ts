import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.ts';
import { MediaSubtitles } from '../src/media/subtitles.ts';
import type { MediaLibraries } from '../src/media/libraries.ts';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractEmbeddedSubtitle } from '../src/media/embedded-subtitles.ts';
import { subtitleToVtt } from '../src/media/subtitles.ts';

test('real MP4 and MKV text subtitles can be extracted without rewriting the video', {skip:!process.env.MEDIA_TEST_FFMPEG},async t=>{
  const root=await mkdtemp(join(tmpdir(),'embedded-subtitles-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous=process.env.MEDIA_FFMPEG_PATH;process.env.MEDIA_FFMPEG_PATH=process.env.MEDIA_TEST_FFMPEG;
  t.after(()=>{if(previous===undefined)delete process.env.MEDIA_FFMPEG_PATH;else process.env.MEDIA_FFMPEG_PATH=previous;});
  const srt=join(root,'input.srt');await writeFile(srt,'1\n00:00:00,100 --> 00:00:01,900\n你好 embedded subtitle\n');
  for(const [extension,codec] of [['mp4','mov_text'],['mkv','srt']]){
    const output=join(root,`video.${extension}`);
    await promisify(execFile)(process.env.MEDIA_TEST_FFMPEG!,['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=32x32:d=2','-i',srt,'-c:v','libx264','-c:s',codec!,output],{timeout:30000,windowsHide:true});
    const before=await readFile(output);
    const webvtt=subtitleToVtt(await extractEmbeddedSubtitle(output,1),'vtt');
    assert.deepEqual(await readFile(output),before);
    assert.ok(webvtt.includes('你好 embedded subtitle'));assert.ok(webvtt.includes('00:00:00.100 --> 00:00:01.900'));
  }
});

test('embedded subtitles are allowlisted and normalized, with post-extraction authorization and file checks',async t=>{
  const db=new Db(':memory:');t.after(()=>db.close());
  db.run('CREATE TABLE media_assets(id TEXT,library_id TEXT,ref TEXT,available INTEGER,technical_json TEXT)');
  db.run('INSERT INTO media_assets VALUES(?,?,?,?,?)','asset','library','movie.mkv',1,JSON.stringify({streams:[
    {index:2,type:'subtitle',codec:'ass',language:'zh',title:'中文'},
    {index:3,type:'subtitle',codec:'hdmv_pgs_subtitle'},
    {index:4,type:'audio',codec:'aac'},
  ]}));
  let allowed=true,modifiedAt=1,calls=0;
  const libraries={get(){if(!allowed)throw new Error('revoked');},async storage(){return {
    siblings:async()=>[],stat:async()=>({size:100,modifiedAt,fileIdentity:'file'}),filePath:async(ref:string)=>'/safe/'+ref,
  };}} as unknown as MediaLibraries;
  let during=()=>{};
  const subtitles=new MediaSubtitles(db,libraries,async(path,index)=>{
    calls++;assert.equal(path,'/safe/movie.mkv');assert.equal(index,2);during();
    return Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b>你好</b>');
  });
  const actor={id:'member',role:'member' as const};
  assert.deepEqual((await subtitles.list(actor,'asset')).items,[{id:'stream:2',label:'中文',language:'zh',format:'vtt',source:'embedded'}]);
  for(const id of ['stream:3','stream:4','stream:-1','stream:2:extra'])await assert.rejects(subtitles.read(actor,'asset',id),{code:'NOT_FOUND'});
  assert.equal(calls,0);
  assert.equal((await subtitles.read(actor,'asset','stream:2')).webvtt,'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n你好\n');
  during=()=>{allowed=false;};await assert.rejects(subtitles.read(actor,'asset','stream:2'),/revoked/);
  allowed=true;during=()=>{modifiedAt++;};await assert.rejects(subtitles.read(actor,'asset','stream:2'),{code:'MEDIA_SUBTITLE_CHANGED'});
  during=()=>{};db.run('UPDATE media_assets SET available=0');await assert.rejects(subtitles.read(actor,'asset','stream:2'),{code:'NOT_FOUND'});
});
