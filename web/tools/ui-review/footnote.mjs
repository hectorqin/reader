/**
 * Footnotes in a real browser: the three things jsdom cannot show.
 *
 *  - A reference mark opens the note in place and the reading position does not move.
 *  - A note in another chapter is fetched and shown without changing chapter.
 *  - A link that is not a note stays inside the book: the address — which is the
 *    app's route — is the same before and after. Left to the browser, a fragment
 *    link in a shadow tree changes the hash and the router leaves the reader.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ILLUSTRATED_ID, createReviewServer } from './server.mjs';

const shots = process.env.UI_REVIEW_DIR
  ? resolve(process.env.UI_REVIEW_DIR)
  : join(resolve(import.meta.dirname, '../../..'), 'artifacts/ui-review/footnote');
await mkdir(shots, { recursive: true });
const errors = [];

for (const [name, width, height] of [
  ['phone', 390, 844],
  ['desktop', 1366, 768],
]) {
  // A server and a browser per size: the jump at the end saves a reading position,
  // and the next size has to open the book where the marks are.
  const server = createReviewServer({ port: 0 });
  await server.listen();
  const base = 'http://127.0.0.1:' + server.server.address().port;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/#/shelf');
    await page.locator('input[autocomplete=username]').fill('review');
    await page.locator('input[type=password]').fill('password12');
    await page.locator('button[type=submit]').click();
    await page.locator('.shelf-screen').waitFor();

    const place = () =>
      page.locator('book-content').evaluate((el) => {
        const flow = el.shadowRoot.querySelector('.book-flow');
        const scroller = el.dataset.paginated === 'true' ? flow : el;
        return {
          x: scroller.scrollLeft,
          y: scroller.scrollTop,
          first: flow.querySelector('p')?.textContent?.slice(0, 6),
        };
      });
    const sheet = page.locator('.reader-screen .sheet.footnote-sheet');

    await page.goto(base + '/#/book/' + ILLUSTRATED_ID);
    const mark = page.locator('book-content #r1');
    await mark.waitFor();
    await mark.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const route = await page.evaluate(() => location.hash);

    // A note in this chapter.
    let before = await place();
    await mark.click();
    await sheet.waitFor();
    assert.equal(
      await sheet.locator('.footnote-text').innerText(),
      '[1] 这是本章之内的脚注，点一下引用标记就在原处读到。',
    );
    assert.deepEqual(await place(), before, name + ': reading a note does not move the page');
    // The sheet slides in; it is measured where it comes to rest.
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    const box = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        height: r.height,
        top: r.top,
        bottom: innerHeight - r.bottom,
        left: r.left,
        right: innerWidth - r.right,
      };
    });
    assert.ok(
      box.height < height / 2,
      name + `: the sheet is as tall as the note, not a half screen (${box.height}px)`,
    );
    assert.ok(
      box.top >= 0 && box.bottom >= 0 && box.left >= 0 && box.right >= 0,
      name + ': the sheet is inside the window ' + JSON.stringify(box),
    );
    await page.screenshot({ path: join(shots, `footnote-${name}-same-chapter.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => location.hash), route, name + ': the route is untouched');

    // A cross-reference is not previewed, and never becomes a route change.
    const xref = page.locator('book-content #xref');
    await xref.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await xref.click();
    await page.waitForTimeout(400);
    assert.equal(await sheet.count(), 0, name + ': a cross-reference is not previewed');
    assert.equal(await page.evaluate(() => location.hash), route, name + ': a fragment link does not become a route');
    assert.equal(await page.locator('book-content').count(), 1, name + ': the reader is still open');

    // A note at the back of the book.
    await mark.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    before = await place();
    await page.locator('book-content #r2').click();
    await sheet.waitFor();
    assert.equal(
      await sheet.locator('.footnote-text').innerText(),
      '[2] 这是写在后记里的书后注，读者不必翻到这里就能读到它。',
    );
    assert.deepEqual(await place(), before, name + ': a note from another chapter is read without going there');
    await page.screenshot({ path: join(shots, `footnote-${name}-other-chapter.png`), animations: 'disabled' });

    // …and the button goes there, landing in the chapter that holds the note.
    await sheet.getByRole('button', { name: '跳到注释处' }).click();
    await sheet.waitFor({ state: 'detached' });
    await page.locator('book-content #n2').waitFor();
    assert.equal(await page.evaluate(() => location.hash), route, name + ': a jump between chapters keeps the route');
  } finally {
    await browser.close();
    await server.close();
  }
}
assert.deepEqual(errors, []);
console.log('footnote review passed; screenshots in ' + shots);
