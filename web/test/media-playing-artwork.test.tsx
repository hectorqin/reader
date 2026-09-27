// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {PlaybackControls} from '../src/media/playback-controls.tsx';
import type {MediaApi} from '../src/media/api.ts';
import type {MediaPlayer} from '../src/media/player.ts';
const host=document.createElement('div');document.body.append(host);
afterEach(()=>act(()=>render(null,host)));
it('keeps playback usable when artwork metadata fails and retries without restarting audio',async()=>{
  const detail=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({id:'track',kind:'track',title:'曲目',metadata:{artist:'演唱者'},overrides:{}});
  const toggle=vi.fn();
  const player={active:true,currentItemId:'track',title:'正在听的曲目',currentPlaylist:[],toggle} as unknown as MediaPlayer;
  await act(async()=>render(<PlaybackControls api={{detail,request:vi.fn().mockResolvedValue({favorite:false})} as unknown as MediaApi} player={player}/>,host));
  await vi.waitFor(()=>expect(host.textContent).toContain('作品资料读取失败'));
  expect(host.querySelector('h2')?.textContent).toBe('正在听的曲目');
  await act(async()=>host.querySelector<HTMLButtonElement>('.media-toggle-play')!.click());
  expect(toggle).toHaveBeenCalledTimes(1);
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='重新读取作品资料')!.click());
  await vi.waitFor(()=>expect(host.textContent).toContain('演唱者'));
  expect(host.textContent).not.toContain('作品资料读取失败');
  expect(host.querySelector('.media-cover')).not.toBeNull();
  expect(host.querySelector('h2')?.textContent).toBe('曲目'); // Track metadata replaces the composed queue label, avoiding repeated titles.
  expect(detail).toHaveBeenCalledTimes(2);
  expect(toggle).toHaveBeenCalledTimes(1);
});
