import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';

import { MediaLibraryEditor } from '../src/features/media/components/library-editor.tsx';
import type { Library, MediaApi } from '../src/features/media/api/media-api.ts';

const root = document.createElement('div'); document.body.append(root);
const library: Library = { id: 'lib', name: '音乐', kind: 'music', access: 'restricted' };
const config = { ...library, storage: 'local', root: '/media/长目录/音乐', userIds: [] };
afterEach(() => act(() => render(null, root)));
const button = (label: string) => [...root.querySelectorAll('button')].find(item => item.textContent === label)!;

it('keeps saving disabled until configuration is read and retries only the read', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(config);
  const api = { request } as unknown as MediaApi;
  await act(async () => render(<MediaLibraryEditor api={api} library={library} onSaved={() => {}} onCancel={() => {}}/>, root));
  expect(button('保存修改').disabled).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')?.textContent).toContain('网络中断'));
  await act(async () => button('重试读取配置').click());
  await vi.waitFor(() => expect(root.textContent).toContain(config.root));
  expect(button('保存修改').disabled).toBe(false);
  expect(request.mock.calls.map(call => call[1])).toEqual(['GET', 'GET']);
});

it('sends only the new name and keeps it available after a failed save', async () => {
  const request = vi.fn().mockResolvedValueOnce(config).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue({ ...library, name: '改名' });
  const saved = vi.fn();
  await act(async () => render(<MediaLibraryEditor api={{ request } as unknown as MediaApi} library={library} onSaved={saved} onCancel={() => {}}/>, root));
  await vi.waitFor(() => expect(button('保存修改').disabled).toBe(false));
  await act(async () => { const input = root.querySelector('input')!; input.value = ' 改名 '; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => button('保存修改').click());
  expect(root.querySelector('input')?.value).toBe(' 改名 ');
  expect(saved).not.toHaveBeenCalled();
  await act(async () => button('保存修改').click());
  expect(request).toHaveBeenLastCalledWith('libraries/lib', 'PATCH', { name: '改名' }, expect.any(AbortSignal));
  expect(saved).toHaveBeenCalledWith({ ...library, name: '改名' });
});

it('aborts a pending save and ignores its result after leaving the panel', async () => {
  let finish!: (value: Library) => void;
  const request = vi.fn().mockResolvedValueOnce(config).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saved = vi.fn();
  await act(async () => render(<MediaLibraryEditor api={{ request } as unknown as MediaApi} library={library} onSaved={saved} onCancel={() => {}}/>, root));
  await vi.waitFor(() => expect(button('保存修改').disabled).toBe(false));
  await act(async () => button('保存修改').click());
  const signal = request.mock.calls[1]![3] as AbortSignal;
  act(() => render(null, root));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(library));
  expect(saved).not.toHaveBeenCalled();
});

it('keeps saved OpenList credentials private and replaces only the entered token',async()=>{
  const request=vi.fn().mockResolvedValueOnce({...config,storage:'openlist',openlist:{baseUrl:'https://openlist.example.com',hasToken:true,hasPassword:true}}).mockResolvedValue({...library,storage:'openlist'});
  await act(async()=>render(<MediaLibraryEditor api={{request} as unknown as MediaApi} library={library} onSaved={()=>{}} onCancel={()=>{}}/>,root));
  await vi.waitFor(()=>expect(root.querySelector('input[name=token]')).not.toBeNull());
  expect(root.querySelector<HTMLInputElement>('input[name=token]')!.value).toBe('');
  expect(root.querySelector<HTMLInputElement>('input[name=password]')!.value).toBe('');
  await act(async()=>{const token=root.querySelector<HTMLInputElement>('input[name=token]')!;token.value='replacement-token';token.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('保存修改').click());
  expect(request).toHaveBeenLastCalledWith('libraries/lib','PATCH',{name:'音乐',openlist:{token:'replacement-token'}},expect.any(AbortSignal));
});
