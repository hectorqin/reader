// Run from server: node --import tsx ../web/tools/ui-review/sources-e2e.mjs
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
const shots = process.env.UI_REVIEW_DIR || join(repo, 'docs/ui-review');
const config = { booksDir: join(root, 'books'), dataDir: join(root, 'data'), host: '127.0.0.1', port: 0,
  jwtSecret: 'isolated-end-to-end-fixture-secret', accessTokenTtl: 86400, refreshTokenTtl: 86400,
  scanInterval: 0, watchInterval: 0, logLevel: 'silent', publicUrl: '', corsOrigins: [], webDir: join(repo, 'web/dist') };
let app, db, browser, page, registry;
const previousRegistry = process.env.npm_config_registry;
const button = name => page.getByRole('button', { name, exact: true });
const tab = name => page.getByRole('tab', { name, exact: true });
async function idle() { await page.waitForFunction(() => !document.querySelector('[role=status]')?.textContent?.includes('正在处理')); }
async function shot(name) {
  await idle();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' overflows');
  await page.screenshot({ path: join(shots, 'sources-e2e-' + name + '.png'), animations: 'disabled' });
}
async function addSource(name) {
  await button('添加来源').click(); await page.getByLabel('来源类型').selectOption('reader.source.demo/demo-chapters');
  await page.getByLabel('名称', { exact: true }).fill(name); await button('保存来源').click();
  await page.locator('.sources-row').getByText(name, { exact: true }).waitFor(); await idle();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await button('添加来源').evaluate(el => el === document.activeElement), true);
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
  await button('注册并登录').click(); await page.locator('.shelf-screen').waitFor();
  await page.goto(base + '/#/sources'); await tab('插件管理').click();
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('plugin-install-' + width); }
  await tab('上传安装包').click();
  for (const width of [320, 1280]) { await page.setViewportSize({ width, height: 844 }); await shot('plugin-upload-' + width); }
  await page.getByLabel('npm pack 安装包').setInputFiles(archive);
  assert.equal(await button('上传并启用').isDisabled(), true);
  await page.getByLabel('我信任这个插件的代码').check();
  await button('上传并启用').click(); await page.getByText('Demo chapter source', { exact: true }).waitFor();
  assert.ok((await page.locator('[role=status]').innerText()).includes('插件已安装并启用'));
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator('.floating-notice').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right, position: getComputedStyle(node).position };
    });
    assert.equal(bounds.position, 'fixed');
    assert.ok(bounds.width <= 448 && bounds.left >= 16 && bounds.right <= width - 16);
    await shot('plugin-feedback-' + width);
  }
  const beforeDismiss = await page.locator('.sources-body').boundingBox();
  await button('关闭提示').click(); await page.locator('.floating-notice').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.locator('.sources-body').boundingBox(), beforeDismiss, 'dismissing feedback does not move the page');
  assert.equal(await page.getByLabel('npm pack 安装包').inputValue(), '');
  await tab('从 npm 安装').click();
  await page.getByLabel('npm 包名', { exact: true }).fill('reader-source-example@latest');
  await page.getByLabel('我信任这个插件的代码').check();
  await button('安装并启用').click(); await page.getByText('Upload example', { exact: true }).waitFor();
  await shot('plugins-enabled-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await tab('书源管理').click(); await addSource('示例章节源'); await addSource('第二个章节源');
  await page.reload(); await tab('书源管理').click(); await page.locator('.sources-row').getByText('示例章节源', { exact: true }).waitFor();
  await tab('书源管理').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await tab('自动追更').getAttribute('aria-selected'), 'true');
  await shot('hub-updates-mobile');
  await page.keyboard.press('End');
  assert.equal(await tab('插件管理').getAttribute('aria-selected'), 'true');
  await shot('hub-plugins-mobile');
  await page.keyboard.press('Home');
  assert.equal(await tab('搜书').getAttribute('aria-selected'), 'true');
  assert.equal(await button('添加来源').count(), 0);
  await shot('search-empty-mobile');
  await tab('书源管理').click();
  const row = page.locator('.sources-row').filter({hasText:'示例章节源'});
  await row.getByRole('button',{name:'管理',exact:true}).click();
  await shot('hub-management-mobile');
  for (const width of [320,390,1280]) { await page.setViewportSize({width,height:844}); await shot('hub-'+width); }
  await tab('搜书').click();
  await page.getByRole('combobox',{name:'选择来源',exact:true}).selectOption({label:'示例章节源'});
  await page.getByLabel('搜索书籍').fill('示例'); await button('搜索').click();
  await page.getByText('插件示例书',{exact:true}).waitFor();
  await shot('search-desktop');
  await button('加入书架').click(); await button('阅读《插件示例书》').click();
  await page.locator('book-content').getByText('这是通过独立 Node 进程提供的示例章节。',{exact:false}).waitFor();
  await page.setViewportSize({width:390,height:844}); await shot('reader-mobile');
  assert.deepEqual(errors, []);
  console.log('PASS real HTTP + SQLite + stdio plugin + production Web: registration, tgz upload, npm registry install, auto-enable, independent instances, tabs, layout, streamed search, acquisition and chapter reading');
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
