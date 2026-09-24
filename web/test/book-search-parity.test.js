// @vitest-environment jsdom
import {test,expect} from 'vitest';
import {plainSearchText,htmlSearchText} from '../../server/src/services/book-search.ts';
import {textToChapterHtml} from '../src/formats/segments.ts';
import {searchableText} from '../src/ui/text-anchor.ts';
test('server text offsets match the reader rendition including headings and paragraphs',()=>{
  for(const raw of ['第一章 测试\n\n  正文。\n  下一段。','前言\r\n\r\n中文 & <原文>\n续行','\n\n普通标题\n软换行\n\n新段','Chapter 1\nHello\n world.','\n','  两个  空格。\n  中文！']) {
    expect(plainSearchText(raw)).toBe(searchableText(textToChapterHtml(raw)));
  }
  for(const html of ['<html><head><title>忽略</title></head><body><p>甲&amp;乙</p>\n<p>目标</p></body></html>','<p>甲<strong>乙</strong>丙</p><script>忽略</script>'])expect(htmlSearchText(html)).toBe(searchableText(html));
});
