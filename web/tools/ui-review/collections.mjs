import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createReviewServer } from './server.mjs';

const server = createReviewServer({ port: 0 });
await server.listen();
const base = 'http://127.0.0.1:' + server.server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  await mkdir('docs/ui-review', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let empty = true, writable = true, files = 0;
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if ((empty || url.searchParams.get('search') === '不存在的关键词') && url.pathname === '/api/v1/books') return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 60 } });
    if (empty && url.pathname === '/api/v1/library/browse') return route.fulfill({ json: {
      path: '', crumbs: [{ name: '书库', path: '' }], parent: null, entries: [], total: files, files, dirs: 0, size: 0, writable,
    } });
    if (url.pathname === '/api/v1/sources/types') return route.fulfill({ json: { types: [] } });
    if (url.pathname === '/api/v1/sources') return route.fulfill({ json: { sources: [] } });
    if (url.pathname === '/api/v1/plugins') return route.fulfill({ json: { plugins: [] } });
    if (url.pathname === '/api/v1/subscriptions') return route.fulfill({ json: { subscriptions: [] } });
    return route.continue();
  });
  const button = name => page.getByRole('button', { name, exact: true });
  async function shot(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' page overflow');
    assert.equal(await page.locator('.collection-links').evaluate(el => el.scrollWidth > el.clientWidth), false, name + ' navigation overflow');
    await page.screenshot({ path: 'docs/ui-review/collections-' + name + '.png', animations: 'disabled' });
  }
  await page.goto(base);
  await page.locator('input[autocomplete=username]').fill('review'); await page.locator('input[type=password]').fill('password12');
  await page.locator('button[type=submit]').click(); await page.getByText('书架还没有书', { exact: true }).waitFor();
  await button('刷新').click(); await page.getByText('书架还没有书', { exact: true }).waitFor();
  assert.equal(await page.getByRole('group', { name: '排序方式' }).count(), 0);
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('shelf-empty-' + width); }
  await button('去搜书').click(); await page.getByRole('tab', { name: '搜书', exact: true }).waitFor();
  await page.goto(base + '/#/shelf'); await button('打开书库').click();
  await page.getByText('书库还没有书', { exact: true }).waitFor();
  assert.equal(await page.getByText('0 本', { exact: true }).count(), 0);
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('library-empty-' + width); }
  const chooser = page.waitForEvent('filechooser'); await button('上传第一本书').click(); await chooser;
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await shot('library-empty-dark');
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  writable = false; await page.reload(); await page.getByText('管理员添加书籍后，就能在这里浏览并加入书架。').waitFor();
  assert.equal(await button('上传书籍').isVisible(), false); assert.equal(await button('上传第一本书').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await shot('library-readonly');
  files = 3; await page.reload(); await page.getByText('这里有 3 个文件，可在文件管理中查看识别结果。').waitFor();
  await page.locator('.empty-actions').getByRole('button', { name: '文件管理', exact: true }).click();
  await page.locator('.library-files-screen').waitFor();
  empty = false; await page.goto(base + '/#/shelf'); await page.locator('.book-grid .book-card').first().waitFor(); await shot('shelf-books');
  await page.getByRole('button', { name: '按书名排序', exact: true }).click();
  await button('书库').click(); await page.locator('.library-browse-grid .book-card').first().waitFor(); await shot('library-books');
  await page.goto(base + '/#/library/folder'); await page.locator('.library-path').waitFor(); await shot('library-folder');
  await page.getByRole('button', { name: '书库', exact: true }).click(); await page.waitForURL('**/#/library');
  await page.getByRole('searchbox').fill('不存在的关键词'); await page.getByRole('searchbox').press('Enter');
  await page.getByText('没有匹配的书', { exact: true }).waitFor(); await shot('library-no-results'); await button('清除搜索').last().click();
  assert.deepEqual(errors, []);
  console.log('PASS collection UI: empty/populated shelf and library, 320/390/1280px, dark mode, readonly, upload entry, source entry, folders, sort and search');
} finally { await browser.close(); await server.close(); }
