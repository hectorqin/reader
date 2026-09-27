// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from '../src/ui/vendor/preact.ts';
import { MediaLibraryCreate } from '../src/media/library-create.tsx';
import type { MediaApi } from '../src/media/api.ts';

const root = document.createElement('div'); document.body.append(root);
const library = { id: 'new-lib', name: '新音乐', kind: 'music', access: 'restricted' };
afterEach(() => act(() => render(null, root)));
const button = (name: string) => [...root.querySelectorAll('button')].find(item => item.textContent === name)!;
async function submit() {
  await act(async () => {
    root.querySelector<HTMLInputElement>('[name=name]')!.value = '新音乐';
    root.querySelector<HTMLInputElement>('[name=root]')!.value = '/music';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')).not.toBeNull());
}

it('reuses the request id after losing a creation response and changes it for a changed form', async () => {
  const request = vi.fn().mockRejectedValue(new Error('response lost'));
  await act(async () => render(<MediaLibraryCreate api={{ request } as unknown as MediaApi} channel="music" disabled={false} onCreated={() => {}} onJobs={async () => {}}/>, root));
  await submit();
  const first = request.mock.calls[0]![2].requestId;
  await submit();
  expect(request.mock.calls[1]![2].requestId).toBe(first);
  await act(async () => {
    root.querySelector<HTMLInputElement>('[name=name]')!.value = '另一个库';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(request.mock.calls[2]![2].requestId).not.toBe(first);
});

it('retains the created library and retries only scanning after a scan request fails', async () => {
  const request = vi.fn().mockResolvedValueOnce(library).mockRejectedValueOnce(new Error('扫描请求失败')).mockResolvedValue({});
  const onCreated = vi.fn(), onJobs = vi.fn(async () => {});
  await act(async () => render(<MediaLibraryCreate api={{ request } as unknown as MediaApi} channel="music" disabled={false} onCreated={onCreated} onJobs={onJobs}/>, root));
  await submit();
  expect(onCreated).toHaveBeenCalledTimes(1);
  expect(root.querySelector('form')).toBeNull();
  expect(root.textContent).toContain('已创建');
  await act(async () => button('启动此库扫描').click());
  await vi.waitFor(() => expect(onJobs).toHaveBeenCalledWith('new-lib'));
  expect(request.mock.calls.map(call => call[0])).toEqual(['libraries', 'libraries/new-lib/scan', 'libraries/new-lib/scan']);
});

it('retries reading jobs without recreating or rescanning after a confirmed scan submission', async () => {
  const request = vi.fn().mockResolvedValueOnce(library).mockResolvedValue({});
  const onJobs = vi.fn().mockRejectedValueOnce(new Error('任务读取失败')).mockResolvedValue(undefined);
  await act(async () => render(<MediaLibraryCreate api={{ request } as unknown as MediaApi} channel="music" disabled={false} onCreated={() => {}} onJobs={onJobs}/>, root));
  await submit();
  expect(root.textContent).toContain('扫描请求已提交');
  expect(button('启动此库扫描')).toBeUndefined();
  await act(async () => button('查看此库任务').click());
  await vi.waitFor(() => expect(onJobs).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.map(call => call[0])).toEqual(['libraries', 'libraries/new-lib/scan']);
});

it('creates an OpenList library with its remote directory and credentials', async () => {
  const request=vi.fn().mockResolvedValueOnce({...library,storage:'openlist'}).mockResolvedValue({});
  await act(async()=>render(<MediaLibraryCreate api={{request} as unknown as MediaApi} channel="video" disabled={false} onCreated={()=>{}} onJobs={async()=>{}}/>,root));
  await act(async()=>{const source=root.querySelector<HTMLSelectElement>('select[aria-label="接入方式"]')!;source.value='openlist';source.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{
    for(const [name,value] of Object.entries({name:'云端影视',root:'/影视/电影',baseUrl:'https://openlist.example.com',token:'private-token',password:'directory-password'}))root.querySelector<HTMLInputElement>(`input[name=${name}]`)!.value=value;
    root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  expect(request.mock.calls[0]).toEqual(['libraries','POST',expect.objectContaining({name:'云端影视',kind:'video',storage:'openlist',root:'/影视/电影',access:'restricted',openlist:{baseUrl:'https://openlist.example.com',token:'private-token',password:'directory-password'}}),expect.any(AbortSignal)]);
  expect(request.mock.calls[1]![0]).toBe('libraries/new-lib/scan');
});

it('drops OpenList-only fields when switching back to a local library',async()=>{
  const request=vi.fn().mockRejectedValue(new Error('response lost'));
  await act(async()=>render(<MediaLibraryCreate api={{request} as unknown as MediaApi} channel="music" disabled={false} onCreated={()=>{}} onJobs={async()=>{}}/>,root));
  const change=async(value:string)=>act(async()=>{const source=root.querySelector<HTMLSelectElement>('select[aria-label="接入方式"]')!;source.value=value;source.dispatchEvent(new Event('change',{bubbles:true}));});
  await change('openlist');
  expect(root.querySelector('input[name=token]')).not.toBeNull();
  await change('local');
  expect(root.querySelector('input[name=token]')).toBeNull();
  await submit();
  expect(request.mock.calls[0]![2].storage).toBe('local');
  expect(request.mock.calls[0]![2]).not.toHaveProperty('openlist');
});
