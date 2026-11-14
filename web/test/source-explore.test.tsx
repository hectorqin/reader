// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { SourceExplore } from '../src/features/sources/components/SourceExplore.tsx';
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
const runtime = {
  api: { baseUrl: 'https://reader.example.com', sourceCatalog: catalog, upload, uploadProbe: async () => ({ allowed: true, writable: true }), coverBytes: async () => new Uint8Array() },
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
  catalog.mockClear(); upload.mockClear();
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
    expect(root.querySelector('.explore-books')).not.toBeNull();
    const grid = [...root.querySelectorAll<HTMLButtonElement>('.explore-layout button')].find(button => button.textContent === '网格')!;
    await act(async () => { grid.click(); });
    expect(useSettingsStore.getState().settings.exploreLayout).toBe('grid');
    expect(root.querySelector('.explore-books')).toBeNull();
    expect(root.querySelector('.explore-grid .explore-card')?.textContent).toContain('远端的书');
    expect(grid.getAttribute('aria-pressed')).toBe('true');
  });
});
