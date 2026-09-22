// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import type { SourcePage } from '../src/api/sources.ts';
import { SourcesScreen } from '../src/ui/sources-screen.tsx';
import { FakeTransport, makePlatform, bodyText } from './helpers/env.ts';
import { parseRoute, routeHash } from '../src/ui/router.ts';

const opds = { id: 'opds', pluginId: 'reader.opds', builtin: true, label: 'OPDS', version: '1', capabilities: ['browse', 'search'],
  credentialKeys: [{ key: 'password', label: 'OPDS 密码' }], configSchema: { required: ['url'], properties: { url: { type: 'string', title: 'OPDS 地址' } } } };
const source = { id: 'source-1', name: '远程书库', pluginId: 'reader.opds', sourceType: 'opds', enabled: true, descriptor: opds, config: { url: 'https://books.test' } };
const screens: SourcesScreen[] = [];
// jsdom has no top-layer dialog implementation; native focus containment is covered in Chromium.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector<HTMLElement>('[autofocus]')?.focus(); };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
async function chooseSource(root: HTMLElement) {
  const select = root.querySelector<HTMLSelectElement>('[aria-label="选择来源"]')!;
  select.value = 'source-1'; select.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect([...root.querySelectorAll('[role=status]')].map(el => el.textContent).join('')).not.toMatch(/正在处理|正在保存/));
}
afterEach(() => { screens.splice(0).forEach((screen) => screen.dispose()); document.body.replaceChildren(); });
async function setup(admin = true) {
  const transport = new FakeTransport();
  const api = new ReaderApi(makePlatform(transport), { async load() { return null; }, async save() {}, async clear() {} });
  const onOpen = vi.fn();
  const screen = new SourcesScreen({ api, admin, onOpen, onBack() {}, onSignedOut() {} });
  screens.push(screen); document.body.append(screen.element);
  transport.respondWith((request) => {
    let json: unknown = {};
    if (request.url.endsWith('/sources/types')) json = { types: [opds] };
    else if (request.url.endsWith('/sources')) json = { sources: [source], source };
    else if (request.url.endsWith('/plugins')) json = { plugins: [{ pluginId: 'remote', name: '远程插件', enabled: true, builtin: false }] };
    else if (request.url.endsWith('/subscriptions')) json = { subscriptions: [{ bookId: 'book1', title: '追更小说', enabled: false, intervalMinutes: 60, newChapters: 2, lastSuccessAt: 1000, nextCheckAt: 0 }] };
    else if (request.url.includes('/browse?') || request.url.endsWith('/search')) json = { items: [{ ref: 'book-ref', title: '来源小说', options: [{ id: 'epub', label: '下载 EPUB' }] }] };
    else if (request.url.endsWith('/acquire')) json = { kind: 'ready', publicationId: 'book1' };
    else if (request.url.endsWith('/books/book1')) json = { book: { id: 'book1', title: '来源小说' } };
    if (request.url.endsWith('/search')) return { status: 200, headers: {}, stream: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: results\ndata: ' + JSON.stringify(json) + '\n\nevent: done\ndata: {}\n\n')); controller.close();
    } }) };
    return { status: 200, headers: {}, json };
  });
  await screen.show();
  return { api, screen, transport, onOpen };
}

async function* pages(...values: Array<SourcePage | Promise<SourcePage>>): AsyncGenerator<SourcePage> { for (const value of values) yield await value; }

it('separates partial failures, preserves single-source pagination and clears old results on a new search', async () => {
  const { screen, api } = await setup(); await chooseSource(screen.element);
  const search = vi.spyOn(api, 'searchSource');
  const errors = [{ source: '测试来源', code: 'HTTP_ERROR', message: '站点返回 HTTP 503' }];
  search.mockImplementationOnce(() => pages({ items: [{ ref: 'ok', title: '成功结果' }], errors }));
  input(screen.element, '搜索书籍', '小说'); await click(screen.element, '搜索');
  expect(screen.element.querySelector('details')?.open).toBe(false);
  expect(screen.element.textContent).toContain('成功结果');
  search.mockImplementationOnce(() => pages({ items: [], errors, nextCursor: 'more' }));
  await click(screen.element, '搜索');
  expect(screen.element.querySelector('details')?.open).toBe(true);
  expect(screen.element.textContent).toContain('部分来源搜索失败');
  search.mockImplementationOnce(() => pages({ items: [] })); await click(screen.element, '加载更多结果');
  expect(search.mock.calls.at(-1)?.[1]).toMatchObject({ query: '小说', cursor: 'more', filters: {} });
  expect(screen.element.querySelector('details')).not.toBeNull();
  search.mockImplementationOnce(() => pages({ items: [] }));
  input(screen.element, '搜索书籍', '新关键词'); await click(screen.element, '搜索');
  expect(screen.element.querySelector('details')).toBeNull();
  expect(screen.element.textContent).toContain('没有找到匹配书籍');
});

it('merges events from one stream, aborts on stop, ignores late data and resumes the last received cursor', async () => {
  const { screen, api } = await setup(); await chooseSource(screen.element);
  const cancel = vi.spyOn(api, 'cancelSourceSearch').mockResolvedValue();
  let resolve!: (page: SourcePage) => void;
  const first = { ref: 'first', title: '第一批结果' };
  const search = vi.spyOn(api, 'searchSource').mockImplementationOnce(() => pages(
    { items: [first, first], batch: { completed: 3, total: 7 }, nextCursor: 'second' },
    new Promise<SourcePage>(done => { resolve = done; })));
  input(screen.element, '搜索书籍', '斗罗'); button(screen.element, '搜索').click();
  await vi.waitFor(() => expect(screen.element.querySelectorAll('.catalog-book')).toHaveLength(1));
  expect(search).toHaveBeenCalledTimes(1);
  const signal = search.mock.calls[0]![2]!.signal!;
  await click(screen.element, '停止搜索'); expect(signal.aborted).toBe(true); expect(cancel).toHaveBeenCalledTimes(1);
  resolve({ items: [{ ref: 'late', title: '迟到结果' }] }); await new Promise(done => setTimeout(done, 10));
  expect(screen.element.textContent).not.toContain('迟到结果');
  search.mockImplementationOnce(() => pages(
    { items: [first, { ref: 'second', title: '第二批结果' }], batch: { completed: 6, total: 7 }, nextCursor: 'third' },
    { items: [{ ref: 'third', title: '第三批结果' }], batch: { completed: 7, total: 7 } }));
  await click(screen.element, '继续搜索');
  expect(search).toHaveBeenCalledTimes(2); expect(search.mock.calls[1]![1].cursor).toBe('second');
  expect(screen.element.querySelectorAll('.catalog-book')).toHaveLength(3);
  expect(screen.element.textContent).toContain('搜索完成');
});

it('keeps earlier results when a stream fails and resumes after the last event', async () => {
  const { screen, api } = await setup(); await chooseSource(screen.element);
  const search = vi.spyOn(api, 'searchSource').mockImplementationOnce(async function* () {
    yield { items: [{ ref: 'one', title: '保留结果' }], batch: { completed: 1, total: 2 }, nextCursor: 'resume' };
    throw new Error('连接中断');
  });
  input(screen.element, '搜索书籍', '查询'); await click(screen.element, '搜索');
  expect(screen.element.textContent).toContain('搜索中断'); expect(screen.element.textContent).toContain('保留结果');
  search.mockImplementationOnce(() => pages({ items: [{ ref: 'two', title: '恢复结果' }], batch: { completed: 2, total: 2 } }));
  await click(screen.element, '继续搜索'); expect(search.mock.calls[1]![1].cursor).toBe('resume');
  expect(screen.element.querySelectorAll('.catalog-book')).toHaveLength(2);
});
function button(root: HTMLElement, label: string) {
  const found = [...root.querySelectorAll('button')].find((element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label);
  expect(found, label).toBeDefined(); return found!;
}
async function click(root: HTMLElement, label: string) {
  button(root, label).click();
  await vi.waitFor(() => expect([...root.querySelectorAll('[role=status]')].map(el => el.textContent).join('')).not.toMatch(/正在处理|正在保存|正在搜索/));
}
function input(root: HTMLElement, label: string, value: string) {
  const element = [...root.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label))?.querySelector('input');
  expect(element, label).toBeDefined(); element!.value = value; element!.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('sources and subscriptions UI', () => {
  it('renders declared numeric defaults and bounds and saves the configured value', async () => {
    const { screen, api } = await setup();
    const descriptor = { ...opds, configSchema: { properties: { parallel: { type: 'integer', title: '并发数量', default: 3, minimum: 1, maximum: 10 }, crossOrigin: { type: 'boolean', title: '允许跨域', default: false } } } };
    vi.spyOn(api, 'sourceTypes').mockResolvedValue([descriptor]);
    const save = vi.spyOn(api, 'saveSource').mockResolvedValue(source);
    await screen.show(); await click(screen.element, '书源管理'); await click(screen.element, '添加来源');
    input(screen.element, '名称', '并发测试');
    const checkbox = screen.element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(checkbox.checked).toBe(false); checkbox.click(); expect(checkbox.checked).toBe(true);
    const field = screen.element.querySelector<HTMLInputElement>('input[type=number]')!;
    expect(field.value).toBe('3'); expect(field.min).toBe('1'); expect(field.max).toBe('10'); expect(field.step).toBe('1');
    input(screen.element, '并发数量', '11'); expect(field.validity.rangeOverflow).toBe(true);
    input(screen.element, '并发数量', '1.5'); expect(field.validity.stepMismatch).toBe(true);
    input(screen.element, '并发数量', '4'); await click(screen.element, '保存来源');
    expect(save).toHaveBeenCalledWith(null, expect.objectContaining({ config: { parallel: 4, crossOrigin: true } }));
  });

  it('provides a stable route and separates member browsing from admin configuration', async () => {
    expect(parseRoute('#/sources')).toEqual({ name: 'sources' }); expect(routeHash({ name: 'sources' })).toBe('#/sources');
    const { screen, transport } = await setup(false);
    expect(screen.element.textContent).not.toContain('插件管理'); expect(screen.element.textContent).not.toContain('添加来源');
    expect(transport.requests.some((request) => request.url.endsWith('/plugins'))).toBe(false);
    await chooseSource(screen.element); expect(screen.element.textContent).toContain('来源小说');
    await click(screen.element, '登录凭据'); input(screen.element, 'OPDS 密码', 'private'); await click(screen.element, '保存个人凭据');
    expect(bodyText(transport.requests.find((request) => request.url.endsWith('/credentials/password')))).toBe('{"value":"private"}');
    expect(screen.element.querySelector('dialog')).toBeNull();
    await click(screen.element, '登录凭据'); expect(screen.element.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
  });
  it('creates OPDS configuration, acquires books and enables automatic updates', async () => {
    const { screen, transport, onOpen } = await setup();
    await click(screen.element, '书源管理'); await click(screen.element, '添加来源'); input(screen.element, '名称', '家庭书库'); input(screen.element, 'OPDS 地址', 'https://home.test/opds');
    await click(screen.element, '保存来源');
    expect(JSON.parse(bodyText(transport.requests.find((request) => request.url.endsWith('/sources') && request.method === 'POST')))).toMatchObject({
      name: '家庭书库', pluginId: 'reader.opds', config: { url: 'https://home.test/opds' },
    });
    await click(screen.element, '搜书'); await chooseSource(screen.element); await click(screen.element, '下载 EPUB');
    expect(JSON.parse(bodyText(transport.requests.find((request) => request.url.endsWith('/acquire'))))).toEqual({ entryRef: 'book-ref', optionId: 'epub' });
    await click(screen.element, '阅读《来源小说》'); expect(onOpen).toHaveBeenCalledWith({ id: 'book1', title: '来源小说' });
    await click(screen.element, '自动追更'); await click(screen.element, '开启追更');
    expect(JSON.parse(bodyText(transport.requests.find((request) => request.url.endsWith('/subscription'))))).toEqual({ enabled: true });
  });
  it('requires the explicit trust control before installing and offers plugin lifecycle actions', async () => {
    const { screen, transport } = await setup();
    await click(screen.element, '插件管理'); expect(button(screen.element, '安装插件').disabled).toBe(true);
    input(screen.element, '已部署的插件目录或 npm 包', 'npm:external-source');
    const trusted = screen.element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    trusted.checked = true; trusted.dispatchEvent(new Event('change', { bubbles: true }));
    await click(screen.element, '安装插件');
    expect(JSON.parse(bodyText(transport.requests.find((request) => request.url.endsWith('/plugins') && request.method === 'POST')))).toEqual({ folder: 'npm:external-source', trusted: true });
    await click(screen.element, '停用'); expect(transport.requests.some((request) => request.url.endsWith('/plugins/remote') && request.method === 'PATCH')).toBe(true);
  });
});

it('uses keyboard tabs and reveals source settings only through management', async () => {
  const { screen, transport } = await setup();
  const tabs = [...screen.element.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  expect(tabs).toHaveLength(4); expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  expect(screen.element.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
  expect(screen.element.textContent).not.toContain('基本设置');
  await click(screen.element, '书源管理');
  await click(screen.element, '管理'); expect(screen.element.textContent).toContain('基本设置');
  expect(screen.element.querySelector('.source-manage-trigger')?.getAttribute('aria-expanded')).toBe('true');
  screen.element.querySelector('.source-management')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(screen.element.querySelector('.source-management')).toBeNull();
  expect(document.activeElement?.textContent).toBe('管理');
  await click(screen.element, '管理'); await click(screen.element, '暂停');
  expect(JSON.parse(bodyText(transport.requests.find(request => request.url.endsWith('/sources/source-1') && request.method === 'PATCH')))).toEqual({ enabled: false });
  expect(screen.element.querySelector('.source-management')).toBeNull();
  tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.activeElement?.textContent).toBe('书源管理');
  expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
  tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(tabs[3]!.getAttribute('aria-selected')).toBe('true');
  expect(screen.element.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby')).toBe(tabs[3]!.id);
});

it('keeps failed configuration inside the modal and restores focus after cancel or save', async () => {
  const { screen, api } = await setup();
  await click(screen.element, '书源管理');
  button(screen.element, '添加来源').focus(); await click(screen.element, '添加来源');
  expect(screen.element.querySelector('main .source-editor')).toBeNull();
  expect(screen.element.querySelector('dialog')?.open).toBe(true);
  input(screen.element, '名称', '草稿名称'); input(screen.element, 'OPDS 地址', 'https://draft.test');
  const save = vi.spyOn(api, 'saveSource').mockRejectedValueOnce(new Error('测试保存失败'));
  await click(screen.element, '保存来源');
  expect(screen.element.querySelector('dialog [role=alert]')?.textContent).toBe('测试保存失败');
  expect(document.activeElement?.getAttribute('role')).toBe('alert');
  expect(screen.element.querySelector<HTMLInputElement>('input[maxlength]')!.value).toBe('草稿名称');
  await click(screen.element, '取消');
  expect(screen.element.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button(screen.element, '添加来源'));
  await click(screen.element, '添加来源');
  expect(screen.element.querySelector<HTMLInputElement>('input[maxlength]')!.value).toBe('');
  input(screen.element, '名称', '保存名称'); input(screen.element, 'OPDS 地址', 'https://saved.test');
  save.mockRestore(); await click(screen.element, '保存来源');
  expect(screen.element.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button(screen.element, '添加来源'));
});

it('separates browsing from management and removes paused sources from the picker', async () => {
  const { screen, api } = await setup();
  await chooseSource(screen.element);
  input(screen.element, '搜索书籍', '保留的关键词'); await click(screen.element, '搜索');
  await click(screen.element, '书源管理');
  expect(screen.element.querySelector('.source-catalog')).toBeNull();
  expect(screen.element.querySelector('.sources-search')).toBeNull();
  await click(screen.element, '搜书');
  expect(screen.element.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('保留的关键词');
  expect(screen.element.textContent).toContain('来源小说');
  expect(screen.element.querySelector('.sources-list')).toBeNull();
  await click(screen.element, '书源管理'); await click(screen.element, '管理');
  vi.spyOn(api, 'sources').mockResolvedValue([{ ...source, descriptor: { ...opds, capabilities: ['browse', 'search'] }, enabled: false }]);
  await click(screen.element, '暂停'); await click(screen.element, '搜书');
  expect(screen.element.querySelector('.source-catalog')).toBeNull();
  expect(screen.element.querySelector('[aria-label="选择来源"]')!.children).toHaveLength(1);
});

it('prevents closing while saving and preserves the form on failure', async () => {
  const { screen, api } = await setup();
  await click(screen.element, '书源管理'); await click(screen.element, '添加来源');
  input(screen.element, '名称', '正在保存'); input(screen.element, 'OPDS 地址', 'https://test');
  let fail!: (error: Error) => void;
  vi.spyOn(api, 'saveSource').mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  button(screen.element, '保存来源').click();
  const dialog = screen.element.querySelector('dialog')!;
  expect(button(screen.element, '关闭弹窗').disabled).toBe(true);
  const cancel = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true); expect(dialog.open).toBe(true);
  fail(new Error('请稍后重试'));
  await vi.waitFor(() => expect(dialog.querySelector('[role=alert]')?.textContent).toBe('请稍后重试'));
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(screen.element.querySelector('dialog')).toBeNull();
});

async function sessionSetup() {
  const value = await setup();
  const descriptor = { ...opds, capabilities: ['search', 'search.cancel', 'search.session'] };
  vi.spyOn(value.api, 'sourceTypes').mockResolvedValue([descriptor]);
  vi.spyOn(value.api, 'sources').mockResolvedValue([{ ...source, descriptor }]);
  await value.screen.show(); await chooseSource(value.screen.element);
  return value;
}

it('consumes heartbeats and buffered results through one HTTP stream', async () => {
  const { screen, api } = await sessionSetup();
  const search = vi.spyOn(api, 'searchSource').mockImplementationOnce(() => pages(
    { items: [], batch: { completed: 0, total: 2 }, nextCursor: 'heartbeat' },
    { items: [], batch: { completed: 0, total: 2 }, nextCursor: 'second' },
    { items: [{ ref: 'one', title: '结果一' }], batch: { completed: 2, total: 2 }, nextCursor: 'buffered' },
    { items: [{ ref: 'two', title: '结果二' }], batch: { completed: 2, total: 2 } }));
  input(screen.element, '搜索书籍', '查询'); await click(screen.element, '搜索');
  expect(search).toHaveBeenCalledTimes(1); expect(search.mock.calls[0]![1].resultLimit).toBe(10000);
  expect(screen.element.querySelectorAll('.catalog-book')).toHaveLength(2);
  expect(screen.element.textContent).toContain('搜索完成');
});

it('stops before the first event and waits for cancellation before resuming', async () => {
  const { screen, api } = await sessionSetup(); let stopped!: () => void;
  const cancel = vi.spyOn(api, 'cancelSourceSearch').mockImplementationOnce(() => new Promise<void>(resolve => { stopped = resolve; }));
  const search = vi.spyOn(api, 'searchSource').mockImplementationOnce(() => pages(new Promise(() => {})))
    .mockImplementationOnce(() => pages({ items: [{ ref: 'resumed', title: '恢复结果' }], batch: { completed: 2, total: 2 } }));
  input(screen.element, '搜索书籍', '查询'); button(screen.element, '搜索').click();
  await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  const id = search.mock.calls[0]![1].sessionId;
  await click(screen.element, '停止搜索'); expect(cancel).toHaveBeenCalledWith('source-1', id);
  button(screen.element, '继续搜索').click(); await new Promise(resolve => setTimeout(resolve, 10)); expect(search).toHaveBeenCalledTimes(1);
  stopped(); await vi.waitFor(() => expect(screen.element.textContent).toContain('搜索完成'));
  expect(search.mock.calls[1]![1].sessionId).toBe(id);
});

it('drains limited result events then cancels and hides continue', async () => {
  const { screen, api } = await sessionSetup();
  const cancel = vi.spyOn(api, 'cancelSourceSearch').mockResolvedValue();
  const search = vi.spyOn(api, 'searchSource').mockImplementationOnce(() => pages(
    { items: [{ ref: 'one', title: '结果一' }], batch: { completed: 1, total: 8 }, limitReached: true, nextCursor: 'buffer' },
    { items: [{ ref: 'two', title: '结果二' }], batch: { completed: 1, total: 8 }, limitReached: true }));
  input(screen.element, '搜索书籍', '查询'); await click(screen.element, '搜索');
  expect(search).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.element.querySelectorAll('.catalog-book')).toHaveLength(2);
  expect(screen.element.textContent).toContain('已达到结果上限'); expect(screen.element.querySelector('.catalog-pagination')).toBeNull();
});
