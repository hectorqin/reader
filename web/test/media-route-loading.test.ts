// @vitest-environment jsdom
import {act} from 'preact/test-utils';
import {expect,it,vi} from 'vitest';
import {MediaScreen} from '../src/media/screen.tsx';
import type {MediaApi} from '../src/media/api.ts';
import type {MediaPlayer} from '../src/media/player.ts';

it('keeps a personal deep link identifiable when the initial library read fails and retries it',async()=>{
  vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',()=>{});
  const libraries=vi.fn().mockRejectedValueOnce(Error('读取媒体库失败')).mockResolvedValue({items:[]});
  const request=vi.fn().mockResolvedValue({items:[],total:0});
  const api={libraries,request,preferenceScope:()=> 'route-loading'} as unknown as MediaApi;
  const player=Object.assign(new EventTarget(),{element:document.createElement('div'),setControlsExpanded:vi.fn(),active:false}) as unknown as MediaPlayer;
  const screen=new MediaScreen(api,player,'music',false,vi.fn(),undefined,{page:'favorites',navigate:vi.fn()});
  document.body.append(screen.element);
  try{
    await act(async()=>{await screen.show();});
    expect(screen.element.querySelector('h1')?.textContent).toBe('我的收藏');
    expect(screen.element.textContent).toContain('读取媒体库失败');
    expect(screen.element.querySelector('.media-read-loading')).toBeNull();
    await act(async()=>{await screen.show();});
    expect(libraries).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledTimes(1);
    expect(screen.element.textContent).toContain('还没有收藏');
  }finally{act(()=>screen.dispose());screen.element.remove();vi.unstubAllGlobals();}
});
