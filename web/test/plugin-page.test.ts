// @vitest-environment jsdom
import { noticeText } from './helpers/notices.ts';
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
it('shows action errors in a dismissible floating alert without replacing the tab or its drafts', async () => {
  const { api, transport } = fixture();
  transport.respondWith(request => request.method === 'POST'
    ? { status: 502, headers: {}, json: { error: { code: 'PLUGIN_UNAVAILABLE', message: '插件暂时不可用' } } }
    : { status: 200, headers: {}, json: { title: '配置', forms: [], tabs: [{ id: 'settings', title: '设置', forms: [
      { id: 'save', title: '保存配置', submit: '保存', fields: [{ key: 'value', label: '内容', type: 'text' }] },
    ] }] } });
  const screen = new PluginPageScreen({ api, sourceId: 'one', pageId: 'settings', onBack() {}, onSignedOut() {} });
  screens.push(screen); document.body.append(screen.element); await screen.show();
  const panel = screen.element.querySelector('[role=tabpanel]');
  const input = screen.element.querySelector('input')!;
  input.value = '保留草稿'; input.dispatchEvent(new Event('input', { bubbles: true }));
  screen.element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  await vi.waitFor(() => expect(noticeText()).toBe('插件暂时不可用'));
  expect(screen.element.querySelector('[role=tabpanel]')).toBe(panel);
  expect(input.value).toBe('保留草稿');
  expect(document.activeElement).toBe(panel);
  document.querySelector<HTMLButtonElement>('.notyf [aria-label="关闭提示"]')!.click();
  await vi.waitFor(() => expect(document.querySelector('.global-notice')).toBeNull());
  expect(screen.element.querySelector('[role=tabpanel]')).toBe(panel);
});
it('renders generic log and JSON outputs as bounded text blocks in the selected tab', async () => {
  const { api, transport } = fixture();
  transport.respondWith(() => ({ status: 200, headers: {}, json: { title: '诊断', forms: [], tabs: [
    { id: 'config', title: '配置', forms: [] },
    { id: 'diagnostic', title: '诊断', forms: [], outputs: [
      { title: '运行日志', format: 'log', text: '<img src=x onerror=alert(1)>\n200 OK' },
      { title: '结果', format: 'json', text: '{"count":1}' },
    ] },
  ] } }));
  const screen = new PluginPageScreen({ api, sourceId: 'third-party', pageId: 'diagnostics', onBack() {}, onSignedOut() {} });
  screens.push(screen); document.body.append(screen.element); await screen.show();
  expect(screen.element.querySelector('pre')).toBeNull();
  screen.element.querySelectorAll<HTMLButtonElement>('[role=tab]')[1]!.click();
  expect(screen.element.querySelectorAll('.extension-output')).toHaveLength(2);
  expect(screen.element.querySelector('pre')?.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(screen.element.querySelector('img')).toBeNull();
  expect(screen.element.querySelector('pre')?.tabIndex).toBe(0);
});
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
    else if (request.url.endsWith('/search')) return { status: 200, headers: {}, stream: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: results\ndata: {"items":[],"nextCursor":"next"}\n\nevent: done\ndata: {}\n\n')); controller.close();
    } }) };
    return { status: 200, headers: {}, json };
  });
  const screen = new SourcesScreen({ api, admin: false, onOpen() {}, onBack() {}, onSignedOut() {} }); screens.push(screen); document.body.append(screen.element); await screen.show();
  const click = (label: string) => [...screen.element.querySelectorAll('button')].find(button => button.textContent === label)!.click();
  const picker = screen.element.querySelector<HTMLSelectElement>('[aria-label="选择来源"]')!;
  picker.value = 's1'; picker.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(screen.element.querySelector('.sources-search select')).not.toBeNull());
  const select = screen.element.querySelector<HTMLSelectElement>('.sources-search select')!; select.value = 'asia'; select.dispatchEvent(new Event('change', { bubbles: true }));
  const input = screen.element.querySelector<HTMLInputElement>('input[type=search]')!; input.value = '测试'; input.dispatchEvent(new Event('input', { bubbles: true })); click('搜索');
  await vi.waitFor(() => expect(screen.element.textContent).toContain('加载更多结果')); click('加载更多结果');
  await vi.waitFor(() => expect(transport.requests.filter(request => request.url.endsWith('/search'))).toHaveLength(2));
  for (const request of transport.requests.filter(request => request.url.endsWith('/search'))) expect(JSON.parse(bodyText(request)).filters).toEqual({ region: 'asia' });
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
  expect(noticeText()).toBe('已保存');
  expect(transport.requests.every(request => request.url.endsWith('/sources/custom%2Fone/pages/settings'))).toBe(true);
});

it('preserves unrelated tab drafts after actions and requires inline confirmation before deletion', async () => {
  const { api, transport } = fixture();
  const payload = { title: '实例', forms: [], tabs: [
    { id: 'rules', title: '规则', forms: [{ id: 'delete', title: '', submit: '删除', confirm: '删除当前规则？', fields: [] }] },
    { id: 'draft', title: '草稿', forms: [{ id: 'import', title: '', submit: '保存草稿', fields: [{ key: 'json', label: 'JSON', type: 'textarea' }] }] },
  ] };
  transport.respondWith(request => ({ status: 200, headers: {}, json: { ...payload, ...(request.method === 'POST' ? { notice: '删除成功' } : {}) } }));
  const screen = new PluginPageScreen({ api, sourceId: 'one', pageId: 'settings', onBack() {}, onSignedOut() {} }); screens.push(screen); document.body.append(screen.element);
  await screen.show();
  const tab = (name: string) => [...screen.element.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(button => button.textContent === name)!;
  const button = (name: string) => [...screen.element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!;
  tab('草稿').click(); const area = screen.element.querySelector('textarea')!; area.value = 'unsaved'; area.dispatchEvent(new Event('input', { bubbles: true }));
  tab('规则').click(); button('删除').click();
  expect(screen.element.querySelector('[role=group]')?.textContent).toContain('删除当前规则？');
  expect(transport.requests.filter(request => request.method === 'POST')).toHaveLength(0);
  button('取消').click(); expect(screen.element.querySelector('[role=group]')).toBeNull();
  button('删除').click(); button('确认删除').click();
  await vi.waitFor(() => expect(noticeText()).toBe('删除成功'));
  expect(document.activeElement?.getAttribute('role')).toBe('tabpanel');
  expect(noticeText()).toBe('删除成功');
  expect(screen.element.querySelector('.extension-toolbar [role=status]')).toBeNull();
  tab('草稿').click(); expect(screen.element.querySelector('textarea')?.value).toBe('unsaved');
});

it('clears secret inputs after a failed login and only renders safe external links', async () => {
  const { api, transport } = fixture();
  transport.respondWith(request => request.method === 'POST' ? { status: 502, headers: {}, json: { error: { code: 'AUTH_REQUIRED', message: '登录失败' } } } : {
    status: 200, headers: {}, json: { title: '登录', forms: [{ id: 'login', title: '登录表单', submit: '登录书源', fields: [{ key: 'password', label: '密码', type: 'password' }] }],
      links: [{ title: '站点', url: 'https://example.test/login' }, { title: '脚本', url: 'javascript:alert(1)' }] }
  });
  const screen = new PluginPageScreen({ api, sourceId: 'one', pageId: 'library', onBack() {}, onSignedOut() {} });
  screens.push(screen); document.body.append(screen.element); await screen.show();
  const secret = screen.element.querySelector<HTMLInputElement>('input[type=password]')!;
  secret.value = 'private'; secret.dispatchEvent(new Event('input', { bubbles: true }));
  expect(screen.element.querySelectorAll('a')).toHaveLength(1); expect(screen.element.querySelector('a')?.rel).toBe('noopener noreferrer');
  screen.element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
  await vi.waitFor(() => expect(noticeText()).toBe('登录失败'));
  expect(secret.value).toBe('');
});
