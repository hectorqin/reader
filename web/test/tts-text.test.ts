// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectSpokenChunks, splitSentence, ChunkCursor } from '../src/render/tts-text.ts';

/**
 * Sentence chunking.
 *
 * This is the part of read-aloud that decides *what is said next*, so every
 * assertion here is really about a behaviour a reader would notice: a sentence
 * that is cut in half sounds broken, and a paragraph that is not cut at all
 * makes the synthesizer stutter or stop.
 */

describe('splitSentence', () => {
  it('splits on Chinese full-width stops', () => {
    const pieces = splitSentence('他来了。她走了！然后呢？');
    expect(pieces.map((piece) => piece.text)).toEqual(['他来了。', '她走了！', '然后呢？']);
  });

  it('keeps the offset of every piece inside the original node', () => {
    const text = '第一句。第二句。';
    for (const piece of splitSentence(text)) {
      expect(text.slice(piece.start, piece.start + piece.text.length)).toBe(piece.text);
    }
  });

  it('does not split a decimal number', () => {
    expect(splitSentence('圆周率是 3.14 左右。')).toHaveLength(1);
  });

  it('does not split an abbreviation', () => {
    const pieces = splitSentence('Dr. Smith arrived. He was late.');
    // The trailing space belongs to the sentence being spoken only for tidiness;
    // what matters is that "Dr." was not cut off from the name that follows it.
    expect(pieces.map((piece) => piece.text.trim())).toEqual(['Dr. Smith arrived.', 'He was late.']);
  });

  it('keeps a closing quote with the sentence it closes', () => {
    const pieces = splitSentence('他说：“好的。”然后走了。');
    expect(pieces.map((piece) => piece.text)).toEqual(['他说：“好的。”', '然后走了。']);
  });

  it('treats a run of terminators as one ending', () => {
    expect(splitSentence('什么？！').map((piece) => piece.text)).toEqual(['什么？！']);
  });

  it('cuts an unpunctuated run at the ceiling instead of emitting one huge utterance', () => {
    const long = 'あ'.repeat(1000);
    const pieces = splitSentence(long, 300);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.text.length).toBeLessThanOrEqual(300);
    expect(pieces.map((piece) => piece.text).join('')).toBe(long);
  });

  it('drops whitespace-only pieces rather than speaking silence', () => {
    expect(splitSentence(' \n ')).toEqual([]);
  });
});

describe('collectSpokenChunks', () => {
  function chunksFor(html: string): ReturnType<typeof collectSpokenChunks> {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.append(root);
    return collectSpokenChunks(root, (node) => {
      const block = [...root.children].find((child) => child.contains(node));
      return block ? [...root.children].indexOf(block) : 0;
    });
  }

  it('walks paragraphs in document order', () => {
    const chunks = chunksFor('<p>第一段。</p><p>第二段。</p>');
    expect(chunks.map((chunk) => chunk.text)).toEqual(['第一段。', '第二段。']);
  });

  it('reports the block index each sentence belongs to', () => {
    const chunks = chunksFor('<p>甲。乙。</p><p>丙。</p>');
    expect(chunks.map((chunk) => chunk.blockIndex)).toEqual([0, 0, 1]);
  });

  it('skips ruby annotations, which are not read on their own', () => {
    // A ruby base and the text after it are separate text nodes, so they come
    // back as separate pieces. What matters is that the reading (かん) is never
    // spoken, which is the behaviour a reader would notice immediately.
    const chunks = chunksFor('<p><ruby>漢<rt>かん</rt></ruby>字。</p>');
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('漢字。');
    expect(chunks.some((chunk) => chunk.text.includes('かん'))).toBe(false);
  });

  it('skips code blocks', () => {
    expect(chunksFor('<pre>const a = 1;</pre>')).toHaveLength(0);
  });

  it('points each sentence at the text node it came from', () => {
    const chunks = chunksFor('<p>一句话。</p>');
    expect(chunks[0]?.node?.data).toBe('一句话。');
    expect(chunks[0]?.start).toBe(0);
  });
});

describe('ChunkCursor', () => {
  const chunks = ['a', 'b', 'c'].map((text, index) => ({
    text,
    node: null,
    start: 0,
    blockIndex: index,
  }));

  it('advances and stops at the end instead of wrapping', () => {
    const cursor = new ChunkCursor();
    cursor.reset(chunks, 0);
    expect(cursor.current?.text).toBe('a');
    expect(cursor.next()?.text).toBe('b');
    expect(cursor.next()?.text).toBe('c');
    expect(cursor.next()).toBeNull();
  });

  it('does not move before the first chunk', () => {
    const cursor = new ChunkCursor();
    cursor.reset(chunks, 0);
    expect(cursor.previous()).toBeNull();
    expect(cursor.index).toBe(0);
  });

  it('clamps a reset index past the end', () => {
    const cursor = new ChunkCursor();
    cursor.reset(chunks, 99);
    expect(cursor.index).toBe(2);
  });

  it('reports no current chunk for an empty queue', () => {
    const cursor = new ChunkCursor();
    cursor.reset([], 0);
    expect(cursor.current).toBeNull();
    expect(cursor.next()).toBeNull();
  });
});
