// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isNoteReference, noteAt, noteInMarkup } from '../src/ui/footnote.ts';

function body(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function link(html: string): Element {
  return body(html).querySelector('a')!;
}

describe('isNoteReference', () => {
  it('believes the book when it says so, in either direction', () => {
    expect(isNoteReference(link('<a epub:type="noteref" href="#n1">see the note</a>'))).toBe(true);
    expect(isNoteReference(link('<a role="doc-noteref" href="#n1">note</a>'))).toBe(true);
    expect(isNoteReference(link('<a role="doc-backlink" href="#r1">1</a>'))).toBe(false);
  });

  it('recognises a reference by how it is set', () => {
    for (const html of [
      '<sup><a href="#n1">1</a></sup>',
      '<a href="#n1"><sup>12</sup></a>',
      '<a href="#n1">[3]</a>',
      '<a href="#n1">①</a>',
      '<a href="#n1">（注2）</a>',
      '<a href="#n1">*</a>',
      '<a class="duokan-footnote" href="#n1"><img src="note.png"></a>',
    ])
      expect(isNoteReference(link(html)), html).toBe(true);
  });

  it('leaves cross-references and ways back as links', () => {
    for (const html of [
      '<a href="#s3">参见第三节</a>',
      '<a href="#fig2">Figure 2</a>',
      '<a href="#r1">↩</a>',
      '<a href="#r1">返回正文</a>',
    ])
      expect(isNoteReference(link(html)), html).toBe(false);
  });
});

describe('noteAt', () => {
  it('reads a declared footnote, dropping its way back', () => {
    const root = body('<aside id="n1" epub:type="footnote"><p>第一段。</p><p>第二段。<a href="#r1">↩</a></p></aside>');
    expect(noteAt(root, 'n1')).toEqual(['第一段。', '第二段。']);
  });

  it('takes the block around an anchor that only marks the start of the note', () => {
    expect(noteAt(body('<p><a id="n1" href="#r1">[1]</a> 注释正文。</p>'), 'n1')).toEqual(['[1] 注释正文。']);
    expect(noteAt(body('<ol><li><a name="n2"></a>列表里的注释。</li></ol>'), 'n2')).toEqual(['列表里的注释。']);
  });

  it('finds an id the reference percent-encoded', () => {
    expect(noteAt(body('<p id="注1">内容</p>'), encodeURIComponent('注1'))).toEqual(['内容']);
  });

  it('answers null for a place in running text, a heading, a section and a missing target', () => {
    expect(noteAt(body('<p>很长的一句正文在引用标记之前<a id="r1" href="#n1">[1]</a>之后。</p>'), 'r1')).toBeNull();
    expect(noteAt(body('<h2 id="s3">第三节</h2>'), 's3')).toBeNull();
    expect(noteAt(body(`<div id="big"><p>${'字'.repeat(1600)}</p></div>`), 'big')).toBeNull();
    expect(noteAt(body('<p id="n1">内容</p>'), 'n9')).toBeNull();
  });
});

describe('noteInMarkup', () => {
  it('reads a note out of a chapter that is not on screen, as text only', () => {
    const chapter =
      '<html><body><h1>注释</h1><p id="n12"><a href="ch1.xhtml#r12">12</a> 书后的<b>注释</b><script>alert(1)</script>。</p></body></html>';
    expect(noteInMarkup(chapter, 'n12')).toEqual(['12 书后的注释。']);
  });
});
