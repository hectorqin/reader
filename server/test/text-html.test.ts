import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { escapeHtml, renderChapterHtml, splitParagraphs } from '../src/indexer/formats/text-html.ts';

/**
 * The paragraph split is where every interesting failure of the TXT rendition
 * lives, so it gets the tests. The escaping and the wrapping around it are
 * mechanical.
 */
describe('splitParagraphs', () => {
  test('a blank line separates paragraphs', () => {
    assert.deepEqual(splitParagraphs('第一段\n\n第二段'), ['第一段', '第二段']);
  });

  test('a single newline inside a paragraph is a soft wrap, not a break', () => {
    // The common shape in a scraped novel: the source wraps a paragraph across
    // two lines. Splitting there would truncate the first half into its own
    // paragraph and indent a continuation.
    assert.deepEqual(splitParagraphs('这句被硬换行了\n但仍然是同一段'), ['这句被硬换行了但仍然是同一段']);
  });

  test('a line-ending sentence starts a new paragraph without a blank line', () => {
    // The other common shape: every paragraph on its own line, no blank lines at
    // all. Without this rule such a file renders as one slab — which is exactly
    // the bug this rendition exists to fix.
    assert.deepEqual(
      splitParagraphs('他走了。\n她留下了。\n天亮了。'),
      ['他走了。', '她留下了。', '天亮了。'],
    );
  });

  test('does not split a continuation line that merely starts with punctuation', () => {
    // The lookahead requires the next line to start a sentence. A line beginning
    // with a comma, a closing quote or an ellipsis is a continuation of the one
    // above and must stay joined.
    assert.deepEqual(splitParagraphs('他走了。\n，她没有回头。'), ['他走了。，她没有回头。']);
    assert.deepEqual(splitParagraphs('他走了。\n」她说。'), ['他走了。」她说。']);
  });

  test('handles CRLF and lone CR line endings', () => {
    // A lone CR is a line ending, not a character inside a word: treated as one,
    // a file off a serial console or an old conversion is a single paragraph.
    assert.deepEqual(splitParagraphs('一段\r\n\r\n二段'), ['一段', '二段']);
    assert.deepEqual(splitParagraphs('他走了。\r她留下了。'), ['他走了。', '她留下了。']);
  });

  test('drops empty paragraphs rather than rendering blank blocks', () => {
    assert.deepEqual(splitParagraphs('\n\n\n\n一段\n\n\n'), ['一段']);
    assert.deepEqual(splitParagraphs('   \n\n   '), []);
  });

  test('an empty body produces no paragraphs', () => {
    assert.deepEqual(splitParagraphs(''), []);
  });
});

describe('escapeHtml', () => {
  test('escapes the characters that would otherwise rewrite the page', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
    assert.equal(escapeHtml(`"'`), '&quot;&#39;');
  });
});

describe('renderChapterHtml', () => {
  test('wraps paragraphs in a .txt-body div so the client can scope its rules', () => {
    const html = renderChapterHtml('第一段\n\n第二段').toString('utf8');
    assert.match(html, /^<div class="txt-body">\n/);
    assert.equal(html.match(/<p>/g)?.length, 2);
    assert.match(html, /<p>第一段<\/p>/);
    assert.match(html, /<p>第二段<\/p>/);
  });

  test('carries no typography, so the readers own settings are what apply', () => {
    // The indent, the paragraph spacing and the removal of a scraper's leading
    // spaces are per-device reading preferences, and a server that baked one of
    // them into the payload is what made them a round trip — and what made a book
    // read windowed look different from the same book read whole. The assertion is
    // on the absence, because absence is the contract.
    const html = renderChapterHtml('一段').toString('utf8');
    assert.doesNotMatch(html, /data-indent/);
    assert.doesNotMatch(html, /style=/);
    assert.doesNotMatch(html, /text-indent/);
  });

  test('a file containing markup cannot inject elements', () => {
    const html = renderChapterHtml(['<img src=x onerror=alert(1)>', '', '<b>粗</b>'].join('\n')).toString('utf8');
    // The characters survive as *text*; what must not survive is an element or an
    // attribute, so the assertion is on the markup rather than on the words — an
    // escaped `onerror` is a paragraph, not a handler.
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;b&gt;粗&lt;\/b&gt;/);
  });

  test('a chapter is rendered whole, with no truncation', () => {
    // `chapter:` sliced the body at 256KB, which cut a long chapter in half.
    // Stated as a test so the cap cannot come back by accident.
    // Comfortably past the 256KB *byte* budget the plain-text path used: Chinese
    // is three bytes per character, so the character count that overflowed it is
    // under 90000. A chapter this size is unusual but real — web novels ship them.
    const body = Array.from({ length: 40_000 }, (_, i) => `第 ${i} 段的内容。`).join('\n');
    assert.ok(body.length > 256 * 1024 / 3, 'fixture must exceed the old character budget');
    const html = renderChapterHtml(body).toString('utf8');
    assert.match(html, /<p>第 39999 段的内容。<\/p>/);
  });

  test('promotes the chapter heading instead of gluing it to the first sentence', () => {
    // `splitChapters` puts the heading in the chapter's own slice, so without this
    // the body reads `第二章 落雨雨来了。` — the title and the first line as one
    // paragraph, which is what a reader reports as "格式乱了".
    const html = renderChapterHtml(['第二章 落雨', '雨来了。'].join('\n')).toString('utf8');
    assert.match(html, /<h3>第二章 落雨<\/h3>/);
    assert.match(html, /<p>雨来了。<\/p>/);
    assert.doesNotMatch(html, /落雨雨来了/);
  });

  test('leaves prose that merely looks like a heading where it is', () => {
    // Only the first line is considered, and only when it is short enough to be a
    // title: a mid-chapter line that mentions a chapter number is a sentence.
    const html = renderChapterHtml(['雨来了。', '他说第二章他看过。'].join('\n')).toString('utf8');
    assert.doesNotMatch(html, /<h3>/);
    assert.match(html, /<p>他说第二章他看过。<\/p>/);
  });

  test('returns utf-8 bytes whose length matches the payload it reports', () => {
    const buffer = renderChapterHtml('中文内容\n\n第二段');
    assert.equal(buffer.toString('utf8').length <= buffer.byteLength, true);
    assert.equal(buffer.byteLength, Buffer.byteLength(buffer.toString('utf8'), 'utf8'));
  });
});
