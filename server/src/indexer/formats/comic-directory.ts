import { readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  registerDirectoryHandler,
  type AssetPayload,
  type DirectoryEntry,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
  type TocEntry,
} from './registry.ts';
import { ZipArchive } from './zip-reader.ts';
import { imageContentType, isImageExtension } from './image-types.ts';
import { naturalCompare, naturalSortBy } from './natural-sort.ts';
import { filenameMetadata } from '../metadata.ts';
import { fileHandlerForExtension } from './registry.ts';

/**
 * Comic directories: a folder of images, optionally split into volumes.
 *
 * This is how most manga collections are actually stored on a NAS:
 *
 *   进击的巨人/
 *     第01卷/ 001.jpg 002.jpg ...
 *     第02卷/ 001.jpg 002.jpg ...
 *
 * The directory becomes one book; each subdirectory becomes a group of pages.
 * Unpacking these into fake `.cbz` files would mean writing into the library,
 * which is off limits, so the handler addresses the files in place.
 *
 * Only one level of nesting is considered. Going deeper turns a messy folder
 * into a thousands-page book, and the reader cannot navigate that.
 *
 * Pages are streamed from disk. A volume is a directory of 20MB scans, so the
 * difference between buffering one page and buffering a volume is the
 * difference between a reader that works on a NAS and one that gets OOM-killed.
 */

const MIN_IMAGES = 2;
/** Below this share of images the folder is not a comic. */
const IMAGE_RATIO = 0.5;

interface LocalEntry {
  name: string;
  isDirectory: boolean;
  isImage: boolean;
  isArchive: boolean;
  /** A file another registered format would index as a book of its own. */
  isBookFile: boolean;
}

/**
 * Whether a file name belongs to a format the registry treats as a book.
 *
 * `.epub` and `.pdf` are the ones that matter here: a shelf directory full of
 * them must never be claimed as a comic. Written as "a handler owns this
 * extension" rather than as a list, so newly registered formats are covered
 * automatically.
 */
function isBookFormatExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return fileHandlerForExtension(name.slice(dot)) !== null;
}

/**
 * Archive extensions that may hold pages.
 *
 * `.epub` deliberately stays out of this set even though it is a zip: an EPUB is
 * a book collection, and treating it as a container of pages would turn a shelf
 * directory into one "comic" with hundreds of pages.
 */
function isArchiveName(name: string): boolean {
  return /\.(cbz|zip)$/i.test(name);
}

/** List a directory, ignoring the cruft that accumulates on real disks. */
async function listEntries(absDir: string): Promise<LocalEntry[]> {
  let dirents;
  try {
    dirents = await readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: LocalEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue;
    const ext = dirent.name.slice(dirent.name.lastIndexOf('.') + 1);
    if (dirent.isDirectory()) {
      out.push({ name: dirent.name, isDirectory: true, isImage: false, isArchive: false, isBookFile: false });
    } else if (dirent.isFile()) {
      const image = isImageExtension(ext);
      const archive = isArchiveName(dirent.name);
      out.push({
        name: dirent.name,
        isDirectory: false,
        isImage: image,
        isArchive: archive,
        isBookFile: !image && !archive && isBookFormatExtension(dirent.name),
      });
    }
  }
  return out.sort((a, b) => naturalCompare(a.name, b.name));
}

/**
 * Decide whether a directory is one comic book.
 *
 * Intentionally conservative: an image COUNT alone is not evidence, because
 * covers, thumbnails and stray scans sit inside every real book collection. What
 * makes a comic is that the folder holds nothing this server would index as a
 * book of another format.
 */
export async function looksLikeComicDirectory(absDir: string): Promise<boolean> {
  const entries = await listEntries(absDir);
  if (entries.length === 0) return false;

  const dirs = entries.filter((entry) => entry.isDirectory);
  const images = entries.filter((entry) => entry.isImage).length;
  const archives = entries.filter((entry) => entry.isArchive).length;

  if (images >= MIN_IMAGES || archives >= MIN_IMAGES) {
    return !entries.some((entry) => entry.isBookFile);
  }

  // Volume layout: subdirectories only, and the first one really holds pages.
  // The probe recurses because "one level of nesting" describes how the reader
  // navigates, while a volume directory may hold its pages one level further
  // down — and this scan is what decides whether the folder is a book at all, so
  // it must not conclude "not a comic" about a folder the manifest reads happily.
  if (images === 0 && archives === 0 && dirs.length === entries.length) {
    return hasImagesBelow(join(absDir, dirs[0]!.name), 0);
  }
  return false;
}

/**
 * Whether a subdirectory is a book collection rather than a volume.
 *
 * Pages are never taken out of a folder that has book files in it, so a
 * `藏书目录/` nested inside a comic folder cannot silently swallow the books
 * inside it.
 */
async function isBookCollection(absDir: string): Promise<boolean> {
  const entries = await listEntries(absDir);
  return entries.some((entry) => !entry.isDirectory && !entry.isImage && !entry.isArchive);
}

/** How deep the "is this a comic" probe may look before giving up. */
const MAX_PROBE_DEPTH = 2;

/** Whether a directory holds at least MIN_IMAGES images within MAX_PROBE_DEPTH levels. */
async function hasImagesBelow(absDir: string, depth: number): Promise<boolean> {
  const entries = await listEntries(absDir);
  const images = entries.filter((entry) => entry.isImage).length;
  if (images >= MIN_IMAGES) return true;
  if (depth >= MAX_PROBE_DEPTH) return false;
  for (const dir of entries.filter((entry) => entry.isDirectory)) {
    if (await hasImagesBelow(join(absDir, dir.name), depth + 1)) return true;
  }
  return false;
}

interface Page {
  /** Path relative to the book directory. */
  relPath: string;
  name: string;
  /** `file` for a loose image, `archive` for an embedded cbz/zip. */
  source: 'file' | 'archive';
}

interface Volume {
  title: string;
  pages: Page[];
}

/** How deep a volume may nest before its pages stop being collected. */
const MAX_PAGE_DEPTH = 3;

/**
 * Collect the pages of a volume: images and embedded archives, in natural order.
 *
 * Recurses into subdirectories, because scans of one volume are routinely split
 * into `第01话/`, `第02话/` folders. A single level of nesting is enough in
 * practice and keeps a stray `extras/` folder from turning into a thousand-page
 * book.
 */
async function collectPages(absDir: string, prefix: string, depth = 0): Promise<Page[]> {
  const entries = await listEntries(absDir);
  const pages: Page[] = [];
  for (const entry of entries) {
    if (entry.isImage || entry.isArchive) {
      pages.push({
        relPath: prefix ? `${prefix}/${entry.name}` : entry.name,
        name: entry.name,
        source: entry.isArchive ? ('archive' as const) : ('file' as const),
      });
      continue;
    }
    if (entry.isDirectory && depth < MAX_PAGE_DEPTH && !isBookCollection(join(absDir, entry.name))) {
      const nested = await collectPages(
        join(absDir, entry.name),
        prefix ? `${prefix}/${entry.name}` : entry.name,
        depth + 1,
      );
      pages.push(...nested);
    }
  }
  return pages.sort((a, b) => naturalCompare(a.relPath, b.relPath));
}

/** Build the volume list: subdirectories first, then any loose images. */
async function collectVolumes(absDir: string): Promise<Volume[]> {
  const entries = await listEntries(absDir);
  const dirs = entries.filter((entry) => entry.isDirectory);
  const loose = entries.filter((entry) => entry.isImage || entry.isArchive);
  const volumes: Volume[] = [];

  if (dirs.length > 0 && loose.length === 0) {
    for (const dir of dirs) {
      const pages = await collectPages(join(absDir, dir.name), dir.name);
      if (pages.length > 0) volumes.push({ title: dir.name, pages });
    }
    return volumes;
  }

  // Flat layout, or a mix of subdirectories and loose images: everything at this
  // level becomes one volume, and nested directories each get their own.
  for (const dir of dirs) {
    const pages = await collectPages(join(absDir, dir.name), dir.name);
    if (pages.length > 0) volumes.push({ title: dir.name, pages });
  }
  const own = await collectPages(absDir, '');
  if (own.length > 0) {
    volumes.push({ title: filenameMetadata(absDir).title || '单页', pages: own });
  }
  return volumes;
}

export const comicDirectoryHandler = registerDirectoryHandler({
  format: 'comic-dir',
  kind: 'paged',
  label: '漫画目录（目录内的图片/压缩包按卷组织）',

  matches: async (ctx: HandlerContext) => looksLikeComicDirectory(ctx.absPath),

  async parse(ctx: HandlerContext): Promise<ParsedSource> {
    const fallback = filenameMetadata(ctx.relPath);
    const volumes = await collectVolumes(ctx.absPath);
    const pageCount = volumes.reduce((sum, volume) => sum + volume.pages.length, 0);

    // Cover: the first page of the first volume.
    let cover: { data: Buffer; contentType: string } | undefined;
    const first = volumes[0]?.pages[0];
    if (first) {
      try {
        cover = { data: await readPage(ctx.absPath, first), contentType: imageContentType(first.name) };
      } catch {
        cover = undefined;
      }
    }

    // Directory content has no single file to hash, so identity comes from the
    // volume/page structure. Changing the contents changes the identity, which
    // is what we want: it is effectively the "content hash" of the folder.
    const structureKey = volumes.map((v) => `${v.title}:${v.pages.map((p) => p.name).join(',')}`).join('|');
    const contentHash = createHash('sha256').update(structureKey).digest('hex');

    return {
      format: 'comic-dir',
      kind: 'paged',
      contentHash,
      size: pageCount,
      pageCount,
      cover,
      metadata: {
        ...fallback,
        raw: {
          ...fallback.raw,
          volumeCount: volumes.length,
          pageCount,
          layout: volumes.some((v) => v.title === '单页') ? 'flat' : 'volumes',
        },
      },
    };
  },

  /** One entry per volume: a comic's table of contents is its volumes. */
  async toc(ctx: HandlerContext): Promise<TocEntry[]> {
    const volumes = await collectVolumes(ctx.absPath);
    return volumes.map((volume, index) => ({
      href: `page:${index}:0`,
      title: `${volume.title}（${volume.pages.length} 页）`,
      level: 0,
      spine: index,
    }));
  },

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const volumes = await collectVolumes(ctx.absPath);
    const items = [];
    const groups: Manifest['groups'] = [];

    for (const [volumeIndex, volume] of volumes.entries()) {
      // `offset` is recorded here rather than derived from the running item
      // count: a client that fetched one volume with `?group=N` must be able to
      // place its pages in the whole-book ordering without holding the others.
      groups.push({
        id: `v${padded(volumeIndex)}`,
        seq: volumeIndex,
        title: volume.title,
        count: volume.pages.length,
        offset: items.length,
      });
      for (const [pageIndex, page] of volume.pages.entries()) {
        items.push({
          id: `${volumeIndex}:${pageIndex}`,
          seq: items.length,
          title: page.name,
          kind: 'page' as const,
          mediaType: imageContentType(page.name),
          href: `page:${volumeIndex}:${pageIndex}`,
        });
      }
    }

    return { kind: 'paged', total: items.length, groups, items };
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const match = /^page:(\d+):(\d+)$/.exec(req.ref);
    if (!match) throw new Error(`invalid page reference: ${req.ref}`);

    const volumes = await collectVolumes(ctx.absPath);
    const volume = volumes[Number.parseInt(match[1]!, 10)];
    const page = volume?.pages[Number.parseInt(match[2]!, 10)];
    if (!page) throw new Error(`page is out of range: ${req.ref}`);

    return await streamPage(ctx.absPath, page);
  },
});

/** Read one page's bytes, transparently handling an embedded archive. */
async function readPage(bookDir: string, page: Page): Promise<Buffer> {
  const abs = join(bookDir, page.relPath);
  if (page.source === 'file') return readFile(abs);

  const archive = await ZipArchive.open(abs);
  const first = firstImage(archive);
  if (!first) throw new Error(`no images inside ${page.name}`);
  return archive.read(first.name);
}

/**
 * Stream one page without buffering it.
 *
 * A loose image is streamed straight off disk and marked seekable; an embedded
 * archive is streamed out of its container. In both cases the response never
 * holds more than a chunk of the page.
 */
async function streamPage(bookDir: string, page: Page): Promise<AssetPayload> {
  const abs = join(bookDir, page.relPath);
  if (page.source === 'file') {
    const info = await stat(abs);
    return {
      stream: createReadStream(abs),
      contentType: imageContentType(page.name),
      filename: page.name,
      size: info.size,
      seekable: true,
      lastModified: info.mtimeMs,
    };
  }

  const archive = await ZipArchive.open(abs);
  const first = firstImage(archive);
  if (!first) throw new Error(`no images inside ${page.name}`);
  return {
    stream: await archive.openStream(first.name),
    contentType: imageContentType(first.name),
    filename: page.name,
    size: first.uncompressedSize,
    seekable: first.method === 0,
  };
}

/** The first image of an embedded archive, in natural page order. */
function firstImage(archive: ZipArchive): ReturnType<ZipArchive['files']>[number] | undefined {
  return naturalSortBy(
    archive.files().filter((entry) => isImageExtension(entry.name.slice(entry.name.lastIndexOf('.') + 1))),
    (entry) => entry.name,
  )[0];
}

/** Volume ids are zero-padded so they sort correctly as strings. */
function padded(value: number): string {
  return String(value).padStart(4, '0');
}
