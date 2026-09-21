// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { PluginPageScreen } from '../src/ui/plugin-page-screen.tsx';
import { SourcesScreen } from '../src/ui/sources-screen.tsx';
import { ReaderApi } from '../src/api/client.ts';
import { FakeTransport, makePlatform, bodyText } from './helpers/env.ts';
import { parseRoute, routeHash, sameRoute, parentOf } from '../src/ui/router.ts';
const screens: Array<{ dispose(): void }> = [];
afterEach(() => { screens.splice(0).forEach(screen => screen.dispose()); document.body.replaceChildren(); });
function fixture() {
  const transport = new FakeTransport();
  const api = new ReaderApi(makePlatform(transport), { async load() { return null; }, async save() {}, async clear() {} });
  return { api, transport };
}
it('renders generic plugin forms as text and submits typed values on an independent route', async () => {
  const { api, transport } = fixture();
  const route = { name: 'plugin-page' as const, pluginId: 'third.party', pageId: 'settings' };
  expect(parseRoute(routeHash(route))).toEqual(route);
  expect(sameRoute(route, { ...route, pageId: 'other' })).toBe(false);
  expect(parentOf(route)).toEqual({ name: 'sources' });
  const screen = new PluginPageScreen({ api, ...route, onBack() {}, onSignedOut() {} });
  screens.push(screen); document.body.append(screen.element);
  transport.respondWith(() => ({ status: 200, headers: {}, json: { title: '扩展页面', description: '<script>evil()</script>',
    forms: [{ id: 'subscribe', title: '订阅', submit: '保存', values: { id: 'opaque' }, fields: [
      { key: 'url', label: '链接', type: 'text', required: true }, { key: 'enabled', label: '启用', type: 'boolean', value: true },
      { key: 'interval', label: '间隔', type: 'number', value: 60 }
    ] }] } }));
  await screen.show(); expect(screen.element.querySelector('script')).toBeNull();
  const url = screen.element.querySelector<HTMLInputElement>('input[type=text]')!; url.value = 'https://source.test'; url.dispatchEvent(new Event('input', { bubbles: true }));
  screen.element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  await vi.waitFor(() => expect(transport.requests.filter(request => request.method === 'POST')).toHaveLength(1));
  expect(JSON.parse(bodyText(transport.requests.find(request => request.method === 'POST')))).toEqual({ action: 'subscribe', values: { id: 'opaque', url: 'https://source.test', enabled: true, interval: 60 } });
});
it('uses provider-defined search filter keys and retains filters across pagination', async () => {
  const { api, transport } = fixture();
  const descriptor = { id: 'custom', pluginId: 'third.party', capabilities: ['search', 'search.filters'] };
  transport.respondWith(request => {
    let json: unknown = {};
    if (request.url.endsWith('/sources/types')) json = { types: [descriptor] };
    else if (request.url.endsWith('/sources')) json = { sources: [{ ...descriptor, id: 's1', name: '第三方', sourceType: 'custom', enabled: true, descriptor }] };
    else if (request.url.endsWith('/subscriptions')) json = { subscriptions: [] };
    else if (request.url.endsWith('/search-filters')) json = [{ key: 'region', label: '地区', type: 'select', options: [{ value: '', label: '全部' }, { value: 'asia', label: '亚洲' }] }];
    else if (request.url.includes('/search?')) json = { items: [], nextCursor: 'next' };
    return { status: 200, headers: {}, json };
  });
  const screen = new SourcesScreen({ api, admin: false, onOpen() {}, onBack() {}, onSignedOut() {} }); screens.push(screen); document.body.append(screen.element); await screen.show();
  const click = (label: string) => [...screen.element.querySelectorAll('button')].find(button => button.textContent === label)!.click();
  click('打开'); await vi.waitFor(() => expect(screen.element.querySelector('select')).not.toBeNull());
  const select = screen.element.querySelector('select')!; select.value = 'asia'; select.dispatchEvent(new Event('change', { bubbles: true }));
  const input = screen.element.querySelector<HTMLInputElement>('input[type=search]')!; input.value = '测试'; input.dispatchEvent(new Event('input', { bubbles: true })); click('搜索');
  await vi.waitFor(() => expect(screen.element.textContent).toContain('下一页')); click('下一页');
  await vi.waitFor(() => expect(transport.requests.filter(request => request.url.includes('/search?'))).toHaveLength(2));
  for (const request of transport.requests.filter(request => request.url.includes('/search?'))) expect(new URL(request.url, 'http://test').searchParams.get('filters')).toBe('{"region":"asia"}');
});
