import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { imageContentType, isImageExtension } from './image-types.ts';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
} from './registry.ts';
import { filenameMetadata } from '../metadata.ts';

/**
 * A loose image file treated as a one-page book.
 *
 * Comic directories already cover the folder case; this handler exists so that
 * a stray `cover.jpg` or a single-page scan is still reachable rather than
 * silently ignored by the walk. It is registered last so the specific formats
 * (epub, cbz, txt, pdf) claim their extensions first.
 */
export const imageHandler = registerFileHandler({
  format: 'image',
  kind: 'single-image',
  extensions: [
    'jpg',
    'jpeg',
    'jpe',
    'png',
    'gif',
    'webp',
    'bmp',
    'avif',
    'tif',
    'tiff',
    'jxl',
  ],
  label: '单张图片（按单页读物处理）',

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    const fallback = filenameMetadata(ctx.relPath);
    return {
      format: 'image',
      kind: 'single-image',
      contentHash: createHash('sha256').update(buf).digest('hex'),
      size: buf.byteLength,
      pageCount: 1,
      cover: { data: buf, contentType: imageContentType(ctx.relPath) },
      metadata: fallback,
    };
  },

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    return {
      kind: 'single-image',
      total: 1,
      groups: [{ id: 'page', seq: 0, title: '第 1 页', count: 1 }],
      items: [
        {
          id: 'p0',
          seq: 0,
          title: ctx.relPath.slice(ctx.relPath.lastIndexOf('/') + 1),
          kind: 'page',
          mediaType: imageContentType(ctx.relPath),
          href: 'page:0',
        },
      ],
    };
  },

  async asset(ctx: HandlerContext): Promise<AssetPayload> {
    return {
      data: await readFile(ctx.absPath),
      contentType: imageContentType(ctx.relPath),
      filename: ctx.relPath.slice(ctx.relPath.lastIndexOf('/') + 1),
    };
  },
});

void isImageExtension;
