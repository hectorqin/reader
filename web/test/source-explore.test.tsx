// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { SourceExplore, describeScan } from '../src/features/sources/components/SourceExplore.tsx';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { useSettingsStore } from '../src/shared/stores/settings.store.ts';
import { DEFAULT_APP_SETTINGS } from '../src/store/settings.ts';
import { LIBRARY_PATH } from '../src/shared/library-link.ts';

const root = document.createElement('div');
document.body.append(root);
const source = (id: string, pluginId: string, name: string, isDefault = false) => ({ id, pluginId, sourceType: id, name, enabled: true, isDefault, descriptor: null });
// An old database may have given the built-in library another id; `local` still finds it.
const sources = [source('legado-1', 'reader-source-legado', '书源库', true), source('lib-7', 'reader.local', '本地书库')];
const catalog = vi.fn(async (id: string, request: { ref?: string }) => id === 'lib-7'
  ? { title: request.ref ?? '本地书库', navigation: request.ref ? [] : [{ title: '科幻', ref: '科幻' }], items: [
    { ref: 'on', title: '在架的书', authors: ['甲'], metadata: { publicationId: 'on' }, options: [{ id: 'read', label: '加入书架' }] },
    { ref: 'off', title: '不在架的书', options: [{ id: 'read', label: '加入书架' }] }] }
  : { title: '发现', items: [{ ref: 'r', title: '远端的书' }] });
const upload = vi.fn(async () => ({ uploaded: [{}], skipped: [] }));
const refreshLibrary = vi.fn(async (scan: boolean) => scan ? { scanned: 3, added: 2, updated: 0, unchanged: 1, removed: 0, failed: 0, lastError: null, durationMs: 5 } : null);
const runtime = {
  api: { baseUrl: 'https://reader.example.com', sourceCatalog: catalog, upload, refreshLibrary, uploadProbe: async () => ({ allowed: true, writable: true }), coverBytes: async () => new Uint8Array() },
  updateSettings: async (patch: object) => useSettingsStore.getState().update(patch),
} as any;
const paint = async (url: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => render(
    <RuntimeContext.Provider value={runtime}><QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}><SourceExplore sources={sources as any} /></MemoryRouter>
    </QueryClientProvider></RuntimeContext.Provider>, root));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
const buttons = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].map(node => node.textContent);

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  useSettingsStore.getState().replace({ ...DEFAULT_APP_SETTINGS });
  catalog.mockClear(); upload.mockClear(); refreshLibrary.mockClear();
});

describe('发现', () => {
  it('opens the local library from 书库’s address, with reading, upload and the file manager', async () => {
    useAuthStore.setState({ verifiedUser: { id: 'u', username: 'a', displayName: 'A', role: 'admin', createdAt: 0 } as any });
    await paint(LIBRARY_PATH);
    expect(catalog).toHaveBeenLastCalledWith('lib-7', {});
    // A book already on the shelf is read, not added again.
    expect(buttons('.explore-book-actions .button.primary, .explore-book-actions button.primary')).toEqual(['阅读', '加入书架']);
    expect(root.querySelector('.explore-tools label')?.textContent).toBe('上传书籍');
    expect(root.querySelector('.explore-tools a')?.getAttribute('href')).toBe('/library/files');
    // Inside a folder, uploads and the file manager target that folder.
    await act(async () => { root.querySelector<HTMLButtonElement>('.explore-link')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(root.querySelector('.explore-tools a')?.getAttribute('href')).toBe(`/library/files?path=${encodeURIComponent('科幻')}`);
    const input = root.querySelector<HTMLInputElement>('.explore-tools input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.txt')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(upload).toHaveBeenCalledWith([expect.any(File)], '科幻', 'rename');
  });

  it('keeps upload and the file manager to the local library, and remembers the layout', async () => {
    await paint('/sources?tab=explore');
    expect(catalog).toHaveBeenLastCalledWith('legado-1', {});
    expect(root.querySelector('.explore-tools label, .explore-tools a')).toBeNull();
    expect(buttons('.explore-tools > button')).toEqual([]);
    expect(root.querySelector('.explore-books')).not.toBeNull();
    const grid = [...root.querySelectorAll<HTMLButtonElement>('.explore-layout button')].find(button => button.textContent === '网格')!;
    await act(async () => { grid.click(); });
    expect(useSettingsStore.getState().settings.exploreLayout).toBe('grid');
    expect(root.querySelector('.explore-books')).toBeNull();
    expect(root.querySelector('.explore-grid .explore-card')?.textContent).toContain('远端的书');
    expect(grid.getAttribute('aria-pressed')).toBe('true');
  });

  it('refreshes 书库 where it stands: an administrator scans first, a member reloads', async () => {
    useAuthStore.setState({ verifiedUser: { id: 'u', username: 'a', displayName: 'A', role: 'admin', createdAt: 0 } as any });
    await paint(LIBRARY_PATH);
    await act(async () => { root.querySelector<HTMLButtonElement>('.explore-link')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    catalog.mockClear();
    const refresh = () => [...root.querySelectorAll<HTMLButtonElement>('.explore-tools > button')].find(button => button.textContent === '刷新')!;
    await act(async () => { refresh().click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(refreshLibrary).toHaveBeenCalledWith(true);
    // The folder being shown is read again, not the top of the library.
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(catalog).toHaveBeenLastCalledWith('lib-7', { ref: '科幻' });
    expect(root.querySelector('.explore-trail [aria-current]')?.textContent).toBe('科幻');

    act(() => render(null, root));
    useAuthStore.setState({ verifiedUser: { id: 'm', username: 'm', displayName: 'M', role: 'member', createdAt: 0 } as any });
    refreshLibrary.mockClear();
    await paint(LIBRARY_PATH);
    await act(async () => { refresh().click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(refreshLibrary).toHaveBeenCalledWith(false);
  });
});

describe('describeScan', () => {
  const base = { scanned: 0, added: 0, updated: 0, unchanged: 0, removed: 0, failed: 0, lastError: null, durationMs: 0 };
  it('says what changed, or that nothing did', () => {
    expect(describeScan(base)).toBe('书库已是最新');
    expect(describeScan({ ...base, added: 2, removed: 1 })).toBe('书库已更新：新增 2 本、1 本文件已不在');
    expect(describeScan({ ...base, failed: 1 })).toBe('书库已更新：1 个文件读取失败');
  });
});

describe('书库 detail', () => {
  it('offers 编辑信息 and 更换封面 to administrators, on the local library’s books only', async () => {
    useAuthStore.setState({ verifiedUser: { id: 'a', username: 'a', displayName: 'A', role: 'admin', createdAt: 0 } as any });
    const detailOf = async () => {
      const open = [...root.querySelectorAll<HTMLButtonElement>('.explore-book-actions button')].find(button => button.textContent === '详情')!;
      await act(async () => { open.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
      const labels = [...document.querySelectorAll<HTMLButtonElement>('.book-detail-manage button')].map(button => button.textContent);
      act(() => { [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.getAttribute('aria-label') === '关闭')?.click(); });
      return labels;
    };
    runtime.api.sourceDetail = async () => ({});
    await paint(LIBRARY_PATH);
    expect(await detailOf()).toEqual(['编辑信息', '更换封面']);
    act(() => render(null, root));
    await paint('/sources?tab=explore');
    expect(await detailOf()).toEqual([]);
    // A reader's edit would rename the book for everyone, so a member gets neither.
    act(() => render(null, root));
    useAuthStore.setState({ verifiedUser: { id: 'm', username: 'm', displayName: 'M', role: 'member', createdAt: 0 } as any });
    await paint(LIBRARY_PATH);
    expect(await detailOf()).toEqual([]);
  });
});

