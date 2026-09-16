import { BookArchive, extensionOf } from './zip.ts';
import { sortByName } from './natural-sort.ts';
import type { BookDoc, LoadContext, Section } from './types.ts';

/**
 * Comic loader: CBZ archives and loose image directories.
 *
 * Comics are the format where a rendering compromise is most visible. There is
 * no reflow, no font negotiation, no theme — a page either fills the viewport
 * at the right aspect ratio with no gap and no crop, or the product looks broken.
 * So this loader emits `layout: 'fixed'`, one section per page, and the renderer
 * treats each as an atomic screen.
 *
 * Page order comes from natural sorting (see natural-sort.ts). Getting that
 * wrong is not a cosmetic bug: it silently scrambles the story.
 */

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'jxl']);

/** Files a comic archive carries that are not pages. */
const NON_PAGE_HINTS = [/^__macosx\//i, /\/\._/, /\.ds_store$/i, /thumbs\.db$/i, /comicinfo\.xml$/i];

export async function loadCbz(ctx: LoadContext): Promise<BookDoc> {
  const archive = await BookArchive.open(ctx.bytes);
  const pages = archive
    .names()
    .filter((name) => IMAGE_EXTENSIONS.has(extensionOf(name)))
    .filter((name) => !NON_PAGE_HINTS.some((pattern) => pattern.test(name)));

  return buildComicDoc(
    sortByName(pages, (name) => name),
    async (path) => (await archive.bytes(path)) ?? new Uint8Array(),
    'cbz',
  );
}

/**
 * A comic stored as a folder of images.
 *
 * `resolve` is supplied by the caller because a directory is not something the
 * server can stream: the client enumerates the book's `files` from the manifest
 * and fetches each page individually.
 */
export async function loadComicDirectory(
  pages: string[],
  resolve: (path: string) => Promise<Uint8Array>,
): Promise<BookDoc> {
  return buildComicDoc(sortByName(pages, (name) => name), resolve, 'comic-dir');
}

export async function buildComicDoc(
  pages: string[],
  resolve: (path: string) => Promise<Uint8Array>,
  format: 'cbz' | 'comic-dir' | 'image',
): Promise<BookDoc> {
  const sections: Section[] = [];
  for (const path of pages) {
    const mediaType = mediaTypeForImage(path);
    const bytes = await resolve(path);
    sections.push({
      id: path,
      // Prefer the page number as the label: a comic page's file name is
      // usually a hash or a scan-tool artefact and means nothing to a reader.
      label: pageLabel(sections.length + 1, path),
      image: { mediaType, bytes },
      depth: 0,
    });
  }

  return {
    format,
    layout: 'fixed',
    // Manga is right-to-left, but detecting it from the archive is unreliable
    // and guessing wrong reverses the book. Default left-to-right and expose a
    // toggle; the reader can fix it in one tap, and the setting persists.
    direction: 'ltr',
    sections,
    toc: sections.map((section) => ({ id: section.id, label: section.label, depth: 0 })),
    styles: [],
    resources: new Map(),
    orderedByBook: true,
  };
}

function pageLabel(index: number, path: string): string {
  const base = path.split('/').pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, '');
  // Only show the file name when it carries information the index does not.
  if (/^[\d\s_-]+$/.test(stem) || stem.length === 0) return `第 ${index} 页`;
  return `第 ${index} 页 · ${stem}`;
}

export function mediaTypeForImage(path: string): string {
  switch (extensionOf(path)) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    case 'jxl':
      return 'image/jxl';
    default:
      return 'application/octet-stream';
  }
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}
