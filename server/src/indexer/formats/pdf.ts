import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
  type TocEntry,
} from './registry.ts';
import { filenameMetadata } from '../metadata.ts';
import { AppError } from '../../lib/errors.ts';
import { CHAPTER_WINDOW } from './epub.ts';
import { buildPdfBook, type PdfBook } from './pdf-text.ts';
import { pdfTextFor } from './pdf-text-runner.ts';

/**
 * 增强解析 (`variant: 'enhanced'`): the book's text layer as chapters, built once per
 * extracted text and kept for the last few books. Chapters are published under
 * made-up paths (`pdf/part0003.xhtml`) like a Kindle book's, so links, notes,
 * search and windowing work as they do for an EPUB.
 */
const books = new Map<string, PdfBook>();
async function enhanced(ctx: HandlerContext): Promise<{ key: string; book: PdfBook }> {
  let extracted;
  try {
    extracted = await pdfTextFor(ctx.absPath, ctx.cacheDir);
  } catch (error) {
    throw new AppError(
      422,
      'PDF_TEXT_FAILED',
      `无法提取这本 PDF 的文字：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let book = books.get(extracted.key);
  if (!book) {
    book = buildPdfBook(extracted.text);
    books.set(extracted.key, book);
    while (books.size > 4) books.delete(books.keys().next().value!);
  }
  return { key: extracted.key, book };
}
const partPath = (index: number): string => `pdf/part${String(index).padStart(4, '0')}.xhtml`;

/** The pages as one document, drawn by the client (the `pdfjs` mode, and the fallback for a scan). */
function pagesManifest(ctx: HandlerContext, notice?: string): Manifest {
  return {
    kind: 'document',
    total: 1,
    groups: [{ id: 'document', seq: 0, title: '文档', count: 1, offset: 0 }],
    items: [
      {
        id: 'doc',
        seq: 0,
        title: ctx.relPath.slice(ctx.relPath.lastIndexOf('/') + 1),
        kind: 'chapter',
        mediaType: 'application/pdf',
        href: 'document',
      },
    ],
    ...(notice ? { notice } : {}),
  };
}

/** Nothing is read from the document: it is served as-is. */
async function parsePdfOnDisk(ctx: HandlerContext, file: { size: number; contentHash: string }): Promise<ParsedSource> {
  return {
    format: 'pdf',
    kind: 'document',
    contentHash: file.contentHash,
    size: file.size,
    pageCount: null,
    metadata: filenameMetadata(ctx.relPath),
  };
}

/**
 * PDF — readable, but explicitly not "精排".
 *
 * The server does not interpret page content. A PDF renderer in Node means
 * either a large dependency tree or a native build, both of which raise the
 * deployment bar for the NAS users this product targets. Instead the original
 * bytes are streamed and the client's own PDF surface renders them.
 *
 * The scanner used to guess a page count from `/Count` in the page tree. That
 * regex happily matched an unrelated `/Count` and reported wrong page counts,
 * which corrupts the reader's progress display. Reporting `null` is honest: the
 * client learns the real count once it opens the document.
 *
 * The body is streamed and marked seekable. A scanned manual is easily 100MB;
 * reading it into a Buffer per request would put a handful of concurrent
 * readers on the edge of the heap limit, and Range support is what lets a PDF
 * viewer jump to page 300 without downloading everything before it.
 */
export const pdfHandler = registerFileHandler({
  format: 'pdf',
  kind: 'document',
  extensions: ['pdf'],
  label: 'PDF（原样下发，由客户端渲染）',

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    return parsePdfOnDisk(ctx, { size: buf.byteLength, contentHash: createHash('sha256').update(buf).digest('hex') });
  },

  parseFile: parsePdfOnDisk,

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    if (ctx.variant !== 'enhanced') return pagesManifest(ctx);
    const { key, book } = await enhanced(ctx);
    // A scan has no text to reflow: the pages are the book, and the reader is told why.
    if (!book.hasText) return pagesManifest(ctx, '这本 PDF 没有文字层（可能是扫描版），已按原版页面打开。');
    const { chapters } = book;
    const groups: Manifest['groups'] = [];
    for (let offset = 0; offset < chapters.length; offset += CHAPTER_WINDOW) {
      const count = Math.min(CHAPTER_WINDOW, chapters.length - offset);
      const first = chapters[offset]!.title,
        last = chapters[offset + count - 1]!.title;
      groups.push({
        id: `spine:${offset}`,
        seq: groups.length,
        title: count === 1 ? first : `${first} – ${last}`,
        count,
        offset,
      });
    }
    return {
      kind: 'reflowable',
      // Different text, different chapters: cached windows and chapters of another
      // extraction (or of the pages mode) must not be mixed with these.
      revision: `pdf-text:${key}`,
      total: chapters.length,
      groups,
      items: chapters.map((chapter, seq) => ({
        id: partPath(seq),
        seq,
        title: chapter.title,
        kind: 'chapter' as const,
        mediaType: 'text/html',
        href: `xhtml:${partPath(seq)}`,
        note: `第 ${chapter.page} 页起`,
        page: chapter.page,
      })),
    };
  },

  async toc(ctx: HandlerContext): Promise<TocEntry[]> {
    if (ctx.variant !== 'enhanced') return [{ href: 'document', title: '文档', level: 0, spine: 0 }];
    const { book } = await enhanced(ctx);
    if (!book.hasText) return [{ href: 'document', title: '文档', level: 0, spine: 0 }];
    return book.toc.map((entry) => ({
      href: `xhtml:${partPath(entry.chapter)}${entry.anchor ? `#${entry.anchor}` : ''}`,
      title: entry.title,
      level: entry.level,
      spine: entry.chapter,
    }));
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const chapter = /^(?:xhtml:)?pdf\/part(\d{4,})\.xhtml(?:#.*)?$/.exec(req.ref);
    if (chapter) {
      const { book } = await enhanced(ctx);
      const found = book.chapters[Number(chapter[1])];
      if (!found) throw new AppError(404, 'NOT_FOUND', `chapter not found: ${req.ref}`);
      const body = Buffer.from(found.html, 'utf8');
      return {
        data: body,
        contentType: 'text/html; charset=utf-8',
        filename: `part${chapter[1]}.html`,
        size: body.byteLength,
      };
    }
    const info = await stat(ctx.absPath);
    return {
      stream: createReadStream(ctx.absPath),
      openRange: (start, end) => createReadStream(ctx.absPath, { start, end }),
      contentType: 'application/pdf',
      filename: ctx.relPath.slice(ctx.relPath.lastIndexOf('/') + 1),
      size: info.size,
      seekable: true,
      lastModified: info.mtimeMs,
    };
  },
});
