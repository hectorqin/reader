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

it('keeps tab drafts and refresh selection, follows action navigation and uses source instance endpoints', async () => {
  const { api, transport } = fixture();
  const route = { name: 'source-page' as const, sourceId: 'custom/one', pageId: 'settings' };
  expect(parseRoute(routeHash(route))).toEqual(route);
  expect(sameRoute(route, { ...route, sourceId: 'two' })).toBe(false);
  expect(parentOf(route)).toEqual({ name: 'sources' });
  transport.respondWith(request => ({ status: 200, headers: {}, json: {
    title: '我的书源', forms: [], ...(request.method === 'POST' ? { activeTab: 'sources', notice: '已保存' } : {}), tabs: [
      { id: 'sources', title: '书源管理', forms: [], sections: [{ title: '列表', items: [{ title: 'A', collapsible: true,
        forms: [{ id: 'save', title: '', submit: '保存', fields: [] }] }] }] },
      { id: 'import', title: '导入书源', forms: [{ id: 'import', title: 'JSON', submit: '导入', fields: [{ key: 'json', label: '规则', type: 'textarea' }] }] },
    ],
  } }));
  const screen = new PluginPageScreen({ api, ...route, onBack() {}, onSignedOut() {} }); screens.push(screen); document.body.append(screen.element);
  await screen.show();
  const tabs = () => [...screen.element.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  expect(screen.element.querySelector('.extension-actions')?.hasAttribute('hidden')).toBe(true);
  (screen.element.querySelector('[aria-expanded]') as HTMLButtonElement).click();
  expect(screen.element.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
  tabs()[1]!.click();
  const textarea = screen.element.querySelector('textarea')!; textarea.value = '{"draft":true}'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
  tabs()[0]!.click(); expect(screen.element.querySelector('textarea')).toBeNull();
  tabs()[1]!.click(); expect(screen.element.querySelector('textarea')!.value).toBe('{"draft":true}');
  await screen.show(); expect(screen.element.querySelector('[aria-selected=true]')?.textContent).toBe('导入书源');
  tabs()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  expect(document.activeElement?.textContent).toBe('书源管理');
  tabs()[1]!.click(); screen.element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  await vi.waitFor(() => expect(screen.element.querySelector('[aria-selected=true]')?.textContent).toBe('书源管理'));
  expect(screen.element.querySelector('[role=status]')?.textContent).toBe('已保存');
  expect(transport.requests.every(request => request.url.endsWith('/sources/custom%2Fone/pages/settings'))).toBe(true);
});
