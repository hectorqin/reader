import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { contentTypeFor } from './image-types.ts';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
  type TocEntry,
} from './registry.ts';
import { filenameMetadata } from '../metadata.ts';

/**
 * Plain text and Markdown.
 *
 * Two things make this more than a `readFile().toString()`:
 *
 *  1. **Encoding.** A large share of Chinese `.txt` novels on disk are GBK or
 *     GB18030. Decoding those as UTF-8 yields a wall of replacement characters,
 *     and there is no recovering it downstream. We therefore try UTF-8 strictly
 *     first (an invalid byte sequence throws) and only then fall back, so valid
 *     UTF-8 is never misread as GB18030.
 *
 *  2. **Chapter splitting.** A 20MB novel with no navigation is unusable on a
 *     phone. The widely used `第N章` headings give us a real table of contents.
 *
 * Markdown is registered too, but the scanner's allowlist keeps README-style
 * files out of the library by default (see `TEXT_EXTENSIONS`).
 */

/** Chunk size for offset-based reads. Bounded so one request cannot exhaust memory. */
const DEFAULT_CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * Chapter heading patterns. Kept deliberately narrow: a false positive inserts a
 * bogus entry into the reader's table of contents, which is more annoying than
 * missing a chapter, and the line length cap below already filters most prose.
 */
const CHAPTER_PATTERNS: readonly RegExp[] = [
  /^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷篇集]\s*.{0,60}$/,
  /^\s*(?:序章|序言|楔子|引子|前言|后记|尾声|终章|番外|附录)\s*.{0,40}$/,
  /^\s*Chapter\s*\d+.*$/i,
  /^\s*#{1,3}\s+.+$/,
];

/**
 * The asset reference prefix for a chapter rendered as markup.
 *
 * A second prefix rather than a new `kind` on the manifest: the reference is
 * opaque and format-specific by design, so a client that does not understand
 * `chapter-html:` keeps working through `chapter:` unchanged.
 */
const CHAPTER_HTML_REF = 'chapter-html:';

/** A heading has to be short; a 200-character line is prose, not a title. */
const MAX_HEADING_LENGTH = 60;

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'utf-16le' | 'gb18030';
}

/**
 * Decode a text buffer, preferring UTF-8 and only falling back on failure.
 * Byte order marks are trusted outright — they are an explicit declaration.
 */
export function decodeTextBuffer(buf: Buffer): DecodedText {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf-16le' };
  }

  try {
    // `fatal: true` is what makes the fallback safe: without it every invalid
    // byte becomes U+FFFD and we would never know the file was not UTF-8.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'utf-8' };
  } catch {
    // GB18030 is a superset of GBK and GB2312, covering essentially every
    // Chinese text file in the wild.
    return { text: new TextDecoder('gb18030').decode(buf), encoding: 'gb18030' };
  }
}

export interface Chapter {
  title: string;
  /** Inclusive line range within the decoded text. */
  startLine: number;
  endLine: number;
}

export interface SplitResult {
  chapters: Chapter[];
  lines: string[];
}

/** Split decoded text into chapters by scanning headings line by line. */
export function splitChapters(text: string): SplitResult {
  const lines = text.split(/\r\n|\r|\n/);
  const chapters: Chapter[] = [];
  let open: { title: string; startLine: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    const isHeading =
      trimmed.length > 0 &&
      trimmed.length <= MAX_HEADING_LENGTH &&
      CHAPTER_PATTERNS.some((pattern) => pattern.test(trimmed));

    if (!isHeading) continue;

    if (open) {
      chapters.push({ title: open.title, startLine: open.startLine, endLine: i - 1 });
    }
    open = { title: trimmed, startLine: i };
  }

  if (open) chapters.push({ title: open.title, startLine: open.startLine, endLine: lines.length - 1 });
  return { chapters, lines };
}

export async function readTextFile(absPath: string): Promise<DecodedText> {
  return decodeTextBuffer(await readFile(absPath));
}

function looksChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text.slice(0, 4096));
}

export const textHandler = registerFileHandler({
  format: 'txt',
  kind: 'text',
  extensions: ['txt'],
  label: '纯文本（自动识别编码并分章）',

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    const { text, encoding } = decodeTextBuffer(buf);
    const fallback = filenameMetadata(ctx.relPath);
    const { chapters } = splitChapters(text);

    return {
      format: 'txt',
      kind: 'text',
      contentHash: createHash('sha256').update(buf).digest('hex'),
      size: buf.byteLength,
      // Only report a count we actually know. Zero chapters means "no headings
      // found", which the client handles by reading the raw stream.
      pageCount: chapters.length > 0 ? chapters.length : null,
      metadata: {
        ...fallback,
        language: fallback.language || (looksChinese(text) ? 'zh' : ''),
        raw: {
          ...fallback.raw,
          encoding,
          bytes: buf.byteLength,
          chars: text.length,
          chapterCount: chapters.length,
        },
      },
    };
  },

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const { text } = await readTextFile(ctx.absPath);
    const { chapters } = splitChapters(text);

    return {
      kind: 'text',
      total: chapters.length,
      groups: chapters.length > 0
        ? [{ id: 'chapters', seq: 0, title: '章节', count: chapters.length, offset: 0 }]
        : [],
      items: chapters.map((chapter, index) => ({
        id: `c${index}`,
        seq: index,
        title: chapter.title,
        kind: 'chapter' as const,
        // The item is a *document* as far as a reader is concerned even though the
        // bytes are characters: the client turns it into one, and saying so here is
        // what stops the client from having to special-case the text format. The
        // reference stays `chapter:<n>` so a position saved before this field
        // existed still resolves; `format` tells the client which rendition to ask
        // for (see `ContentItem.format`), and `html` now means "the whole chapter,
        // to be typeset" rather than "server-rendered markup".
        mediaType: 'text/plain; charset=utf-8',
        href: `chapter:${index}`,
        format: 'html' as const,
      })),
    };
  },

  /** The chapters the heading scan found, in order. */
  async toc(ctx: HandlerContext): Promise<TocEntry[]> {
    const { text } = await readTextFile(ctx.absPath);
    return splitChapters(text).chapters.map((chapter, index) => ({
      href: `chapter:${index}`,
      title: chapter.title,
      level: 0,
      spine: index,
    }));
  },

  /**
   * Body text. Three addressing modes, because clients need all three:
   *   - `chapter-html:<n>` one whole chapter, as the characters it is stored as
   *   - `chapter:<n>` the same chapter, capped at `size` (a streaming window)
   *   - `chunk:<byteOffset>` for streaming a novel with no headings
   *
   * Not one of them carries the reader's typography, and not one of them carries
   * paragraph boundaries either. `chapter-html:` used to render `<p>` markup on
   * the server; it no longer does, because paragraph splitting is a *reading*
   * decision (see `web/src/formats/segments.ts`) and doing it here meant the
   * windowed path got paragraphs while the streamed path could not, and meant the
   * reader's indent was a round trip. What the server owes the reader is the
   * chapter entire; the client typesets it.
   *
   * `chapter-html:` is therefore now an alias for the whole chapter as plain
   * characters, with the one difference that it is *not* capped: `chapter:` bounds
   * its reply because it is a window for streaming, and bounding a chapter the
   * reader is about to read would hand them a chapter that stops mid-sentence.
   */
  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const size = Math.min(MAX_CHUNK_BYTES, DEFAULT_CHUNK_BYTES);
    const { text } = await readTextFile(ctx.absPath);

    // The whole chapter, uncapped. See the method comment: `chapter:` bounds its
    // reply because it is a streaming window, and that bound must not be applied
    // to a chapter the reader is about to read in one piece.
    if (req.ref.startsWith(CHAPTER_HTML_REF)) {
      const index = Number.parseInt(req.ref.slice(CHAPTER_HTML_REF.length), 10);
      const { chapters, lines } = splitChapters(text);
      const chapter = chapters[index];
      if (!chapter) throw new Error(`chapter ${index} is out of range`);
      const body = lines.slice(chapter.startLine, chapter.endLine + 1).join('\n');
      return {
        data: Buffer.from(body, 'utf8'),
        // Plain characters, not `text/html`. The content type has to say what the
        // body is: served as HTML, a chapter whose text happens to contain `<`
        // would be parsed as markup by anything that trusted the label, and the
        // client's own escaping — the thing that makes a TXT safe — would be
        // sidestepped. The client typesets from this text; it does not trust it.
        contentType: 'text/plain; charset=utf-8',
        size: Buffer.byteLength(body, 'utf8'),
      };
    }

    if (req.ref.startsWith('chapter:')) {
      const index = Number.parseInt(req.ref.slice('chapter:'.length), 10);
      const { chapters, lines } = splitChapters(text);
      const chapter = chapters[index];
      if (!chapter) throw new Error(`chapter ${index} is out of range`);
      const body = lines.slice(chapter.startLine, chapter.endLine + 1).join('\n').slice(0, size);
      return {
        data: Buffer.from(body, 'utf8'),
        contentType: 'text/plain; charset=utf-8',
        size: Buffer.byteLength(body, 'utf8'),
      };
    }

    if (req.ref.startsWith('chunk:')) {
      // Offsets are character offsets, which is what the client can count as it
      // appends text. `size` is the BODY's byte length, not the character count:
      // a chunk of Chinese is three bytes per character, and reporting the
      // character count as a content-length would truncate the response.
      const offset = Math.max(0, Number.parseInt(req.ref.slice('chunk:'.length), 10) || 0);
      const body = text.slice(offset, offset + size);
      return {
        data: Buffer.from(body, 'utf8'),
        contentType: 'text/plain; charset=utf-8',
        size: Buffer.byteLength(body, 'utf8'),
      };
    }

    // Whole file. Streamed and seekable: a 20MB novel is fine in memory, but the
    // download path is also what a client uses to cache a book for offline
    // reading, and Range support makes a resumed download possible.
    const info = await stat(ctx.absPath);
    return {
      stream: createReadStream(ctx.absPath),
      contentType: contentTypeFor(ctx.relPath, 'text/plain; charset=utf-8'),
      size: info.size,
      seekable: true,
      lastModified: info.mtimeMs,
    };
  },
});
