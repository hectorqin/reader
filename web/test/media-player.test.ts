import {savePlaybackPreferences} from '../src/media/playback-preferences.ts';
// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPlayer } from '../src/media/player.ts';
import type { MediaApi, Playback } from '../src/media/api.ts';

vi.mock('../src/media/web-video.ts',()=>({enhanceVideo:vi.fn(()=>({}))}));
const part=(id:string)=>({part:{id,assetId:id,title:id,start:0,end:100,available:true},title:id,video:false});
const session=(id:string):Playback=>({id,partId:id,streamUrl:'/stream/'+id,contentType:'audio/mpeg',expiresAt:Date.now()+6*60*60*1000,start:0,end:100,position:42,revision:1});
function setup(){const request=vi.fn().mockImplementation(async(_path,_method,body)=>({revision:body.revision+1,position:body.position,completed:body.completed}));const playback=vi.fn().mockImplementation(async(id:string)=>session(id));const api={preferenceScope:()=>'player-test',playback,request:(path:string,...args:unknown[])=>path.startsWith('assets/')?Promise.resolve({}):request(path,...args),streamUrl:(s:Playback)=>s.streamUrl} as unknown as MediaApi;return {player:new MediaPlayer(api),request,playback};}
function ready(player:MediaPlayer){player.audio.dispatchEvent(new Event('loadedmetadata'));}
describe('media playback lifecycle',()=>{
  beforeEach(()=>{localStorage.clear();vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{configurable:true,value:false});});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){Object.defineProperty(this,'paused',{configurable:true,value:true});});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});});
  afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
  it('times out after metadata and retries without duplicating the session or queue',async()=>{
    vi.useFakeTimers();
    const {player,playback}=setup();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(()=>new Promise(()=>{}));
    await player.play([part('slow')]);ready(player);
    await vi.advanceTimersByTimeAsync(20001);
    expect(player.error).toContain('超时');expect(player.loadingStatus).toBe('');
    player.retryPlayback();await vi.advanceTimersByTimeAsync(0);
    expect(player.loadingStatus).toContain('连接');expect(playback).toHaveBeenCalledTimes(1);
    player.audio.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(20001);
    expect(player.error).toBe('');expect(player.loadingStatus).toBe('');await player.stop();
  });
  it('opens video controls and releases the action while playback is still buffering',async()=>{
    const {player}=setup();let started=false;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(()=>{started=true;return new Promise(()=>{});});
    const opened=vi.fn();player.addEventListener('open-controls',opened);
    let returned=false;void player.play([{...part('film'),video:true}]).then(()=>{returned=true;});
    await vi.waitFor(()=>expect(started).toBe(true));
    expect(opened).toHaveBeenCalledTimes(1);expect(returned).toBe(true);
    await player.stop();
  });
  it('falls back once in auto mode without creating a second playback session',async()=>{
    const {player,playback}=setup();playback.mockResolvedValue({...session('film'),playbackMode:'auto'});
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('source failed','NotSupportedError')).mockRejectedValueOnce(new DOMException('CORS failed','NotSupportedError')).mockResolvedValueOnce();
    await player.play([{...part('film'),video:true}]);
    await vi.waitFor(()=>expect(player.video.src).toContain('proxy=1'));
    expect(playback).toHaveBeenCalledTimes(1);expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
    expect(player.video.hasAttribute('crossorigin')).toBe(false);
    player.video.dispatchEvent(new Event('error'));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);expect(player.error).not.toBe('');await player.stop();
  });
  it('does not proxy on autoplay rejection, explicit direct mode or a paused restore',async()=>{
    for(const mode of ['autoplay','direct','restore'] as const){
      const {player,playback}=setup();playback.mockResolvedValue({...session('film'),playbackMode:mode==='direct'?'direct':'auto'});
      vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('failed',mode==='autoplay'?'NotAllowedError':'NotSupportedError'));
      await player.play([{...part('film'),video:true}],0,false,{autoplay:mode!=='restore'});
      if(mode==='restore')player.video.dispatchEvent(new Event('error'));
      await Promise.resolve();expect(player.video.src).not.toContain('proxy=1');await player.stop();
    }
  });
  it('re-enables automatic recovery after a paused restore is resumed by the user',async()=>{
    const {player,playback}=setup();playback.mockResolvedValue({...session('film'),playbackMode:'auto'});
    await player.play([{...part('film'),video:true}],0,false,{autoplay:false});
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('source blocked','NotSupportedError'));
    player.toggle();
    await vi.waitFor(()=>expect(player.video.src).toContain('proxy=1'));
    await player.stop();
  });
  it('tries anonymous CORS after opaque direct playback fails before using proxy',async()=>{
    const {player,playback}=setup();playback.mockResolvedValue({...session('film'),playbackMode:'auto'});
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('opaque source blocked','NotSupportedError')).mockResolvedValueOnce();
    await player.play([{...part('film'),video:true}]);
    await vi.waitFor(()=>expect(player.video.crossOrigin).toBe('anonymous'));
    expect(player.video.src).not.toContain('proxy=1');expect(playback).toHaveBeenCalledTimes(1);await player.stop();
  });
  it('allows an explicit proxy retry in direct mode without another session',async()=>{
    const {player,playback}=setup();playback.mockResolvedValue({...session('film'),playbackMode:'direct'});
    await player.play([{...part('film'),video:true}],0,false,{autoplay:false});
    expect(player.canRetryViaProxy).toBe(true);player.retryViaProxy();
    expect(player.video.src).toContain('proxy=1');expect(player.canRetryViaProxy).toBe(false);
    expect(playback).toHaveBeenCalledTimes(1);await player.stop();
  });
  it('closes the mini player, saves progress and releases its media and queue',async()=>{
    const {player,request}=setup();await player.play([part('a'),part('b')]);ready(player);
    player.audio.currentTime=57;
    expect(player.element.querySelector('.media-mini-toggle svg')).not.toBeNull();
    const close=player.element.querySelector<HTMLButtonElement>('[aria-label="关闭播放器"]')!;
    expect(close.querySelector('svg')).not.toBeNull();close.click();
    await vi.waitFor(()=>expect(player.active).toBe(false));
    expect(request.mock.calls.some(call=>call[2].position===57)).toBe(true);
    expect(player.audio.hasAttribute('src')).toBe(false);
    expect(player.currentPlaylist).toHaveLength(0);
    expect(player.element.hidden).toBe(true);
  });
  it('restores a resource at server progress without autoplay and ignores cancelled restores',async()=>{
    const {player,playback}=setup();await player.play([part('a')],0,false,{autoplay:false,openControls:false});ready(player);
    expect(player.audio.currentTime).toBe(42);expect(player.paused).toBe(true);expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    const controller=new AbortController();controller.abort();await player.play([part('b')],0,false,{autoplay:false,signal:controller.signal});
    expect(playback).toHaveBeenCalledTimes(1);expect(player.currentPartId).toBe('a');await player.stop();
  });
  it('keeps the video attached while opening controls and applies volume and seek to the active video',async()=>{
    const {player,playback}=setup();await player.play([{...part('film'),video:true}]);
    player.video.dispatchEvent(new Event('loadedmetadata'));
    const parent=player.video.parentElement,source=player.video.src,host=document.createElement('div'),volumeHost=document.createElement('div');
    const restore=player.mountVideoTimeline(host),restoreVolume=player.mountVolumeControl(volumeHost);
    const seek=host.querySelector<HTMLInputElement>('[aria-label="视频播放进度"]')!;
    seek.value='65';seek.dispatchEvent(new Event('input'));seek.dispatchEvent(new Event('change'));
    expect(player.video.currentTime).toBe(65);expect(player.video.controls).toBe(false);
    const volume=volumeHost.querySelector<HTMLInputElement>('input')!;
    volume.value='0.35';volume.dispatchEvent(new Event('input'));
    expect(player.video.volume).toBe(0.35);expect(player.audio.volume).toBe(1);
    player.video.volume=0.6;player.video.dispatchEvent(new Event('volumechange'));expect(volume.value).toBe('0.6');
    player.video.dispatchEvent(new Event('play'));expect(player.video.controls).toBe(false);
    restoreVolume();restore();
    expect(player.video.parentElement).toBe(parent);expect(player.video.src).toBe(source);expect(player.video.currentTime).toBe(65);expect(player.video.controls).toBe(false);expect(playback).toHaveBeenCalledTimes(1);
    await player.stop();
  });
  it('moves the live audio timeline into the player page and restores it without restarting',async()=>{
    const {player,playback}=setup();await player.play([part('a')]);ready(player);
    const host=document.createElement('div');
    const restore=player.mountAudioControls(host);
    const slider=host.querySelector<HTMLInputElement>('input[aria-label="当前章节播放位置"]')!;
    expect(slider).not.toBeNull();
    slider.value='63';slider.dispatchEvent(new Event('input'));slider.dispatchEvent(new Event('change'));
    expect(player.audio.currentTime).toBe(63);
    restore();expect(player.element.contains(slider)).toBe(true);
    expect(host.childElementCount).toBe(0);expect(playback).toHaveBeenCalledTimes(1);
    await player.stop();
  });
  it('disables playback controls after terminal renewal failure and restores them for a new session',async()=>{
    vi.useFakeTimers();
    const {player,playback,request}=setup();
    playback.mockResolvedValueOnce({...session('a'),expiresAt:Date.now()+121000});
    request.mockRejectedValue(Object.assign(new Error('access revoked'),{status:403}));
    await player.play([part('a')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.playbackUnavailable).toBe(true);
    expect(player.error).toContain('重新选择播放');
    expect(player.element.querySelector<HTMLButtonElement>('.media-mini-toggle')!.disabled).toBe(true);
    expect(player.audio.controls).toBe(false);
    const attempts=vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    player.toggle();await Promise.resolve();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(attempts);
    await player.play([part('b')]);
    expect(player.playbackUnavailable).toBe(false);
    expect(player.element.querySelector<HTMLButtonElement>('.media-mini-toggle')!.disabled).toBe(false);
    expect(player.audio.controls).toBe(false);
    await player.stop();
  });
  it('does not request media, play or start timers during an idle reading session',async()=>{
    vi.useFakeTimers();
    const request=vi.fn(),playback=vi.fn();
    const player=new MediaPlayer({preferenceScope:()=>'player-test',request,playback} as unknown as MediaApi);
    player.setVisible(false);player.reconnectNative();
    await player.flush();await vi.advanceTimersByTimeAsync(60000);
    expect(request).not.toHaveBeenCalled();expect(playback).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);expect(player.element.hidden).toBe(true);
    expect(player.audio.hasAttribute('src')).toBe(false);expect(player.video.hasAttribute('src')).toBe(false);
    await player.stop();
  });
  it('jumps to an arbitrary playlist entry only after saving unfinished progress',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b'),part('c'),part('d')]);ready(player);
    player.audio.currentTime=23;await player.selectPlaylist(3);
    expect(playback.mock.calls.map(call=>call[0])).toEqual(['a','d']);
    expect(request.mock.calls.every(call=>call[2].completed===false)).toBe(true);
    expect(player.currentPlaylist[3]?.current).toBe(true);
    await player.selectPlaylist(-1);await player.selectPlaylist(4);await player.selectPlaylist(1.5);await player.selectPlaylist(3);
    expect(playback).toHaveBeenCalledTimes(2);
    ready(player);request.mockRejectedValue(new Error('offline'));await player.selectPlaylist(1);
    expect(playback).toHaveBeenCalledTimes(2);expect(player.currentPlaylist[3]?.current).toBe(true);await player.stop();
  });
  it('advances an embedded chapter after the asynchronous boundary pause and its save',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b')]);ready(player);
    const completions:Array<()=>void>=[];
    request.mockImplementation((_path,_method,body)=>new Promise(resolve=>completions.push(()=>resolve({revision:body.revision+1}))));
    player.audio.currentTime=100;player.audio.dispatchEvent(new Event('timeupdate'));
    await vi.waitFor(()=>expect(completions).toHaveLength(1));
    player.audio.dispatchEvent(new Event('pause'));completions[0]!();
    await vi.waitFor(()=>expect(completions).toHaveLength(2));
    expect(playback).toHaveBeenCalledTimes(1);
    request.mockImplementation(async(_path,_method,body)=>({revision:body.revision+1}));completions[1]!();
    await vi.waitFor(()=>expect(playback).toHaveBeenCalledTimes(2));await player.stop();
  });
  it('shows chapter-relative time in the mini player and clips progress to its boundaries',async()=>{
    const {player,playback}=setup();playback.mockResolvedValue({...session('chapter'),start:3600,end:3720,position:3630});
    await player.play([part('chapter')]);ready(player);
    expect(player.element.querySelector('.media-mini-time')!.textContent).toBe('00:30 / 02:00');
    const seek=player.element.querySelector<HTMLInputElement>('[aria-label="当前章节播放位置"]')!;
    expect(seek.disabled).toBe(false);expect(seek.max).toBe('120');expect(seek.value).toBe('30');
    seek.value='90';seek.dispatchEvent(new Event('change'));expect(player.audio.currentTime).toBe(3690);
    const volume=player.element.querySelector<HTMLInputElement>('[aria-label="音量"]')!;
    volume.value='0.35';volume.dispatchEvent(new Event('input'));expect(player.audio.volume).toBe(0.35);
    expect(player.audio.controls).toBe(false);
    player.audio.currentTime=3660;player.audio.dispatchEvent(new Event('timeupdate'));
    const progress=player.element.querySelector('progress')!;expect(progress.max).toBe(120);expect(progress.value).toBe(60);
    player.audio.currentTime=3500;player.audio.dispatchEvent(new Event('timeupdate'));expect(progress.value).toBe(0);
    await player.stop();
  });
  it('edits the live playlist without recreating the current session or losing duplicate occurrences',async()=>{
    const {player,playback}=setup();await player.play([part('a'),{...part('a'),title:'repeat'},part('b')],1);ready(player);
    player.audio.currentTime=18;
    player.editPlaylist(1,0);expect(player.currentPlaylist).toHaveLength(3);
    player.editPlaylist(1,-1);expect(player.currentPlaylist[0]).toMatchObject({title:'repeat',current:true});
    player.editPlaylist(1,0);expect(player.currentPlaylist.map(entry=>entry.title)).toEqual(['repeat','b']);
    expect(player.audio.currentTime).toBe(18);expect(playback).toHaveBeenCalledTimes(1);
    await player.move(1);expect(playback.mock.calls.map(call=>call[0])).toEqual(['a','b']);await player.stop();
  });
  it('keeps a dragged seek value during playback updates and drops an old chapter gesture',async()=>{
    const {player}=setup();await player.play([part('a'),part('b')]);ready(player);
    const seek=player.element.querySelector<HTMLInputElement>('[aria-label="当前章节播放位置"]')!;
    seek.value='70';seek.dispatchEvent(new Event('input'));
    player.audio.currentTime=43;player.audio.dispatchEvent(new Event('timeupdate'));
    expect(seek.value).toBe('70');
    seek.dispatchEvent(new Event('change'));expect(player.audio.currentTime).toBe(70);
    seek.value='80';seek.dispatchEvent(new Event('input'));
    await player.move(1);ready(player);
    seek.dispatchEvent(new Event('change'));expect(player.audio.currentTime).toBe(42);
    seek.value='90';seek.dispatchEvent(new Event('input'));seek.dispatchEvent(new Event('pointercancel'));
    expect(seek.value).toBe('42');
    player.audio.currentTime=44;player.audio.dispatchEvent(new Event('timeupdate'));expect(seek.value).toBe('44');
    await player.stop();
  });
  it('manual next and previous preserve unfinished progress and queue boundaries',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b'),part('c')]);ready(player);
    expect(player.canPrevious).toBe(false);expect(player.canNext).toBe(true);
    player.audio.currentTime=18;await player.move(1);
    expect(playback.mock.calls.map(call=>call[0])).toEqual(['a','b']);
    expect(request.mock.calls.every(call=>call[2].completed===false)).toBe(true);
    expect(player.canPrevious).toBe(true);ready(player);await player.move(-1);
    expect(playback.mock.calls.map(call=>call[0])).toEqual(['a','b','a']);
    await player.move(-1);expect(playback).toHaveBeenCalledTimes(3);await player.stop();
    expect(player.canNext).toBe(false);
  });
  it('does not switch past unsaved progress and retries after persistence recovers',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b')]);ready(player);
    request.mockRejectedValue(new Error('offline'));await player.move(1);
    expect(playback).toHaveBeenCalledTimes(1);expect(player.error).toContain('尚未保存');
    request.mockImplementation(async(_path,_method,body)=>({revision:body.revision+1}));
    await player.move(1);expect(playback).toHaveBeenCalledTimes(2);await player.stop();
  });
  it('restores the queue position after a session request fails',async()=>{
    const {player,playback}=setup();await player.play([part('a'),part('b')]);ready(player);
    playback.mockRejectedValueOnce(new Error('temporarily unavailable'));await player.move(1);
    expect(player.canNext).toBe(true);expect(player.canPrevious).toBe(false);
    await player.move(1);expect(playback.mock.calls.map(call=>call[0])).toEqual(['a','b','b']);await player.stop();
  });
  it('waits for the save appended by the asynchronous browser pause event',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b')]);ready(player);
    const completions:Array<()=>void>=[];
    request.mockImplementation((_path,_method,body)=>new Promise(resolve=>completions.push(()=>resolve({revision:body.revision+1}))));
    const moving=player.move(1);await vi.waitFor(()=>expect(completions).toHaveLength(1));
    player.audio.dispatchEvent(new Event('pause'));
    completions[0]!();await vi.waitFor(()=>expect(completions).toHaveLength(2));
    expect(playback).toHaveBeenCalledTimes(1);
    request.mockImplementation(async(_path,_method,body)=>({revision:body.revision+1}));
    completions[1]!();await moving;
    expect(playback).toHaveBeenCalledTimes(2);expect(player.error).toBe('');await player.stop();
  });
  it('keeps unknown container support advisory and reports actual unsupported playback',async()=>{
    vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('');
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('unsupported','NotSupportedError'));
    const {player}=setup();await player.play([part('a')]);
    expect(player.support).toContain('仍可尝试');
    expect(player.error).toContain('无法直放');
    expect(player.audio.hasAttribute('src')).toBe(true);
    player.toggle();await vi.waitFor(()=>expect(player.error).toBe(''));
    await player.stop();
  });
  it('does not overwrite saved progress before media metadata is loaded',async()=>{
    const {player,request}=setup();await player.play([part('a')]);await player.flush();expect(request).not.toHaveBeenCalled();ready(player);expect(player.audio.currentTime).toBe(42);player.audio.currentTime=16;await player.flush();expect(request.mock.calls[0]![2]).toMatchObject({position:16,sequence:0,revision:1});await player.stop();
  });
  it('serializes updates using the latest revision and permits a seek backwards',async()=>{
    const {player,request}=setup();await player.play([part('a')]);ready(player);player.audio.currentTime=80;const a=player.flush();player.audio.currentTime=20;const b=player.flush();await Promise.all([a,b]);expect(request.mock.calls.map(call=>call[2])).toEqual([{sequence:0,revision:1,position:80,completed:false},{sequence:1,revision:2,position:20,completed:false}]);await player.stop();
  });
  it('retries the exact uncertain request before sending a newer position',async()=>{
    const {player,request}=setup();await player.play([part('a')]);ready(player);
    request.mockRejectedValueOnce(new Error('response lost'));
    player.audio.currentTime=32;await player.flush();
    player.audio.currentTime=40;await player.flush();
    expect(request.mock.calls[1]![2]).toEqual(request.mock.calls[0]![2]);
    expect(request.mock.calls[2]![2]).toMatchObject({sequence:1,revision:2,position:40});
    await player.stop();
  });
  it('stops immediately even if the server never completes the progress save',async()=>{
    const {player,request}=setup();await player.play([part('a')]);ready(player);let done!:(v:unknown)=>void;request.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));const stop=player.stop();expect(player.active).toBe(false);expect(player.audio.hasAttribute('src')).toBe(false);expect(player.element.hidden).toBe(true);await Promise.resolve();done({revision:2});await stop;
  });
  it('ignores a late playback response after stopping',async()=>{
    const {player,playback}=setup();let resolve!:(v:Playback)=>void;playback.mockImplementation(()=>new Promise(r=>{resolve=r;}));const play=player.play([part('a')]);await Promise.resolve();await player.stop();resolve(session('a'));await play;expect(player.active).toBe(false);expect(player.audio.hasAttribute('src')).toBe(false);
  });
  it('does not restart the next track after stop while completion is being saved',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b')]);ready(player);let resolve!:(v:unknown)=>void;request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));player.audio.dispatchEvent(new Event('ended'));await Promise.resolve();const stop=player.stop();resolve({revision:2});await stop;await Promise.resolve();expect(playback).toHaveBeenCalledTimes(1);expect(player.active).toBe(false);
  });
  it('sleep timer pauses playback',async()=>{
    vi.useFakeTimers();const {player}=setup();await player.play([part('a')]);ready(player);player.sleep(15);await vi.advanceTimersByTimeAsync(15*60000);expect(player.paused).toBe(true);await player.stop();
  });
  it('waits for acknowledged completion before advancing and retries when continued',async()=>{
    const {player,request,playback}=setup();await player.play([part('a'),part('b')]);ready(player);
    request.mockRejectedValueOnce(new Error('offline'));
    player.audio.currentTime=100;player.audio.dispatchEvent(new Event('ended'));
    await vi.waitFor(()=>expect(player.error).toContain('尚未保存'));
    expect(playback).toHaveBeenCalledTimes(1);
    // An ended HTML media element is paused; model that state in jsdom.
    Object.defineProperty(player.audio,'paused',{configurable:true,value:true});
    player.toggle();await vi.waitFor(()=>expect(playback).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1]![2]).toEqual(request.mock.calls[0]![2]);
    await player.stop();
  });
  it('times out an unresponsive progress transport and retries its original payload',async()=>{
    vi.useFakeTimers();const {player,request}=setup();await player.play([part('a')]);ready(player);
    let late!:(value:unknown)=>void;
    request.mockImplementationOnce(()=>new Promise(resolve=>{late=resolve;}));
    player.audio.currentTime=12;const first=player.flush();
    await vi.advanceTimersByTimeAsync(15000);await first;
    expect(player.error).toContain('超时');
    expect((request.mock.calls[0]![3] as AbortSignal).aborted).toBe(true);
    player.audio.currentTime=20;await player.flush();
    expect(request.mock.calls[1]![2]).toEqual(request.mock.calls[0]![2]);
    expect(request.mock.calls[2]![2]).toMatchObject({position:20,revision:2});
    late({revision:999});await Promise.resolve();
    player.audio.currentTime=21;await player.flush();
    expect(request.mock.calls[3]![2]).toMatchObject({position:21,revision:3});
    await player.stop();
  });
  it('tracks remaining sleep time, ignores invalid changes, and clears it on stop',async()=>{
    vi.useFakeTimers();const {player}=setup();await player.play([part('a')]);ready(player);
    player.sleep(15);const deadline=player.sleepAt;expect(player.sleepRemainingMinutes).toBe(15);
    player.sleep(Number.NaN);expect(player.sleepAt).toBe(deadline);
    await vi.advanceTimersByTimeAsync(60000);expect(player.sleepRemainingMinutes).toBe(14);
    player.sleep(0);expect(player.sleepAt).toBe(0);
    player.sleep(30);await player.stop();expect(player.sleepAt).toBe(0);
  });
  it('retains chosen speed when switching media elements and tracks native browser controls',async()=>{
    const {player}=setup();await player.play([part('a')]);ready(player);
    player.speed(1.75);expect(player.playbackRate).toBe(1.75);
    await player.play([{...part('video'),video:true}]);
    expect(player.video.playbackRate).toBe(1.75);
    player.video.playbackRate=1.25;player.video.dispatchEvent(new Event('ratechange'));
    expect(player.playbackRate).toBe(1.25);
    player.speed(Number.NaN);expect(player.playbackRate).toBe(1.25);
    await player.stop();
  });
  it('bounds relative seeking to the current chapter and keeps paused state',async()=>{
    const {player,playback}=setup();
    playback.mockResolvedValue({...session('chapter'),start:30,end:60,position:40});
    await player.play([part('chapter')]);ready(player);player.pause();
    player.skip(-15);expect(player.audio.currentTime).toBe(30);
    player.skip(300);expect(player.audio.currentTime).toBe(60);
    player.seek(Number.NaN);expect(player.audio.currentTime).toBe(60);
    expect(player.paused).toBe(true);await player.stop();
  });
  it('keeps playback controls hidden when a late response arrives in the reading area',async()=>{
    const {player,playback}=setup();
    let resolve!:(value:Playback)=>void;
    playback.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const playing=player.play([part('a')]);
    await Promise.resolve();
    player.setVisible(false);
    resolve(session('a'));
    await playing;
    expect(player.active).toBe(true);
    expect(player.element.hidden).toBe(true);
    expect(player.paused).toBe(false);
    player.setVisible(true);
    expect(player.element.hidden).toBe(false);
    await player.stop();
  });
  it('renews before resuming without reloading or losing speed and position',async()=>{
    const {player,request,playback}=setup();
    const plan=session('a');plan.expiresAt=Date.now()-1;
    playback.mockResolvedValue(plan);
    request.mockImplementation(async(path,_method,body)=>path.endsWith('/renew')?{id:'a',expiresAt:Date.now()+6*60*60*1000}:{revision:body.revision+1});
    await player.play([part('a')]);ready(player);player.audio.currentTime=25;player.speed(1.5);player.pause();
    player.toggle();
    await vi.waitFor(()=>expect(player.paused).toBe(false));
    expect(request.mock.calls.filter(call=>call[0].endsWith('/renew'))).toHaveLength(1);
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(player.audio.currentTime).toBe(25);expect(player.audio.playbackRate).toBe(1.5);
    await player.stop();
  });
  it('does not resume after a pause command while renewal is pending',async()=>{
    const {player,request,playback}=setup();
    const plan=session('a');plan.expiresAt=Date.now()-1;playback.mockResolvedValue(plan);
    let finish!:(value:unknown)=>void;
    request.mockImplementation(async(path,_method,body)=>path.endsWith('/renew')?new Promise(resolve=>{finish=resolve;}):{revision:body.revision+1});
    await player.play([part('a')]);ready(player);player.pause();player.toggle();
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    player.pause();finish({id:'a',expiresAt:Date.now()+6*60*60*1000});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(player.paused).toBe(true);
    await player.stop();
  });
  it('loads the account default speed and preserves an explicit speed while advancing',async()=>{
    savePlaybackPreferences('player-test',{defaultRate:1.5,continuous:true});
    const {player}=setup();await player.play([part('a'),part('b')]);ready(player);
    expect(player.playbackRate).toBe(1.5);player.speed(1.75);await player.move(1);ready(player);
    expect(player.playbackRate).toBe(1.75);await player.stop();
  });
  it('saves completion without starting the next entry when continuous playback is disabled',async()=>{
    savePlaybackPreferences('player-test',{defaultRate:1,continuous:false});
    const {player,playback,request}=setup();await player.play([part('a'),part('b')]);ready(player);
    player.audio.currentTime=100;player.audio.dispatchEvent(new Event('ended'));
    await vi.waitFor(()=>expect(request.mock.calls.some(call=>call[2]?.completed)).toBe(true));
    expect(playback).toHaveBeenCalledTimes(1);expect(player.currentPartId).toBe('a');
    await player.move(1);expect(player.currentPartId).toBe('b');await player.stop();
  });

});
