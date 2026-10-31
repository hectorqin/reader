// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { ApiError } from '../src/api/errors.ts';
import { PublicationCache, publicationScope } from '../src/store/publications.ts';
import { useSourceMutations } from '../src/features/sources/hooks/sourceQueries.ts';

const opened: string[] = [];
vi.mock('../src/ui/reader-screen.tsx', () => ({
  ReaderScreen: class {
    element = document.createElement('div');
    open(book: { id: string }) { opened.push(book.id); return Promise.resolve(); }
    flushProgress() { return Promise.resolve(); }
    dispose() {}
  },
}));
const { ReaderPage } = await import('../src/features/reader/pages/ReaderPage.tsx');

function memoryKv() {
  const map = new Map<string, string>();
  return { get: async (key: string) => map.get(key) ?? null, set: async (key: string, value: string) => { map.set(key, value); }, delete: async (key: string) => { map.delete(key); } };
}

describe('a downloaded book opens offline', () => {
  it('takes the book record from the download manifest when the offline mirror has none', async () => {
    const kv = memoryKv();
    const platform = { kv, blobs: { get: async () => null, set: async () => undefined, delete: async () => undefined } } as any;
    const book = { id: 'b1', title: '离线书', format: 'epub' };
    await new PublicationCache(kv as any, platform.blobs, publicationScope('https://reader.example', 'u1')).putManifest('b1', { book } as any);
    const runtime = {
      api: { baseUrl: 'https://reader.example', currentSession: () => ({ user: { id: 'u1' } }), getBook: async () => { throw new ApiError('offline', 'Failed to fetch'); } },
      offline: { books: () => [], flush: async () => undefined },
      sync: { flush: async () => undefined },
      queryClient: { invalidateQueries: async () => undefined },
      mediaApi: { preferenceScope: () => 'scope' },
      settings: { current: {} },
      platform,
      registerReader: () => () => undefined,
      updateSettings: async () => undefined,
    } as any;
    const root = document.createElement('div');
    await act(async () => render(
      <RuntimeContext.Provider value={runtime}>
        <MemoryRouter initialEntries={['/book/b1']}><Routes><Route path="/book/:bookId" element={<ReaderPage />} /></Routes></MemoryRouter>
      </RuntimeContext.Provider>, root));
    await vi.waitFor(() => expect(opened).toEqual(['b1']));
    expect(root.textContent).not.toContain('无法打开这本书');
    await act(async () => render(null, root));
  });
});

describe('书源 writes refresh what they change', () => {
  async function mutations() {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const api = {
      baseUrl: 'https://reader.example',
      sourceCredential: async () => undefined,
      installPlugin: async () => ({ pluginId: 'p' }),
      uploadPlugin: async () => ({ pluginId: 'p' }),
      enablePlugin: async () => undefined,
      uninstallPlugin: async () => undefined,
    };
    let result!: ReturnType<typeof useSourceMutations>;
    function Probe() { result = useSourceMutations(); return null; }
    const root = document.createElement('div');
    await act(async () => render(<RuntimeContext.Provider value={{ api } as any}><QueryClientProvider client={client}><Probe /></QueryClientProvider></RuntimeContext.Provider>, root));
    const keys = () => invalidate.mock.calls.map(([filter]) => (filter as { queryKey: unknown[] }).queryKey);
    return { get m() { return result; }, keys, reset: () => invalidate.mockClear() };
  }

  it('a saved credential refetches that source’s credential status', async () => {
    const probe = await mutations();
    await act(async () => { await probe.m.credential.mutateAsync({ id: 's1', key: 'password', value: 'x' }); });
    expect(probe.keys()).toContainEqual(['source-credentials', 'https://reader.example', 's1']);
  });

  it.each(['installPlugin', 'uploadPlugin', 'enablePlugin', 'uninstallPlugin'] as const)('%s refetches the source types the plugin brings', async name => {
    const probe = await mutations();
    const argument = name === 'enablePlugin' ? { id: 'p', enabled: true } : name === 'uploadPlugin' ? new File([], 'p.tgz') : 'p';
    await act(async () => { await (probe.m[name].mutateAsync as (value: unknown) => Promise<unknown>)(argument); });
    await vi.waitFor(() => expect(probe.keys()).toContainEqual(['source-types']));
  });
});

describe('the expanded player’s address', async () => {
  const { playerPath } = await import('../src/features/media/stores/playback.store.ts');
  it('names the playing channel and the item/part a refresh restores, on every panel', () => {
    expect(playerPath({ channel: 'music', itemId: 'a b', partId: 'p1' })).toBe('/media/music/player?item=a%20b&part=p1');
    expect(playerPath({ channel: 'music', itemId: 'a', partId: 'p' }, 'lyrics')).toBe('/media/music/player/lyrics?item=a&part=p');
    expect(playerPath({ channel: 'audiobook', itemId: '', partId: '' })).toBe('/media/audiobook/player');
  });
});
