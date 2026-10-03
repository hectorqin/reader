import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { EditionOrder } from '../src/features/media/components/edition-order.tsx';
import type { Edition, MediaApi } from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('moves a chapter across a page boundary, retries failures and explicitly resets scanned order',async()=>{
  const edition:Edition={id:'e',label:'版本',revision:'snapshot',parts:Array.from({length:51},(_,i)=>({id:String(i),assetId:String(i),title:`章${i}`,start:0,end:10,available:true}))};
  const request=vi.fn().mockRejectedValueOnce(new Error('暂时失败')).mockResolvedValue({id:'work'}),updated=vi.fn();
  await act(async()=>render(<EditionOrder api={{request} as unknown as MediaApi} edition={edition} onUpdated={updated}/>,root));
  expect(root.querySelectorAll('.media-row')).toHaveLength(50);
  await act(async()=>{(root.querySelector('[aria-label="下移 章49"]') as HTMLButtonElement).click();});
  expect(root.querySelector('.media-row')!.textContent).toContain('51. 章49');
  const save=()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='保存章节顺序')!;
  expect(request).not.toHaveBeenCalled();
  await act(async()=>save().click());expect(root.textContent).toContain('暂时失败');expect(updated).not.toHaveBeenCalled();
  await act(async()=>save().click());
  expect(request.mock.calls[1]![2].partIds.slice(-2)).toEqual(['50','49']);
  expect(edition.parts[49]!.id).toBe('49');
  await act(async()=>{(root.querySelector('input[type=checkbox]') as HTMLInputElement).click();});
  await act(async()=>save().click());
  expect(request).toHaveBeenLastCalledWith('editions/e/order','PUT',{expectedRevision:'snapshot',partIds:null},expect.any(AbortSignal));
});
