// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  endsAtParagraphBreak,
  escapeHtml,
  paragraphElement,
  splitChapterHeading,
  splitTextParagraphs,
  textToChapterHtml,
  textToParagraphHtml,
} from '../src/formats/segments.ts';

/**
 * The client-side TXT typesetting.
 *
 * Every one of these is a shape that actually appears in a TXT library, and the
 * failure mode of each is a book that looks wrong in a way that no error message
 * mentions: a scraper's indentation stacked on top of the reader's indent, a
 * paragraph chopped in half at a line the source wrapped, or a whole novel drawn as
 * one slab because the file had no blank lines.
 */
describe('splitTextParagraphs', () => {
  it('treats a blank line as a paragraph break', () => {
    expect(splitTextParagraphs('第一段\n\n第二段').map((p) => p.text)).toEqual(['第一段', '第二段']);
  });

  it('joins a hard-wrapped line rather than splitting there and leaving a gap', () => {
    // The common shape in a scraped novel: the source wrapped at some column. The
    // newline is not information, and keeping it would draw a gap inside a
    // paragraph that grows with the reader's font size.
    expect(splitTextParagraphs('这句被硬换行了\n但仍然是同一段')[0]!.text).toBe('这句被硬换行了但仍然是同一段');
  });

  it('starts a new paragraph at a sentence-final line with no blank line', () => {
    // The other common shape: every paragraph on its own line, no blank lines at
    // all. Without this rule the book is one slab.
    expect(splitTextParagraphs('他走了。\n她留下了。\n天亮了。').map((p) => p.text))
      .toEqual(['他走了。', '她留下了。', '天亮了。']);
  });

  it('does not split a continuation line that merely starts with punctuation', () => {
    expect(splitTextParagraphs('他走了。\n，她没有回头。')[0]!.text).toBe('他走了。，她没有回头。');
    expect(splitTextParagraphs('他走了。\n」她说。')[0]!.text).toBe('他走了。」她说。');
  });

  it('normalises CRLF and a lone CR, so a Windows file is not one paragraph', () => {
    expect(splitTextParagraphs('一段\r\n\r\n二段').map((p) => p.text)).toEqual(['一段', '二段']);
    expect(splitTextParagraphs('他走了。\r她留下了。').map((p) => p.text)).toEqual(['他走了。', '她留下了。']);
  });

  it('removes the leading whitespace a scraper wrote, and reports how much', () => {
    // What "段前空格" is: the full-width spaces a converter indented with. Kept,
    // they are indent *added to* the reader's own indent, and the setting appears
    // to do nothing on exactly the files that needed it.
    const [paragraph] = splitTextParagraphs('　　这是被缩进过的一段。');
    expect(paragraph!.text).toBe('这是被缩进过的一段。');
    expect(paragraph!.leading).toBe(2);

    const [ascii] = splitTextParagraphs('   缩进用了半角空格。');
    expect(ascii!.text).toBe('缩进用了半角空格。');
    expect(ascii!.leading).toBe(3);
  });

  it('drops whitespace-only blocks rather than drawing blank paragraphs', () => {
    expect(splitTextParagraphs('\n\n\n\n一段\n\n\n').map((p) => p.text)).toEqual(['一段']);
    expect(splitTextParagraphs('   \n\n   ')).toEqual([]);
    expect(splitTextParagraphs('')).toEqual([]);
  });
});

describe('the markup form', () => {
  it('escapes a file that contains markup', () => {
    // A TXT is user data: a novel with a `<` in it must not be able to produce an
    // element, and `escapeHtml` is the one place that decides so.
    const html = textToParagraphHtml('<img src=x onerror=alert(1)>\n\n<b>粗</b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`a & b "c" 'd'`)).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
  });

  it('wraps a chapter in the class the client scopes its rules to', () => {
    // The wrapper is what keeps an EPUB chapter — which may have its own idea of an
    // indent — out of the plain-text rules, and it has to travel with the markup
    // rather than be added by whoever renders it, because the server's rendition
    // carries it too.
    expect(textToChapterHtml('一段')).toMatch(/^<div class="txt-body">\n<p>一段<\/p>\n<\/div>\n$/);
  });

  it('promotes the chapter title instead of gluing it to the first sentence', () => {
    // Chapter splitting records the heading as the chapter's *first line* — that is
    // what makes a saved position land on the title rather than one line in. Rendered
    // as ordinary prose it reads `第二章 落雨雨来了。`: title and first sentence as one
    // paragraph, which is what a reader reports as "格式乱了".
    const html = textToChapterHtml(['第二章 落雨', '雨来了。'].join('\n'));
    expect(html).toContain('<h3>第二章 落雨</h3>');
    expect(html).toContain('<p>雨来了。</p>');
    expect(html).not.toContain('落雨雨来了');
  });

  it('leaves prose that merely looks like a heading where it is', () => {
    // Only the *first* line is considered, and only when it is short enough to be a
    // title. A mid-chapter line that mentions a chapter number is a sentence, and
    // promoting it would restructure the book rather than render it.
    const html = textToChapterHtml(['雨来了。', '他说第二章他看过。'].join('\n'));
    expect(html).not.toContain('<h3>');
    expect(html).toContain('<p>他说第二章他看过。</p>');
  });

  it('uses textContent for the node form, so the DOM is the escaper', () => {
    const element = paragraphElement({ text: '<b>不是标签</b>', leading: 0 });
    expect(element.tagName).toBe('P');
    expect(element.textContent).toBe('<b>不是标签</b>');
    expect(element.querySelector('b')).toBeNull();
  });
});

describe('splitChapterHeading', () => {
  it('splits the heading off the body and reports both', () => {
    // The pair, not just the heading: the body is what the paragraph split then
    // works on, and returning only the heading would leave the caller to find the
    // boundary again — a second copy of the rule, which is how the server's copy and
    // the client's came to disagree in the first place.
    expect(splitChapterHeading(['第一章 起点', '正文。'].join('\n'))).toEqual({
      heading: '第一章 起点',
      body: '正文。',
    });
  });

  it('skips leading blank lines before looking for the heading', () => {
    expect(splitChapterHeading('\n\n第二章 落雨\n正文。').heading).toBe('第二章 落雨');
  });

  it('reports no heading for a body that has none', () => {
    expect(splitChapterHeading('正文只有这一段。')).toEqual({
      heading: '',
      body: '正文只有这一段。',
    });
  });

  it('does not promote a long line that merely starts with a chapter number', () => {
    // The length cap is what keeps a paragraph that *starts* with `第三章` from being
    // read as a title, which would move the real body's first line into a heading.
    const prose = `第三章他记得很清楚，${'那天的雨下得很大，'.repeat(8)}`;
    expect(splitChapterHeading(prose).heading).toBe('');
  });
});

/**
 * Streaming across chunk boundaries.
 *
 * `render/text.ts` splits each 256KB chunk as it arrives, and both of the split's
 * rules look at the *next* line to decide — so a chunk boundary that lands inside a
 * paragraph would otherwise become a spurious paragraph break, one extra indent
 * somewhere in the middle of a novel. The fix is the carry: the last paragraph of a
 * chunk is held back until the chunk that continues it arrives.
 *
 * The arithmetic is asserted here rather than through the reader, because the
 * reader needs a DOM, a scroll container and a fetch to reach it, and the part that
 * goes wrong is the predicate.
 */
describe('chunk boundaries and the carry', () => {
  const endsAtBreak = endsAtParagraphBreak;

  const settle = (text: string): { settled: string[]; rest: string } => {
    const split = splitTextParagraphs(text);
    if (endsAtBreak(text)) return { settled: split.map((p) => p.text), rest: '' };
    return { settled: split.slice(0, -1).map((p) => p.text), rest: split[split.length - 1]?.text ?? '' };
  };

  it('holds back a paragraph that the next chunk continues', () => {
    // The boundary landed mid-sentence: emitting the tail here would draw a
    // paragraph break that the file does not have.
    expect(settle('第一段。\n\n第二段')).toEqual({ settled: ['第一段。'], rest: '第二段' });
  });

  it('emits everything when the chunk ends at a paragraph break', () => {
    expect(settle('第一段。\n\n第二段。\n')).toEqual({ settled: ['第一段。', '第二段。'], rest: '' });
  });

  it('carries the whole chunk when it has no complete paragraph yet', () => {
    expect(settle('第一段')).toEqual({ settled: [], rest: '第一段' });
  });

  it('reassembles the same paragraphs as one pass over the whole text', () => {
    // The property that matters: however the text is cut, what is drawn is what a
    // single split would have drawn.
    const whole = '他走了。\n\n她留下了。\n天亮了。\n\n风停了。';
    const cuts = ['他走了。\n\n她留', '下了。\n天亮', '了。\n\n风停了。'];

    const drawn: string[] = [];
    let carry = '';
    for (const cut of cuts) {
      const { settled, rest } = settle(carry + cut);
      drawn.push(...settled);
      carry = rest;
    }
    drawn.push(...settle(`${carry}\n\n`).settled);

    expect(drawn).toEqual(splitTextParagraphs(whole).map((p) => p.text));
  });
});
