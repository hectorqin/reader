import { decodeText } from './text-encoding.ts';
import { textToChapterHtml } from './segments.ts';
import type { BookDoc, LoadContext, Section } from './types.ts';

/**
 * Plain-text loader.
 *
 * Two problems worth solving properly, because a TXT library is where a reader
 * either earns trust or loses it:
 *
 * 1. **Encoding.** See text-encoding.ts. This file has no way to know, so it
 *    detects, and it reports what it chose so the UI can let the reader override
 *    it for the one file in a thousand that the heuristic gets wrong.
 *
 * 2. **Chapter splitting.** TXT has no structure at all, so the table of
 *    contents has to be inferred. Getting it wrong in either direction is bad:
 *    too eager and every numbered line becomes a chapter, too timid and a
 *    5000-chapter web novel becomes one endless section that cannot be
 *    navigated or paginated without freezing the device.
 */

/**
 * Chapter headings, ordered from most to least specific.
 *
 * Tuned against the shapes that actually appear in Chinese TXT collections:
 * `第一章`, `第 1 章`, `第1节`, `Chapter 3`, and the bracketed forms that
 * scrapers emit. Each alternative is anchored so a line of prose that merely
 * *mentions* a chapter number ("他在第一章里说过") is not mistaken for a
 * heading.
 */
const CHAPTER_PATTERNS: RegExp[] = [
  // 第一章 标题 / 第1章 / 第一百二十三章
  /^\s*第\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*[章回节卷部篇集]\s*[:：.、\-—]?\s*(.{0,60})$/,
  // Chapter 3 / CHAPTER III
  /^\s*chapter\s+([0-9]+|[ivxlcdm]+)\b\s*[:：.、\-—]?\s*(.{0,60})$/i,
  // 【第一章】标题 / （第一节）标题
  /^\s*[【（(\[]\s*第\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*[章回节卷部篇集]\s*[】）)\]]\s*(.{0,60})$/,
  // 卷一 / 卷二 （bare 卷 heading, common in classic novels)
  /^\s*[卷部]\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*(.{0,60})$/,
];

/**
 * A heading line is short. Without this, a paragraph that starts with "第三章"
 * and continues for 800 characters would be treated as a chapter title and the
 * real chapter body would lose its beginning.
 */
const MAX_HEADING_LENGTH = 80;

export interface TxtOptions {
  /** Force an encoding label such as `gb18030`; detected when omitted. */
  encoding?: string;
  /** Split into chapters. When false the whole book is one section. */
  splitChapters?: boolean;
}

export interface TxtSplitResult {
  doc: BookDoc;
  encoding: string;
  encodingGuessed: boolean;
  chapterCount: number;
}

export function loadTxt(ctx: LoadContext, options: TxtOptions = {}): TxtSplitResult {
  const decoded = options.encoding
    ? { text: decodeWith(ctx.bytes, options.encoding), encoding: options.encoding, guessed: false }
    : decodeText(ctx.bytes);
  const text = normaliseLineEndings(decoded.text);
  const splitChapters = options.splitChapters !== false;

  const lines = text.split('\n');
  const chapters: Array<{ title: string; start: number }> = [];
  let offset = 0;

  if (splitChapters) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length <= MAX_HEADING_LENGTH && matchHeading(trimmed)) {
        chapters.push({ title: trimmed, start: offset });
      }
      offset += line.length + 1;
    }
  }

  const sections: Section[] = [];
  if (chapters.length === 0) {
    // No headings found: either the book simply has none, or the heuristic
    // missed. Either way one giant section is unusable, so fall back to fixed
    // chunks that keep the renderer responsive.
    for (const chunk of chunkByLength(text, 40_000)) {
      sections.push({
        id: `chunk-${sections.length}`,
        label: chunk.label,
        html: textToChapterHtml(chunk.text),
        depth: 0,
      });
    }
  } else {
    if (chapters[0]!.start > 0) {
      const preface = text.slice(0, chapters[0]!.start).trim();
      if (preface.length > 0) {
        sections.push({ id: 'preface', label: '前言', html: textToChapterHtml(preface), depth: 0 });
      }
    }
    for (let index = 0; index < chapters.length; index += 1) {
      const current = chapters[index]!;
      const next = chapters[index + 1];
      const body = text.slice(current.start, next ? next.start : text.length);
      // A chapter of several hundred thousand characters (some web novels have
      // them) still needs splitting, or layout blocks the UI thread.
      const parts = chunkByLength(body, 60_000);
      for (const [partIndex, part] of parts.entries()) {
        sections.push({
          id: `ch${index}-${partIndex}`,
          label: parts.length > 1 ? `${current.title} (${partIndex + 1}/${parts.length})` : current.title,
          html: textToChapterHtml(part.text),
          depth: 0,
        });
      }
    }
  }

  const toc = sections.map((section) => ({ id: section.id, label: section.label, depth: 0 }));

  return {
    encoding: decoded.encoding,
    encodingGuessed: decoded.guessed,
    chapterCount: chapters.length,
    doc: {
      format: 'txt',
      layout: 'reflowable',
      render: 'reflowable',
      direction: 'ltr',
      sections,
      toc,
      styles: [],
      resources: new Map(),
      orderedByBook: chapters.length > 0,
    },
  };
}

function matchHeading(line: string): boolean {
  for (const pattern of CHAPTER_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) return true;
  }
  return false;
}

function decodeWith(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

interface Chunk {
  text: string;
  label: string;
}

/**
 * Splits text into pieces of at most `maxLength` characters, breaking on a
 * paragraph boundary when one is close enough.
 *
 * Breaking mid-paragraph is acceptable; breaking mid-sentence would not be, so
 * the search looks backwards for a blank line first and only then for the end
 * of a paragraph.
 */
export function chunkByLength(text: string, maxLength: number): Chunk[] {
  if (text.length <= maxLength) return [{ text, label: '' }];
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const window = text.slice(start + Math.floor(maxLength * 0.6), end);
      const blank = window.lastIndexOf('\n\n');
      if (blank !== -1) end = start + Math.floor(maxLength * 0.6) + blank + 2;
      else {
        const newline = window.lastIndexOf('\n');
        if (newline !== -1) end = start + Math.floor(maxLength * 0.6) + newline + 1;
      }
    }
    const body = text.slice(start, end);
    if (body.trim().length > 0) chunks.push({ text: body, label: `第 ${index + 1} 段` });
    index += 1;
    start = end;
  }
  return chunks;
}

/**
 * A chapter body as the reader's own paragraph markup.
 *
 * Kept as a named export because the loader has always had one and the name is
 * what the tests look for; the work itself moved to `segments.ts`, which is the
 * single definition of what a paragraph is for a TXT — shared with the server's
 * `chapter-full:` rendition's consumer and with the text reader, so a book cannot
 * be typeset one way locally and another way when it arrives windowed.
 */
export const textToHtml = textToChapterHtml;
