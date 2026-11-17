import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { AppError } from '../../lib/errors.ts';
import { filenameMetadata, type ExtractedMetadata } from '../metadata.ts';
import { BOOK_RESOURCE_MARKER, CHAPTER_WINDOW, firstHeading } from './epub.ts';
import {
  MobiError, NONE, PalmDb, decodeText, decompressPalmDoc, huffCdicDecompressor, readFontRecord, readHeader,
  readIndex, sniffResource, trimTrailingEntries, type MobiHeader,
} from './mobi-reader.ts';
import {
  registerFileHandler, type AssetPayload, type HandlerContext, type Manifest, type ParsedSource, type TocEntry,
} from './registry.ts';

/**
 * Kindle books (`.mobi`, `.azw3`, `.azw`), served the way an EPUB is
 * (docs/kindle-formats.zh-CN.md).
 *
 * The client never sees the Kindle container. The server reads it and publishes
 * chapters as HTML documents under made-up paths (`text/part0003.xhtml`), images
 * as `res/<n>` and stylesheets as `flow/<n>.css`. Those are the same shapes an
 * EPUB's chapters and resources have, so the reader's paging, links, notes,
 * search and windowing need nothing new: a link to another chapter is the same
 * marked asset URL an EPUB's is, and a chapter's `href` is `xhtml:<path>` like
 * an EPUB's.
 *
 * Reading means decompressing the whole text, which is the expensive part. The
 * last few books opened are kept, keyed by path, size and modification time, so
 * turning pages does not decompress the book once per chapter.
 */

const CACHE_SIZE = 4;
/** A decompressed text larger than this is not a book anyone can page through. */
const MAX_TEXT_BYTES = 256 * 1024 * 1024;

interface Chapter {
  path: string;
  title: string;
  /** The finished document, built on first request. */
  html: () => string;
}

interface KindleBook {
  generation: 'mobi6' | 'kf8';
  header: MobiHeader;
  db: PalmDb;
  chapters: Chapter[];
  toc: TocEntry[];
  /** KF8 flows (stylesheets, SVG) as text byte ranges; flow 0 is the book itself. */
  flows: Array<[number, number]>;
  text: Buffer;
  resource(index: number): Buffer;
}

const cache = new Map<string, { key: string; book: KindleBook }>();

async function openBook(absPath: string): Promise<KindleBook> {
  const info = await stat(absPath);
  const key = `${info.size}:${info.mtimeMs}`;
  const hit = cache.get(absPath);
  if (hit && hit.key === key) {
    // Most recently used goes to the end.
    cache.delete(absPath); cache.set(absPath, hit);
    return hit.book;
  }
  const book = readKindle(await readFile(absPath));
  cache.set(absPath, { key, book });
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return book;
}

/** A Kindle book from its bytes: headers, text, chapters and table of contents. */
export function readKindle(buf: Buffer): KindleBook {
  const db = new PalmDb(buf);
  const first = readHeader(db.record(0));
  let header = first, start = 0, generation: KindleBook['generation'] = first.version >= 8 ? 'kf8' : 'mobi6';
  // A hybrid .mobi carries an old MOBI 6 copy for old devices and the KF8 book after
  // a boundary. The KF8 half is the better book: real XHTML, stylesheets, fonts.
  const boundary = first.exth.kf8Boundary;
  if (generation === 'mobi6' && boundary !== undefined && boundary !== NONE && boundary > 0 && boundary < db.count) {
    try {
      const kf8 = readHeader(db.record(boundary));
      if (kf8.version >= 8) { header = kf8; start = boundary; generation = 'kf8'; }
    } catch (error) {
      if (error instanceof MobiError && error.code === 'DRM') throw error;
      // A damaged KF8 half still leaves a readable MOBI 6 book.
    }
  }
  // Resources are numbered from the first file's header, which is an absolute record index.
  const resourceStart = first.resourceStart;
  const exth = { ...first.exth, ...stripEmpty(header.exth) };
  header = { ...header, exth };
  const load = (index: number): Buffer => db.record(start + index);

  let decompress: (input: Uint8Array) => Buffer;
  if (header.compression === 1) decompress = input => Buffer.from(input);
  else if (header.compression === 2) decompress = decompressPalmDoc;
  else if (header.compression === 17480) decompress = huffCdicDecompressor(load, header.huffRecord, header.huffCount);
  else throw new MobiError(`不支持的压缩方式 ${header.compression}`, 'UNSUPPORTED');

  const parts: Buffer[] = [];
  let total = 0;
  for (let i = 0; i < header.numTextRecords; i += 1) {
    const part = decompress(trimTrailingEntries(load(i + 1), header.trailingFlags));
    total += part.length;
    if (total > MAX_TEXT_BYTES) throw new MobiError('正文过大', 'UNSUPPORTED');
    parts.push(part);
  }
  const text = Buffer.concat(parts);

  const resource = (index: number): Buffer => {
    if (resourceStart === NONE) throw new MobiError('这本书没有资源记录', 'CORRUPT');
    const record = db.record(resourceStart + index);
    const magic = record.toString('latin1', 0, 4);
    if (magic === 'FONT') return readFontRecord(record);
    if (magic === 'VIDE' || magic === 'AUDI') return record.subarray(12);
    return record;
  };

  const ncx = header.ncx !== NONE ? safeIndex(() => readIndex(load, header.ncx, header.encoding)) : null;
  const built = generation === 'kf8' ? buildKf8(load, header, text, ncx) : buildMobi6(header, text, ncx);
  return { generation, header, db, text, resource, ...built };
}

function stripEmpty<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as Partial<T>;
}

function safeIndex<T>(read: () => T): T | null {
  // A broken table of contents must not cost the reader the book.
  try { return read(); } catch { return null; }
}

const partPath = (index: number): string => `text/part${String(index).padStart(4, '0')}.xhtml`;

// ---- MOBI 6 ----------------------------------------------------------------

const PAGEBREAK = /<(?:mbp:)?pagebreak\b[^>]*>/gi;

function buildMobi6(header: MobiHeader, text: Buffer, ncx: ReturnType<typeof readIndex> | null): Pick<KindleBook, 'chapters' | 'toc' | 'flows'> {
  // Byte offsets are what MOBI 6 links point at. Work on a latin1 string, where one
  // character is one byte, so offsets stay offsets until the text is decoded.
  let raw = text.toString('latin1');
  const targets = new Set<number>();
  for (const match of raw.matchAll(/\bfilepos\s*=\s*["']?0*(\d+)/gi)) targets.add(Number(match[1]));
  const ncxEntries = (ncx?.entries ?? []).map(entry => ({
    offset: entry.tags.get(1)?.[0], label: ncx!.cncx.get(entry.tags.get(3)?.[0] ?? -1) ?? '', level: entry.tags.get(4)?.[0] ?? 0,
  })).filter((entry): entry is { offset: number; label: string; level: number } => entry.offset !== undefined);
  for (const entry of ncxEntries) targets.add(entry.offset);
  // Mark every target with an anchor, in one pass: a book with thousands of notes
  // must not copy its whole text once per note.
  const marks = [...targets].filter(p => p <= raw.length).map(position => {
    let at = position;
    // An offset inside a tag would split it: step back to the tag's start.
    const open = raw.lastIndexOf('<', at), close = raw.lastIndexOf('>', at - 1);
    if (open > close && open < at) at = open;
    return { at, position };
  }).sort((a, b) => a.at - b.at || a.position - b.position);
  const pieces0: string[] = [];
  let cursor = 0;
  for (const { at, position } of marks) {
    pieces0.push(raw.slice(cursor, at), `<a id="filepos-${position}"></a>`);
    cursor = at;
  }
  pieces0.push(raw.slice(cursor));
  raw = pieces0.join('');
  const bodyStart = /<body\b[^>]*>/i.exec(raw);
  const bodyEnd = raw.search(/<\/body\s*>/i);
  const body = raw.slice(bodyStart ? bodyStart.index + bodyStart[0].length : 0, bodyEnd > 0 ? bodyEnd : raw.length);

  // Split at page breaks. A piece with nothing to read in it (two breaks in a row,
  // a break before a heading) joins the next one instead of becoming a blank page.
  const pieces: string[] = [];
  let pending = '';
  for (const piece of body.split(PAGEBREAK)) {
    if (!readable(piece)) { pending += piece; continue; }
    pieces.push(pending + piece); pending = '';
  }
  if (pending) { if (pieces.length) pieces[pieces.length - 1] += pending; else pieces.push(pending); }
  if (!pieces.length) pieces.push('');

  const anchorChapter = new Map<number, number>();
  pieces.forEach((piece, index) => { for (const match of piece.matchAll(/<a id="filepos-(\d+)"><\/a>/g)) anchorChapter.set(Number(match[1]), index); });

  const toc: TocEntry[] = ncxEntries.flatMap(entry => {
    const chapter = anchorChapter.get(entry.offset);
    return chapter === undefined || !entry.label ? [] : [{ href: `xhtml:${partPath(chapter)}#filepos-${entry.offset}`, title: entry.label, level: entry.level, spine: chapter }];
  });

  const chapters: Chapter[] = pieces.map((piece, index) => {
    const decoded = decodeText(Buffer.from(piece, 'latin1'), header.encoding);
    let built: string | null = null;
    return {
      path: partPath(index),
      title: chapterTitle(toc, index, decoded),
      html: () => built ??= mobi6Document(decoded, index, anchorChapter),
    };
  });
  return { chapters, toc, flows: [] };
}

function readable(html: string): boolean {
  return /<img\b/i.test(html) || html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s/g, '').length > 0;
}

function mobi6Document(body: string, index: number, anchorChapter: Map<number, number>): string {
  const html = body
    // Images are numbered from 1 among the book's resources.
    .replace(/<img\b[^>]*>/gi, tag => tag.replace(/\b(?:hi)?recindex\s*=\s*["']?0*(\d+)["']?/i, (_m, n: string) => `src="${RESOURCE(`res/${Number(n) - 1}`)}"`))
    .replace(/<a\b[^>]*>/gi, tag => tag.replace(/\bfilepos\s*=\s*["']?0*(\d+)["']?/i, (_m, n: string) => {
      const target = Number(n), chapter = anchorChapter.get(target);
      if (chapter === undefined) return '';
      return chapter === index ? `href="#filepos-${target}"` : `href="${RESOURCE(partPath(chapter), `filepos-${target}`)}"`;
    }));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${legacySpacing(html)}</body></html>`;
}

/**
 * MOBI 6 spells paragraph spacing as attributes no browser reads: `height` on a
 * block is the space above it, `width` its first-line indent (negative for a
 * hanging indent). Kindle honoured them; a browser drops them, and the book loses
 * every paragraph indent. They become the CSS they always meant.
 */
export function legacySpacing(html: string): string {
  return html.replace(/<(p|div|blockquote|h[1-6])\b([^>]*)>/gi, (tag, name: string, attrs: string) => {
    const style: string[] = [];
    const rest = attrs.replace(/\s(height|width)\s*=\s*["']?(-?\d+(?:\.\d+)?)(em|pt|px|%)?["']?/gi, (_m, attr: string, value: string, unit = 'em') => {
      if (Number(value) !== 0) style.push(`${attr.toLowerCase() === 'height' ? 'margin-top' : 'text-indent'}:${value}${unit}`);
      return '';
    });
    if (!style.length) return rest === attrs ? tag : `<${name}${rest}>`;
    const existing = /\sstyle\s*=\s*"([^"]*)"/i.exec(rest);
    return existing
      ? `<${name}${rest.replace(existing[0], ` style="${style.join(';')};${existing[1]}"`)}>`
      : `<${name}${rest} style="${style.join(';')}">`;
  });
}

// ---- KF8 -------------------------------------------------------------------

interface Fragment { insertAt: number; fid: number; offset: number; length: number }
interface Skeleton { offset: number; length: number; fragments: Fragment[] }

function buildKf8(load: (index: number) => Buffer, header: MobiHeader, text: Buffer, ncx: ReturnType<typeof readIndex> | null): Pick<KindleBook, 'chapters' | 'toc' | 'flows'> {
  const fdst = load(header.fdst);
  if (fdst.toString('latin1', 0, 4) !== 'FDST') throw new MobiError('缺少 FDST 记录', 'CORRUPT');
  const flows = Array.from({ length: fdst.readUInt32BE(8) }, (_, i) => [fdst.readUInt32BE(12 + i * 8), fdst.readUInt32BE(16 + i * 8)] as [number, number]);
  const skelIndex = readIndex(load, header.skel, header.encoding);
  const fragIndex = readIndex(load, header.frag, header.encoding);
  const fragments: Fragment[] = fragIndex.entries.map(entry => ({
    insertAt: Number.parseInt(entry.name, 10),
    fid: entry.tags.get(4)?.[0] ?? -1,
    offset: entry.tags.get(6)?.[0] ?? 0,
    length: entry.tags.get(6)?.[1] ?? 0,
  }));
  let next = 0;
  const skeletons: Skeleton[] = skelIndex.entries.map(entry => {
    const count = entry.tags.get(1)?.[0] ?? 0;
    const skeleton = { offset: entry.tags.get(6)?.[0] ?? 0, length: entry.tags.get(6)?.[1] ?? 0, fragments: fragments.slice(next, next + count) };
    next += count;
    return skeleton;
  });
  const chapterOfFid = new Map<number, number>();
  skeletons.forEach((skeleton, index) => { for (const fragment of skeleton.fragments) chapterOfFid.set(fragment.fid, index); });

  /** The id a `kindle:pos` link lands on: the first id/name/aid at that offset of the fragment. */
  const resolvePos = (fid: number, off: number): { chapter: number; fragment: string } | null => {
    const chapter = chapterOfFid.get(fid);
    if (chapter === undefined) return null;
    const skeleton = skeletons[chapter]!, fragment = skeleton.fragments.find(f => f.fid === fid)!;
    const begin = skeleton.offset + skeleton.length + fragment.offset;
    const tail = text.subarray(begin + off, Math.min(begin + fragment.length, begin + off + 4096)).toString('utf8');
    // The first element at that offset that can be landed on. Its own id wins over its
    // aid: an element that has an id is not given an `aid-` one (see kf8Document).
    for (const tag of tail.matchAll(/<[a-z][^>]*>/gi)) {
      const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag[0])?.[1];
      const id = attr('id') ?? attr('name');
      if (id) return { chapter, fragment: id };
      const aid = attr('aid');
      if (aid) return { chapter, fragment: `aid-${aid}` };
    }
    return { chapter, fragment: '' };
  };

  const toc: TocEntry[] = (ncx?.entries ?? []).flatMap(entry => {
    const pos = entry.tags.get(6), label = ncx!.cncx.get(entry.tags.get(3)?.[0] ?? -1) ?? '';
    const target = pos && pos.length >= 2 ? resolvePos(pos[0]!, pos[1]!) : null;
    if (!target || !label) return [];
    return [{ href: `xhtml:${partPath(target.chapter)}${target.fragment ? `#${target.fragment}` : ''}`, title: label, level: entry.tags.get(4)?.[0] ?? 0, spine: target.chapter }];
  });

  const chapters: Chapter[] = skeletons.map((skeleton, index) => {
    let assembled: string | null = null;
    const source = (): string => {
      if (assembled !== null) return assembled;
      const fragmentsLength = skeleton.fragments.reduce((sum, f) => sum + f.length, 0);
      const raw = text.subarray(skeleton.offset, skeleton.offset + skeleton.length + fragmentsLength);
      let document = Buffer.from(raw.subarray(0, skeleton.length));
      for (const fragment of skeleton.fragments) {
        const at = fragment.insertAt - skeleton.offset;
        const piece = raw.subarray(skeleton.length + fragment.offset, skeleton.length + fragment.offset + fragment.length);
        document = Buffer.concat([document.subarray(0, at), piece, document.subarray(at)]);
      }
      return (assembled = document.toString('utf8'));
    };
    let built: string | null = null;
    return {
      path: partPath(index),
      get title() { return chapterTitle(toc, index, source()); },
      html: () => built ??= kf8Document(source(), index, resolvePos),
    };
  });
  return { chapters, toc, flows };
}

function kf8Document(source: string, index: number, resolvePos: (fid: number, off: number) => { chapter: number; fragment: string } | null): string {
  return replaceKindleUris(source)
    .replace(/kindle:pos:fid:([0-9a-v]+):off:([0-9a-v]+)/gi, (_m, fid: string, off: string) => {
      const target = resolvePos(Number.parseInt(fid, 32), Number.parseInt(off, 32));
      if (!target) return '#';
      if (target.chapter === index) return `#${target.fragment}`;
      return RESOURCE(partPath(target.chapter), target.fragment);
    })
    // Almost every KF8 element carries an `aid`, and links land on them. Give each
    // one an id to land on, unless it already has one.
    .replace(/<([a-z][\w:-]*)(\s[^>]*?)\baid\s*=\s*["']([^"']+)["']([^>]*)>/gi, (tag, name: string, before: string, aid: string, after: string) =>
      /\sid\s*=/i.test(before + after) ? tag : `<${name}${before}aid="${aid}" id="aid-${aid}"${after}>`);
}

/** `kindle:embed` (images, fonts) and `kindle:flow` (stylesheets) to asset URLs. */
function replaceKindleUris(text: string): string {
  return text
    .replace(/kindle:embed:([0-9a-v]+)(?:\?mime=[\w/+.-]+)?/gi, (_m, id: string) => RESOURCE(`res/${Number.parseInt(id, 32) - 1}`))
    .replace(/kindle:flow:([0-9a-v]+)(?:\?mime=([\w/+.-]+))?/gi, (_m, id: string, mime?: string) =>
      RESOURCE(`flow/${Number.parseInt(id, 32)}.${mime === 'image/svg+xml' ? 'svg' : 'css'}`));
}

// ---- shared ----------------------------------------------------------------

/**
 * A URL in the book's own resource space. The value is a placeholder the asset
 * route fills in with the real base (see `withAssetBase`): the documents are
 * cached per book file, not per request.
 */
const BASE = '\u0000reader-asset-base\u0000';
function RESOURCE(ref: string, fragment = ''): string {
  // A bare `&`, not `&amp;`: the same URL is written into stylesheets, where no
  // entity is decoded. In an HTML attribute `&ref=` is not a character reference.
  return `${BASE}?${BOOK_RESOURCE_MARKER}=1&ref=${encodeURIComponent(ref)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}
/**
 * A KF8 chapter's stylesheets, embedded as `<style>`.
 *
 * Always, not only offline: a chapter read through the server is rendered from its
 * body and its `<style>` blocks, and a `<link>` in the head is not fetched, so a
 * linked stylesheet would simply not apply. The stylesheets are small and their
 * own URLs are already rewritten, so embedding them costs little.
 *
 * With `images`, the chapter also renders with no network: its images become
 * `data:` URLs. That is what the offline download asks for (`offline:<chapter>`),
 * and stores under the chapter's own key, so the reader reads it back unchanged.
 * Fonts stay links: one font inlined into every chapter would multiply its size by
 * the chapter count, and offline the reader's own font is a fine stand-in. So does
 * an image too large to be worth carrying twice.
 */
const INLINE_IMAGE_LIMIT = 4 * 1024 * 1024;
function selfContained(html: string, book: KindleBook, images: boolean): string {
  const marker = `${BASE}?${BOOK_RESOURCE_MARKER}=1&ref=`;
  const flowRef = new RegExp(`<link\\b[^>]*href=["']${escapeRegExp(marker)}flow%2F(\\d+)\\.css["'][^>]*>`, 'gi');
  const embedded = html.replace(flowRef, (tag, n: string) => {
    const range = book.flows[Number(n)];
    if (!range || Number(n) === 0) return tag;
    return `<style>${replaceKindleUris(book.text.subarray(range[0], range[1]).toString('utf8')).replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  if (!images) return embedded;
  return embedded.replace(new RegExp(`${escapeRegExp(marker)}res%2F(\\d+)`, 'g'), (url, n: string) => {
    let data: Buffer;
    try { data = book.resource(Number(n)); } catch { return url; }
    const type = sniffResource(data);
    if (!type.startsWith('image/') || data.length > INLINE_IMAGE_LIMIT) return url;
    return `data:${type};base64,${data.toString('base64')}`;
  });
}
function escapeRegExp(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function withAssetBase(html: string, ctx: HandlerContext): string {
  if (!ctx.bookId) throw new Error('HandlerContext.bookId is required to rewrite chapter links');
  return html.split(BASE).join(`/api/v1/books/${encodeURIComponent(ctx.bookId)}/assets`);
}

function chapterTitle(toc: TocEntry[], index: number, html: string): string {
  return toc.find(entry => entry.spine === index)?.title || firstHeading(html) || `第 ${index + 1} 节`;
}

function metadataOf(book: KindleBook, relPath: string): ExtractedMetadata {
  const { exth, fullName } = book.header;
  const fallback = filenameMetadata(relPath);
  const title = (exth.title || fullName).trim();
  const strip = (value: string | undefined): string => (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    ...fallback,
    title: title || fallback.title,
    author: exth.creators.join(', ') || fallback.author,
    publisher: exth.publisher ?? '',
    language: exth.languages[0] ?? '',
    isbn: exth.isbn ?? '',
    description: strip(exth.description),
    tags: exth.subjects,
    pubdate: exth.date ?? '',
    identifier: exth.asin || exth.isbn || null,
    source: title ? 'embedded' : fallback.source,
    raw: { generation: book.generation, version: book.header.version, ...(exth.asin ? { asin: exth.asin } : {}) },
  };
}

function coverOf(book: KindleBook): ParsedSource['cover'] {
  const { coverOffset, thumbnailOffset } = book.header.exth;
  for (const offset of [coverOffset, thumbnailOffset]) {
    if (offset === undefined || offset === NONE) continue;
    try {
      const data = book.resource(offset);
      const contentType = sniffResource(data);
      if (contentType.startsWith('image/')) return { data: Buffer.from(data), contentType };
    } catch { /* a missing cover is not a missing book */ }
  }
  return undefined;
}

/** What the reader is told when a book cannot be opened. */
function unreadable(error: unknown): AppError {
  if (error instanceof MobiError) return new AppError(422, error.code === 'DRM' ? 'BOOK_DRM' : 'BOOK_UNREADABLE', error.message);
  return new AppError(422, 'BOOK_UNREADABLE', `无法读取这本 Kindle 书：${error instanceof Error ? error.message : String(error)}`);
}

async function open(ctx: HandlerContext): Promise<KindleBook> {
  try { return await openBook(ctx.absPath); } catch (error) { throw unreadable(error); }
}

export const mobiHandler = registerFileHandler({
  format: 'mobi',
  kind: 'reflowable',
  extensions: ['mobi', 'azw3', 'azw'],
  label: 'Kindle（MOBI / AZW3，无 DRM）',

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    const contentHash = createHash('sha256').update(buf).digest('hex');
    let book: KindleBook;
    try {
      book = readKindle(buf);
    } catch (error) {
      // Indexed anyway, under its file name: the reader finds the book and, on
      // opening it, is told why it cannot be read (DRM, damage) instead of the
      // file silently missing from the library.
      const metadata = filenameMetadata(ctx.relPath);
      metadata.raw = { parseError: error instanceof Error ? error.message : String(error), ...(error instanceof MobiError ? { parseErrorCode: error.code } : {}) };
      return { format: 'mobi', kind: 'reflowable', contentHash, size: buf.byteLength, pageCount: null, metadata };
    }
    return {
      format: 'mobi', kind: 'reflowable', contentHash, size: buf.byteLength,
      pageCount: book.chapters.length, metadata: metadataOf(book, ctx.relPath), cover: coverOf(book),
    };
  },

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const book = await open(ctx);
    const { chapters } = book;
    const groups: Manifest['groups'] = [];
    for (let offset = 0; offset < chapters.length; offset += CHAPTER_WINDOW) {
      const count = Math.min(CHAPTER_WINDOW, chapters.length - offset);
      const first = chapters[offset]!.title, last = chapters[offset + count - 1]!.title;
      groups.push({ id: `spine:${offset}`, seq: groups.length, title: count === 1 ? first : `${first} – ${last}`, count, offset });
    }
    return {
      kind: 'reflowable',
      total: chapters.length,
      groups,
      items: chapters.map((chapter, seq) => ({
        id: chapter.path, seq, title: chapter.title, kind: 'chapter' as const,
        // Parsed as HTML, not XML: a MOBI 6 body is a 2007 HTML dialect that no XML parser accepts.
        mediaType: 'text/html', href: `xhtml:${chapter.path}`,
      })),
    };
  },

  async toc(ctx: HandlerContext): Promise<TocEntry[]> {
    const book = await open(ctx);
    if (book.toc.length) return book.toc;
    return book.chapters.map((chapter, spine) => ({ href: `xhtml:${chapter.path}`, title: chapter.title, level: 0, spine }));
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const book = await open(ctx);
    const offline = req.ref.startsWith('offline:');
    const ref = req.ref.replace(/^offline:/, '').replace(/^xhtml:/, '').replace(/#.*$/, '');
    const chapter = /^text\/part(\d{4,})\.xhtml$/.exec(ref);
    if (chapter) {
      const found = book.chapters[Number(chapter[1])];
      if (!found) throw new AppError(404, 'NOT_FOUND', `chapter not found: ${ref}`);
      const body = Buffer.from(withAssetBase(selfContained(found.html(), book, offline), ctx), 'utf8');
      return { data: body, contentType: 'text/html; charset=utf-8', filename: ref.slice(5), size: body.byteLength };
    }
    const flow = /^flow\/(\d+)\.(css|svg)$/.exec(ref);
    if (flow && book.generation === 'kf8') {
      const range = book.flows[Number(flow[1])];
      if (!range || Number(flow[1]) === 0) throw new AppError(404, 'NOT_FOUND', `flow not found: ${ref}`);
      const body = Buffer.from(withAssetBase(replaceKindleUris(book.text.subarray(range[0], range[1]).toString('utf8')), ctx), 'utf8');
      return { data: body, contentType: flow[2] === 'svg' ? 'image/svg+xml' : 'text/css; charset=utf-8', filename: ref.slice(5), size: body.byteLength };
    }
    const resource = /^res\/(\d+)$/.exec(ref);
    if (resource) {
      let data: Buffer;
      try { data = Buffer.from(book.resource(Number(resource[1]))); } catch { throw new AppError(404, 'NOT_FOUND', `resource not found: ${ref}`); }
      return { data, contentType: sniffResource(data), size: data.byteLength, etag: ctx.bookId };
    }
    throw new AppError(404, 'NOT_FOUND', `resource not found: ${req.ref}`);
  },
});
