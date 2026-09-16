import { extensionOf } from './zip.ts';
import type { BookFormat } from './types.ts';

/**
 * Format detection, in the order the evidence deserves: magic bytes beat a
 * declared media type, which beats a file extension.
 *
 * The reason to look at magic bytes at all is that self-hosted libraries are
 * full of misnamed files — a `.txt` that is really an EPUB, a `.cbz` that is
 * actually a ZIP of PDFs from a batch conversion tool. Opening the wrong loader
 * produces a confusing error, while sniffing turns an unusable book into a
 * usable one.
 */

const ZIP_MAGIC = [0x50, 0x4b]; // "PK"
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
/** "GIF8", and the two variants of the PNG signature's first half. */
const IMAGE_MAGIC: Array<{ magic: number[]; label: BookFormat }> = [
  { magic: [0x89, 0x50, 0x4e, 0x47], label: 'image' }, // PNG
  { magic: [0xff, 0xd8, 0xff], label: 'image' }, // JPEG
  { magic: [0x47, 0x49, 0x46, 0x38], label: 'image' }, // GIF
  { magic: [0x42, 0x4d], label: 'image' }, // BMP
];
/** MP3/MP4-family containers are audio/video, never a book. Detected to refuse. */
const MEDIA_MAGIC: number[][] = [
  [0x49, 0x44, 0x33], // ID3
  [0x1a, 0x45, 0xdf, 0xa3], // Matroska / WebM
];

export function detectFormat(fileName: string, bytes?: Uint8Array): BookFormat {
  const extension = extensionOf(fileName);

  if (bytes && bytes.length >= 4) {
    // Magic bytes first, and *only* magic bytes for the formats that are
    // unambiguous. Self-hosted libraries are full of misnamed files — a `.txt`
    // that is really an EPUB from a batch conversion tool, a `.cbz` that is
    // actually a JPEG somebody renamed, an `.epub` that is a PDF. Being
    // confident about a format whose signature admits no alternative is how
    // those files become readable instead of producing a confusing parse error.
    if (matches(bytes, PDF_MAGIC)) return 'pdf';
    for (const entry of IMAGE_MAGIC) {
      if (matches(bytes, entry.magic)) return entry.label;
    }
    if (MEDIA_MAGIC.some((magic) => matches(bytes, magic))) {
      // Not a book at all. Naming it `unknown` is the honest answer: the reader
      // gets "this file is not a book" rather than a text decoder chewing on an
      // MP3 and producing fifty thousand replacement characters.
      return 'unknown';
    }
    if (matches(bytes, ZIP_MAGIC)) {
      // A ZIP admits two answers, so here the extension does get a vote — but
      // only as the tie-breaker between two formats that are both plausible for
      // the same bytes. When the extension is neither, the container document
      // inside decides.
      if (extension === 'cbz' || extension === 'cbr') return 'cbz';
      if (extension === 'epub') return 'epub';
      return looksLikeEpub(bytes) ? 'epub' : 'cbz';
    }
  }

  switch (extension) {
    case 'epub':
      return 'epub';
    case 'pdf':
      return 'pdf';
    case 'txt':
    case 'text':
      return 'txt';
    case 'cbz':
    case 'zip':
      return 'cbz';
    case 'cbr':
      // RAR archives are not readable without a native decoder, which the
      // browser cannot provide. Reported as unknown so the UI can say so
      // instead of failing with a confusing parse error.
      return 'unknown';
    default:
      if (isImageName(fileName)) return 'image';
      return 'unknown';
  }
}

function matches(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic[index]) return false;
  }
  return true;
}

/**
 * Reads the first ZIP entry header and checks whether it is an EPUB container.
 *
 * ZIP stores file names uncompressed in local headers, so the entry can be
 * located without inflating anything. Only the first few entries are scanned:
 * `mimetype` is required to be first by the EPUB spec, and a reasonable fallback
 * does not need to walk a 3000-page archive.
 */
function looksLikeEpub(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, limit));
  if (text.includes('META-INF/container.xml')) return true;
  if (text.includes('mimetypeapplication/epub+zip')) return true;
  return false;
}

function isImageName(fileName: string): boolean {
  switch (extensionOf(fileName)) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'avif':
    case 'bmp':
      return true;
    default:
      return false;
  }
}
