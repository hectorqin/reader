import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
} from './registry.ts';
import { filenameMetadata } from '../metadata.ts';

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
 */
export const pdfHandler = registerFileHandler({
  format: 'pdf',
  kind: 'document',
  extensions: ['pdf'],
  label: 'PDF（原样下发，由客户端渲染）',

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    const fallback = filenameMetadata(ctx.relPath);
    return {
      format: 'pdf',
      kind: 'document',
      contentHash: createHash('sha256').update(buf).digest('hex'),
      size: buf.byteLength,
      pageCount: null,
      metadata: fallback,
    };
  },

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    return {
      kind: 'document',
      total: 1,
      groups: [{ id: 'document', seq: 0, title: '文档', count: 1 }],
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
    };
  },

  async asset(ctx: HandlerContext): Promise<AssetPayload> {
    return {
      data: await readFile(ctx.absPath),
      contentType: 'application/pdf',
      filename: ctx.relPath.slice(ctx.relPath.lastIndexOf('/') + 1),
    };
  },
});
