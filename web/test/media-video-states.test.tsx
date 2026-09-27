// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {VideoControls} from '../src/media/video-controls.tsx';
import {PlaybackProblem} from '../src/media/playback-problem.tsx';
import {ApiError} from '../src/api/errors.ts';
import type {MediaApi,Detail} from '../src/media/api.ts';
import type {MediaPlayer} from '../src/media/player.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const player=()=>({currentItemId:'film',currentPlaylist:[],mountVideoTimeline:()=>()=>{},play:vi.fn()} as unknown as MediaPlayer);
const film=(id='film'):Detail=>({id,libraryId:'lib',title:'电影',kind:'movie',parentId:null,metadata:{plot:'扫描的简介'},overrides:{plot:'人工简介'},children:[],editions:[]});
it('keeps controls during metadata loading and retries denied reads without starting playback',async()=>{
  let reject!:(reason:Error)=>void;
  const detail=vi.fn().mockImplementationOnce(()=>new Promise((_resolve,no)=>reject=no)).mockResolvedValue(film()),p=player();
  await act(async()=>render(<VideoControls api={{detail} as unknown as MediaApi} player={p}/>,root));
  expect(root.querySelector('[aria-busy=true]')).not.toBeNull();expect([...root.querySelectorAll('button')].some(button=>button.textContent==='字幕'&&!button.disabled)).toBe(true);
  await act(async()=>reject(new ApiError('forbidden','denied','MEDIA_FORBIDDEN',403)));
  await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('没有访问权限'));
  await act(async()=>root.querySelector<HTMLButtonElement>('[role=alert] button')!.click());
  await vi.waitFor(()=>expect(root.querySelector('.media-video-description p')?.textContent).toBe('人工简介'));
  expect(detail).toHaveBeenCalledTimes(2);expect(p.play).not.toHaveBeenCalled();
});
it('ignores old video metadata when the current item changes',async()=>{
  let release!:(value:Detail)=>void;
  const detail=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>release=resolve)).mockResolvedValue({...film('new'),overrides:{plot:'新的简介'}}),api={detail} as unknown as MediaApi,p=player();
  await act(async()=>render(<VideoControls api={api} player={p}/>,root));
  Object.defineProperty(p,'currentItemId',{value:'new'});
  await act(async()=>render(<VideoControls api={api} player={p}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('.media-video-description p')?.textContent).toBe('新的简介'));
  await act(async()=>release(film()));expect(root.querySelector('.media-video-description p')?.textContent).toBe('新的简介');expect(detail.mock.calls[0][1].aborted).toBe(true);
});
it('opens recovery choices without restarting an expired session automatically',()=>{
  const versions=vi.fn(),back=vi.fn(),p={...player(),error:'请重新选择播放。',playbackUnavailable:true} as unknown as MediaPlayer;
  act(()=>render(<PlaybackProblem player={p} onVersions={versions} onBack={back}/>,root));
  expect(root.textContent).toContain('播放会话已失效');expect(p.play).not.toHaveBeenCalled();
  act(()=>root.querySelector('button')!.click());expect(versions).toHaveBeenCalledOnce();expect(p.play).not.toHaveBeenCalled();
});
