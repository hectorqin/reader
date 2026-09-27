// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { App } from '../src/app.ts';
import { parseRoute } from '../src/ui/router.ts';

it.each(['#/shelf', '#/library', '#/library/files', '#/sources', '#/sources/source/page', '#/plugins/plugin/page', '#/book/book-id'])(
  'keeps %s free of channel navigation before and after visiting media', (hash) => {
    const container = document.createElement('div');
    const root = document.createElement('main');
    root.innerHTML = '<button>书架设置</button>';
    container.append(root);
    const originalContent = root.firstChild;
    const player = { setVisible: vi.fn(), stop: vi.fn(), pause: vi.fn() };
    const context = { root, channelEntry: null, mediaPlayer: player };
    const navigate = (target: string) => Reflect.apply(
      App.prototype['showChannelEntry'], context, [parseRoute(target)],
    );

    navigate(hash);
    expect(container.querySelector('nav')).toBeNull();
    expect(player.setVisible).toHaveBeenLastCalledWith(false);

    navigate('#/media/music');
    expect(container.querySelectorAll('nav')).toHaveLength(1);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('音乐');
    expect(player.setVisible).toHaveBeenLastCalledWith(true);

    navigate(hash);
    expect(container.querySelector('nav')).toBeNull();
    expect(player.setVisible).toHaveBeenLastCalledWith(false);
    expect(root.firstChild).toBe(originalContent);
    expect(player.stop).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();

    navigate('#/media/video');
    expect(container.querySelectorAll('nav')).toHaveLength(1);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('影视');
  },
);

it('flushes reading in its original order while media persistence is pending',async()=>{
  const calls:string[]=[];
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const context={mediaPlayer:{flush:()=>pending},reader:{flushProgress:async()=>{calls.push('reader');}},offline:{flush:async()=>{calls.push('offline');}},sync:{flush:async()=>{calls.push('sync');}}};
  const result=Reflect.apply(App.prototype.flush,context,[]) as Promise<void>;
  await vi.waitFor(()=>expect(calls).toEqual(['reader','offline','sync']));
  release();await result;
});

it('does not skip reading persistence when the media module throws',async()=>{
  const flush=vi.fn(async()=>{});
  const context={mediaPlayer:{flush:()=>{throw new Error('media failed');}},reader:{flushProgress:flush},offline:{flush},sync:{flush}};
  await expect(Reflect.apply(App.prototype.flush,context,[])).resolves.toBeUndefined();
  expect(flush).toHaveBeenCalledTimes(3);
});
