import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { stripNullBytes } from '../lib/text.ts';
import { parseFilename } from './filename.ts';

/**
 * Format identifier as stored in `books.format`.
 *
 * Deliberately an open string rather than a union: the supported set is defined
 * by the handler registry in `./formats`, and a closed union here would mean
 * every new format needs edits in three unrelated files.
 */
export type BookFormat = string;

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

/**
 * Cover location without reading the image.
 *
 * `extractEpubCover` eagerly decodes the cover for the scanner, which is right
 * when a book is being indexed. It is wasteful for a request that only wants to
 * hand the bytes to a client — for a large art book the cover can be several
 * megabytes. This returns the archive path and media type so the caller can
 * stream it out of the container instead.
 *
 * The item-picking order matches `extractEpubCover` on purpose: two code paths
 * that disagree about which image is the cover would serve a different picture
 * depending on which endpoint the client hit.
 */
export async function findEpubCoverTarget(
  zip: JSZip,
  opfPath?: string,
): Promise<{ path: string; contentType: string } | undefined> {
  const opf = opfPath ?? (await findOpfPath(zip));
  if (!opf) return undefined;
  const opfFile = zip.file(opf);
  if (!opfFile) return undefined;
  const parsed = xmlParser.parse(await opfFile.async('string')) as Record<string, any>;
  const metadata = parsed?.package?.metadata ?? {};
  const manifest = asArray(parsed?.package?.manifest?.item);

  const coverId = asArray(metadata.meta)
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}))
    .find((entry) => String(entry['@_name'] ?? '') === 'cover')?.['@_content'];

  const isImage = (item: Record<string, any>) => String(item['@_media-type'] ?? '').startsWith('image/');

  let item = coverId ? manifest.find((entry) => entry?.['@_id'] === coverId) : undefined;
  if (!item) {
    item = manifest.find(
      (entry) => isImage(entry) && /cover/i.test(String(entry?.['@_id'] ?? entry?.['@_href'] ?? '')),
    );
  }
  if (!item) {
    item = manifest.find(
      (entry) => isImage(entry) && /\.(jpe?g|png|gif|webp)$/i.test(String(entry?.['@_href'] ?? '')),
    );
  }
  if (!item) return undefined;

  const href = String(item['@_href'] ?? '');
  const baseDir = opf.includes('/') ? opf.slice(0, opf.lastIndexOf('/') + 1) : '';
  const path = decodeURIComponent(`${baseDir}${href}`);
  return {
    path: zip.file(path) ? path : href,
    contentType: String(item['@_media-type'] ?? 'image/jpeg'),
  };
}

export async function findOpfPath(zip: JSZip): Promise<string> {
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
