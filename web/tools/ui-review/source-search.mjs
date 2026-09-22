import { chromium } from 'playwright';
import { createReviewServer } from './server.mjs';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const server = createReviewServer({ port: 5301 });
const base = await server.listen();
const chrome = process.env.CHROME_PATH || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const descriptor = { id: 'aggregate', pluginId: 'fixture.generic', label: '多来源', capabilities: ['search', 'search.filters'] };
const errors = [{ source: '得奇小说网', code: 'HTTP_ERROR', message: '站点返回 HTTP 错误（404），请稍后重试或换源。' },
  { source: '艾途小说', code: 'ORIGIN_DENIED', message: '请求跳转到了未授权的域名，请在此书源的管理页面检查允许访问的域名。' }];
let mode = 'failed'; const requests = [];
try {
  const page = await browser.newPage(); const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname; let json;
    if (path.endsWith('/sources/types')) json = { types: [descriptor] };
    else if (path.endsWith('/sources')) json = { sources: [{ id: 'demo', name: '我的小说书源', enabled: true, descriptor, pluginId: descriptor.pluginId, sourceType: descriptor.id }] };
    else if (path.endsWith('/plugins')) json = { plugins: [] };
    else if (path.endsWith('/subscriptions')) json = { subscriptions: [] };
    else if (path.endsWith('/search-filters')) json = [
      { key: 'group', label: '分组', type: 'select', options: [{ value: '', label: '全部分组' }, { value: 'fiction', label: '小说' }] },
      { key: 'source', label: '书源', type: 'select', options: [{ value: '', label: '全部书源' }, { value: 'one', label: '示例书源' }] },
    ];
    else if (path.endsWith('/demo/search')) {
      requests.push(route.request().postDataJSON());
      const last = true;
      json = { title: '本批：艾途小说 / 得奇小说网 / 就爱文学', batch: { completed: last ? 6 : 3, total: 6 },
        items: mode === 'partial' ? [{ ref: 'book', title: '斗破苍穹', authors: ['天蚕土豆'], description: '【示例书源】这里是斗气的世界，没有花哨艳丽的魔法，有的仅仅是繁衍到巅峰的斗气。', options: [{ id: 'read', label: '加入书架' }] }] : [],
        ...(mode !== 'empty' ? { errors } : {}), ...(!last ? { nextCursor: 'batch2' } : {}) };
    }
    if (path.endsWith('/demo/search')) return route.fulfill({ contentType: 'text/event-stream', body: 'event: results\ndata: ' + JSON.stringify(json) + '\n\nevent: done\ndata: {}\n\n' });
    if (json !== undefined) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
    return route.continue();
  });
  await page.goto(base);
  await page.locator('input[autocomplete=username]').fill('review');
  await page.locator('input[type=password]').fill('password12');
  await page.locator('button[type=submit]').click(); await page.locator('.shelf-screen').waitFor();
  await page.goto(base + '/#/sources');
  await page.getByRole('combobox', { name: '选择来源' }).selectOption('demo');
  await page.getByRole('combobox', { name: '分组', exact: true }).selectOption('fiction');
  await page.locator('input[type=search]').fill('斗破苍穹');
  await mkdir('docs/ui-review', { recursive: true });
  for (const width of [390, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    mode = 'failed'; await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByText('暂未返回书籍，部分来源搜索失败', { exact: true }).waitFor();
    assert.equal(await page.locator('.catalog-errors').evaluate(el => el.open), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.sources-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `docs/ui-review/source-search-failed-${width}.png` });
    mode = 'partial'; await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.locator('.search-progress').filter({ hasText: '搜索完成' }).waitFor();
    assert.equal(await page.locator('.catalog-book').count(), 1, 'repeated entries merge by ref');
    assert.equal(requests.at(-1).query, '斗破苍穹');
    assert.equal(requests.at(-1).filters.group, 'fiction');
    assert.equal(await page.locator('.catalog-errors').evaluate(el => el.open), false);
    await page.locator('.catalog-errors summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.catalog-errors').evaluate(el => el.open), true);
    assert.equal(await page.locator('.sources-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `docs/ui-review/source-search-partial-${width}.png` });
  }
  mode = 'empty'; await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByText('没有找到匹配书籍', { exact: true }).waitFor();
  assert.equal(await page.locator('.catalog-errors').count(), 0);
  assert.deepEqual(failures, []);
  console.log('PASS Chromium: generic provider, failed/partial/empty states, keyboard details, cursor, 390/1024/1440/1920px without overflow');
} finally { await browser.close(); await server.close(); }
