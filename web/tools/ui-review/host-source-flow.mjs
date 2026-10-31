// Run from server: node --import tsx ../web/tools/ui-review/host-source-flow.mjs
// Real HTTP server, SQLite, stdio plugin and production Web; uses a self-contained example source.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openDatabase } from '../../../server/src/db/index.ts';
import { buildApp } from '../../../server/src/http/app.ts';
import { Scanner } from '../../../server/src/indexer/scanner.ts';
import { UserService } from '../../../server/src/services/users.ts';
import { ShelfService } from '../../../server/src/services/shelf.ts';
import { SyncService } from '../../../server/src/services/sync.ts';
import { TtsService } from '../../../server/src/services/tts.ts';
import { BrowseService } from '../../../server/src/services/browse.ts';
import { UploadService } from '../../../server/src/services/uploads.ts';
import { pluginArchive } from '../../../server/test/helpers/plugin-package.ts';

const repo = resolve(import.meta.dirname, '../../..');
const root = await mkdtemp(join(tmpdir(), 'reader-ui-e2e-'));
const shots = process.env.UI_REVIEW_DIR ? resolve(process.env.UI_REVIEW_DIR) : join(repo, 'artifacts/ui-review/sources');
const config = { booksDir: join(root, 'books'), dataDir: join(root, 'data'), host: '127.0.0.1', port: 0,
  jwtSecret: 'isolated-end-to-end-fixture-secret', accessTokenTtl: 86400, refreshTokenTtl: 86400,
  scanInterval: 0, watchInterval: 0, logLevel: 'silent', publicUrl: '', corsOrigins: [], webDir: join(repo, 'web/dist') };
let app, db, browser, page, registry;
const previousRegistry = process.env.npm_config_registry;
const button = name => page.getByRole('button', { name, exact: true });
// Toasts outlive navigation; a step that measures one starts with none on screen.
const dismissNotices = async () => { while (await button('关闭提示').count()) { await button('关闭提示').first().click(); await page.waitForTimeout(400); } };
const tab = name => page.getByRole('tab', { name, exact: true });
// The tab is in the URL (?tab=), so selection lands a render after focus moves: wait for it.
const selectedTab = name => page.locator('[role=tab][aria-selected="true"]').filter({ hasText: name }).waitFor();
async function idle() { await page.waitForFunction(() => !document.querySelector('[role=status]')?.textContent?.includes('正在处理')); }
async function shot(name) {
  await idle();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' overflows');
  await page.screenshot({ path: join(shots, 'sources-e2e-' + name + '.png'), animations: 'disabled' });
}
// 添加来源 opens the editor page (/sources/manage/new); saving returns to the hub.
async function addSource(name) {
  await page.getByRole('link', { name: '添加来源', exact: true }).click();
  await page.locator('select:has(option[value="reader.source.demo/demo-chapters"])').selectOption('reader.source.demo/demo-chapters');
  await page.getByLabel('名称', { exact: true }).fill(name); await button('保存').click();
  await page.waitForURL(/#\/sources$/); await tab('书源管理').click();
  await page.locator('.sources-row').getByText(name, { exact: true }).waitFor(); await idle();
  assert.equal(await page.getByRole('dialog').count(), 0);
}
try {
  await Promise.all([mkdir(config.booksDir), mkdir(config.dataDir), mkdir(shots, { recursive: true })]);
  const cli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'pack', '--ignore-scripts', '--json', '--pack-destination', root],
    { cwd: join(repo, 'examples/plugins/demo-chapters'), windowsHide: true });
  const archive = join(root, JSON.parse(stdout)[0].filename);
  let registryUrl = '';
  registry = createServer((request, response) => {
    if (request.url === '/example.tgz') { response.end(pluginArchive('reader-source-example', 'test.registry')); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ name: 'reader-source-example', 'dist-tags': { latest: '1.0.0' }, versions: {
      '1.0.0': { name: 'reader-source-example', version: '1.0.0', dist: { tarball: registryUrl + '/example.tgz' } },
    } }));
  });
  await new Promise(resolve => registry.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${registry.address().port}`;
  process.env.npm_config_registry = registryUrl;
  db = openDatabase(config); const ctx = { config, db }; app = buildApp(ctx); ctx.log = app.log;
  ctx.scanner = new Scanner(db, config, { info() {}, warn() {} }); ctx.users = new UserService(db, config);
  ctx.shelf = new ShelfService(db); ctx.sync = new SyncService(db, ctx.shelf); ctx.tts = new TtsService(config);
  ctx.browse = new BrowseService(db, config, ctx.shelf); ctx.uploads = new UploadService(db, config, ctx.browse, ctx.scanner);
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByText('这是一个全新的实例，第一个注册的账号会成为管理员。', { exact: true }).waitFor();
  if (!await button('注册并登录').isVisible()) await button('注册新账号').click();
  await page.locator('input[autocomplete=username]').fill('e2e-admin'); await page.locator('input[type=password]').fill('password123');
  await button('注册并登录').click(); await page.locator('.app-shell').waitFor();
  await page.goto(base + '/#/sources'); await tab('插件管理').click();
  // Installing is one sheet: npm 包 or 本地文件, a trust switch, then 安装并启用.
  const installSheet = page.getByRole('dialog', { name: '安装插件' });
  const openInstall = async mode => {
    await button('安装插件').click(); await installSheet.waitFor();
    await installSheet.getByRole('button', { name: mode, exact: true }).click();
  };
  const trust = () => installSheet.locator('.switch-field').filter({ hasText: '我信任这个插件' }).locator('button').click();
  await openInstall('npm 包');
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('plugin-install-' + width); }
  await installSheet.getByRole('button', { name: '本地文件', exact: true }).click();
  for (const width of [320, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('plugin-upload-' + width); }
  await installSheet.locator('input[type=file]').setInputFiles(archive);
  assert.equal(await button('安装并启用').isDisabled(), true, 'installing waits for the trust switch');
  await trust();
  await button('安装并启用').click(); await installSheet.waitFor({ state: 'detached' });
  await page.getByText('Demo chapter source', { exact: true }).waitFor();
  await page.locator('.global-notice').filter({ hasText: '已安装' }).first().waitFor();
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator('.global-notice').first().evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right, position: getComputedStyle(node.closest('.notyf')).position };
    });
    assert.equal(bounds.position, 'fixed');
    assert.ok(bounds.width <= 448 && bounds.left >= 16 && bounds.right <= width - 16);
    await shot('plugin-feedback-' + width);
  }
  const beforeDismiss = await page.locator('.sources-body').boundingBox();
  await dismissNotices();
  assert.deepEqual(await page.locator('.sources-body').boundingBox(), beforeDismiss, 'dismissing feedback does not move the page');
  await openInstall('npm 包');
  await installSheet.locator('input[type=text]').fill('reader-source-example@latest');
  await trust();
  await button('安装并启用').click(); await installSheet.waitFor({ state: 'detached' });
  await page.getByText('Upload example', { exact: true }).waitFor();
  // Upload another version of the same plugin; no uninstall or source deletion.
  await openInstall('本地文件');
  await installSheet.locator('input[type=file]').setInputFiles({ name: 'example-1.1.0.tgz', mimeType: 'application/gzip',
    buffer: pluginArchive('reader-source-example', 'test.registry', true, '1.1.0') });
  await trust();
  await button('安装并启用').click(); await installSheet.waitFor({ state: 'detached' });
  const example = page.locator('.sources-row').filter({ hasText: 'Upload example' });
  await example.filter({ hasText: 'v1.1.0' }).waitFor();
  assert.equal(await example.count(), 1);
  await shot('plugins-enabled-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await tab('书源管理').click(); await addSource('示例章节源'); await addSource('第二个章节源');
  await page.reload(); await tab('书源管理').click(); await page.locator('.sources-row').getByText('示例章节源', { exact: true }).waitFor();
  await tab('书源管理').focus(); await page.keyboard.press('ArrowRight');
  await selectedTab('自动追更');
  await shot('hub-updates-mobile');
  await page.keyboard.press('End');
  await selectedTab('插件管理');
  await shot('hub-plugins-mobile');
  await page.keyboard.press('Home');
  await selectedTab('搜书');
  assert.equal(await page.getByRole('link', { name: '添加来源', exact: true }).count(), 0);
  await shot('search-empty-mobile');
  await tab('书源管理').click();
  const row = page.locator('.sources-row').filter({hasText:'示例章节源'});
  await row.getByRole('button',{name:'管理',exact:true}).click();
  await page.getByRole('menuitem', { name: '设为默认', exact: true }).click(); await idle();
  await row.locator('.source-default-badge').waitFor();
  await shot('hub-management-mobile');
  for (const width of [320,390,1280]) { await page.setViewportSize({width,height:844}); await shot('hub-'+width); }
  await page.reload(); await tab('搜书').click();
  await page.waitForFunction(() => document.querySelector('[aria-label="选择来源"]')?.selectedOptions[0]?.textContent === '示例章节源（默认）');
  await page.getByLabel('搜索书籍', { exact: true }).waitFor();
  const searchAlignment = await button('搜索').evaluate(node => {
    const icon = node.querySelector('.icon').getBoundingClientRect();
    const text = document.createRange(); text.selectNodeContents(node.lastChild); const rect = text.getBoundingClientRect();
    return Math.abs((icon.top + icon.bottom) / 2 - (rect.top + rect.bottom) / 2);
  });
  assert.ok(searchAlignment < 3, 'search icon and text align vertically');
  await page.getByLabel('搜索书籍', { exact: true }).fill('示例'); await button('搜索').click();
  await page.getByText('插件示例书',{exact:true}).waitFor();
  await shot('search-desktop');
  await button('1 条书源').click();
  const sourceList = page.getByRole('dialog', { name: '书源列表', exact: true });
  await sourceList.getByRole('button', { name: '加入书架', exact: true }).click();
  // Acquiring puts 阅读《…》 on the result page itself; the sheet is closed to reach it.
  const readAcquired = page.locator('.sources-body').getByRole('button', { name: '阅读《插件示例书》', exact: true });
  await readAcquired.waitFor();
  await sourceList.getByRole('button', { name: '关闭', exact: true }).click(); await sourceList.waitFor({ state: 'detached' });
  await readAcquired.click();
  await page.locator('book-content').getByText('这是通过独立 Node 进程提供的示例章节。',{exact:false}).waitFor();
  await page.setViewportSize({width:390,height:844}); await shot('reader-mobile');

  // Deterministic extension responses exercise the shared page renderer's
  // busy/error/success feedback without depending on a third-party service.
  let releaseAction, failAction = true;
  const extensionPage = { title: '扩展配置', activeTab: 'browser', forms: [], tabs: [{ id: 'settings', title: '来源设置', forms: [
    { id: 'save', title: '来源设置', submit: '保存配置', fields: [{ key: 'name', label: '配置名称', type: 'text', value: '示例' }] },
  ], sections: [{ title: '配置项目', items: Array.from({ length: 12 }, (_, index) => ({ title: '项目 ' + index, description: '用于验证操作反馈不会移动内容。' })) }] },
    ...['订阅管理', '导入配置', '来源调试', '浏览器'].map((title, index) => ({ id: index === 3 ? 'browser' : 'tab-' + index, title, forms: [], description: title + '的配置内容' })),
  ] };
  await page.route('**/api/v1/sources/feedback-fixture/pages/settings', async route => {
    if (route.request().method() === 'POST') {
      await new Promise(resolve => { releaseAction = resolve; });
      if (failAction) return route.fulfill({ status: 502, json: { error: { code: 'PLUGIN_UNAVAILABLE', message: '插件暂时不可用，请重启后重试。' } } });
      return route.fulfill({ json: { ...extensionPage, notice: '配置已保存' } });
    }
    return route.fulfill({ json: extensionPage });
  });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/#/sources/feedback-fixture/settings');
    await tab('浏览器').waitFor(); await idle();
    const assertActiveVisible = async () => {
      const bounds = await page.locator('.extension-tabs').evaluate(list => {
        const selected = list.querySelector('[aria-selected=true]').getBoundingClientRect();
        const viewport = list.getBoundingClientRect();
        return { left: selected.left, right: selected.right, start: viewport.left, end: viewport.right };
      });
      assert.ok(bounds.left >= bounds.start - 1 && bounds.right <= bounds.end + 1, 'selected tab is visible');
      assert.equal(await page.evaluate(() => window.scrollY), 0);
    };
    await assertActiveVisible();
    await tab('浏览器').focus(); await page.keyboard.press('Home');
    await selectedTab('来源设置');
    await assertActiveVisible();
    await shot('extension-tabs-first-' + width);
    await page.keyboard.press('End');
    await selectedTab('浏览器');
    await assertActiveVisible();
    const layout = await page.locator('.extension-tabs').evaluate(list => ({
      overflow: list.scrollWidth > list.clientWidth,
      heights: [...list.children].map(item => item.getBoundingClientRect().height),
    }));
    assert.equal(layout.overflow, width < 600);
    assert.ok(layout.heights.every(height => height >= 44 && height < 60), 'tabs stay single-line with touch-sized targets');
    await shot('extension-tabs-last-' + width);
  }
  delete extensionPage.activeTab;
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/#/sources/feedback-fixture/settings');
    await tab('来源设置').click();
    await button('保存配置').waitFor(); await idle(); await dismissNotices();
    const bodyBounds = await page.locator('.sources-body').boundingBox();
    const toolbarBounds = await page.locator('.extension-toolbar').boundingBox();
    for (const failed of [true, false]) {
      failAction = failed;
      await button('保存配置').click();
      await page.locator('.global-notice').getByText('正在处理…', { exact: true }).waitFor();
      assert.deepEqual(await page.locator('.sources-body').boundingBox(), bodyBounds);
      assert.deepEqual(await page.locator('.extension-toolbar').boundingBox(), toolbarBounds);
      await page.locator('.sources-body').evaluate(node => { node.scrollTop = 180; });
      const scrollTop = await page.locator('.sources-body').evaluate(node => node.scrollTop);
      releaseAction();
      await page.locator(failed ? '.global-notice [role=alert]' : '.global-notice [role=status]').getByText(failed ? '插件暂时不可用，请重启后重试。' : '配置已保存', { exact: true }).waitFor();
      assert.equal(await page.locator('.sources-body').evaluate(node => node.scrollTop), scrollTop);
      assert.deepEqual(await page.locator('.sources-body').boundingBox(), bodyBounds);
      assert.deepEqual(await page.locator('.extension-toolbar').boundingBox(), toolbarBounds);
      const notice = await page.locator('.global-notice').evaluate(node => ({ width: node.getBoundingClientRect().width, position: getComputedStyle(node.closest('.notyf')).position }));
      assert.equal(notice.position, 'fixed'); assert.ok(notice.width <= Math.min(448, width - 32));
      await shot('extension-feedback-' + (failed ? 'error-' : 'success-') + width);
      await button('关闭提示').click(); await page.locator('.global-notice').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.locator('.sources-body').boundingBox(), bodyBounds);
      assert.equal(await page.locator('.sources-body').evaluate(node => node.scrollTop), scrollTop);
    }
  }
  // A failed save on the editor page keeps the draft and says why, in place.
  await page.goto(base + '/#/sources/manage/new');
  await page.locator('select:has(option[value="reader.source.demo/demo-chapters"])').selectOption('reader.source.demo/demo-chapters');
  await page.getByLabel('名称', { exact: true }).fill('保留的草稿');
  await page.route('**/api/v1/sources', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 502, json: { error: { code: 'SAVE_FAILED', message: '保存失败，请稍后重试。' } } })
    : route.continue());
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await button('保存').click();
    await page.locator('.sources-card').getByText('保存失败，请稍后重试。', { exact: true }).waitFor();
    assert.match(new URL(page.url()).hash, /^#\/sources\/manage\/new/);
    assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), '保留的草稿');
    await shot('source-editor-error-' + width);
  }
  await button('取消').click(); await page.waitForURL(/#\/sources$/);
  assert.deepEqual(errors, []);
  console.log('PASS real HTTP + SQLite + stdio plugin + production Web: registration, tgz upload, npm registry install, auto-enable, independent instances, tabs, layout, streamed search, acquisition and chapter reading');
  console.log('PASS extension feedback fixtures: mobile/desktop floating busy/error/success, bounded width and stable content position');
} catch (error) {
  if (page) { await page.screenshot({ path: join(shots, 'sources-e2e-failure.png') }); console.error((await page.locator('body').innerText()).slice(-4500)); }
  throw error;
} finally {
  await browser?.close(); await app?.close(); db?.close();
  if (registry) await new Promise(resolve => registry.close(resolve));
  if (previousRegistry === undefined) delete process.env.npm_config_registry; else process.env.npm_config_registry = previousRegistry;
  assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('reader-ui-e2e-'));
  await rm(root, { recursive: true, force: true });
}
