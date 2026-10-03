import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { ResourceInfo } from '../src/features/media/components/resource-info.tsx';
import type { MediaApi } from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('loads only when expanded and ignores a response after closing',async()=>{
  let resolve!:(value:unknown)=>void;
  const request=vi.fn(()=>new Promise(done=>{resolve=done;}));
  await act(async()=>render(<ResourceInfo api={{request} as unknown as MediaApi} assetId="asset"/>,root));
  expect(request).not.toHaveBeenCalled();
  await act(async()=>{const details=root.querySelector('details')!;details.open=true;details.dispatchEvent(new Event('toggle'));});
  expect(request).toHaveBeenCalledTimes(1);
  const signal=(request.mock.calls[0] as unknown as unknown[])[3] as AbortSignal;
  await act(async()=>{const details=root.querySelector('details')!;details.open=false;details.dispatchEvent(new Event('toggle'));});
  expect(signal.aborted).toBe(true);
  await act(async()=>resolve({size:1024,available:true,probe:{info:{format:'TEST',duration:30,streams:[]},status:'ready'}}));
  expect(root.textContent).not.toContain('TEST');
});
