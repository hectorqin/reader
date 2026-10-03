import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaProviderSettings} from '../src/features/media/components/provider-settings.tsx';
import type {MediaApi} from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('retries source status and shows only capabilities reported by the server',async()=>{
 const request=vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue({items:[{id:'tmdb',label:'TMDB',kinds:['movie','series'],configured:false},{id:'musicbrainz',label:'MusicBrainz',kinds:['album','track'],configured:true}]});
 const businessSettingsRequest=vi.fn().mockResolvedValue({groups:[{group:'tmdb',label:'TMDB',revision:1,values:{enabled:false},secrets:{token:false},fields:[{key:'token',label:'读取令牌',type:'password'}]}]});
 await act(async()=>render(<MediaProviderSettings api={{request,businessSettingsRequest} as unknown as MediaApi}/>,root));
 await vi.waitFor(()=>expect(root.querySelector('[role=alert]')?.textContent).toContain('网络中断'));
 await act(async()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='重试读取来源')!.click());
 await vi.waitFor(()=>expect(root.querySelectorAll('.media-provider-row')).toHaveLength(3));
 const rows=root.querySelectorAll('.media-provider-row');expect(rows).toHaveLength(3);expect(rows[0]!.textContent).toContain('未配置');expect(rows[1]!.textContent).toContain('已配置');
 await act(async()=>(rows[0] as HTMLButtonElement).click());await vi.waitFor(()=>expect(root.querySelector('input[type=password]')).not.toBeNull());expect(root.textContent).not.toContain('MEDIA_TMDB_API_KEY');expect(root.textContent).toContain('保存配置');
 expect(request.mock.calls.every(call=>call[0]==='metadata/providers'&&call[1]==='GET')).toBe(true);
 expect(Array.from(root.querySelectorAll('button')).some(button=>button.textContent?.includes('TVBox'))).toBe(false);
});
it('keeps local information available while loading and aborts a pending source read on exit',async()=>{
 let reject!:(error:Error)=>void;
 const request=vi.fn(()=>new Promise((_resolve,no)=>reject=no));
 await act(async()=>render(<MediaProviderSettings api={{request} as unknown as MediaApi}/>,root));
 expect(root.querySelectorAll('.media-skeleton-entry')).toHaveLength(2);
 await act(async()=>Array.from(root.querySelectorAll('button')).find(button=>button.textContent?.startsWith('本地资料'))!.click());
 expect(root.textContent).toContain('扫描时读取本地资料');expect(root.querySelector('[role=alert]')).toBeNull();
 const signal=(request.mock.calls[0] as unknown as unknown[])[3] as AbortSignal;
 act(()=>render(null,root));expect(signal.aborted).toBe(true);
 await act(async()=>reject(new Error('过期来源错误')));expect(root.textContent).toBe('');
});
