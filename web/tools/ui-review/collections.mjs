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
    if (!empty && url.pathname === '/api/v1/library/browse') {
      const response = await route.fetch(), json = await response.json();
      const file = json.entries.find(entry => entry.type === 'file');
      if (file) file.name = 'DanXiaoShiManHuaYuZhou_胆小师漫画宇宙_第一卷_完整修订版.epub';
      return route.fulfill({ json });
    }
    if (url.pathname === '/api/v1/sources/types') return route.fulfill({ json: { types: [] } });
    if (url.pathname === '/api/v1/sources') return route.fulfill({ json: { sources: [] } });
    if (url.pathname === '/api/v1/plugins') return route.fulfill({ json: { plugins: [] } });
    if (url.pathname === '/api/v1/subscriptions') return route.fulfill({ json: { subscriptions: [] } });
    return route.continue();
  });
  const button = name => page.getByRole('button', { name, exact: true });
  async function shot(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' page overflow');
    if (await page.locator('.collection-links').count()) assert.equal(await page.locator('.collection-links').evaluate(el => el.scrollWidth > el.clientWidth), false, name + ' navigation overflow');
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
  assert.equal(await button('上传书籍').count(), 0);
  assert.equal(await page.locator('.library-header button[aria-label^=书架设置]').count(), 0);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await shot('library-empty-dark');
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  writable = false; await page.reload(); await page.getByText('前往文件管理添加书籍，再回到这里浏览。').waitFor();
  assert.equal(await button('上传书籍').count(), 0); assert.equal(await button('上传第一本书').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await shot('library-readonly');
  files = 3; await page.reload(); await page.getByText('这里有 3 个文件，可在文件管理中查看识别结果。').waitFor();
  await page.locator('.empty-actions').getByRole('button', { name: '文件管理', exact: true }).click();
  await page.locator('.library-files-screen').waitFor();
  await page.getByText('当前目录只读', { exact: true }).waitFor();
  assert.equal(await button('上传书籍').count(), 0);
  await button('返回').click(); await page.waitForURL('**/#/library');
  empty = false; await page.goto(base + '/#/shelf'); await page.locator('.book-grid .book-card').first().waitFor(); await shot('shelf-books');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.shelf-head button[aria-label^=书架设置]').click();
    const close = page.locator('.shelf-settings button[aria-label="关闭"]');
    await page.locator('.shelf-settings .panel-body').evaluate(el => { el.scrollTop = 0; });
    await shot('shelf-settings-' + width);
    assert.equal(await close.evaluate(el => { const r = el.getBoundingClientRect(), p = el.closest('.panel-header').getBoundingClientRect(); return p.right - r.right <= 20 && r.top >= p.top && r.bottom <= p.bottom; }), true);
    if (width >= 1280) {
      const desktopPanel = await page.locator('.shelf-settings').evaluate(el => {
        const r = el.getBoundingClientRect();
        return { rightGap: innerWidth - r.right, width: r.width, top: r.top, bottom: innerHeight - r.bottom };
      });
      assert.ok(desktopPanel.width >= 400 && desktopPanel.width <= 450, 'desktop settings should be a compact side panel');
      assert.ok(desktopPanel.rightGap <= 20 && desktopPanel.top >= 10 && desktopPanel.bottom >= 10, 'desktop settings should sit inside the viewport');
      assert.equal(await page.locator('.shelf-discovery').evaluate(el => getComputedStyle(el).display), 'flex');
    }
    await page.setViewportSize({ width, height: width >= 1024 ? 420 : 568 });
    const body = page.locator('.shelf-settings .panel-body');
    await body.evaluate(el => { el.scrollTop = 45; });
    await shot('shelf-settings-sticky-' + width);
    const sticky = await body.evaluate(el => {
      const first = el.querySelector('.section-title').getBoundingClientRect();
      const bounds = el.getBoundingClientRect();
      const header = el.previousElementSibling.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + 20, bounds.top + 2);
      return { gap: first.top - header.bottom, scrolled: el.scrollTop, covered: !!hit?.closest('.section-title') };
    });
    assert.ok(sticky.scrolled > 0, 'settings must actually scroll');
    assert.ok(Math.abs(sticky.gap) <= 1, 'sticky heading must touch the sheet header');
    assert.equal(sticky.covered, true, 'controls must not show through above the sticky heading');
    await close.click(); assert.equal(await page.locator('.shelf-settings').isVisible(), false);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '按书名排序', exact: true }).click();
  await button('书库').click(); await page.locator('.library-browse-grid .book-card').first().waitFor(); await shot('library-books');
  await page.goto(base + '/#/library/folder'); await page.locator('.library-path').waitFor(); await shot('library-folder');
  await page.getByRole('button', { name: '书库', exact: true }).click(); await page.waitForURL('**/#/library');
  await page.getByRole('searchbox').fill('不存在的关键词'); await page.getByRole('searchbox').press('Enter');
  await page.getByText('没有匹配的书', { exact: true }).waitFor(); await shot('library-no-results'); await button('清除搜索').last().click();
  await page.goto(base + '/#/library/files'); await page.getByRole('heading', { name: '文件管理', exact: true }).waitFor();
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('files-' + width); }
  const chooser = page.waitForEvent('filechooser'); await button('上传书籍').click(); await chooser;
  await page.goto(base + '/#/library/files/folder'); await page.reload(); await button('返回').click(); await page.waitForURL('**/#/library/files');
  await button('返回').click(); await page.waitForURL('**/#/library');
  // Real desktop sizes, including a narrow window and a full-HD monitor.
  for (const [width, height] of [[1024, 768], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + '/#/shelf'); await page.locator('.book-grid .book-card').first().waitFor();
    await shot('shelf-desktop-' + width);
    const trigger = page.locator('.shelf-head button[aria-label^=书架设置]');
    await trigger.click();
    await page.locator('.shelf-settings .panel-body').evaluate(el => { el.scrollTop = 0; });
    await shot('settings-desktop-' + width);
    if (width === 1366) {
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
      await shot('settings-desktop-dark');
      await page.evaluate(() => document.documentElement.dataset.theme = 'light');
      await page.setViewportSize({ width: 390, height: 844 });
      await shot('settings-resized-mobile');
      assert.equal(await page.locator('.shelf-settings').evaluate(el => {
        const r = el.getBoundingClientRect();
        return Math.abs(r.left) < 1 && Math.abs(r.right - innerWidth) < 1 && Math.abs(r.bottom - innerHeight) < 1;
      }), true, 'resizing an open desktop panel restores the mobile bottom sheet');
      await page.setViewportSize({ width, height });
    }
    await page.locator('.shelf-settings button[aria-label="关闭"]').press('Escape');
    assert.equal(await page.locator('.shelf-settings').isVisible(), false);
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true, 'closing settings restores keyboard focus');
    await page.goto(base + '/#/library'); await page.locator('.library-browse-grid .book-card').first().waitFor();
    await shot('library-desktop-' + width);
    await page.goto(base + '/#/library/files'); await page.locator('.manager-row').first().waitFor();
    assert.equal(await page.locator('.manager-row').first().evaluate(el => {
      const name = el.querySelector('.manager-name').getBoundingClientRect();
      const meta = el.querySelector('.manager-meta').getBoundingClientRect();
      return meta.left >= name.right && meta.top < name.bottom;
    }), true, 'desktop file metadata occupies a separate column');
    await shot('files-desktop-' + width);
  }
  // A member cannot reach file management even through a direct link.
  await page.route('**/api/v1/auth/me', async route => { const response = await route.fetch(); const json = await response.json(); json.user.role = 'member'; await route.fulfill({ json }); });
  await page.goto(base + '/#/library/files'); await page.reload(); await page.locator('.library-browse-screen').waitFor();
  assert.equal(await button('文件管理').count(), 0); assert.equal(await button('上传书籍').count(), 0);
  assert.equal(await page.locator('.manager-upload-input').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS collection UI: permissions, navigation, sticky settings, desktop sidebar and keyboard focus, file columns, dark theme, responsive resize; 320/390/1024/1280/1366/1920px');
} finally { await browser.close(); await server.close(); }
