import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {probeMedia} from '../src/media/probe.ts';

test('real H264 and AAC probe preserves profile, level, pixel format and sample rate',{skip:!process.env.MEDIA_TEST_FFMPEG||!process.env.MEDIA_FFPROBE_PATH},async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-profile-'));
  try{
    const file=join(root,'profile.mp4');
    await promisify(execFile)(process.env.MEDIA_TEST_FFMPEG!,['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:d=1','-f','lavfi','-i','sine=duration=1:sample_rate=48000','-c:v','libx264','-profile:v','high','-level:v','3.1','-pix_fmt','yuv420p','-c:a','aac',file],{windowsHide:true,timeout:30000});
    const result=await probeMedia(file);assert.equal(result.status,'ready');
    const video=result.info!.streams.find(stream=>stream.type==='video')!,audio=result.info!.streams.find(stream=>stream.type==='audio')!;
    assert.equal(video.profile,'High');assert.equal(video.level,31);assert.equal(video.pixelFormat,'yuv420p');
    assert.equal(audio.profile,'LC');assert.equal(audio.sampleRate,48000);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('real multiple audio tracks retain distinct stream indices, languages and titles',{skip:!process.env.MEDIA_TEST_FFMPEG||!process.env.MEDIA_FFPROBE_PATH},async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-multitrack-'));
  try{
    const file=join(root,'two-tracks.mkv');
    await promisify(execFile)(process.env.MEDIA_TEST_FFMPEG!,['-nostdin','-loglevel','error',
      '-f','lavfi','-i','color=c=black:s=320x180:d=1',
      '-f','lavfi','-i','sine=frequency=440:duration=1:sample_rate=48000',
      '-f','lavfi','-i','sine=frequency=880:duration=1:sample_rate=48000',
      '-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',
      '-metadata:s:a:0','language=zho','-metadata:s:a:0','title=国语测试',
      '-metadata:s:a:1','language=eng','-metadata:s:a:1','title=English test',file],{windowsHide:true,timeout:30000});
    const result=await probeMedia(file);assert.equal(result.status,'ready');
    const tracks=result.info!.streams.filter(stream=>stream.type==='audio');
    assert.deepEqual(tracks.map(({index,language,title,channels,sampleRate})=>({index,language,title,channels,sampleRate})),[
      {index:1,language:'zho',title:'国语测试',channels:1,sampleRate:48000},
      {index:2,language:'eng',title:'English test',channels:1,sampleRate:48000},
    ]);
    assert.ok(tracks.every(track=>track.codec==='aac'&&track.profile==='LC'&&!track.attachedPicture));
  }finally{await rm(root,{recursive:true,force:true});}
});
