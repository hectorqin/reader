import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { CDP } from './cdp.mjs';
import { createReviewServer, BOOK_ID, ILLUSTRATED_ID } from './server.mjs';

const server = createReviewServer({ port: 5201 });
const origin = await server.listen();
const cdp = await CDP.launch({ viewport: { width: 390, height: 844 }, scale: 2 });
const read = () => cdp.run(`
  const host = document.querySelector('book-content');
  const flow = host.shadowRoot.querySelector('.book-flow');
  const scroller = host.dataset.paginated === 'true' ? flow : host;
  const rect = host.getBoundingClientRect();
  return { top: rect.top, height: rect.height, x: scroller.scrollLeft, y: scroller.scrollTop,
    page: document.querySelector('.progress-scrubber').value,
    pages: document.querySelector('.progress-scrubber').max,
    chrome: document.querySelector('.reader-screen').dataset.chrome };
`);
try {
  await cdp.navigate(`${origin}/#/shelf`);
  await cdp.waitFor('document.querySelector(".login-screen") !== null');
  await cdp.fill('input[autocomplete="username"]', 'review');
  await cdp.fill('input[type="password"]', 'password12');
  await cdp.click('button[type="submit"]');
  await cdp.waitFor('document.querySelector(".book-card") !== null');
  await cdp.navigate(`${origin}/#/book/${BOOK_ID}`);
  await cdp.waitFor('Number(document.querySelector(".progress-scrubber")?.max) > 1');
  await cdp.sleep(500);
  await cdp.tapMiddle();
  await cdp.sleep(350);
  await cdp.tapThird(0.85);
  await cdp.sleep(350);
  const before = await read();
  assert.ok(Number(before.page) > 1, `must reach a later page: ${JSON.stringify(before)}`);
  await cdp.tapMiddle();
  await cdp.sleep(350);
  const after = await read();
  console.log(JSON.stringify({ before, after }));
  assert.equal(after.page, before.page, 'middle tap must preserve page');
  assert.equal(after.y, before.y, 'middle tap must preserve scroll offset');
  assert.equal(after.top, before.top, 'chrome must not move the reading surface');
  assert.equal(after.height, before.height, 'chrome must not resize the reading surface');
  await mkdir('../docs/ui-review/mobile', { recursive: true });
  await cdp.screenshot('../docs/ui-review/mobile/reader.png');
  for (const label of ['目录', '界面', '设置', '朗读']) {
    await cdp.clickText('.reader-actions button', label);
    await cdp.waitFor('document.querySelector(".panel") !== null');
    await cdp.run(`await Promise.all(document.querySelector('.panel').getAnimations().map(a=>a.finished));`);
    const opened = await read();
    assert.equal(opened.y, after.y, `${label} must preserve scroll position`);
    assert.equal(opened.height, after.height, `${label} must preserve surface height`);
    const panel = await cdp.run(`const r=document.querySelector('.panel').getBoundingClientRect();return {top:r.top,bottom:r.bottom};`);
    assert.ok(panel.top > 250 && panel.bottom <= 845, `sheet must leave a preview and fit the screen: ${JSON.stringify(panel)}`);
    await cdp.screenshot(`../docs/ui-review/mobile/panel-${label}.png`);
    await cdp.click('.panel button[aria-label="关闭"]');
    await cdp.waitFor('document.querySelector(".panel") === null');
    assert.equal((await read()).y, after.y, `${label} close must preserve position`);
  }
  await cdp.clickText('.reader-actions button', '界面');
  await cdp.clickText('.panel button', '浅绿');
  await cdp.click('.panel button[aria-label="关闭"]');
  await cdp.sleep(300);
  assert.equal((await read()).page, after.page, 'theme must preserve page');
  await cdp.tapMiddle();
  await cdp.sleep(250);
  await cdp.screenshot('../docs/ui-review/mobile/immersive-green.png');
  for (let i=0; i<6; i++) {
    const prior = await read();
    await cdp.tapMiddle();
    await cdp.sleep(150);
    const next = await read();
    for (const key of ['x','y','page','pages','top','height']) assert.equal(next[key],prior[key],`repeated toggle: ${key}`);
  }
  await cdp.tapMiddle();
  await cdp.clickText('.reader-actions button', '设置');
  await cdp.clickText('.panel button', '翻页');
  await cdp.click('.panel button[aria-label="关闭"]');
  await cdp.sleep(300);
  await cdp.run(`const el=document.querySelector('.progress-scrubber');el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));`);
  await cdp.sleep(250);
  const paged = await read();
  assert.equal(paged.page, '2', 'chapter slider reaches page two');
  for(let i=0;i<4;i++) {
    await cdp.tapMiddle();
    await cdp.sleep(200);
    const next=await read();
    for(const key of ['x','y','page','pages','top','height']) assert.equal(next[key],paged[key],`paged toggle: ${key}`);
  }
  await cdp.tapThird(0.85);
  await cdp.sleep(300);
  assert.equal(Number((await read()).page),3,'tap advances one page');
  await cdp.tapThird(0.15);
  await cdp.sleep(300);
  assert.equal((await read()).page,'2','reverse tap returns to same page');
  await cdp.screenshot('../docs/ui-review/mobile/paged.png');
  await cdp.clickText('.footer button', '下一章');
  await cdp.sleep(350);
  assert.equal((await read()).page,'1','next chapter starts at page one');
  await cdp.navigate(`${origin}/#/book/${ILLUSTRATED_ID}`);
  await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector("img")?.naturalWidth > 0');
  await cdp.sleep(300);
  const epub=await read();
  await cdp.tapMiddle();
  await cdp.sleep(250);
  const epubHidden=await read();
  for(const key of ['x','y','page','pages','top','height']) assert.equal(epubHidden[key],epub[key],`EPUB toggle: ${key}`);
  await cdp.screenshot('../docs/ui-review/mobile/epub.png');
  await cdp.navigate(`${origin}/#/book/review-comic`);
  await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector("img")?.naturalWidth > 0');
  await cdp.sleep(200);
  await cdp.tapThird(0.85);
  await cdp.sleep(300);
  const comic = await read();
  const chapter = await cdp.evaluate('document.querySelector(".reader-heading span").textContent');
  assert.equal(chapter, '第 2 页', 'comic page advances');
  assert.equal(comic.page, '1', 'fixed page has one page inside its chapter');
  assert.equal(comic.pages, '1', 'fixed chapter slider must not become a whole-book slider');
  for (let i=0; i<4; i++) {
    await cdp.tapMiddle();
    await cdp.sleep(200);
    assert.equal(await cdp.evaluate('document.querySelector(".reader-heading span").textContent'), chapter);
    assert.equal((await read()).height, comic.height, 'fixed layout geometry stays stable');
  }
  await cdp.screenshot('../docs/ui-review/mobile/comic.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await cdp.sleep(250);
  for(const label of ['界面','设置']) {
    await cdp.clickText('.reader-actions button', label);
    await cdp.run(`await Promise.all(document.querySelector('.panel').getAnimations().map(a=>a.finished));`);
    const overflow=await cdp.run(`const p=document.querySelector('.panel');return p.scrollWidth-p.clientWidth;`);
    assert.ok(overflow <= 1, `${label} fits a narrow phone`);
    await cdp.screenshot(`../docs/ui-review/mobile/narrow-${label}.png`);
    await cdp.click('.panel button[aria-label="关闭"]');
  }
  await cdp.navigate(`${origin}/#/book/review-pdf`);
  await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector("iframe")?.src.startsWith("blob:")');
  const pdf = await cdp.run(`const frame=document.querySelector('book-content').shadowRoot.querySelector('iframe');return (await fetch(frame.src).then(r=>r.text())).slice(0,8);`);
  assert.equal(pdf, '%PDF-1.4', 'browser viewer receives the actual PDF bytes');
  // The browser's PDF extension starts asynchronously after the frame commits.
  await cdp.sleep(1500);
  await cdp.screenshot('../docs/ui-review/mobile/pdf.png');
  console.log('PASS: page and geometry survive chrome toggle');
} finally {
  await cdp.close();
  await server.close();
}
