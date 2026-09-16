import { detectFormat } from './detect.ts';
import { loadEpub } from './epub.ts';
import { loadTxt, type TxtOptions } from './txt.ts';
import { loadCbz, loadComicDirectory, isImagePath } from './comic.ts';
import { loadPdf } from './pdf.ts';
import { extensionOf } from './zip.ts';
import type { BookDoc, LoadContext } from './types.ts';

export type { BookDoc, BookFormat, LoadContext, Section, TocEntry, Layout, Resource } from './types.ts';
export { loadEpub } from './epub.ts';
export { loadTxt } from './txt.ts';
export { loadCbz, loadComicDirectory, isImagePath } from './comic.ts';
export { loadPdf } from './pdf.ts';
export { detectFormat } from './detect.ts';
export { extensionOf } from './zip.ts';

/**
 * Format dispatch.
 *
 * A plain switch rather than a plugin registry: there are six formats and the
 * set is decided by what readers have on disk, not by third-party extension.
 * Adding a format means adding a case and a loader — nothing else in the client
 * changes, which is the property that actually matters.
 */

export interface LoadOptions extends TxtOptions {
  /** File name from the manifest, used to disambiguate formats. */
  fileName?: string;
  /** Directory-comic page list, resolved from the book manifest. */
  comicPages?: string[];
  resolvePage?: (path: string) => Promise<Uint8Array>;
}

export interface LoadedBook {
  doc: BookDoc;
  /** Diagnostics worth surfacing: TXT encoding chosen, chapter count, etc. */
  notes: string[];
}

export async function loadBook(ctx: LoadContext, options: LoadOptions = {}): Promise<LoadedBook> {
  const format = resolveFormat(ctx, options);

  switch (format) {
    case 'epub':
      return { doc: await loadEpub(ctx), notes: [] };
    case 'txt': {
      const result = loadTxt(ctx, options);
      const notes: string[] = [];
      if (result.encodingGuessed) {
        notes.push(`按 ${result.encoding} 解码（文件未声明编码，若显示乱码可在设置中切换）`);
      }
      if (result.chapterCount === 0) {
        notes.push('未识别到章节标记，已按长度分段');
      }
      return { doc: result.doc, notes };
    }
    case 'cbz':
      return { doc: await loadCbz(ctx), notes: [] };
    case 'comic-dir': {
      if (!options.comicPages || options.comicPages.length === 0) {
        throw new Error('漫画目录中没有可用图片');
      }
      const resolve = options.resolvePage ?? (async () => new Uint8Array());
      return { doc: await loadComicDirectory(options.comicPages, resolve), notes: [] };
    }
    case 'pdf':
      return { doc: await loadPdf(), notes: [] };
    default:
      throw new Error(`不支持的格式：${ctx.fileName || '未知文件'}`);
  }
}

/**
 * Chooses the loader.
 *
 * Detection by sniffing and extension covers single-file books. One case cannot
 * be detected that way: a comic stored as a *directory* has no single file to
 * sniff, and its "file name" is a folder. The caller recognises it from the
 * manifest's page list and passes that in, and it has to win over the extension.
 */
function resolveFormat(ctx: LoadContext, options: LoadOptions): string {
  const name = options.fileName ?? ctx.fileName;
  const pages = options.comicPages?.length ?? 0;
  if (pages > 0) {
    const extension = extensionOf(name).toLowerCase();
    // A lone image file with a page list is still one image, not a directory
    // comic; and an archive extension means the manifest is listing members of
    // an archive the format layer should unpack itself.
    if (!['epub', 'pdf', 'cbz', 'txt'].includes(extension) && !isImagePath(name)) {
      return 'comic-dir';
    }
  }
  return detectFormat(name, ctx.bytes);
}
