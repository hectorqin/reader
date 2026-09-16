import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  registerDirectoryHandler,
  type AssetPayload,
  type DirectoryEntry,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
} from './registry.ts';
import { ZipArchive } from './zip-reader.ts';
import { imageContentType, isImageExtension } from './image-types.ts';
import { naturalCompare, naturalSortBy } from './natural-sort.ts';
import { filenameMetadata } from '../metadata.ts';

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
 */

const MIN_IMAGES = 2;
/** Below this share of images the folder is not a comic. */
const IMAGE_RATIO = 0.5;

interface LocalEntry {
  name: string;
  isDirectory: boolean;
  isImage: boolean;
  isArchive: boolean;
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
      out.push({ name: dirent.name, isDirectory: true, isImage: false, isArchive: false });
    } else if (dirent.isFile()) {
      out.push({
        name: dirent.name,
        isDirectory: false,
        isImage: isImageExtension(ext),
        isArchive: /\.(cbz|zip)$/i.test(dirent.name),
      });
    }
  }
  return out.sort((a, b) => naturalCompare(a.name, b.name));
}

export function toDirectoryEntries(entries: LocalEntry[]): DirectoryEntry[] {
  return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory, size: 0 }));
}

/**
 * Decide whether a directory is one comic book.
 *
 * Intentionally conservative. A music or video folder that happens to contain
 * two stray JPEGs must not become a comic, so both the absolute count and the
 * ratio have to clear their thresholds, and a volume layout is only accepted
 * when the first subdirectory really holds images.
 */
export async function looksLikeComicDirectory(absDir: string): Promise<boolean> {
  const entries = await listEntries(absDir);
  if (entries.length === 0) return false;

  const images = entries.filter((entry) => entry.isImage).length;
  const archives = entries.filter((entry) => entry.isArchive).length;
  const dirs = entries.filter((entry) => entry.isDirectory);

  if (images >= MIN_IMAGES && images >= entries.length * IMAGE_RATIO) return true;
  if (archives >= MIN_IMAGES && archives >= entries.length * IMAGE_RATIO) return true;

  if (dirs.length > 0 && images === 0 && archives === 0 && dirs.length >= entries.length * IMAGE_RATIO) {
    const probe = await listEntries(join(absDir, dirs[0]!.name));
    const subImages = probe.filter((entry) => entry.isImage).length;
    return subImages >= MIN_IMAGES && subImages >= probe.length * IMAGE_RATIO;
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

/** Collect the pages of one directory level (images plus embedded archives). */
async function collectPages(absDir: string, prefix: string): Promise<Page[]> {
  const entries = await listEntries(absDir);
  return entries
    .filter((entry) => entry.isImage || entry.isArchive)
    .map((entry) => ({
      relPath: prefix ? `${prefix}/${entry.name}` : entry.name,
      name: entry.name,
      source: entry.isArchive ? ('archive' as const) : ('file' as const),
    }));
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

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const volumes = await collectVolumes(ctx.absPath);
    const items = [];

    for (const [volumeIndex, volume] of volumes.entries()) {
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

    return {
      kind: 'paged',
      total: items.length,
      groups: volumes.map((volume, index) => ({
        id: `v${index}`,
        seq: index,
        title: volume.title,
        count: volume.pages.length,
      })),
      items,
    };
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const match = /^page:(\d+):(\d+)$/.exec(req.ref);
    if (!match) throw new Error(`invalid page reference: ${req.ref}`);

    const volumes = await collectVolumes(ctx.absPath);
    const volume = volumes[Number.parseInt(match[1]!, 10)];
    const page = volume?.pages[Number.parseInt(match[2]!, 10)];
    if (!page) throw new Error(`page is out of range: ${req.ref}`);

    return {
      data: await readPage(ctx.absPath, page),
      contentType: imageContentType(page.name),
      filename: page.name,
    };
  },
});

/** Read one page's bytes, transparently handling an embedded archive. */
async function readPage(bookDir: string, page: Page): Promise<Buffer> {
  const abs = join(bookDir, page.relPath);
  if (page.source === 'file') return readFile(abs);

  // An embedded archive counts as a single page and shows its first image.
  const archive = await ZipArchive.open(abs);
  const images = naturalSortBy(
    archive.files().filter((entry) => isImageExtension(entry.name.slice(entry.name.lastIndexOf('.') + 1))),
    (entry) => entry.name,
  );
  const first = images[0];
  if (!first) throw new Error(`no images inside ${page.name}`);
  return archive.read(first.name);
}
