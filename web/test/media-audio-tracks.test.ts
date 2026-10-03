// @vitest-environment jsdom
import { describe,expect,it,vi } from 'vitest';
import { AudioTrackControls } from '../src/features/media/components/audio-tracks.ts';
import type { MediaApi } from '../src/features/media/api/media-api.ts';

function setup(count=2){
  const request=vi.fn().mockResolvedValue({probe:{info:{streams:Array.from({length:count},()=>({type:'audio'}))}}});
  const controls=new AudioTrackControls({request} as unknown as MediaApi),media=document.createElement('video');
  return {controls,media,request};
}
function trackList(){return Object.assign(new EventTarget(),{length:2,0:{label:'国语',language:'zh',enabled:true},1:{label:'英语',language:'en',enabled:false}});}
describe('direct playback audio tracks',()=>{
  it('switches the decoder tracks without changing the source or playback position',async()=>{
    const {controls,media}=setup(),tracks=trackList();Object.defineProperty(media,'audioTracks',{value:tracks});
    media.src='/movie.mp4';media.currentTime=42;await controls.load(media,'asset');
    const select=controls.element.querySelector('select')!;expect(select.hidden).toBe(false);
    select.value='1';select.dispatchEvent(new Event('change'));
    expect(tracks[0].enabled).toBe(false);expect(tracks[1].enabled).toBe(true);expect(media.currentTime).toBe(42);expect(media.getAttribute('src')).toBe('/movie.mp4');
    tracks[0].enabled=true;tracks[1].enabled=false;tracks.dispatchEvent(new Event('change'));expect(select.value).toBe('0');controls.clear();
  });
  it('explains unavailable switching without creating fake probe-based options',async()=>{
    const {controls,media}=setup();await controls.load(media,'asset');
    expect(controls.element.hidden).toBe(false);expect(controls.element.textContent).toContain('此浏览器未开放切换');
    expect(controls.element.querySelector('select')!.hidden).toBe(true);expect(controls.element.querySelectorAll('option')).toHaveLength(0);controls.clear();
  });
  it('ignores a late probe response after switching resources and detaches track events',async()=>{
    const {controls,media,request}=setup(),tracks=trackList();Object.defineProperty(media,'audioTracks',{value:tracks});
    let finish!:(value:unknown)=>void;request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const loading=controls.load(media,'old');controls.clear();finish({probe:{info:{streams:[{type:'audio'},{type:'audio'}]}}});await loading;
    tracks.dispatchEvent(new Event('change'));expect(controls.element.hidden).toBe(true);expect(controls.element.querySelectorAll('option')).toHaveLength(0);
  });
  it('handles decoder tracks arriving after metadata and hides single-track files',async()=>{
    const {controls,media}=setup(1);await controls.load(media,'asset');expect(controls.element.hidden).toBe(true);
    Object.defineProperty(media,'audioTracks',{value:trackList()});media.dispatchEvent(new Event('loadedmetadata'));
    expect(controls.element.hidden).toBe(false);expect(controls.element.querySelectorAll('option')).toHaveLength(2);controls.clear();
  });
});
