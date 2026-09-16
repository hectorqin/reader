import { createHash } from 'node:crypto';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
} from './registry.ts';
import { ZipArchive, ZipError } from './zip-reader.ts';
import { imageContentType, isImageExtension } from './image-types.ts';
import { naturalSortBy } from './natural-sort.ts';
import { filenameMetadata } from '../metadata.ts';

/**
 * Comic archives: `.cbz` and `.zip`.
 *
 * Pages are read straight out of the archive on demand. Extracting a collection
 * to disk would double its footprint and — more importantly — would mean
 * writing next to the books, which this server must never do.
 *
 * `.cbr`/`.rar` are deliberately absent. RAR needs a non-free decompressor or
 * an external binary, either of which breaks the single-container promise, and
 * a half-working RAR reader would corrupt pages silently.
 */

/** Refuse absurd page counts rather than building a huge manifest for a broken zip. */
const MAX_PAGES = 5000;

function isComicArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.cbz') || lower.endsWith('.zip');
}

/** Page entries in reading order, with reader tooling filtered out. */
function pageEntries(archive: ZipArchive): ReturnType<ZipArchive['files']> {
  const pages = archive.files().filter((entry) => {
    const base = entry.name.slice(entry.name.lastIndexOf('/') + 1);
    if (base.startsWith('.')) return false;
    // macOS resource forks and Windows thumbnails sit alongside the real pages
    // and would otherwise show up as blank pages in the reader.
    if (entry.name.includes('__MACOSX/')) return false;
    if (/^(thumbs\.db|desktop\.ini)$/i.test(base)) return false;
    return isImageExtension(entry.name.slice(entry.name.lastIndexOf('.') + 1));
  });

  // Natural order across the whole path: `ch01/p10.jpg` before `ch01/p9.jpg`
  // and `ch2/` before `ch10/`.
  return naturalSortBy(pages, (entry) => entry.name).slice(0, MAX_PAGES);
}

export const comicArchiveHandler = registerFileHandler({
  format: 'cbz',
  kind: 'paged',
  extensions: ['cbz', 'zip'],
  label: '漫画压缩包（.cbz / .zip，按页序翻页）',

  /**
   * `.zip` is ambiguous — plenty of libraries store documents in zip files, so
   * it is only claimed when most entries are images.
   *
   * `.cbz` is not ambiguous: the extension is an explicit statement of intent.
   * It is accepted even when the archive is unreadable, so that `parse()` gets
   * to record WHY it failed. Rejecting it here would make a corrupt volume
   * silently vanish from the shelf, which is far worse than showing it with an
   * error — the user would have no idea a file was skipped.
   */
  async matches(ctx: HandlerContext, head: Buffer): Promise<boolean> {
    if (!isComicArchive(ctx.relPath)) return false;
    if (ctx.relPath.toLowerCase().endsWith('.cbz')) return true;

    // A valid zip always starts with a local file header; bail out early rather
    // than paying for a central-directory parse on every unrelated .zip.
    if (head.length < 4 || head.readUInt32LE(0) !== 0x04034b50) return false;
    try {
      const archive = await ZipArchive.open(ctx.absPath);
      const files = archive.files();
      if (files.length === 0) return false;
      const images = pageEntries(archive).length;
      return images > 0 && images / files.length >= 0.5;
    } catch {
      return false;
    }
  },

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    const fallback = filenameMetadata(ctx.relPath);
    const contentHash = createHash('sha256').update(buf).digest('hex');

    try {
      const archive = await ZipArchive.open(ctx.absPath);
      const pages = pageEntries(archive);

      // Use the first page as the cover when the archive carries no explicit
      // one — for comics that is nearly always the actual cover art.
      let cover: { data: Buffer; contentType: string } | undefined;
      if (pages[0]) {
        try {
          cover = { data: await archive.read(pages[0].name), contentType: imageContentType(pages[0].name) };
        } catch {
          // A broken first page must not cost us the whole book.
          cover = undefined;
        }
      }

      return {
        format: 'cbz',
        kind: 'paged',
        contentHash,
        size: buf.byteLength,
        pageCount: pages.length,
        cover,
        metadata: {
          ...fallback,
          series: fallback.series ?? '',
          raw: {
            ...fallback.raw,
            entryCount: archive.files().length,
            pageCount: pages.length,
          },
        },
      };
    } catch (err) {
      // Record the failure rather than dropping the book: a library with one
      // corrupt archive should still show it, with the reason, instead of
      // silently having fewer books than files.
      const reason = err instanceof ZipError ? err.code : 'ZIP_ERROR';
      return {
        format: 'cbz',
        kind: 'paged',
        contentHash,
        size: buf.byteLength,
        pageCount: 0,
        metadata: {
          ...fallback,
          raw: { ...fallback.raw, error: reason, message: err instanceof Error ? err.message : String(err) },
        },
      };
    }
  },

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const archive = await ZipArchive.open(ctx.absPath);
    const pages = pageEntries(archive);
    const title = filenameMetadata(ctx.relPath).title;

    return {
      kind: 'paged',
      total: pages.length,
      groups: [{ id: 'pages', seq: 0, title, count: pages.length }],
      items: pages.map((entry, index) => ({
        id: `p${index}`,
        seq: index,
        title: entry.name.slice(entry.name.lastIndexOf('/') + 1),
        kind: 'page' as const,
        mediaType: imageContentType(entry.name),
        href: `page:${index}`,
      })),
    };
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const archive = await ZipArchive.open(ctx.absPath);
    const pages = pageEntries(archive);

    let name: string | null = null;
    if (/^page:\d+$/.test(req.ref)) {
      // Index-based references are the contract: they keep working when the
      // archive is re-packed with renamed entries.
      const index = Number.parseInt(req.ref.slice('page:'.length), 10);
      name = pages[index]?.name ?? null;
      if (!name) throw new Error(`page ${index} is out of range`);
    } else {
      const decoded = safeDecode(req.ref);
      if (archive.has(req.ref)) name = req.ref;
      else if (archive.has(decoded)) name = decoded;
      if (!name) throw new Error(`entry not found: ${req.ref}`);
    }

    return {
      data: await archive.read(name),
      contentType: imageContentType(name),
      filename: name.slice(name.lastIndexOf('/') + 1),
    };
  },
});

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
