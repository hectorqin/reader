import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BOOK_ID, createReviewServer } from './server.mjs';
const server = createReviewServer({ port: 0 });
await server.listen();
const base = 'http://127.0.0.1:' + server.server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(base);
  await page.locator('input[autocomplete=username]').fill('review');
  await page.locator('input[type=password]').fill('password12');
  await page.locator('button[type=submit]').click();
  await page.locator('.shelf-screen').waitFor();
  for (const width of [1366, 390]) {
    await page.setViewportSize({width,height:768});
    await page.goto(base + '/#/shelf');
    await page.goto(base + '/#/book/' + BOOK_ID);
    await page.waitForFunction(() => Number(document.querySelector('.progress-scrubber')?.max) > 3);
    await page.waitForTimeout(300);
    const pages=Number(await page.locator('.progress-scrubber').getAttribute('max'));
    for (const direction of [1,-1]) for (let turn=1; turn<pages; turn++) {
      await page.evaluate(() => {
        const host = document.querySelector('book-content');
        const flow = host.shadowRoot?.querySelector('.book-flow') ?? host.querySelector('.book-flow');
        window.turnTrace=[];
        const until=performance.now()+400;
        const sample=() => {
          window.turnTrace.push({y:host.scrollTop,top:flow.getBoundingClientRect().top});
          if(performance.now()<until) requestAnimationFrame(sample);
        };
        sample();
      });
      const rect=await page.locator('book-content').boundingBox();
      await page.mouse.click(rect.x+rect.width*(direction===1 ? .85 : .15), rect.y+rect.height*.5);
      await page.waitForTimeout(450);
      const trace=await page.evaluate(()=>window.turnTrace);
      const detail=JSON.stringify({width,direction,turn,trace});
      assert.ok((trace.at(-1).y-trace[0].y)*direction>1,'page must move in the requested direction: '+detail);
      assert.ok(trace.every((v,i)=>!i || (v.y-trace[i-1].y)*direction>=-1),'scroll offset must not reverse: '+detail);
      assert.ok(trace.every((v,i)=>!i || (v.top-trace[i-1].top)*direction<=1),'visible content must not reverse: '+detail);
      assert.equal(Number(await page.locator('.progress-scrubber').inputValue()),direction===1 ? turn+1 : pages-turn,'each click advances exactly one page');
    }
  }
  console.log('PASS: desktop/mobile next and previous clicks, including the short final page, move without visual reversal');
} finally { await browser.close(); await server.close(); }
