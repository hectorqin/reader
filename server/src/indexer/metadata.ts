import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { stripNullBytes } from '../lib/text.ts';
import { parseFilename } from './filename.ts';

export type BookFormat = 'epub' | 'pdf' | 'txt' | 'cbz' | 'comic-dir' | 'unknown';

export interface ExtractedMetadata {
  title: string;
  author: string;
  publisher: string;
  language: string;
  isbn: string;
  description: string;
  series: string;
  seriesIndex: number | null;
  tags: string[];
  pubdate: string;
  identifier: string | null;
  /** Which layer produced the current values: embedded | filename. */
  source: 'embedded' | 'filename' | 'unknown';
  /** Raw extracted fields, kept for round-tripping and manual completion UI. */
  raw: Record<string, unknown>;
}

export interface ParsedBookFile {
  format: BookFormat;
  contentHash: string;
  size: number;
  pageCount: number | null;
  /** Cover bytes, written into DATA_DIR by the caller. Never into BOOKS_DIR. */
  cover?: { data: Buffer; contentType: string };
  /** Set by the scanner once the cover is persisted under DATA_DIR. */
  coverPath?: string | null;
  metadata: ExtractedMetadata;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Keep every field as text; epub metadata is famously inconsistent.
  parseTagValue: false,
  parseAttributeValue: false,
});

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Text encoding detection for TXT books.
 *
 * The same validate-then-fallback approach the client uses, and for the same
 * reason: a strict UTF-8 check is reliable in the direction that matters. It is
 * duplicated rather than shared because the server and the client are separate
 * build targets with no common module, and a wrong answer on either side is
 * merely a hint — the client re-decodes from the bytes it downloads.
 */
export function detectTextEncoding(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (isStrictUtf8(sample)) return 'utf-8';
  // GB18030 is a superset of GBK/GB2312, which is what almost every legacy
  // Chinese TXT in a personal library is.
  return 'gb18030';
}

/** Strict UTF-8 validation: returns false if any replacement would occur. */
export function isStrictUtf8(bytes: Buffer): boolean {
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index]!;
    if (byte <= 0x7f) {
      index += 1;
      continue;
    }
    let needed: number;
    let min: number;
    let code: number;
    if ((byte & 0xe0) === 0xc0) {
      needed = 1; min = 0x80; code = byte & 0x1f;
    } else if ((byte & 0xf0) === 0xe0) {
      needed = 2; min = 0x800; code = byte & 0x0f;
    } else if ((byte & 0xf8) === 0xf0) {
      needed = 3; min = 0x10000; code = byte & 0x07;
    } else {
      return false;
    }
    if (index + needed >= bytes.length) return false;
    for (let offset = 1; offset <= needed; offset += 1) {
      const next = bytes[index + offset]!;
      if ((next & 0xc0) !== 0x80) return false;
      code = (code << 6) | (next & 0x3f);
    }
    if (code < min || code > 0x10ffff) return false;
    if (code >= 0xd800 && code <= 0xdfff) return false;
    index += needed + 1;
  }
  return true;
}

/**
 * Counts image entries in a ZIP without extracting them.
 *
 * Reads the end-of-central-directory record and walks the central directory
 * names, which is metadata only: no entry is inflated. That keeps a scan of a
 * hundred 200MB comic archives cheap, which matters because the scanner runs
 * every minute (see docs/architecture.md §3).
 */
export async function countZipImages(buf: Buffer): Promise<number | null> {
  const eocd = findEndOfCentralDirectory(buf);
  if (!eocd) return null;
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let pages = 0;
  for (let index = 0; index < entryCount; index += 1) {
    // Each central directory header is at least 46 bytes.
    if (offset + 46 > buf.length) break;
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('latin1');
    if (name.endsWith('/')) {
      // directory entry
    } else {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'].includes(ext)) pages += 1;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return pages;
}

/**
 * Locates the end-of-central-directory record.
 *
 * Scanned backwards because the comment field after it may be up to 64KB, and it
 * is not at a fixed offset. The signature is checked rather than the position.
 */
function findEndOfCentralDirectory(buf: Buffer): number | null {
  const minimum = Math.max(0, buf.length - 22 - 0xffff);
  for (let index = buf.length - 22; index >= minimum; index -= 1) {
    if (buf.readUInt32LE(index) === 0x06054b50) return index;
  }
  return null;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('#text' in obj) return textOf(obj['#text']);
  }
  return '';
}

function isbn13ChecksumOk(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

export function normalizeIsbn(candidate: string): string {
  const cleaned = candidate.replace(/^urn:isbn:/i, '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (cleaned.length === 13 && isbn13ChecksumOk(cleaned)) return cleaned;
  if (cleaned.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const ch = cleaned[i]!;
      const value = ch === 'X' ? 10 : Number(ch);
      if (Number.isNaN(value)) return '';
      sum += value * (10 - i);
    }
    return sum % 11 === 0 ? cleaned : '';
  }
  return '';
}

/**
 * EPUB metadata extraction.
 *
 * Priority chain from the product design §6: embedded metadata wins over
 * filename parsing, and manual edits win over both (applied later, in the
 * override layer — not here).
 */
export async function parseEpub(buf: Buffer, relPath: string): Promise<ExtractedMetadata> {
  const zip = await JSZip.loadAsync(buf);
  const containerFile = zip.file('META-INF/container.xml');
  let opfPath = '';
  if (containerFile) {
    const containerXml = await containerFile.async('string');
    const container = xmlParser.parse(containerXml) as Record<string, any>;
    const rootfiles = asArray(container?.container?.rootfiles?.rootfile);
    const full = rootfiles.map((r) => r?.['@_full-path']).find((p) => typeof p === 'string' && p);
    if (full) opfPath = full;
  }
  if (!opfPath) {
    opfPath = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf')) ?? '';
  }
  if (!opfPath) throw new Error('epub has no OPF package document');

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`epub OPF not found at ${opfPath}`);
  const opf = xmlParser.parse(await opfFile.async('string')) as Record<string, any>;
  const pkg = opf?.package ?? {};
  const metadata = pkg?.metadata ?? {};

  const title = textOf(metadata['dc:title'] ?? metadata.title);
  const creators = asArray(metadata['dc:creator'] ?? metadata.creator).map(textOf).filter(Boolean);
  const publisher = textOf(metadata['dc:publisher'] ?? metadata.publisher);
  const language = textOf(metadata['dc:language'] ?? metadata.language);
  const description = textOf(metadata['dc:description'] ?? metadata.description);
  const pubdate = textOf(metadata['dc:date'] ?? metadata.date);
  const identifiers = asArray(metadata['dc:identifier'] ?? metadata.identifier).map(textOf).filter(Boolean);

  let isbn = '';
  for (const id of identifiers) {
    const candidate = normalizeIsbn(id);
    if (candidate) {
      isbn = candidate;
      break;
    }
  }
  if (!isbn) {
    for (const id of identifiers) {
      const match = /(\d{9}[\dXx]|\d{13})/.exec(id.replace(/[^0-9Xx]/g, ' '));
      if (match) {
        const candidate = normalizeIsbn(match[1]!);
        if (candidate) {
          isbn = candidate;
          break;
        }
      }
    }
  }

  const tags = asArray(metadata['dc:subject'] ?? metadata.subject).map(textOf).filter(Boolean);

  let series = '';
  let seriesIndex: number | null = null;
  const calibreSeries = metadata['meta'];
  for (const entry of asArray(calibreSeries)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const name = String(obj['@_name'] ?? '');
    const content = textOf(obj['@_content'] ?? obj['#text']);
    if (name === 'calibre:series' && content && !series) series = content;
    if (name === 'calibre:series_index' && content) {
      const parsed = Number.parseFloat(content);
      if (Number.isFinite(parsed)) seriesIndex = parsed;
    }
  }
  const belongsTo = metadata['meta'] ? [] : [];
  void belongsTo;

  // EPUB 3 collection/group-position, the modern equivalent of calibre:series.
  const collection = metadata['belongs-to-collection'] ?? metadata['meta'];
  for (const entry of asArray(collection)) {
    if (typeof entry === 'string') {
      if (!series) series = entry.trim();
      continue;
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, any>;
    const role = String(obj['@_property'] ?? obj['@_name'] ?? '');
    if (role.includes('belongs-to-collection') || role === 'calibre:series') {
      const value = textOf(obj['#text'] ?? obj['@_content']);
      if (value && !series) series = value;
    }
  }

  // The identifier is not the primary key by itself: it is missing from plenty
  // of pirated/self-made epubs and duplicated across re-releases. The caller
  // combines it with the content hash.
  const identifier = identifiers[0] ?? null;

  return {
    title,
    author: creators.join(', '),
    publisher,
    language,
    isbn,
    description,
    series,
    seriesIndex,
    tags,
    pubdate,
    identifier,
    source: 'embedded',
    raw: { metadata, opfPath, identifiers },
  };
}

function pdfInfo(buf: Buffer): { title: string; author: string; pageCount: number | null } {
  const head = buf.subarray(0, Math.min(buf.length, 2 * 1024 * 1024)).toString('latin1');
  const readField = (key: string): string => {
    const match = new RegExp(`/${key}\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)`).exec(head);
    return match ? stripNullBytes(match[1]!).trim() : '';
  };
  let pageCount: number | null = null;
  const countMatch = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(head);
  if (countMatch) {
    const parsed = Number.parseInt(countMatch[1]!, 10);
    if (Number.isFinite(parsed)) pageCount = parsed;
  }
  return { title: readField('Title'), author: readField('Author'), pageCount };
}

/**
 * Parse an arbitrary library file. Never writes to disk.
 */
export async function parseBookFile(buf: Buffer, relPath: string): Promise<ParsedBookFile> {
  const contentHash = sha256(buf);
  const size = buf.byteLength;
  const lower = relPath.toLowerCase();

  if (lower.endsWith('.epub')) {
    try {
      const metadata = await parseEpub(buf, relPath);
      // A broken or huge cover must never fail the whole book.
      const cover = await extractEpubCover(buf).catch(() => undefined);
      return { format: 'epub', contentHash, size, pageCount: null, metadata, cover };
    } catch (err) {
      const fallback = filenameMetadata(relPath);
      fallback.raw = { parseError: err instanceof Error ? err.message : String(err) };
      return { format: 'epub', contentHash, size, pageCount: null, metadata: fallback };
    }
  }

  if (lower.endsWith('.pdf')) {
    const info = pdfInfo(buf);
    const fallback = filenameMetadata(relPath);
    const metadata: ExtractedMetadata = {
      ...fallback,
      title: info.title || fallback.title,
      author: info.author || fallback.author,
      source: info.title || info.author ? 'embedded' : fallback.source,
    };
    return { format: 'pdf', contentHash, size, pageCount: info.pageCount, metadata };
  }

  if (lower.endsWith('.txt')) {
    // Only cheap facts are extracted here: the encoding decision and the chapter
    // split are the *client's* to make, because they depend on what the reader
    // sees and can be overridden per book in the UI. Trying to do them server-side
    // would mean decoding a whole novel on every scan for information the client
    // is going to recompute anyway.
    const fallback = filenameMetadata(relPath);
    const encoding = detectTextEncoding(buf);
    return {
      format: 'txt',
      contentHash,
      size,
      pageCount: null,
      metadata: {
        ...fallback,
        publisher: '',
        raw: { filename: relPath, encoding, bytes: buf.byteLength },
      },
    };
  }

  if (lower.endsWith('.cbz') || lower.endsWith('.zip')) {
    // A CBZ is a ZIP of images. Reading the central directory for a page count is
    // cheap and gives the shelf a usable "N 页" label without unpacking anything.
    const pageCount = await countZipImages(buf).catch(() => null);
    const fallback = filenameMetadata(relPath);
    const isZip = lower.endsWith('.zip');
    return {
      format: 'cbz',
      contentHash,
      size,
      pageCount,
      metadata: {
        ...fallback,
        // A `.zip` that contains images is a comic by content. Naming it as one
        // lets the client pick the comic renderer without re-sniffing.
        title: fallback.title,
        raw: { filename: relPath, pages: pageCount, container: isZip ? 'zip' : 'cbz' },
      },
    };
  }

  return {
    format: 'unknown',
    contentHash,
    size,
    pageCount: null,
    metadata: filenameMetadata(relPath),
  };
}

/**
 * Filename parsing. Only used to fill gaps left by embedded metadata, and it is
 * always the weakest layer of the priority chain.
 */
export function filenameMetadata(relPath: string): ExtractedMetadata {
  const parsed = parseFilename(relPath);
  return {
    title: parsed.title,
    author: parsed.author,
    publisher: '',
    language: parsed.language,
    isbn: '',
    description: '',
    series: parsed.series,
    seriesIndex: parsed.seriesIndex,
    tags: [],
    pubdate: '',
    identifier: null,
    source: 'filename',
    raw: { filename: relPath, parsed },
  };
}

/**
 * Metadata for a comic stored as a folder of images.
 *
 * Unlike every other format there is no single file to hash, so the identity is
 * built from the folder path plus the page count: the folder *is* the book, and
 * the reader expects it to stay one book when they add a page.
 */
export function comicDirectoryMetadata(relDir: string, pages: string[], totalBytes: number): ExtractedMetadata {
  const parsed = parseFilename(relDir);
  return {
    title: parsed.title,
    author: parsed.author,
    publisher: '',
    language: parsed.language,
    isbn: '',
    description: '',
    series: parsed.series,
    seriesIndex: parsed.seriesIndex,
    tags: [],
    pubdate: '',
    // The identifier anchors identity on the folder name rather than on the
    // contents, so adding a page does not create a second book.
    identifier: `comic-dir:${relDir}`,
    source: 'filename',
    raw: { directory: relDir, pages: pages.length, bytes: totalBytes },
  };
}

/**
 * Locate and read the cover image from an EPUB.
 *
 * Covers are cached into DATA_DIR/covers by the caller; the library directory is
 * never written to.
 */
export async function extractEpubCover(buf: Buffer): Promise<{ data: Buffer; contentType: string } | undefined> {
  const zip = await JSZip.loadAsync(buf);
  const opfPath = await findOpfPath(zip);
  if (!opfPath) return undefined;
  const opfFile = zip.file(opfPath);
  if (!opfFile) return undefined;
  const opf = xmlParser.parse(await opfFile.async('string')) as Record<string, any>;
  const metadata = opf?.package?.metadata ?? {};
  const manifest = asArray(opf?.package?.manifest?.item);

  const coverId = asArray(metadata.meta)
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}))
    .find((entry) => String(entry['@_name'] ?? '') === 'cover')?.['@_content'];

  const isImage = (item: Record<string, any>) =>
    String(item['@_media-type'] ?? '').startsWith('image/');

  let item = coverId
    ? manifest.find((entry) => entry?.['@_id'] === coverId)
    : undefined;
  if (!item) {
    item = manifest.find(
      (entry) => isImage(entry) && /cover/i.test(String(entry?.['@_id'] ?? entry?.['@_href'] ?? '')),
    );
  }
  if (!item) {
    item = manifest.find((entry) => isImage(entry) && /\.(jpe?g|png|gif|webp)$/i.test(String(entry?.['@_href'] ?? '')));
  }
  if (!item) return undefined;

  const href = String(item['@_href'] ?? '');
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const coverPath = decodeURIComponent(`${baseDir}${href}`);
  const file = zip.file(coverPath) ?? zip.file(href);
  if (!file) return undefined;

  const data = Buffer.from(await file.async('uint8array'));
  const contentType = String(item['@_media-type'] ?? 'image/jpeg');
  return { data, contentType };
}

async function findOpfPath(zip: JSZip): Promise<string> {
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const container = xmlParser.parse(await containerFile.async('string')) as Record<string, any>;
    const full = asArray(container?.container?.rootfiles?.rootfile)
      .map((r) => r?.['@_full-path'])
      .find((p) => typeof p === 'string' && p);
    if (full) return full;
  }
  return Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf')) ?? '';
}

export async function saveCover(
  dataDir: string,
  bookId: string,
  cover: { data: Buffer; contentType: string },
): Promise<string> {
  const ext = cover.contentType.includes('png')
    ? '.png'
    : cover.contentType.includes('svg')
      ? '.svg'
      : cover.contentType.includes('gif')
        ? '.gif'
        : '.jpg';
  const rel = join('covers', `${bookId}${ext}`);
  const abs = join(dataDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, cover.data);
  return rel;
}

export async function readFileBuffer(absPath: string): Promise<Buffer> {
  return readFile(absPath);
}
