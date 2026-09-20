import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richContent, chapterMedia } from '../src/publications/rich-content.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHf8AAAAASUVORK5CYII=', 'base64');

test('rich chapters keep semantic markup and embed only declared raster resources', async () => {
  const calls: string[] = [];
  const html = await richContent(`<h2 onclick="evil()">标题</h2><p>正文 <strong>强调</strong></p>
    <script>evil()</script><style>@import 'https://evil.test'</style><iframe srcdoc="bad"></iframe>
    <img src="reader-res:opaque?x=1&amp;y=2" onerror="evil()"><img src="https://evil.test/pixel">
    <svg><image href="https://evil.test"></image></svg><form action="https://evil.test"><input></form>
    <a href="javascript:evil()">链接</a><div style="background:url(https://evil.test)">安全文本</div>`, async (ref) => {
    calls.push(ref); return { mediaType: 'image/png', data: png };
  });
  assert.deepEqual(calls, ['opaque?x=1&y=2']);
  assert.match(html, /<h2>标题<\/h2>/); assert.match(html, /<strong>强调<\/strong>/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /evil|script|style|iframe|svg|form|input|onclick|onerror|https:/);
});

test('rich chapter resource failures, active image formats and quotas fail without partial output', async () => {
  await assert.rejects(() => richContent('<img src="reader-res:a">', async () => ({ mediaType: 'image/svg+xml', data: Buffer.from('<svg/>') })), { code: 'INVALID_RESOURCE' });
  await assert.rejects(() => richContent('<img src="reader-res:a">', async () => ({ mediaType: 'image/png', data: Buffer.from('<script>bad</script>') })), { code: 'INVALID_RESOURCE' });
  await assert.rejects(() => richContent(Array.from({ length: 33 }, (_, n) => `<img src="reader-res:${n}">`).join(''), async () => ({ mediaType: 'image/png', data: png })), { code: 'CHAPTER_TOO_LARGE' });
  const big = Buffer.alloc(1024 * 1024); png.copy(big);
  await assert.rejects(() => richContent('<img src="reader-res:repeat">'.repeat(8), async () => ({ mediaType: 'image/png', data: big })), { code: 'CHAPTER_TOO_LARGE' });
  assert.throws(() => chapterMedia('text/html; charset = gbk'), { code: 'UNSUPPORTED_FORMAT' });
});
