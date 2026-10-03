import { describe, expect, it, vi } from 'vitest';
import { playbackFailure, playbackSupport } from '../src/features/media/services/playback-support.ts';

describe('direct playback support feedback',()=>{
  it.each([['LC','mp4a.40.2'],['HE-AAC','mp4a.40.5'],['HE-AACv2','mp4a.40.29']])('uses the scanned AAC %s profile for MP4 capability checks', (profile,codec)=>{
    const canPlayType=vi.fn(()=> 'probably' as const);
    expect(playbackSupport({canPlayType},'audio/mp4',[{type:'audio',codec:'aac',profile}])).toContain('支持扫描到的音视频编码');
    expect(canPlayType).toHaveBeenCalledWith(`audio/mp4; codecs="${codec}"`);
  });
  it('does not guess unknown AAC profiles or reuse MP4 declarations for raw AAC',()=>{
    const canPlayType=vi.fn(()=> 'probably' as const);
    expect(playbackSupport({canPlayType},'audio/mp4',[{type:'audio',codec:'aac',profile:'unknown'}])).toContain('不足以完整判断');
    expect(playbackSupport({canPlayType},'audio/aac',[{type:'audio',codec:'aac',profile:'LC'}])).toContain('不足以完整判断');
    expect(canPlayType).not.toHaveBeenCalled();
  });
  it('checks codec declarations and identifies unsupported audio even in a supported container',()=>{
    const canPlayType=vi.fn((type:string)=>type.includes('ec-3')?'':'probably');
    expect(playbackSupport({canPlayType},'video/mp4',[
      {type:'video',codec:'h264'},{type:'audio',codec:'eac3'},
    ])).toContain('部分音轨编码（eac3）');
    expect(canPlayType).toHaveBeenCalledWith('video/mp4; codecs="ec-3"');
  });
  it('ignores attached cover images and subtitles',()=>{
    const canPlayType=vi.fn(()=> 'probably' as const);
    expect(playbackSupport({canPlayType},'audio/ogg',[
      {type:'audio',codec:'opus'},{type:'video',codec:'mjpeg',attachedPicture:true},{type:'subtitle',codec:'subrip'},
    ])).toContain('支持扫描到的音视频编码');
    expect(canPlayType).toHaveBeenCalledTimes(1);
  });
  it('does not invent H264 or AAC profiles from codec names',()=>{
    const canPlayType=vi.fn(()=> 'probably' as const);
    expect(playbackSupport({canPlayType},'video/mp4',[
      {type:'video',codec:'h264'},{type:'audio',codec:'aac'},
    ])).toContain('不足以完整判断');
    expect(canPlayType).not.toHaveBeenCalled();
  });
  it('does not promise decoding from container support',()=>{
    expect(playbackSupport({canPlayType:()=> 'probably'},'video/mp4')).toContain('实际解码能力');
    expect(playbackSupport({canPlayType:()=> ''},'video/x-matroska')).toContain('仍可尝试');
    expect(playbackSupport({canPlayType:()=> 'maybe'},'application/octet-stream')).toContain('格式信息不足');
  });
  it('survives a missing or failing capability implementation',()=>{
    expect(playbackSupport({canPlayType:()=>{throw new Error('unavailable');}},'audio/flac')).toContain('将尝试');
  });
  it('distinguishes user activation from unsupported media and network failures',()=>{
    expect(playbackFailure({name:'NotAllowedError'})).toContain('点击继续');
    expect(playbackFailure({name:'NotSupportedError'})).toContain('不提供转码');
    expect(playbackFailure(undefined,{code:2})).toContain('网络');
    expect(playbackFailure(undefined,{code:3})).toContain('解码失败');
    expect(playbackFailure(undefined,{code:4})).toContain('无法直放');
  });
});
