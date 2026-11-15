/**
 * The picture viewer in a real browser.
 *
 * A tap on a plate opens it over the whole window; a sideways drag goes to the
 * chapter's next picture; a double click zooms about the point clicked and a drag
 * then moves the picture no further than its edge; Escape returns to the page
 * exactly where it was. A tap on text is still the reader's tap.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ILLUSTRATED_ID, createReviewServer } from './server.mjs';

const shots = process.env.UI_REVIEW_DIR ? resolve(process.env.UI_REVIEW_DIR) : join(resolve(import.meta.dirname, '../../..'), 'artifacts/ui-review/image-viewer');
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
    await page.goto(base + '/#/book/' + ILLUSTRATED_ID);
    const plate = page.locator('book-content .pic img').first();
    await plate.waitFor();
    await page.waitForFunction(() => [...document.querySelector('book-content').shadowRoot.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0));

    const place = () => page.locator('book-content').evaluate(el => ({ y: el.scrollTop, chrome: document.querySelector('.reader-screen').dataset.chrome }));
    const viewer = page.locator('dialog.image-viewer');
    const shown = () => viewer.locator('img').evaluate(img => { const r = img.getBoundingClientRect(); const m = new DOMMatrix(getComputedStyle(img).transform);
      return { src: img.src.startsWith('blob:') ? img.src : new URL(img.src).searchParams.get('ref'), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, scale: m.a, x: m.e, y: m.f }; });
    const rest = () => viewer.locator('img').evaluate(img => Promise.all(img.getAnimations().map(animation => animation.finished)).then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))));
    const drag = async (fromX, fromY, toX, toY) => { await page.mouse.move(fromX, fromY); await page.mouse.down(); await page.mouse.move((fromX + toX) / 2, (fromY + toY) / 2, { steps: 4 }); await page.mouse.move(toX, toY, { steps: 4 }); await page.mouse.up(); };
    const centre = [width / 2, height / 2];

    const before = await place();
    const route = await page.evaluate(() => location.hash);
    await plate.click();
    await viewer.waitFor();
    await rest();
    let state = await shown();
    assert.equal(state.src, 'OEBPS/Images/pic.png', name + ': the tapped picture is the one shown');
    assert.equal(await viewer.locator('.image-viewer-count').innerText(), '1 / 2', name + ': the chapter has two pictures');
    const box = await viewer.evaluate(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    assert.deepEqual(box, [0, 0, width, height], name + ': the viewer is the whole window');
    assert.ok(state.left >= -0.5 && state.right <= width + 0.5 && state.top >= -0.5 && state.bottom <= height + 0.5, name + ': the picture fits at rest');
    assert.deepEqual(await place(), before, name + ': opening a picture is not also a page turn or a toolbar toggle');
    await page.screenshot({ path: join(shots, `viewer-${name}-rest.png`), animations: 'disabled' });

    // Sideways: the chapter's next picture, and back; the ends do not turn.
    await drag(centre[0] + 80, centre[1], centre[0] - 80, centre[1]);
    await rest();
    state = await shown();
    assert.equal(state.src, 'OEBPS/Images/wide.png', name + ': a drag to the left shows the next picture');
    assert.equal(await viewer.locator('.image-viewer-count').innerText(), '2 / 2');
    assert.ok(Math.abs(state.x) < 0.5 && Math.abs(state.scale - 1) < 0.01, name + ': the new picture starts at rest');
    await drag(centre[0] + 80, centre[1], centre[0] - 80, centre[1]);
    await rest();
    state = await shown();
    assert.equal(state.src, 'OEBPS/Images/wide.png', name + ': the last picture does not turn further');
    assert.ok(Math.abs(state.x) < 0.5, name + ': and springs back to the centre');

    // Double click zooms about the point clicked; a drag then stops at the picture's edge.
    const point = [state.left + state.width * 0.25, (state.top + state.bottom) / 2];
    await page.mouse.dblclick(point[0], point[1]);
    await rest();
    state = await shown();
    assert.ok(Math.abs(state.scale - 2.5) < 0.01, name + `: double click zooms to 2.5× (${state.scale})`);
    await page.screenshot({ path: join(shots, `viewer-${name}-zoomed.png`), animations: 'disabled' });
    await drag(centre[0], centre[1], centre[0] + width * 3, centre[1] + 200);
    await rest();
    state = await shown();
    if (state.width > width) assert.ok(Math.abs(state.left) < 1, name + `: dragged right, the picture stops with its left edge at the window's (${state.left})`);
    else assert.ok(Math.abs((state.left + state.right) / 2 - width / 2) < 1, name + ': a picture narrower than the window stays centred');
    if (state.height <= height) assert.ok(Math.abs((state.top + state.bottom) / 2 - height / 2) < 1, name + ': and stays centred on the axis it does not overflow');
    await drag(centre[0], centre[1], centre[0] - 120, centre[1]);
    await rest();
    assert.equal((await shown()).src, 'OEBPS/Images/wide.png', name + ': a drag while zoomed moves the picture, it does not turn');
    await page.mouse.wheel(0, 2000);
    await rest();
    assert.ok(Math.abs((await shown()).scale - 1) < 0.01, name + ': the wheel zooms back out to rest');

    await page.keyboard.press('ArrowLeft');
    await rest();
    assert.equal((await shown()).src, 'OEBPS/Images/pic.png', name + ': ← goes back');
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    assert.deepEqual(await place(), before, name + ': closing returns to the page as it was');
    assert.equal(await page.evaluate(() => location.hash), route);

    // A tap beside the picture closes too, and a tap on text is still the reader's own.
    await plate.click();
    await viewer.waitFor();
    await rest();
    await page.mouse.click(8, height - 8);
    await viewer.waitFor({ state: 'detached' });
    await page.locator('book-content p').first().click();
    await page.waitForTimeout(300);
    assert.equal(await viewer.count(), 0, name + ': a tap on text opens nothing');

    // A comic: a tap is still a page turn, and a long press opens the page as a picture.
    await page.goto(base + '/#/book/review-comic');
    const comicPage = page.locator('book-content .fixed-page img');
    await comicPage.waitFor();
    const firstPage = await comicPage.getAttribute('src');
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await viewer.waitFor();
    assert.equal(await viewer.locator('img').getAttribute('src'), firstPage, name + ': a long press opens the comic page on screen');
    assert.equal(await viewer.locator('.image-viewer-count').count(), 0, name + ': one page, no counter');
    await page.mouse.dblclick(width / 2, height / 2);
    await rest();
    assert.ok(Math.abs((await shown()).scale - 2.5) < 0.01, name + ': and it zooms like any picture');
    await page.screenshot({ path: join(shots, `viewer-${name}-comic.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    assert.equal(await comicPage.getAttribute('src'), firstPage, name + ': closing leaves the comic on the same page');
    await page.mouse.click(width - 20, height / 2);
    await page.waitForFunction(previous => document.querySelector('book-content').shadowRoot.querySelector('.fixed-page img')?.getAttribute('src') !== previous, firstPage);
    assert.equal(await viewer.count(), 0, name + ': a tap on a comic page is still a page turn');
  } finally {
    await browser.close();
    await server.close();
  }
}
assert.deepEqual(errors, []);
console.log('image viewer review passed; screenshots in ' + shots);
