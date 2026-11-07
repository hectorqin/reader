import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import { createPdfFixture } from './pdf-fixture.mjs';

const bytes = createPdfFixture();
const requests = [];
const server = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{
    name: 'pdf-review-fixture',
    configureServer(vite) {
      vite.middlewares.use('/api/v1/books/pdf-review/content', (request, response) => {
        requests.push({ method: request.method, range: request.headers.range, authorization: request.headers.authorization });
        if (request.headers.authorization !== 'Bearer pdf-review') { response.statusCode = 401; return response.end(); }
        response.setHeader('content-type', 'application/pdf');
        response.setHeader('accept-ranges', 'bytes');
        if (request.method === 'HEAD') { response.setHeader('content-length', bytes.length); return response.end(); }
        const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
        if (!match) { response.statusCode = 400; return response.end('Full downloads are forbidden in this review'); }
        const begin = Number(match[1]);
        const end = Math.min(Number(match[2]), bytes.length - 1);
        response.statusCode = 206;
        response.setHeader('content-range', `bytes ${begin}-${end}/${bytes.length}`);
        response.setHeader('content-length', end - begin + 1);
        response.end(bytes.subarray(begin, end + 1));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1244, height: 1944 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    const { ReaderView } = await import('/src/ui/reader-view.ts');
    const { ReaderApi } = await import('/src/api/client.ts');
    const { FetchTransport } = await import('/src/core/fetch-transport.ts');
    const { loadPdf } = await import('/src/formats/pdf.ts');
    await import('/src/styles/reader.css');
    document.body.replaceChildren();
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;inset:64px 20px 100px';
    document.body.append(stage);
    const api = new ReaderApi({ transport: new FetchTransport(() => '') }, {
      load: async () => ({ accessToken: 'pdf-review', accessTokenExpiresAt: 9e15 }),
      save: async () => undefined, clear: async () => undefined,
    });
    await api.restore();
    const doc = await loadPdf(await api.pdfSource('pdf-review'));
    window.pdfDoc = doc;
    window.pdfReader = new ReaderView({ container: stage, doc });
    await window.pdfReader.open(0);
  });
  await page.waitForFunction(() => document.querySelector('book-content').shadowRoot.querySelector('.textLayer')?.textContent.includes('PDF page 1'));
  const firstRequests = requests.length;
  const transferred = requests.filter(request => request.range).reduce((total, request) => {
    const [, begin, end] = /^bytes=(\d+)-(\d+)$/.exec(request.range);
    return total + Number(end) - Number(begin) + 1;
  }, 0);
  assert.ok(transferred < bytes.length / 4, `first page must not download the entire PDF: ${transferred}/${bytes.length}`);
  await page.waitForTimeout(300);
  assert.equal(requests.length, firstRequests, 'idle reading must not prefetch the entire PDF');
  for (const viewport of [{ width: 1244, height: 1944 }, { width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ['scroll', 'paged']) {
      for (const fit of ['contain', 'width']) {
        await page.evaluate(({ mode, fit }) => window.pdfReader.applySettings({ mode, fit, pageMargin: 4 }), { mode, fit });
        await page.waitForFunction(() => {
          const wrapper = window.pdfReader.elementHost.flow.querySelector('.pdf-page');
          const canvas = wrapper?.querySelector('canvas');
          if (!canvas?.width || !wrapper.querySelector('.textLayer')?.textContent) return false;
          const bounds = canvas.getBoundingClientRect();
          return bounds.width <= wrapper.clientWidth + 1 && (wrapper.dataset.fit === 'width' || bounds.height <= wrapper.clientHeight + 1);
        });
        const geometry = await page.evaluate(() => {
          const host = window.pdfReader.elementHost;
          const rect = element => {
            const bounds = element.getBoundingClientRect();
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
          };
          return { host: rect(host), flow: rect(host.flow), wrapper: rect(host.flow.querySelector('.pdf-page')), columns: getComputedStyle(host.flow).columnCount };
        });
        for (const box of [geometry.flow, geometry.wrapper]) {
          for (const dimension of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[dimension] - geometry.host[dimension]) < 1, JSON.stringify({ viewport, mode, fit, geometry }));
        }
        assert.equal(geometry.columns, 'auto');
      }
    }
  }
  await page.evaluate(async () => { window.pdfReader.applySettings({ fit: 'contain' }); await window.pdfReader.open(2); });
  await page.waitForFunction(() => window.pdfReader.elementHost.flow.querySelector('.textLayer')?.textContent.includes('PDF page 3'));
  assert.equal(await page.evaluate(() => window.pdfReader.position().sectionId), 'pdf:3');
  await page.evaluate(async () => { await window.pdfReader.openLocator('r1:0.0000:pdf:2'); });
  assert.equal(await page.evaluate(() => window.pdfReader.position().sectionId), 'pdf:2');
  await mkdir(fileURLToPath(new URL('../../../artifacts/ui-review/pdf/', import.meta.url)), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../../../artifacts/ui-review/pdf/page.png', import.meta.url)) });
  await page.evaluate(() => { window.pdfReader.dispose(); window.pdfDoc.pdf.dispose(); });
  const beforeOffline = requests.length;
  await page.evaluate(async offlineBytes => {
    const { ReaderView } = await import('/src/ui/reader-view.ts');
    const { loadPdf } = await import('/src/formats/pdf.ts');
    window.pdfDoc = await loadPdf(new Uint8Array(offlineBytes));
    window.pdfReader = new ReaderView({ container: document.body.firstElementChild, doc: window.pdfDoc });
    await window.pdfReader.open(0);
  }, Array.from(createPdfFixture(0)));
  assert.equal(requests.length, beforeOffline, 'offline PDF bytes must not request network content');
  await page.evaluate(() => { window.pdfReader.dispose(); window.pdfDoc.pdf.dispose(); });
  assert.deepEqual(errors, []);
  await page.evaluate(async () => {
    const { loadPdf } = await import('/src/formats/pdf.ts');
    const controller = new AbortController();
    let requested;
    const started = new Promise(resolve => { requested = resolve; });
    const opening = loadPdf({
      length: 8 * 1024 * 1024,
      readRange: (_begin, _end, signal) => new Promise((_resolve, reject) => {
        requested();
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
    }, controller.signal).then(() => false, () => true);
    await started;
    controller.abort();
    if (!await opening) throw new Error('Cancelling PDF loading must reject the pending open');
  });
  for (let attempt = 0; attempt < 50 && page.workers().length; attempt += 1) await page.waitForTimeout(100);
  assert.equal(page.workers().length, 0, 'closing or cancelling a PDF must release its workers');
  assert.ok(errors.every(error => error.includes('Worker was terminated') && error.includes('ensureNotTerminated')), `Unexpected errors during cancellation: ${JSON.stringify(errors)}`);
  console.log(`PASS: first page transferred ${transferred}/${bytes.length} bytes; authenticated Range loading, 12 layouts, text, page jumps, offline bytes, cancellation and worker cleanup`);
  const production = await preview({ root: server.config.root, preview: { host: '127.0.0.1', port: 0, open: false } });
  const productionPage = await browser.newPage();
  const productionErrors = [];
  productionPage.on('pageerror', error => productionErrors.push(error.message));
  try {
    await productionPage.route('**/__pdf-review.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await productionPage.goto(`${production.resolvedUrls.local[0]}__pdf-review.html`);
    const bundle = (await readdir(fileURLToPath(new URL('../../dist/assets/', import.meta.url)))).find(file => /^pdf-renderer-.*\.js$/.test(file));
    assert.ok(bundle, 'the PDF.js engine must be split out of the main application bundle');
    await productionPage.evaluate(async ({ bundle, offlineBytes }) => {
      const { openPdf } = await import(`/assets/${bundle}`);
      const { renderer } = await openPdf(new Uint8Array(offlineBytes));
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;inset:0';
      document.body.append(container);
      await renderer.render(3, container, 'contain');
      if (!container.querySelector('canvas')?.width || !container.querySelector('.textLayer')?.textContent.includes('PDF page 3')) throw new Error('The production PDF.js bundle must render canvas and text');
      renderer.dispose();
    }, { bundle, offlineBytes: Array.from(createPdfFixture(0)) });
    for (let attempt = 0; attempt < 50 && productionPage.workers().length; attempt += 1) await productionPage.waitForTimeout(100);
    assert.equal(productionPage.workers().length, 0);
    assert.deepEqual(productionErrors, []);
    console.log('PASS: production PDF.js bundle, fingerprinted worker and bundled font resources render without a CDN');
  } finally {
    await productionPage.close();
    await new Promise(resolve => production.httpServer.close(resolve));
  }
} finally {
  await browser?.close();
  await server.close();
}
