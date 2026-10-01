// One PWA icon supplies APK launcher sizes and iOS startup images.
// Run: node web/tools/pwa/branding.mjs
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const icon = await readFile(new URL('public/icons/icon-512.png', root));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  async function render(relative, width, height, size) {
    const bytes = await page.evaluate(async ({ source, width, height, size }) => {
      const img = new Image(); img.src = source; await img.decode();
      const canvas = document.querySelector('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fbfaf7'; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, (width - size) / 2, (height - size) / 2, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source: `data:image/png;base64,${icon.toString('base64')}`, width, height, size });
    const dest = new URL(relative, root); await mkdir(new URL('./', dest), { recursive: true });
    await writeFile(dest, Buffer.from(bytes, 'base64'));
  }
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    await render(`../android/app/src/main/res/mipmap-${density}/ic_launcher.png`, size, size, size);
  }
  const devices = [[320,568,2],[375,667,2],[414,736,3],[375,812,3],[390,844,3],[393,852,3],[402,874,3],[414,896,2],[414,896,3],[428,926,3],[430,932,3],[440,956,3],[768,1024,2],[810,1080,2],[820,1180,2],[834,1194,2],[1024,1366,2]];
  const links = [];
  for (const [w,h,dpr] of devices) {
    for (const orientation of ['portrait', 'landscape']) {
      const width = (orientation === 'portrait' ? w : h) * dpr;
      const height = (orientation === 'portrait' ? h : w) * dpr;
      const name = `startup-${width}x${height}.png`;
      await render(`public/startup/${name}`, width, height, 96 * dpr);
      links.push(`    <link rel="apple-touch-startup-image" href="./startup/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})" />`);
    }
  }
  const htmlPath = new URL('index.html', root);
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(htmlPath, html.replace(/<!-- startup-images:start -->[\s\S]*?<!-- startup-images:end -->/, `<!-- startup-images:start -->\n${links.join('\n')}\n    <!-- startup-images:end -->`));
  console.log('Generated Android launcher icons and iOS startup images.');
} finally { await browser.close(); }
