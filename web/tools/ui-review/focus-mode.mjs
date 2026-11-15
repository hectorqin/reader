/**
 * 专注模式 in a real browser.
 *
 * The veils are two boxes placed from measured rects, which jsdom cannot produce:
 * this is where "the paragraph on the line is the one left clear" is checked, at
 * the start, middle and end of a long chapter, by keyboard, across a reload, and
 * gone again in paged mode. Off by default is checked first.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { BOOK_ID, createReviewServer } from './server.mjs';

const shots = process.env.UI_REVIEW_DIR ? resolve(process.env.UI_REVIEW_DIR) : join(resolve(import.meta.dirname, '../../..'), 'artifacts/ui-review/focus-mode');
await mkdir(shots, { recursive: true });
const errors = [];

for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1366, 768]]) {
  const server = createReviewServer({ port: 0 });
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
    await page.goto(base + '/#/book/' + BOOK_ID);
    await page.waitForFunction(() => Number(document.querySelector('.progress-scrubber')?.max) > 1);

    /** The veils, the clear band between them, and the paragraphs that band shows whole. */
    const read = () => page.evaluate(() => {
      const host = document.querySelector('book-content'), box = host.getBoundingClientRect();
      const veils = [...document.querySelectorAll('.focus-veil')].map(veil => { const r = veil.getBoundingClientRect(); return { hidden: veil.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
      const clearTop = veils[0] && !veils[0].hidden ? veils[0].bottom : box.top;
      const clearBottom = veils[1] && !veils[1].hidden ? veils[1].top : box.bottom;
      const paragraphs = [...host.shadowRoot.querySelectorAll('.book-flow :is(p, h1, h2, h3)')];
      const clear = paragraphs.map((p, index) => ({ index, rect: p.getBoundingClientRect() })).filter(({ rect }) => rect.height > 0 && rect.top >= clearTop - 1 && rect.bottom <= clearBottom + 1).map(({ index }) => index);
      return { count: veils.length, veils, clear, total: paragraphs.length, firstTop: paragraphs[0]?.getBoundingClientRect().top, box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height },
        scrollTop: host.scrollTop, maxScroll: host.scrollHeight - host.clientHeight, clearTop, clearBottom };
    });
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const scrollTo = async (top) => { await page.locator('book-content').evaluate((host, value) => { host.scrollTop = value; }, top); await settle(); };
    const settings = async () => { await page.locator('.reader-actions').getByRole('button', { name: '设置', exact: true }).click(); await page.locator('.reader-screen .sheet').waitFor(); };
    const focusRow = page.locator('.reader-screen .sheet .segmented[aria-label="专注模式"]');
    const closeSheet = async () => { await page.keyboard.press('Escape'); await page.locator('.reader-screen .sheet').waitFor({ state: 'detached' }); };

    assert.equal((await read()).count, 0, name + ': off by default');

    await settings();
    // The row sits on the same two edges as the rows around it.
    const edges = await page.locator('.reader-screen .sheet .field').evaluateAll(fields => fields.map(field => { const label = field.querySelector('label').getBoundingClientRect(), control = field.querySelector('.segmented').getBoundingClientRect(); return { name: field.querySelector('label').textContent, left: Math.round(label.left), controlLeft: Math.round(control.left), right: Math.round(control.right) }; }));
    const mine = edges.find(edge => edge.name === '专注模式'), other = edges.find(edge => edge.name === '翻页方式');
    assert.deepEqual([mine.left, mine.controlLeft, mine.right], [other.left, other.controlLeft, other.right], name + ': 专注模式 lines up with 翻页方式 ' + JSON.stringify(edges));
    await focusRow.getByRole('button', { name: '开', exact: true }).click();
    await closeSheet();
    await settle();

    // The start of the chapter: nothing above the first paragraph to veil.
    await scrollTo(0);
    let state = await read();
    assert.equal(state.count, 2, name + ': two veils once on');
    assert.ok(state.maxScroll > state.box.height, name + ': the fixture chapter is long enough to scroll');
    assert.deepEqual(state.clear.slice(0, 1), [0], name + ': the chapter heading, its first block, is in focus at the top ' + JSON.stringify(state.clear));
    assert.ok(state.veils[0].hidden || state.veils[0].bottom <= state.firstTop, name + ': nothing is veiled above the first block but the page margin');
    assert.ok(!state.veils[1].hidden && state.veils[1].bottom >= state.box.bottom - 1, name + ': the veil below reaches the bottom of the page');

    // The middle: exactly one paragraph is clear, and it is the one on the resting line.
    await scrollTo(Math.round(state.maxScroll / 2));
    state = await read();
    const line = state.box.top + state.box.height * 0.4;
    assert.equal(state.clear.length, 1, name + ': one paragraph in focus mid-chapter ' + JSON.stringify(state.clear));
    assert.ok(state.clearTop <= line && state.clearBottom >= line, name + `: the clear band holds the resting line (${state.clearTop}–${state.clearBottom}, line ${line})`);
    for (const veil of state.veils) assert.ok(Math.abs(veil.left - state.box.left) <= 1.5 && Math.abs(veil.right - state.box.right) <= 1.5, name + ': the veils are as wide as the page');
    if (width > 1000) await page.mouse.click(width / 2, height / 2); // hide the chrome for the picture
    await settle();
    await page.screenshot({ path: join(shots, `focus-${name}-middle.png`), animations: 'disabled' });

    // ↓ and ↑ move one paragraph at a time.
    const before = state.clear[0];
    await page.keyboard.press('ArrowDown');
    await settle();
    state = await read();
    assert.deepEqual(state.clear, [before + 1], name + ': ↓ focuses the next paragraph');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await settle();
    assert.deepEqual((await read()).clear, [before - 1], name + ': ↑ focuses the previous one');

    // The end of the chapter: the last paragraph can be reached.
    await scrollTo(state.maxScroll);
    state = await read();
    assert.equal(state.clear.at(-1), state.total - 1, name + ': the last paragraph is in focus at the end ' + JSON.stringify(state.clear));

    // It is this device's setting, and survives a reload.
    await page.reload();
    await page.waitForFunction(() => Number(document.querySelector('.progress-scrubber')?.max) > 1);
    await settle();
    assert.equal((await read()).count, 2, name + ': still on after a reload');

    // Paged mode has no focus, and does not offer one.
    if ((await page.locator('.reader-screen').getAttribute('data-chrome')) === 'hidden') await page.mouse.click(width / 2, height / 2);
    await settings();
    await page.locator('.reader-screen .sheet').getByRole('button', { name: '翻页', exact: true }).click();
    await settle();
    assert.equal(await focusRow.count(), 0, name + ': the choice is not offered in paged mode');
    assert.equal((await read()).count, 0, name + ': no veils in paged mode');
    await page.locator('.reader-screen .sheet').getByRole('button', { name: '滚动', exact: true }).click();
    await settle();
    assert.equal((await read()).count, 2, name + ': back in scroll mode the veils return');
    await focusRow.getByRole('button', { name: '关', exact: true }).click();
    await settle();
    assert.equal((await read()).count, 0, name + ': switching it off removes them');
    await closeSheet();
  } finally {
    await browser.close();
    await server.close();
  }
}
assert.deepEqual(errors, []);
console.log('focus mode review passed; screenshots in ' + shots);
