/**
 * The AI 选区助手 in a real browser: select a passage, ask about it, read the answer.
 *
 * jsdom has no selection geometry and no top layer, so this is where the path from
 * a selection to the toolbar's 问AI to the sheet is actually walked, at phone and
 * desktop size. The stand-in server answers with what it was sent.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ILLUSTRATED_ID, createReviewServer } from './server.mjs';

const shots = process.env.UI_REVIEW_DIR ? resolve(process.env.UI_REVIEW_DIR) : join(resolve(import.meta.dirname, '../../..'), 'artifacts/ui-review/ai-assist');
await mkdir(shots, { recursive: true });
const errors = [];
const PASSAGE = '空出来的位置';

for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1366, 768]]) {
  const server = createReviewServer({ port: 0, ai: true });
  await server.listen();
  const base = 'http://127.0.0.1:' + server.server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#/shelf');
    await page.locator('input[autocomplete=username]').fill('review');
    await page.locator('input[type=password]').fill('password12');
    await page.locator('button[type=submit]').click();
    await page.locator('.shelf-screen').waitFor();
    await page.goto(base + '/#/book/' + ILLUSTRATED_ID);
    await page.locator('book-content #r1').waitFor();

    // Select a few words inside a paragraph, as a drag would.
    await page.locator('book-content').evaluate((host, passage) => {
      const flow = host.shadowRoot.querySelector('.book-flow');
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.data.indexOf(passage);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + passage.length);
        const selection = getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        return;
      }
      throw new Error('passage not found');
    }, PASSAGE);

    const toolbar = page.locator('.annotation-popover');
    await toolbar.waitFor();
    const fit = await toolbar.evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth, left: el.getBoundingClientRect().left, right: innerWidth - el.getBoundingClientRect().right,
      wrapped: new Set([...el.querySelectorAll('.annotation-actions button')].map(b => Math.round(b.getBoundingClientRect().top))).size }));
    assert.ok(fit.overflow <= 1 && fit.left >= 0 && fit.right >= 0 && fit.wrapped === 1, name + ': the toolbar still fits on one row with 问AI ' + JSON.stringify(fit));
    await page.screenshot({ path: join(shots, `ai-assist-${name}-toolbar.png`), animations: 'disabled' });

    await toolbar.getByRole('button', { name: '问AI' }).click();
    const sheet = page.locator('.reader-screen .sheet.ai-assist-sheet');
    await sheet.waitFor();
    assert.equal(await sheet.locator('blockquote').innerText(), PASSAGE);
    await sheet.getByRole('button', { name: '翻译' }).click();
    const answer = sheet.locator('.ai-assist-answer');
    await answer.waitFor();
    const translated = await answer.innerText();
    assert.ok(translated.startsWith('译文：' + PASSAGE), name + ': the selected passage was sent: ' + translated);
    const context = Number(/上下文 (\d+) 字/.exec(translated)?.[1]);
    assert.ok(context > PASSAGE.length + 20, name + `: the paragraph around the selection was sent as context (${context} chars)`);

    await sheet.locator('input').fill('这里指的是什么？');
    await sheet.getByRole('button', { name: '提问' }).click();
    await page.waitForFunction(() => document.querySelector('.ai-assist-answer')?.textContent?.startsWith('回答'));
    assert.ok((await answer.innerText()).startsWith('回答「这里指的是什么？」：' + PASSAGE));
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    const box = await sheet.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right, overflow: el.scrollWidth - el.clientWidth }; });
    assert.ok(box.top >= 0 && box.bottom >= 0 && box.left >= 0 && box.right >= 0 && box.overflow <= 1, name + ': the sheet is inside the window ' + JSON.stringify(box));
    assert.ok(await sheet.locator('input').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16), name + ': the question field is 16px or more (no iOS zoom)');
    await page.screenshot({ path: join(shots, `ai-assist-${name}-answer.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
  } finally {
    await browser.close();
    await server.close();
  }
}
assert.deepEqual(errors, []);
console.log('AI assist review passed; screenshots in ' + shots);
