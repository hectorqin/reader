import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {VideoEpisodeRail} from '../src/media/video-episode-rail.tsx';
import {ArtistTracks} from '../src/media/artist-tracks.tsx';
import type {Detail,MediaApi} from '../src/media/api.ts';
import type {MediaPlayer} from '../src/media/player.ts';
import {readPlaybackPreferences,savePlaybackPreferences} from '../src/media/playback-preferences.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));localStorage.clear();});
const item={id:'ep1',kind:'episode',title:'第一集',parentId:'season1',libraryId:'lib',metadata:{},overrides:{},editions:[],children:[]} as Detail;
const episode=(id:string)=>({id,title:id,editions:[{id:'v-'+id,label:'原版',parts:[{id:'p-'+id,assetId:'a-'+id,title:id,start:0,end:60,available:true}]}]});
it('shows the full season for a direct episode and plays a selected episode without replacing metadata',async()=>{
 const request=vi.fn().mockResolvedValue({episodes:[episode('ep1'),episode('ep2'),episode('ep3')]}),detail=vi.fn().mockResolvedValue({...item,id:'season1',kind:'season',title:'第一季',parentId:null}),play=vi.fn().mockResolvedValue(undefined);
 await act(async()=>render(<VideoEpisodeRail api={{request,detail} as unknown as MediaApi} item={item} player={{currentPartId:'p-ep1',play} as unknown as MediaPlayer}/>,root));
 await vi.waitFor(()=>expect(root.querySelectorAll('.media-video-episodes button')).toHaveLength(3));
 expect(root.querySelector<HTMLButtonElement>('[aria-current=true]')!.disabled).toBe(true);
 await act(async()=>root.querySelectorAll<HTMLButtonElement>('.media-video-episodes button')[1]!.click());
 expect(play.mock.calls[0]![0].map((entry:{part:{id:string}})=>entry.part.id)).toEqual(['p-ep2','p-ep3']);
 expect(request).toHaveBeenCalledWith('items/season1/season-playback','GET',undefined,expect.any(AbortSignal));
});
it('does not choose an ambiguous episode version automatically',async()=>{
 const ep=episode('ep2');ep.editions.push({...ep.editions[0]!,id:'alternate',label:'配音版'});
 const play=vi.fn(),api={request:vi.fn().mockResolvedValue({episodes:[ep]}),detail:vi.fn().mockResolvedValue({...item,id:'season1',parentId:null})} as unknown as MediaApi;
 await act(async()=>render(<VideoEpisodeRail api={api} item={item} player={{currentPartId:'p-other',play} as unknown as MediaPlayer}/>,root));
 await vi.waitFor(()=>expect(root.querySelector('.media-video-episodes button')).not.toBeNull());
 await act(async()=>root.querySelector<HTMLButtonElement>('.media-video-episodes button')!.click());expect(play).not.toHaveBeenCalled();expect(root.querySelector('[role=status]')?.textContent).toContain('需要选择版本');
 await act(async()=>{const select=root.querySelector<HTMLSelectElement>('[aria-label="ep2 版本"]')!;select.value='alternate';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>root.querySelector<HTMLButtonElement>('.media-video-episodes button')!.click());expect(play).toHaveBeenCalledOnce();
});
it('queries artist tracks inside the artist library, supports play and does not invent tracks',async()=>{
 const song={...item,id:'song',kind:'track',title:'真实曲目',metadata:{artist:'北岸'}},items=vi.fn().mockResolvedValue({items:[song],total:1}),play=vi.fn().mockResolvedValue(undefined);
 await act(async()=>render(<ArtistTracks api={{items} as unknown as MediaApi} artist={{...item,kind:'artist',title:'北岸'}} onPlay={play} onDetail={vi.fn()}/>,root));
 expect(items).toHaveBeenCalledWith('lib','track','',0,expect.any(AbortSignal),'default',{artist:'北岸'});
 await vi.waitFor(()=>expect(root.querySelector('[aria-label="播放 真实曲目"]')).not.toBeNull());
 await act(async()=>root.querySelector<HTMLButtonElement>('[aria-label="播放 真实曲目"]')!.click());expect(play).toHaveBeenCalledWith('song');expect(root.querySelectorAll('.media-track-entry')).toHaveLength(1);
});
it('isolates playback preferences by account and validates invalid stored values',()=>{
 savePlaybackPreferences('a',{defaultRate:1.5,continuous:false});expect(readPlaybackPreferences('a')).toEqual({defaultRate:1.5,continuous:false});expect(readPlaybackPreferences('b')).toEqual({defaultRate:1,continuous:true});
 localStorage.setItem('reader.media.playback-preferences.v1:a','{"defaultRate":999,"continuous":"no"}');expect(readPlaybackPreferences('a')).toEqual({defaultRate:1,continuous:true});
});
