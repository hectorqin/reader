import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from 'playwright';

const dist = new URL('../../dist/', import.meta.url);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf' };
let updated = false;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = pathname.replace(/^\/nested\//, '/').replace(/^\//, '') || 'index.html';
  if (path.startsWith('api/')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":{"code":"UNAUTHORIZED","message":"sign in"}}');
    return;
  }
  try {
    let bytes = await readFile(new URL(path, dist));
    if (path === 'sw.js' && updated) bytes = Buffer.from(bytes.toString().replace(/[a-f0-9]{20}/, 'updated'));
    res.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const base of ['/', '/nested/']) {
    updated = false;
    const context = await browser.newContext();
    let page = await context.newPage();
    await page.goto(`${origin}${base}`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
    const manifest = await page.evaluate(async () => {
      const url = document.querySelector('link[rel="manifest"]').href;
      return (await fetch(url)).json();
    });
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) {
      const dimensions = await page.evaluate(async (src) => {
        const img = new Image(); img.src = src; await img.decode();
        return `${img.naturalWidth}x${img.naturalHeight}`;
      }, icon.src);
      assert.equal(dimensions, icon.sizes);
    }
    const cdp = await context.newCDPSession(page);
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, []);
    await page.evaluate(() => fetch('./api/private?token=test'));
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.map(async (name) =>
        (await (await caches.open(name)).keys()).map((req) => req.url)))).flat();
    });
    assert(cached.some((url) => url.endsWith('/assets/client.js')));
    assert(!cached.some((url) => url.includes('/api/')));
    await context.setOffline(true);
    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}${base}#/shelf`);
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
    assert(!await page.locator('#app').textContent().then((text) => text.includes('客户端启动失败')));
    assert.equal(await page.evaluate(() => fetch('./api/private').then(() => true, () => false)), false);
    await context.setOffline(false);
    updated = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    // Existing readers retain their version until every controlled page closes.
    assert.equal(await page.evaluate(async () => (await caches.keys()).length), 2);
    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}${base}`);
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.length === 1 && keys[0].endsWith(':updated');
    });
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
    await context.close();
    console.log(`PASS ${base}: manifest, icons, installability, offline restart, API isolation, waiting update and cache cleanup`);
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
