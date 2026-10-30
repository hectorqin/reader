// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  cleanTextMarkup,
  htmlToText,
  isTextOnlyMarkup,
  escapeHtml,
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

  it('starts a new paragraph on an *indented* sentence-final line', () => {
    // The report: "章节txt原文包含换行符，但是客户端没有拆分为多个段落" — the whole
    // chapter came out as one paragraph, in a file where every paragraph is on its
    // own line.
    //
    // The cause was one character class. The continuation test was applied to the
    // line *as written* and its first alternative was `\s`, so a line beginning
    // with the two full-width spaces that essentially every Chinese web novel
    // indents with was classified as "this continues the sentence above" — the
    // boundary rule therefore never fired once, on exactly the files it exists
    // for. It was invisible in this suite because every fixture wrote paragraphs
    // *without* the indent.
    expect(
      splitTextParagraphs(['　　他走了。', '　　她留下了。', '　　天亮了。'].join('\n')).map((p) => p.text),
    ).toEqual(['他走了。', '她留下了。', '天亮了。']);
  });

  it('splits an indented chapter of any indent style the same way', () => {
    // The three ways a converter writes "this is a new paragraph": full-width
    // spaces, ASCII spaces, and the ideographic space mixed with a tab. All three
    // mean the same thing and none of them is a continuation.
    for (const indent of ['　　', '    ', '\t']) {
      expect(splitTextParagraphs([`${indent}他走了。`, `${indent}她留下了。`].join('\n')).map((p) => p.text))
        .toEqual(['他走了。', '她留下了。']);
    }
  });

  it('still joins a wrapped line that is indented like a paragraph', () => {
    // The failure the continuation rule guards the *other* way. A file that
    // indents every paragraph and also hard-wraps long ones has continuation lines
    // that carry the same indentation, so "indented" cannot by itself mean "new
    // paragraph" — it is the sentence-final lookahead that decides, and the indent
    // is only *not allowed to veto* it.
    expect(splitTextParagraphs(['　　他走了，', '　　没有回头，', '　　也没有说话。'].join('\n'))[0]!.text)
      .toBe('他走了，没有回头，也没有说话。');
  });

  it('does not let the indent be counted as the continuation punctuation', () => {
    // A line that begins with the closing quote *of the sentence above* is a
    // continuation, indented or not: the punctuation test has to see the content,
    // not the whitespace before it.
    expect(splitTextParagraphs(['　　他走了。', '　　」她接着说。'].join('\n'))[0]!.text)
      .toBe('他走了。」她接着说。');
  });

  it('normalises CRLF and a lone CR, so a Windows file is not one paragraph', () => {
    expect(splitTextParagraphs('一段\r\n\r\n二段').map((p) => p.text)).toEqual(['一段', '二段']);
    expect(splitTextParagraphs('他走了。\r她留下了。').map((p) => p.text)).toEqual(['他走了。', '她留下了。']);
  });

  it('counts a full-width space as one character of indent', () => {
    // The count is in *characters*, not bytes and not code units, because what a
    // caller can do with it is compare it: two ideographic spaces is the
    // conventional Chinese indent and four ASCII ones is the other convention, and
    // the two are distinguishable only if each counts as itself.
    const [indented] = splitTextParagraphs('　　Two ideographic spaces.');
    expect(indented!.leading).toBe(2);
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
    // Known page tags (`<img>`, `<b>`) are cleaned away as web-page residue; any
    // other markup is escaped. Neither path can produce an element.
    const html = textToParagraphHtml('<img src=x onerror=alert(1)>\n\n<b>粗</b>\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script');
    expect(html).toContain('粗');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
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
 * TXT files saved from a web page still carry its markup. Escaped, the tags are
 * drawn as text and every `<br/>` line becomes a gap, so they are cleaned before
 * paragraphs are inferred.
 */
describe('web-page markup in a TXT', () => {
  const scraped = '<div>\n    天斗星作为第一颗被人类发现并且移民成功的行政星，距今已经有数千年的历史了。<br/>\n    <br/>\n    <br/>\n    <br/>\n    这颗星球大约有原本斗罗星二分之一大。<br/>\n</div>';

  it('turns the scraped block into clean paragraphs with no tags or gaps', () => {
    expect(splitTextParagraphs(scraped).map((p) => p.text)).toEqual([
      '天斗星作为第一颗被人类发现并且移民成功的行政星，距今已经有数千年的历史了。',
      '这颗星球大约有原本斗罗星二分之一大。',
    ]);
  });

  it('renders no literal tags and no empty paragraphs', () => {
    const html = textToChapterHtml(scraped);
    expect(html).not.toMatch(/&lt;|<br|<div>\s*<\/div>|<p><\/p>/);
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it('keeps a heading that follows the markup', () => {
    expect(splitChapterHeading('<div>\n第一章 天斗星<br/>\n正文。</div>').heading).toBe('第一章 天斗星');
  });

  it('drops inline tags, decodes entities and leaves prose angle brackets alone', () => {
    expect(cleanTextMarkup('<p>他说&ldquo;<span style="x">好</span>&rdquo;&nbsp;a&lt;b&#65281;</p>')).toBe('\n他说“好” a<b！\n');
    expect(cleanTextMarkup('如果 a<b 且 <书名> 未知')).toBe('如果 a<b 且 <书名> 未知');
    expect(cleanTextMarkup(cleanTextMarkup(scraped))).toBe(cleanTextMarkup(scraped));
  });
});

/** A book source's chapter is a scraped HTML fragment; legado-E reads it as text. */
describe('book-source HTML chapters', () => {
  const fragment = '<div>    天斗星作为第一颗行政星。<br /><br /><br /><br />    星球表面本来是没有生物的。<br /><br /></div>';

  it('reads a text-only fragment back into the paragraphs it meant', () => {
    expect(splitTextParagraphs(htmlToText(fragment)).map((p) => p.text)).toEqual(['天斗星作为第一颗行政星。', '星球表面本来是没有生物的。']);
  });

  it('strips every tag but keeps escaped angle brackets as text', () => {
    expect(htmlToText('<p>a&lt;b&gt;<custom-tag x>c</custom-tag><!-- ad --><script>bad()</script></p>')).toBe('\na<b>c\n');
  });

  it('keeps chapters with images or tables as markup', () => {
    expect(isTextOnlyMarkup(fragment)).toBe(true);
    expect(isTextOnlyMarkup('<p>图</p><img src="x">')).toBe(false);
    expect(isTextOnlyMarkup('<table><tr><td>1</td></tr></table>')).toBe(false);
  });
});
