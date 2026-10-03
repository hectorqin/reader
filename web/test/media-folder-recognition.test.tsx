import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {FolderRecognition} from '../src/media/folder-recognition.tsx';
import type {MediaApi} from '../src/media/api.ts';
vi.mock('../src/ui/modal.tsx',()=>({Modal:({children,title}:any)=><div role="dialog" aria-label={title}>{children}</div>}));
vi.mock('../src/ui/floating-confirm.tsx',()=>({FloatingConfirm:({onConfirm,onCancel}:any)=><div><button onClick={onConfirm}>确认应用</button><button onClick={onCancel}>取消应用</button></div>}));
const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));vi.clearAllMocks();});
const click=async(text:string)=>act(async()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!.click());
const rule={rule:{path:'Show',mode:'series',title:'剧名',season:1},inherited:null,revision:'revision'};
const preview={id:'preview',items:['ready','review','protected','ignored'].map((status,index)=>({assetId:String(index),ref:`Show/${index}.mp4`,before:{id:'old',title:'旧名称',kind:'movie'},status,reason:'原因',after:{kind:'episode',metadata:{show:'剧名',season:1,episode:index,title:'标题'}}}))};
it('saves exact directory rules, selects only reliable results and applies after confirmation',async()=>{
  const request=vi.fn().mockResolvedValueOnce(rule).mockResolvedValueOnce({revision:'next'}).mockResolvedValueOnce(preview).mockResolvedValueOnce({updated:[]}),onApplied=vi.fn();
  act(()=>render(<FolderRecognition api={{request} as unknown as MediaApi} libraryId="lib" path="Show" disabled={false} onBusy={vi.fn()} onApplied={onApplied}/>,root));
  await click('识别规则与预览');await vi.waitFor(()=>expect(root.querySelector<HTMLButtonElement>('.media-primary')?.disabled).toBe(false));await click('保存并预览');
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-recognition-row')).toHaveLength(4));
  expect(request.mock.calls[1]!.slice(0,3)).toEqual(['libraries/lib/recognition-rule','PUT',{path:'Show',revision:'revision',rule:{...rule.rule,stripLeadingNumber:false}}]);
  const checks=Array.from(root.querySelectorAll<HTMLInputElement>('.media-recognition-row input'));
  expect(checks.map(input=>input.checked)).toEqual([true,false,false,false]);expect(checks.map(input=>input.disabled)).toEqual([false,false,true,true]);
  await click('应用所选');expect(request).toHaveBeenCalledTimes(3);await click('取消应用');expect(request).toHaveBeenCalledTimes(3);
  await click('应用所选');await click('确认应用');await vi.waitFor(()=>expect(onApplied).toHaveBeenCalledOnce());
  expect(request.mock.calls[3]!.slice(0,3)).toEqual(['libraries/lib/recognition-apply','POST',{path:'Show',previewId:'preview',assetIds:['0']}]);
});
it('retains saved-rule notice if preview fails and reports no successful application',async()=>{
  const request=vi.fn().mockResolvedValueOnce(rule).mockResolvedValueOnce({revision:'next'}).mockRejectedValueOnce(new Error('目录超过 500 个资源')),onApplied=vi.fn();
  act(()=>render(<FolderRecognition api={{request} as unknown as MediaApi} libraryId="lib" path="Show" disabled={false} onBusy={vi.fn()} onApplied={onApplied}/>,root));
  await click('识别规则与预览');await vi.waitFor(()=>expect(root.querySelector<HTMLButtonElement>('.media-primary')?.disabled).toBe(false));await click('保存并预览');await vi.waitFor(()=>expect(root.textContent).toContain('500'));expect(root.textContent).toContain('目录规则已保存');expect(onApplied).not.toHaveBeenCalled();
});
it('batch selection spans pages, excludes protected resources, and can be cleared',async()=>{
  const items=Array.from({length:65},(_,i)=>({...preview.items[i%4]!,assetId:String(i),ref:`Show/${i}.mp4`}));
  const request=vi.fn().mockResolvedValueOnce(rule).mockResolvedValueOnce({revision:'next'}).mockResolvedValueOnce({id:'many',items});
  act(()=>render(<FolderRecognition api={{request} as unknown as MediaApi} libraryId="lib" path="Show" disabled={false} onBusy={vi.fn()} onApplied={vi.fn()}/>,root));
  await click('识别规则与预览');await vi.waitFor(()=>expect(root.querySelector<HTMLButtonElement>('.media-primary')?.disabled).toBe(false));await click('保存并预览');
  await vi.waitFor(()=>expect(root.querySelectorAll('.media-recognition-row')).toHaveLength(30));
  await click('清空选择');await click('全选本页');expect(root.textContent).toContain('已选 16 / 33 项');
  await click('下一页');expect(root.textContent).toContain('已选 16 / 33 项');
  await click('全选可应用项');expect(root.textContent).toContain('已选 33 / 33 项');
  expect(root.querySelectorAll('.media-recognition-row input:disabled:checked')).toHaveLength(0);
  await click('清空选择');expect(root.textContent).toContain('已选 0 / 33 项');
});
it('does not decorate named season groups with 第 and 季',async()=>{
  const named={...preview.items[0]!,after:{...preview.items[0]!.after,metadata:{...preview.items[0]!.after.metadata,season:'4K版'}}};
  const request=vi.fn().mockResolvedValueOnce({...rule,rule:{...rule.rule,season:'4K版'}}).mockResolvedValueOnce({revision:'next'}).mockResolvedValueOnce({id:'named',items:[named]});
  act(()=>render(<FolderRecognition api={{request} as unknown as MediaApi} libraryId="lib" path="Show" disabled={false} onBusy={vi.fn()} onApplied={vi.fn()}/>,root));
  await click('识别规则与预览');await vi.waitFor(()=>expect(root.querySelector<HTMLButtonElement>('.media-primary')?.disabled).toBe(false));await click('保存并预览');
  await vi.waitFor(()=>expect(root.textContent).toContain('4K版第 0 集'));expect(root.textContent).not.toContain('第 4K版 季');
});
