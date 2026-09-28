// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'preact/test-utils';
import {render} from '../src/ui/vendor/preact.ts';
import {FolderCleanup} from '../src/media/folder-cleanup.tsx';
import type {MediaApi} from '../src/media/api.ts';
vi.mock('../src/ui/floating-confirm.tsx',()=>({FloatingConfirm:({text,onConfirm,onCancel}:any)=><div role="dialog"><p>{text}</p><button onClick={onConfirm}>确认清理</button><button onClick={onCancel}>取消</button></div>}));
const root=document.createElement('div');document.body.append(root);
afterEach(()=>{act(()=>render(null,root));vi.clearAllMocks();});
const click=async(text:string)=>act(async()=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!.click());
const preview={path:'Show/Season 01',revision:'abc',assets:2,parts:2,editions:2,items:3,favorites:1,progress:2,queue:0};
it('previews the exact directory and requires confirmation before cleanup',async()=>{
  const request=vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce({...preview,returnPath:'Show'}),onCleaned=vi.fn();
  act(()=>render(<FolderCleanup api={{request} as unknown as MediaApi} libraryId="lib" path={preview.path} disabled={false} onBusy={vi.fn()} onCleaned={onCleaned}/>,root));
  await click('清理失效资源');await vi.waitFor(()=>expect(root.querySelector('[role=dialog]')).not.toBeNull());
  expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0]![0]).toContain('path=Show%2FSeason+01');
  expect(root.textContent).toContain('所有用户');expect(root.textContent).toContain('不会删除原始文件');
  await click('确认清理');await vi.waitFor(()=>expect(onCleaned).toHaveBeenCalledWith({...preview,returnPath:'Show'}));
  expect(request.mock.calls[1]!.slice(0,3)).toEqual(['libraries/lib/missing-resources/cleanup','POST',{path:preview.path,revision:'abc'}]);
});
it('cancel leaves records untouched; an empty preview does not offer deletion',async()=>{
  const request=vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce({...preview,assets:0});
  act(()=>render(<FolderCleanup api={{request} as unknown as MediaApi} libraryId="lib" path="" disabled={false} onBusy={vi.fn()} onCleaned={vi.fn()}/>,root));
  await click('清理失效资源');await click('取消');expect(request).toHaveBeenCalledTimes(1);
  await click('清理失效资源');expect(root.textContent).toContain('没有已标记缺失');expect(root.querySelector('[role=dialog]')).toBeNull();
});
it('failed or stale cleanup requires a fresh preview and never reports success',async()=>{
  const request=vi.fn().mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error('目录已变化')),onCleaned=vi.fn();
  act(()=>render(<FolderCleanup api={{request} as unknown as MediaApi} libraryId="lib" path="Show" disabled={false} onBusy={vi.fn()} onCleaned={onCleaned}/>,root));
  await click('清理失效资源');await click('确认清理');expect(root.textContent).toContain('重新预览');expect(onCleaned).not.toHaveBeenCalled();expect(root.querySelector('[role=dialog]')).toBeNull();
});
