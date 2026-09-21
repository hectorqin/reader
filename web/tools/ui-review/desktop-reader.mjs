import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { BOOK_ID, createReviewServer } from './server.mjs';

const server = createReviewServer({ port: 0 });
await server.listen();
const base = 'http://127.0.0.1:' + server.server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  await mkdir('docs/ui-review', { recursive: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('input[autocomplete=username]').fill('review');
  await page.locator('input[type=password]').fill('password12');
  await page.locator('button[type=submit]').click();
  await page.locator('.shelf-screen').waitFor();

  const surface = () => page.locator('book-content').evaluate(el => {
    const rect = el.getBoundingClientRect();
    const flow = el.shadowRoot?.querySelector('.book-flow') ?? el.querySelector('.book-flow');
    const scroller = el.dataset.paginated === 'true' ? flow : el;
    return { width: rect.width, height: rect.height, top: rect.top, x: scroller.scrollLeft, y: scroller.scrollTop,
      page: document.querySelector('.progress-scrubber').value };
  });
  async function shot(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' horizontal overflow');
    await page.screenshot({ path: 'docs/ui-review/desktop-reader-' + name + '.png', animations: 'disabled' });
  }

  for (const [width, height] of [[1024, 768], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + '/#/shelf');
    await page.goto(base + '/#/book/' + BOOK_ID);
    await page.waitForFunction(() => Number(document.querySelector('.progress-scrubber')?.max) > 1);
    await shot('toolbar-' + width);
    assert.ok(await page.locator('.footer').evaluate(el => el.getBoundingClientRect().width <= 800), 'desktop controls stay within the reading column');
    assert.equal(await page.locator('.topbar').evaluate(el => {
      const bar=el.getBoundingClientRect(), book=document.querySelector('book-content').getBoundingClientRect();
      return Math.abs(bar.left-book.left)<1 && Math.abs(bar.right-book.right)<1;
    }), true, 'book header aligns with the paper');
    for (const label of ['目录', '界面', '设置', '朗读']) {
      const before = await surface();
      const trigger = page.locator('.reader-actions').getByRole('button', { name: label, exact: true });
      await trigger.click();
      const panel = page.locator('.reader-screen .panel');
      await panel.waitFor();
      await shot(label + '-' + width);
      const bounds = await panel.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, rightGap: innerWidth - r.right, width: r.width, top: r.top, bottomGap: innerHeight - r.bottom,
          overflow: el.scrollWidth > el.clientWidth };
      });
      assert.ok(bounds.width <= 420 && bounds.width >= 360, 'bounded panel width');
      assert.ok(bounds.top >= 10 && bounds.bottomGap >= 10 && !bounds.overflow, 'panel fits viewport');
      assert.ok((label === '目录' ? bounds.left : bounds.rightGap) <= 20, 'contents on left, settings on right');
      assert.deepEqual(await surface(), before, 'opening ' + label + ' preserves the reading position and geometry');
      await panel.getByRole('button', { name: '关闭', exact: true }).press('Escape');
      await panel.waitFor({ state: 'detached' });
      assert.equal(await trigger.evaluate(el => document.activeElement === el), true, 'Escape returns focus to the opener');
      assert.deepEqual(await surface(), before, 'closing ' + label + ' preserves the reading position');
    }
    const before = await surface();
    await page.mouse.click(width / 2, height / 2);
    await page.locator('.reader-screen[data-chrome=hidden]').waitFor();
    await shot('immersive-' + width);
    assert.deepEqual(await surface(), before, 'hiding chrome preserves the page');
    await page.mouse.click(width / 2, height / 2);
    await page.locator('.reader-screen[data-chrome=visible]').waitFor();
  }
  await page.locator('.reader-actions').getByRole('button', {name:'设置',exact:true}).click();
  await page.locator('.panel').getByRole('button',{name:'翻页',exact:true}).click();
  await page.locator('.panel button[aria-label="关闭"]').click();
  await page.locator('.progress-scrubber').fill('2');
  await page.waitForFunction(() => document.querySelector('.progress-page')?.textContent?.includes('第 2/'));
  await shot('paged');
  const paged = await surface();
  await page.locator('.reader-actions').getByRole('button',{name:'目录',exact:true}).click();
  await page.locator('.panel button[aria-label="关闭"]').press('Escape');
  assert.deepEqual(await surface(),paged,'side panels preserve the selected page in paged mode');
  await page.getByRole('button',{name:'夜间',exact:true}).click();
  await shot('dark');
  await page.locator('.reader-actions').getByRole('button',{name:'界面',exact:true}).click();
  await shot('dark-settings');
  await page.locator('.panel button[aria-label="关闭"]').click();
  await page.getByRole('button',{name:'日间',exact:true}).click();
  await page.setViewportSize({ width: 1024, height: 420 });
  await page.locator('.reader-actions').getByRole('button', { name: '界面', exact: true }).click();
  const body = page.locator('.panel-body');
  await body.hover(); await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('.panel-body')?.scrollTop > 0);
  await shot('short-window-scroll');
  await page.locator('.panel button[aria-label="关闭"]').click();
  assert.deepEqual(errors, []);
  console.log('PASS desktop reader: 1024/1366/1920px, four panels, Escape/focus, immersive mode, stable page geometry and short-window scrolling');
} finally {
  await browser.close();
  await server.close();
}
