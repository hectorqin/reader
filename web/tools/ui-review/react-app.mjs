/**
 * React 19 application smoke review.
 *
 * This is intentionally separate from run.mjs. The latter is the historical
 * reader/layout review and still exercises the old reader fixture. This harness
 * drives the current hash-router application, captures the real production bundle
 * at phone and desktop widths, and fails on page errors or horizontal overflow.
 */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createReviewServer } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const output = process.env.UI_REVIEW_DIR
  ? resolve(process.env.UI_REVIEW_DIR)
  : join(repo, 'artifacts', 'ui-review', 'react-app');
const widths = [390, 1120];
const height = 844;

const waitForServerLine = (child, label) => new Promise((resolvePromise, reject) => {
  let buffer = '';
  let stderr = '';
  const timer = setTimeout(() => reject(new Error(`${label} did not start within 30s\n${stderr}`)), 30_000);
  child.stdout.on('data', chunk => {
    buffer += String(chunk);
    for (const line of buffer.split(/\r?\n/)) {
      try {
        const value = JSON.parse(line);
        if (value.baseUrl) {
          clearTimeout(timer);
          resolvePromise(value);
          return;
        }
      } catch {
        // The fixture can print non-JSON diagnostics before its ready line.
      }
    }
    buffer = buffer.slice(-16_000);
  });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    reject(new Error(`${label} exited before ready (${code ?? signal})\n${stderr}`));
  });
});

async function startMediaFixture() {
  const loader = join(repo, 'server', 'node_modules', 'tsx', 'dist', 'loader.mjs');
  const child = spawn(process.execPath, ['--import', pathToFileURL(loader).href, join(repo, 'server', 'tools', 'media-review-fixture.ts')], {
    cwd: repo,
    env: { ...process.env, MEDIA_REVIEW_TIMEOUT_MS: '600000' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const ready = await waitForServerLine(child, 'media-review-fixture');
  return { child, ...ready };
}

function reportError(errors, page, name, error) {
  errors.push({ page: name, message: error instanceof Error ? error.message : String(error) });
  void page.screenshot({ path: join(output, `${name}-failure.png`), fullPage: true }).catch(() => undefined);
}

async function login(page, origin, target = '/#/shelf') {
  await page.goto(`${origin}${target}`, { waitUntil: 'domcontentloaded' });
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    username.waitFor({ state: 'visible' }).catch(() => undefined),
    page.locator('.shelf-screen, .media-app-nav').first().waitFor({ state: 'attached' }).catch(() => undefined),
  ]);
  if (await username.isVisible().catch(() => false)) {
    await username.fill('reviewer');
    await page.locator('input[type="password"]').fill('review-test-pass');
    await page.locator('form button[type="submit"]').click();
  }
  await page.locator('.shelf-screen, .media-app-nav').first().waitFor({ state: 'attached' });
}

async function installReaderApiStubs(page) {
  await page.route('**/api/v1/admin/settings**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    if (url.pathname.endsWith('/admin/settings')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ group: 'tts', label: '朗读', revision: 1, values: {}, secrets: {}, fields: [] }] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ group: 'tts', label: '朗读', revision: 1, values: {}, secrets: {}, fields: [] }) });
  });
  await page.route('**/api/v1/sources**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = { sources: [] };
    if (path.endsWith('/types')) body = { types: [] };
    if (path.includes('/subscriptions')) body = { subscriptions: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/v1/plugins**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plugins: [] }) });
  });
}

async function capture(page, name, checks, errors) {
  for (const width of widths) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const screen = document.querySelector('.media-screen');
      return {
        pageOverflow: root.scrollWidth > window.innerWidth + 1,
        screenOverflow: !!screen && screen.scrollWidth > screen.clientWidth + 1,
        pageErrors: 0,
      };
    });
    assert.equal(metrics.pageOverflow, false, `${name} ${width}px: document horizontal overflow`);
    assert.equal(metrics.screenOverflow, false, `${name} ${width}px: screen horizontal overflow`);
    const file = `${name}-${width}.png`;
    await page.screenshot({ path: join(output, file), fullPage: true });
    checks.push({ name, width, file, ...metrics });
  }
  assert.equal(errors.length, 0, `${name}: pageerror ${errors.map(item => item.message).join('; ')}`);
}

async function waitHeading(page, name) {
  await page.getByRole('heading', { name, exact: true }).first().waitFor();
}

async function runReaderReview(browser, origin, checks, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push({ page: 'reader', message: error.message }));
  await installReaderApiStubs(page);
  await page.goto(`${origin}/#/shelf`);
  await page.locator('input[autocomplete="username"]').fill('reviewer');
  await page.locator('input[type="password"]').fill('review-test-pass');
  await page.locator('form button[type="submit"]').click();
  await page.locator('.shelf-screen').waitFor();
  await capture(page, 'shelf', checks, errors);
  await page.goto(`${origin}/#/library`);
  await waitHeading(page, '书库');
  await capture(page, 'library', checks, errors);
  await page.goto(`${origin}/#/settings`);
  await waitHeading(page, '设置');
  await capture(page, 'settings', checks, errors);
  await page.goto(`${origin}/#/sources`);
  await waitHeading(page, '书源');
  await capture(page, 'sources', checks, errors);
  // Hash history is part of the router contract.
  await page.goto(`${origin}/#/shelf`);
  await page.goto(`${origin}/#/library`);
  await page.goBack();
  assert.equal(new URL(page.url()).hash, '#/shelf');
  await page.goForward();
  assert.equal(new URL(page.url()).hash, '#/library');
  await context.close();
}

async function runMediaReview(browser, origin, checks, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push({ page: 'media', message: error.message }));
  page.on('response', response => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      console.warn(`media API ${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('requestfailed', request => console.warn(`media request failed ${request.url()} ${request.failure()?.errorText ?? ''}`));
  await page.route('**/api/v1/sync**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverTime: Date.now(), progress: [], notes: [] }) }));
  await page.route('**/api/v1/admin/users**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users: [{ id: 'reviewer', username: 'reviewer', displayName: '评测', role: 'admin' }] }) }));
  await login(page, origin, '/#/media/video');
  const pages = [
    ['media-video', '/#/media/video', '影视', '.media-grid'],
    ['media-music', '/#/media/music', '音乐', '.media-screen'],
    ['media-audiobook', '/#/media/audiobook', '有声书', '.media-screen'],
    ['media-detail', '/#/media/video/items/review-film', '人工保留标题', '.media-detail-page'],
    ['media-favorites', '/#/media/favorites', '我的收藏', '.media-grid'],
    ['media-history', '/#/media/video/history', '播放历史', '.media-screen'],
    ['media-queue', '/#/media/queue', '待播队列', '.media-screen'],
    ['media-folders', '/#/media/video/folders/review-lib', '文件夹浏览', '.media-folders'],
    ['media-settings', '/#/media/video/settings', '影音设置', '.media-settings'],
    ['media-permissions', '/#/media/video/settings/libraries/review-lib/permissions', '访问权限', '.media-permissions-page'],
  ];
  for (const [name, path, heading, target] of pages) {
    await page.goto(`${origin}${path}`);
    await waitHeading(page, heading);
    try {
      await page.locator(target).first().waitFor({ state: 'attached' });
    } catch (error) {
      throw new Error(`${name} did not render ${target}; URL=${page.url()} body=${(await page.locator('body').innerText()).slice(0, 1200)}\n${error instanceof Error ? error.message : String(error)}`);
    }
    await capture(page, name, checks, errors);
  }
  // Back/forward must remain inside the hash router and keep the target page.
  await page.goto(`${origin}/#/media/video`);
  await page.goto(`${origin}/#/media/music`);
  await page.goBack();
  assert.equal(new URL(page.url()).hash, '#/media/video');
  await page.goForward();
  assert.equal(new URL(page.url()).hash, '#/media/music');
  await context.close();
}

const checks = [];
const errors = [];
let readerServer;
let mediaServer;
let browser;
try {
  await mkdir(output, { recursive: true });
  await rm(join(output, 'verification.json'), { force: true });
  readerServer = createReviewServer({ port: 0 });
  const readerOrigin = await readerServer.listen();
  mediaServer = await startMediaFixture();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  await runReaderReview(browser, readerOrigin, checks, errors);
  await runMediaReview(browser, mediaServer.baseUrl, checks, errors);
  assert.deepEqual(errors, [], `browser page errors: ${JSON.stringify(errors)}`);
  const report = { passed: true, screenshots: checks.length, checks, pageErrors: errors };
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: checks.length, output }));
} catch (error) {
  const report = { passed: false, screenshots: checks.length, checks, pageErrors: errors, error: error instanceof Error ? error.stack : String(error) };
  await writeFile(join(output, 'verification.json'), JSON.stringify(report, null, 2)).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await readerServer?.close().catch(() => undefined);
  if (mediaServer?.child && mediaServer.child.exitCode === null) {
    mediaServer.child.stdin.end();
    await new Promise(resolvePromise => mediaServer.child.once('exit', resolvePromise));
  }
}
