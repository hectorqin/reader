// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '../src/ui/vendor/preact.ts';
import { ScanJobs } from '../src/media/scan-jobs.tsx';
const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
it('shows inspected counts without inventing a total and prevents a retry while scanning',()=>{
  const props={libraryName:'家庭影院',busy:false,jobs:[{id:'now',state:'running',inspected:136,error:null},{id:'old',state:'failed',inspected:0,error:'directory-unavailable'}],onCancel:vi.fn(),onRetry:vi.fn()};
  act(()=>render(<ScanJobs {...props}/>,root));
  expect(root.textContent).toContain('已检查 136 个文件');expect(root.querySelector('progress')!.hasAttribute('value')).toBe(false);
  expect(root.textContent).toContain('媒体目录不可访问，原有资料已保留');
  const retry=root.querySelector<HTMLButtonElement>('[aria-label="重新扫描媒体库"]')!;expect(retry.disabled).toBe(true);
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="取消扫描"]')!.click());expect(props.onCancel).toHaveBeenCalledWith('now');
  act(()=>render(<ScanJobs {...props} jobs={props.jobs.slice(1)}/>,root));
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="重新扫描媒体库"]')!.click());expect(props.onRetry).toHaveBeenCalledOnce();
});

it('shows queued libraries, retries a different library and pages long job lists',()=>{
  const jobs=[{id:'queued',libraryId:'a',state:'queued',inspected:0,error:null},...Array.from({length:34},(_,i)=>({id:'failed-'+i,libraryId:'b',state:'failed',inspected:0,error:'directory-unavailable'}))];
  const onCancel=vi.fn(),onRetry=vi.fn();
  act(()=>render(<ScanJobs jobs={jobs} libraryName="媒体库" libraries={[{id:'a',name:'音乐',kind:'music',access:'all'},{id:'b',name:'影院',kind:'video',access:'all'}]} busy={false} onCancel={onCancel} onRetry={onRetry}/>,root));
  expect(root.textContent).toContain('音乐 · 目录扫描');expect(root.textContent).toContain('排队中');expect(root.querySelector('progress')).toBeNull();
  expect(root.querySelectorAll('.media-scan-job')).toHaveLength(30);
  act(()=>root.querySelector<HTMLButtonElement>('[aria-label="取消扫描"]')!.click());expect(onCancel).toHaveBeenCalledWith('queued');
  const retry=root.querySelector<HTMLButtonElement>('[aria-label="重新扫描媒体库"]')!;expect(retry.disabled).toBe(false);act(()=>retry.click());expect(onRetry).toHaveBeenCalledWith('b');
  act(()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='下一页')!.click());expect(root.querySelectorAll('.media-scan-job')).toHaveLength(5);
});
