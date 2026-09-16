import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { posix } from 'node:path';
import { contentTypeFor } from './image-types.ts';
import { ZipArchive } from './zip-reader.ts';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
  type TocEntry,
} from './registry.ts';
import { parseEpub, extractEpubCover } from '../metadata.ts';
import { XMLParser } from 'fast-xml-parser';

/**
 * EPUB 2/3.
 *
 * The container reader here is the project's own `ZipArchive`, not JSZip. That
 * matters more than it looks: JSZip decompresses the entire archive into memory,
 * and the original version of this handler did that on *every* manifest and
 * asset request — a reader paging through a 50MB art book inflated the whole
 * container on every chapter turn, and a first scan of a real library could
 * hold every book in RAM at once.
 *
 * What this handler keeps from the original design:
 *
 *  - It stays thin on metadata: `metadata.ts` already parses the package
 *    document for the scanner, and duplicating that here would give the two
 *    code paths a chance to disagree about a book's identity.
 *  - It rewrites relative resource URLs inside chapters. A chapter arrives as
 *    XHTML with references relative to the OPF directory (`images/pic1.png`).
 *    Sent to a WebView as-is those all 404, because the client fetched the
 *    chapter from the asset endpoint, not from inside the archive.
 *  - It injects no layout CSS and restructures nothing. Preserving the
 *    publisher's own layout is the product's core differentiator; the client
 *    applies only minimal overrides on top.
 *
 * One rule is load-bearing and easy to get wrong: **never address a chapter by
 * spine index**. Windowed loading means the server returns a prefix of the spine
 * when the client asks for a group, so an index computed against that prefix
 * would point at a different chapter in the full spine. Items are addressed by
 * archive path (`xhtml:OEBPS/ch1.xhtml`) instead.
 */

/**
 * How many spine entries one manifest window may describe.
 *
 * This is a *transfer* boundary, not a table of contents. The two were the same
 * thing in the first version of this contract, which made a book's TOC read
 * "第 1 章 – 第 40 章" instead of listing its chapters — the reader asked for a
 * table of contents and got the server's pagination.
 *
 * A client that wants the chapter list asks for it with `toc=1`, which returns
 * every spine entry's title without its per-item detail. A long book's TOC is
 * therefore a few kilobytes of strings rather than a manifest with sizes and
 * media types for every chapter.
 */
export const CHAPTER_WINDOW = 40;

/** A chapter document is XHTML; anything larger is not something we serve. */
const MAX_CHAPTER_BYTES = 32 * 1024 * 1024;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export const epubHandler = registerFileHandler({
  format: 'epub',
  kind: 'reflowable',
  extensions: ['epub'],
  label: 'EPUB（精排渲染，保留出版方样式）',

  async parse(ctx: HandlerContext, buf: Buffer): Promise<ParsedSource> {
    const contentHash = createHash('sha256').update(buf).digest('hex');
    // A broken EPUB still gets indexed with filename metadata, matching the
    // previous behaviour: one bad file must not abort the whole scan.
    const metadata = await parseEpub(buf, ctx.relPath).catch(async (err: unknown) => {
      const { filenameMetadata } = await import('../metadata.ts');
      const fallback = filenameMetadata(ctx.relPath);
      fallback.raw = { parseError: err instanceof Error ? err.message : String(err) };
      return fallback;
    });
    const cover = await extractEpubCover(buf).catch(() => undefined);

    return {
      format: 'epub',
      kind: 'reflowable',
      contentHash,
      size: buf.byteLength,
      // The spine length is cheap to read here and gives the client a real
      // progress denominator before it has fetched the manifest.
      pageCount: await spineLength(buf),
      metadata,
      cover,
    };
  },

  /**
   * The spine, described as windows of chapters.
   *
   * `?group=N` on the items endpoint is not just a comic-volume thing: for a
   * reflowable book it means "chapters N*40 .. N*40+39". That is what lets the
   * client open a 1200-chapter omnibus without a 400KB manifest, and it is why
   * the chapter count of a window is a constant rather than a per-book choice —
   * a client that knows the window size can jump straight to the chapter holding
   * a saved position.
   */
  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const archive = await ZipArchive.open(ctx.absPath);
    const pkg = await readPackage(archive);
    const spines = pkg.spine;
    const total = spines.length;
    const titles = pkg.titles;

    return {
      kind: 'reflowable',
      total,
      groups: buildGroups(spines, titles),
      items: spines.map((item, index) => ({
        id: item.path,
        seq: index,
        title: titles.get(item.path) ?? `第 ${index + 1} 章`,
        kind: 'chapter' as const,
        mediaType: 'application/xhtml+xml',
        // Path-addressed, never index-addressed: see the module comment.
        href: `xhtml:${item.path}`,
        size: archive.get(item.path)?.uncompressedSize ?? undefined,
      })),
    };
  },

  /**
   * Every chapter, by name.
   *
   * This is the book's table of contents, not the manifest's windows. It exists
   * because windowing made the two groups in the manifest (`第 1 章 – 第 40 章`)
   * look like a table of contents, which no reader wants to see.
   */
  async toc(ctx: HandlerContext): Promise<TocEntry[]> {
    const archive = await ZipArchive.open(ctx.absPath);
    const pkg = await readPackage(archive);
    return pkg.spine.map((item, index) => ({
      href: `xhtml:${item.path}`,
      title: pkg.titles.get(item.path) ?? `第 ${index + 1} 章`,
      level: 0,
      spine: index,
    }));
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const archive = await ZipArchive.open(ctx.absPath);

    if (req.ref.startsWith('xhtml:')) {
      const path = safeDecode(req.ref.slice('xhtml:'.length));
      const entry = archive.get(path);
      if (!entry) throw new Error(`chapter not found: ${path}`);

      const xhtml = await archive.read(path, MAX_CHAPTER_BYTES);
      const rewritten = rewriteChapterDocument(xhtml.toString('utf8'), {
        path,
        baseDir: posix.dirname(path),
        assetUrl: (archivePath, fragment) =>
          `${assetBase(ctx)}?ref=${encodeURIComponent(archivePath)}${fragment ? `#${fragment}` : ''}`,
        exists: (archivePath) => archive.has(archivePath),
      });

      const body = Buffer.from(rewritten, 'utf8');
      return {
        // A chapter is a text document; streaming it would buy nothing and cost
        // a second pass over the container.
        data: body,
        contentType: 'application/xhtml+xml; charset=utf-8',
        filename: posix.basename(path),
        size: body.byteLength,
      };
    }

    // Everything else is addressed by its archive path, percent-encoded by the
    // client when it needs to. Styles, fonts, images and the OPF land here.
    const name = safeDecode(req.ref);
    const entry = archive.get(name);
    if (!entry) throw new Error(`resource not found: ${req.ref}`);

    return {
      // Streamed, not buffered: an illustrated EPUB's images are exactly the
      // case where "just read it into a Buffer" stops being free.
      stream: await archive.openStream(name),
      contentType: contentTypeFor(name),
      filename: posix.basename(name),
      size: entry.uncompressedSize,
      seekable: true,
      etag: ctx.bookId,
    };
  },
});

/** Base URL of this book's asset endpoint, used when rewriting chapter links. */
function assetBase(ctx: HandlerContext): string {
  if (!ctx.bookId) {
    // Only reachable if a handler is called outside the request path (tests,
    // tooling). Failing loudly beats emitting links that point nowhere.
    throw new Error('HandlerContext.bookId is required to rewrite chapter links');
  }
  return `/api/v1/books/${encodeURIComponent(ctx.bookId)}/assets`;
}

interface SpineItem {
  /** Archive path of the document. This is the identity of a chapter. */
  path: string;
}

interface Package {
  spine: SpineItem[];
  titles: Map<string, string>;
}

/**
 * Read the OPF through the project's own ZIP reader.
 *
 * The parsing is deliberately the same shape as the JSZip version it replaces —
 * the OPF grammar does not care which container library opened the file — but it
 * now reads only the package document instead of the whole archive.
 */
async function readPackage(archive: ZipArchive): Promise<Package> {
  const empty: Package = { spine: [], titles: new Map() };
  const containerEntry = archive.get('META-INF/container.xml');
  let opfPath = '';
  if (containerEntry) {
    const container = xmlParser.parse((await archive.read('META-INF/container.xml')).toString('utf8')) as Record<string, any>;
    const rootfile = asArray(container?.container?.rootfiles?.rootfile).find(
      (entry) => typeof entry?.['@_full-path'] === 'string',
    );
    opfPath = String(rootfile?.['@_full-path'] ?? '');
  }
  if (!opfPath) {
    opfPath = archive.entries.find((entry) => entry.name.toLowerCase().endsWith('.opf'))?.name ?? '';
  }
  if (!opfPath || !archive.get(opfPath)) return empty;

  const opf = xmlParser.parse((await archive.read(opfPath)).toString('utf8')) as Record<string, any>;
  const pkg = opf?.package ?? {};
  const base = posix.dirname(opfPath);

  const manifest = new Map<string, string>();
  for (const item of asArray(pkg?.manifest?.item)) {
    const id = String(item?.['@_id'] ?? '');
    const href = String(item?.['@_href'] ?? '');
    if (!id || !href) continue;
    // hrefs are relative to the package document, not to the archive root.
    manifest.set(id, resolveHref(base, href));
  }

  const spine: SpineItem[] = [];
  for (const ref of asArray(pkg?.spine?.itemref)) {
    const target = manifest.get(String(ref?.['@_idref'] ?? ''));
    if (target) spine.push({ path: target });
  }

  return { spine, titles: await readTitles(archive, base) };
}

/**
 * Groups of at most `CHAPTER_WINDOW` spine entries.
 *
 * Encoding `offset` in the group matters: a client that fetched one window must
 * be able to tell where it belongs in the whole book. Deriving it by summing the
 * previous `count`s works only if the client has every group, which is exactly
 * what windowed loading avoids.
 */
function buildGroups(spine: SpineItem[], titles: Map<string, string>): Manifest['groups'] {
  if (spine.length === 0) return [];
  const groups: Manifest['groups'] = [];
  for (let offset = 0; offset < spine.length; offset += CHAPTER_WINDOW) {
    const count = Math.min(CHAPTER_WINDOW, spine.length - offset);
    const label = (index: number): string =>
      titles.get(spine[index]!.path) ?? `第 ${index + 1} 章`;
    groups.push({
      id: `spine:${offset}`,
      seq: groups.length,
      // A window is not a chapter, so it is labelled by the range it covers
      // rather than pretending to be one.
      title: count === 1 ? label(offset) : `${label(offset)} – ${label(offset + count - 1)}`,
      count,
      offset,
    });
  }
  return groups;
}

/** Best-effort chapter titles from the NCX or nav document. */
async function readTitles(archive: ZipArchive, base: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();

  const ncxName = archive.entries.find((entry) => entry.name.toLowerCase().endsWith('.ncx'))?.name;
  if (ncxName) {
    const ncx = await archive.read(ncxName).catch(() => null);
    if (ncx) {
      for (const match of ncx.toString('utf8').matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/gi)) {
        const block = match[0];
        const label = /<text>([\s\S]*?)<\/text>/i.exec(block)?.[1]?.trim();
        const src = /<content\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(block)?.[1];
        if (!label || !src) continue;
        const resolved = resolveHref(base, src.split('#')[0]!);
        if (!titles.has(resolved)) titles.set(resolved, decodeEntities(label));
      }
    }
  }

  const navName = archive.entries.find((entry) => /nav\.x?html?$/i.test(entry.name))?.name;
  if (navName) {
    const nav = await archive.read(navName).catch(() => null);
    if (nav) {
      for (const match of nav.toString('utf8').matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const raw = match[1]!;
        const label = decodeEntities(match[2]!.replace(/<[^>]*>/g, '').trim());
        if (!label) continue;
        const resolved = resolveHref(base, raw.split('#')[0]!);
        if (!titles.has(resolved)) titles.set(resolved, label);
      }
    }
  }

  return titles;
}

function resolveHref(base: string, href: string): string {
  const decoded = safeDecode(href);
  return base === '.' ? posix.normalize(decoded) : posix.normalize(`${base}/${decoded}`);
}

async function spineLength(buf: Buffer): Promise<number | null> {
  try {
    const archive = await ZipArchive.openBuffer(buf);
    const { spine } = await readPackage(archive);
    return spine.length || null;
  } catch (err) {
    // Returning null silently here was how the spine length went missing for
    // every book while the test suite stayed green: `null` is also the legitimate
    // answer for a format that cannot know its length, so the two are
    // indistinguishable downstream. Log it so a real failure is visible.
    const { log } = await import('../../lib/log.ts');
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'could not read the epub spine');
    return null;
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

interface ChapterContext {
  /** Archive path of the chapter being served. */
  path: string;
  /** Directory the chapter's relative references resolve against. */
  baseDir: string;
  assetUrl: (archivePath: string, fragment: string) => string;
  exists: (archivePath: string) => boolean;
}

/**
 * Turn an archive chapter into a document a WebView can render standalone.
 *
 * Two transforms, both about the same problem — the document is being served
 * from outside the container, so anything it refers to relatively is broken:
 *
 *  1. Rewrite relative `src`/`href` to absolute asset URLs.
 *  2. Publish the chapter's own URLs as CSS custom properties. The container
 *     image is displayed in a Shadow DOM, where `:root` is not the element that
 *     ends up holding the CSS variables, so a publisher's
 *     `background-image: var(--reader-chapter-dir)` would silently do nothing
 *     without a `<style>` inside the container to anchor them.
 *
 * `exists` guards transform 1: absolute URLs, `data:` URIs, in-document anchors
 * and mail links are skipped, which is what keeps footnotes and outbound links
 * alive instead of turning them into dead asset requests.
 */
export function rewriteChapterDocument(xhtml: string, chapter: ChapterContext): string {
  const withAssets = rewriteRelativeReferences(
    xhtml,
    chapter.baseDir,
    chapter.assetUrl,
    chapter.exists,
  );
  return injectReaderAssets(withAssets, chapter);
}

/**
 * The only markup the server adds to a book.
 *
 * Deliberately declarative: two variable definitions a publisher's stylesheet
 * may consume, and nothing else. No layout rule, no font choice, no margin
 * override — those would flatten exactly the typography this product exists to
 * preserve.
 */
function injectReaderAssets(xhtml: string, chapter: ChapterContext): string {
  const vars = [
    '--reader-chapter-url: url("' + escapeAttribute(chapter.assetUrl(chapter.path, '')) + '");',
    '--reader-parent-url: url("' + escapeAttribute(chapter.assetUrl(chapter.baseDir, '')) + '");',
  ].join('');
  const style = `<style id="reader-vars">:root{${vars}}</style>`;
  // Appended at the end of the document so it follows the publisher's own
  // stylesheets in source order and wins on equal specificity, without needing
  // `!important` gymnastics.
  if (/<\/body>/i.test(xhtml)) return xhtml.replace(/<\/body>/i, `${style}</body>`);
  if (/<\/html>/i.test(xhtml)) return xhtml.replace(/<\/html>/i, `${style}</html>`);
  return `${xhtml}${style}`;
}

/**
 * Rewrite relative `src`/`href` attributes to absolute asset URLs.
 *
 * A chapter arrives as XHTML with references relative to the OPF's directory
 * (`images/pic.png`). The client fetched that document from the asset endpoint,
 * not from inside the archive, so left alone every image, stylesheet and font
 * resolves to a 404 and the book renders as unstyled text with broken images.
 *
 * `resolve` reports whether the target exists inside the archive. That check is
 * what keeps the rewrite safe: absolute URLs, `data:` URIs, in-document anchors
 * (`#note7`) and mail links are skipped, so footnotes and outbound links keep
 * working instead of being turned into dead asset requests.
 */
export function rewriteRelativeReferences(
  xhtml: string,
  baseDir: string,
  assetUrl: (archivePath: string, fragment: string) => string,
  resolve: (archivePath: string) => unknown,
): string {
  return xhtml.replace(
    /\b(src|href|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (full: string, attr: string, _quoted: string, doubleQuoted?: string, singleQuoted?: string) => {
      const value = doubleQuoted ?? singleQuoted ?? '';
      if (!value) return full;
      // A scheme (`https:`, `data:`, `mailto:`), a protocol-relative URL or a
      // bare fragment is not something we can or should resolve.
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return full;

      const [path, fragment] = splitFragment(value);
      if (!path) return full;
      const resolved = posix.normalize(baseDir === '.' ? path : `${baseDir}/${path}`);
      if (!resolve(resolved)) return full;

      return `${attr}="${escapeAttribute(assetUrl(resolved, fragment))}"`;
    },
  );
}

/** Escape a URL for embedding in a double-quoted attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function splitFragment(value: string): [string, string] {
  const index = value.indexOf('#');
  if (index < 0) return [value, ''];
  return [value.slice(0, index), value.slice(index + 1)];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

void Readable;
