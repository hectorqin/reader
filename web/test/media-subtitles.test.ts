// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleControls } from '../src/features/media/components/subtitles.ts';
import type { MediaApi } from '../src/features/media/api/media-api.ts';

afterEach(()=>{vi.unstubAllGlobals();});
describe('external subtitle lifecycle',()=>{
  it('selects embedded subtitles and turns every embedded track off without fetching subtitle text',async()=>{
    const request=vi.fn().mockResolvedValue({items:[]});
    const video=document.createElement('video');
    const first={kind:'subtitles',label:'中文',language:'zh',mode:'disabled'};
    const second={kind:'captions',label:'English',language:'en',mode:'disabled'};
    const tracks=Object.assign(new EventTarget(),{length:2,0:first,1:second});
    Object.defineProperty(video,'textTracks',{value:tracks});
    const controls=new SubtitleControls({request} as unknown as MediaApi,video);await controls.load('asset');
    const select=controls.element.querySelector('select')!;
    expect(select.options).toHaveLength(3);expect(select.options[1]!.textContent).toContain('内嵌');
    select.value='embedded:0';select.dispatchEvent(new Event('change'));expect(first.mode).toBe('showing');expect(second.mode).toBe('disabled');
    select.value='embedded:1';select.dispatchEvent(new Event('change'));expect(first.mode).toBe('disabled');expect(second.mode).toBe('showing');
    select.value='';select.dispatchEvent(new Event('change'));expect(second.mode).toBe('disabled');expect(request).toHaveBeenCalledTimes(1);
    controls.clear();tracks.dispatchEvent(new Event('change'));expect(controls.element.hidden).toBe(true);
  });
  it('keeps embedded subtitles usable when listing sidecars fails and follows native track changes',async()=>{
    const video=document.createElement('video'),track={kind:'subtitles',label:'中文',language:'zh',mode:'disabled'};
    const tracks=Object.assign(new EventTarget(),{length:1,0:track});Object.defineProperty(video,'textTracks',{value:tracks});
    const controls=new SubtitleControls({request:vi.fn().mockRejectedValue(new Error('offline'))} as unknown as MediaApi,video);
    await controls.load('asset');expect(controls.element.hidden).toBe(false);expect(controls.element.querySelector('select')!.hidden).toBe(false);
    track.mode='showing';tracks.dispatchEvent(new Event('change'));expect(controls.element.querySelector('select')!.value).toBe('embedded:0');controls.clear();expect(track.mode).toBe('disabled');
  });
  it('cancels pending sidecar text when the decoder selects an embedded track',async()=>{
    const video=document.createElement('video'),track={kind:'subtitles',label:'中文',language:'zh',mode:'disabled'};
    const tracks=Object.assign(new EventTarget(),{length:1,0:track});Object.defineProperty(video,'textTracks',{value:tracks});
    let finish!:(value:unknown)=>void;
    const request=vi.fn(async(path:string)=>path.endsWith('/subtitles')?{items:[{id:'external',label:'English',language:'en',format:'srt'}]}:new Promise(resolve=>{finish=resolve;}));
    const createObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL,revokeObjectURL:vi.fn()});
    const controls=new SubtitleControls({request} as unknown as MediaApi,video);await controls.load('asset');
    const select=controls.element.querySelector('select')!;select.value='external';select.dispatchEvent(new Event('change'));
    select.value='embedded:0';select.dispatchEvent(new Event('change'));finish({webvtt:'WEBVTT'});await Promise.resolve();await Promise.resolve();
    expect(createObjectURL).not.toHaveBeenCalled();expect(select.value).toBe('embedded:0');
    track.mode='disabled';tracks.dispatchEvent(new Event('change'));expect(select.value).toBe('');controls.clear();
  });
  it('does not let browser automatic in-band selection cancel a pending sidecar',async()=>{
    const video=document.createElement('video'),track={kind:'subtitles',label:'中文',language:'zh',mode:'disabled'};
    const tracks=Object.assign(new EventTarget(),{length:1,0:track});Object.defineProperty(video,'textTracks',{value:tracks});
    const request=vi.fn(async(path:string)=>path.endsWith('/subtitles')?{items:[{id:'external',label:'English',language:'en',format:'srt'}]}:new Promise(()=>{}));
    const controls=new SubtitleControls({request} as unknown as MediaApi,video);await controls.load('asset');
    const select=controls.element.querySelector('select')!;select.value='external';select.dispatchEvent(new Event('change'));
    track.mode='showing';tracks.dispatchEvent(new Event('change'));expect(track.mode).toBe('disabled');expect(select.value).toBe('external');controls.clear();
  });
  it('ignores a late list after changing media',async()=>{
    let finish!:(value:unknown)=>void;
    const request=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const controls=new SubtitleControls({request} as unknown as MediaApi,document.createElement('video'));
    const loading=controls.load('old');controls.clear();
    finish({items:[{id:'subtitle',label:'中文',language:'zh',format:'srt'}]});
    await loading;
    expect(controls.element.hidden).toBe(true);
    expect(controls.element.querySelectorAll('option')).toHaveLength(0);
  });
  it('cancels a selected subtitle before creating a blob if the user turns it off',async()=>{
    let finish!:(value:unknown)=>void;
    const request=vi.fn(async(path:string)=>path.endsWith('/subtitles')?{items:[{id:'s1',label:'中文',language:'zh',format:'srt'}]}:new Promise(resolve=>{finish=resolve;}));
    const createObjectURL=vi.fn();vi.stubGlobal('URL',{createObjectURL,revokeObjectURL:vi.fn()});
    const controls=new SubtitleControls({request} as unknown as MediaApi,document.createElement('video'));
    await controls.load('asset');
    const select=controls.element.querySelector('select')!;
    select.value='s1';select.dispatchEvent(new Event('change'));
    select.value='';select.dispatchEvent(new Event('change'));
    finish({webvtt:'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ntext'});
    await Promise.resolve();await Promise.resolve();
    expect(createObjectURL).not.toHaveBeenCalled();controls.clear();
  });
});
