import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { SavePlaylist } from '../src/features/media/components/save-playlist.tsx';
import type { MediaApi } from '../src/features/media/api/media-api.ts';
import type { MediaPlayer } from '../src/features/media/services/player.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const button=(text:string)=>[...root.querySelectorAll('button')].find(button=>button.textContent===text)!;
it('requires a reviewed queue snapshot and invalidates confirmation after local edits',async()=>{
  const request=vi.fn(async(path:string)=>path==='queue/preview'?{channel:'music',revision:'rev',existingCount:3,newCount:2}:{items:[]});
  const api={request} as unknown as MediaApi,player={playlistPartIds:['a','b']} as unknown as MediaPlayer;
  const draw=()=>render(<SavePlaylist api={api} player={player}/>,root);
  await act(async()=>draw());
  await act(async()=>button('保存为待播队列').click());
  expect(root.textContent).toContain('替换已有 3 项');expect(request).toHaveBeenCalledTimes(1);
  await act(async()=>{Object.defineProperty(player,'playlistPartIds',{value:['b','a']});draw();});
  expect(button('确认保存队列').disabled).toBe(true);
  await act(async()=>button('重新预览').click());
  await act(async()=>button('确认保存队列').click());
  expect(request).toHaveBeenLastCalledWith('queue/snapshot','PUT',{partIds:['b','a'],expectedRevision:'rev'},expect.any(AbortSignal));
  expect(root.textContent).toContain('已保存');
});
