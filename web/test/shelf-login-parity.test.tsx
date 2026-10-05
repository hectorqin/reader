// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { ShelfPage } from '../src/features/shelf/pages/ShelfPage.tsx';
import { LoginPage } from '../src/features/auth/pages/LoginPage.tsx';

vi.mock('../src/features/shelf/queries/shelf.queries.ts', () => ({
  useShelf: () => ({ data: { items: [], total: 0, pageSize: 60 }, isPending: false, error: null }),
}));

const root = document.createElement('div');
document.body.append(root);
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function runtime() {
  const api = {
    baseUrl: 'https://reader.test',
    currentSession: () => ({ user: { id: 'u1', username: 'admin', displayName: '管理员', role: 'admin' } }),
    refreshQueries: vi.fn(),
    continueReading: vi.fn(async () => []),
    browseBatchShelf: vi.fn(async () => ({ books: [] })),
    setBaseUrl: vi.fn(),
    instance: vi.fn(async () => ({ name: 'reader', apiVersion: 1, userCount: 1, registrationOpen: false, invitationRequired: false })),
    opdsCredentials: vi.fn(async () => ({ credentials: [], catalogUrl: '/opds' })),
    createOpdsCredential: vi.fn(),
    revokeOpdsCredential: vi.fn(),
    adminUsers: vi.fn(async () => ({ users: [] })),
    registrationSettings: vi.fn(async () => ({ mode: 'closed', invites: [] })),
  };
  return {
    api,
    updateSettings: vi.fn(async () => undefined),
    settings: { setServerUrl: vi.fn(async () => undefined) },
  } as any;
}

function mount(node: ReactNode, value = runtime(), initialEntry = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => render(<RuntimeContext value={value}><QueryClientProvider client={queryClient}><MantineProvider><MemoryRouter initialEntries={[initialEntry]}>{node}</MemoryRouter></MantineProvider></QueryClientProvider></RuntimeContext>, root));
  return value;
}

afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  vi.restoreAllMocks();
});

it('keeps the shelf entry points available and restores clear, settings and OPDS actions', async () => {
  const value = mount(<ShelfPage />, runtime(), '/shelf?q=三体');
  expect(root.textContent).toContain('书源');
  expect(root.textContent).not.toContain('刷新');
  expect(root.textContent).toContain('设置');
  expect(root.querySelector('[aria-label="清除搜索"]')).not.toBeNull();
  const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => root.querySelector<HTMLButtonElement>('[aria-label="清除搜索"]')!.click());
  expect(search.value).toBe('');

  const settingsButton = [...root.querySelectorAll('button')].find(button => button.textContent === '设置');
  await act(async () => settingsButton?.click());
  expect(root.textContent).toContain('连接外部阅读器');
  await act(async () => [...root.querySelectorAll('button')].find(button => button.textContent === '连接外部阅读器')?.click());
  await vi.waitFor(() => expect(root.querySelector('dialog')).not.toBeNull());
  expect(value.api.opdsCredentials).toHaveBeenCalled();
});

it('collapses the server address and explains that sessions are remembered on login', () => {
  mount(<LoginPage />);
  const details = root.querySelector<HTMLDetailsElement>('.login-connection')!;
  expect(details.open).toBe(false);
  expect(root.textContent).toContain('登录状态自动保持，无需每天重新登录');
  details.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(details.open).toBe(true);
});
