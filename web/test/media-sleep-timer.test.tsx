// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {SleepTimerOptions} from '../src/media/sleep-timer.tsx';
import type {MediaPlayer} from '../src/media/player.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('sets and clears the active player timer through touch-sized presets',()=>{
  const sleep=vi.fn(),onSelected=vi.fn();
  act(()=>render(<SleepTimerOptions player={{sleep,sleepAt:123,sleepRemainingMinutes:28} as unknown as MediaPlayer} onSelected={onSelected}/>,root));
  expect(root.textContent).toContain('28 分钟');expect(root.querySelector('select')).toBeNull();
  act(()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='45分钟')!.click());expect(sleep).toHaveBeenLastCalledWith(45);
  act(()=>root.querySelector<HTMLButtonElement>('.media-sleep-off')!.click());expect(sleep).toHaveBeenLastCalledWith(0);expect(onSelected).toHaveBeenCalledTimes(2);
});
