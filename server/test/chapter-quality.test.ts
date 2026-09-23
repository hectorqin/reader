import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterQuality, requireChapterContent } from '../src/publications/chapter-quality.ts';

test('quality counts visible Unicode characters, ignores markup and rejects empty chapters', () => {
  assert.equal(chapterQuality(' 中文 😀 \n', 'text/plain').characters, 3);
  assert.equal(chapterQuality('<p>中&nbsp;文 &amp; 😀</p><script>evil()</script>', 'text/html').characters, 4);
  for (const body of [' ', '\u200b\u2060', '<p>&nbsp;</p>', '<script>evil()</script>']) {
    assert.throws(() => requireChapterContent(body, 'text/html'), { code: 'EMPTY_CHAPTER' });
  }
  assert.equal(requireChapterContent('<img src="data:image/png;base64,abcd" />', 'text/html').images, 1);
});
