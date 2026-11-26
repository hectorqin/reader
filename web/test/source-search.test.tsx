// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { SourcesPage } from '../src/features/sources/pages/SourcesPage.tsx';
import { SourceCatalogPage } from '../src/features/sources/pages/SourceCatalogPage.tsx';
import type { SourcePage } from '../src/api/sources.ts';

const root = document.createElement('div');
document.body.append(root);
const getRandomValues = crypto.getRandomValues.bind(crypto);
const source = {
  id: 'local',
  name: '本地书库',
  pluginId: 'reader.local',
  sourceType: 'local',
  enabled: true,
  isDefault: true,
  descriptor: { label: '本地书库', builtin: true, capabilities: ['search'] },
};
const searchSource = vi.fn(async function* (
  _id: string,
  _request: Record<string, unknown>,
  _options?: unknown,
): AsyncGenerator<SourcePage> {
  yield { items: [{ ref: 'book', title: '找到的书' }] };
});
const runtime = {
  api: {
    baseUrl: 'http://192.168.1.10:5888',
    sources: async () => [source],
    sourceTypes: async () => [],
    searchSource,
  },
} as any;
let client: QueryClient;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const submitButton = () => root.querySelector<HTMLButtonElement>('.sources-search button[type="submit"]')!;
const submit = () =>
  act(async () => {
    root.querySelector('form.sources-search')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const expectReady = () => {
  expect(submitButton().disabled).toBe(false);
  expect(root.querySelector('.search-stop')).toBeNull();
  expect(root.textContent).not.toContain('正在搜索');
};

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  searchSource.mockClear();
});
afterEach(() => {
  act(() => render(null, root));
  client.clear();
  vi.unstubAllGlobals();
});

describe.each([
  { name: 'SourcesPage', Page: SourcesPage, path: '/sources' },
  { name: 'SourceCatalogPage', Page: SourceCatalogPage, path: '/sources/:sourceId/browse' },
])('$name on LAN HTTP without randomUUID', ({ Page, path }) => {
  async function paint() {
    await act(async () =>
      render(
        <RuntimeContext.Provider value={runtime}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[path.replace(':sourceId', 'local')]}>
              <Routes>
                <Route path={path} element={<Page />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </RuntimeContext.Provider>,
        root,
      ),
    );
    await settle();
    const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '书');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('sends a request with a fallback UUID and clears busy after streamed results', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    searchSource.mockImplementationOnce(async function* () {
      await pending;
      yield { items: [{ ref: 'book', title: '找到的书' }] };
    });
    await paint();
    await submit();
    expect(root.querySelector('.search-stop') || submitButton().disabled).toBeTruthy();
    expect(searchSource).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        query: '书',
        sessionId: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
      }),
      ...(Page === SourcesPage ? [expect.objectContaining({ signal: expect.any(AbortSignal) })] : []),
    );
    await act(async () => finish());
    await settle();
    expect(root.textContent).toContain('找到的书');
    expectReady();
  });

  it('clears busy after empty results', async () => {
    searchSource.mockImplementationOnce(async function* () {
      yield { items: [] };
    });
    await paint();
    await submit();
    expect(searchSource).toHaveBeenCalledTimes(1);
    expectReady();
  });

  it('shows request errors and clears busy', async () => {
    searchSource.mockImplementationOnce(async function* () {
      throw new Error('请求失败');
    });
    await paint();
    await submit();
    expect(searchSource).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('请求失败');
    expectReady();
  });

  it('shows setup errors, clears busy, and allows another search', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: () => {
        throw new Error('无法生成搜索 ID');
      },
    });
    await paint();
    await submit();
    expect(searchSource).not.toHaveBeenCalled();
    expect(root.textContent).toContain('无法生成搜索 ID');
    expectReady();
    vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues });
    await submit();
    expect(searchSource).toHaveBeenCalledTimes(1);
    expect(root.textContent).not.toContain('无法生成搜索 ID');
    expectReady();
  });
});
