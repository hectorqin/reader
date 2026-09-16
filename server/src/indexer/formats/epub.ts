import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { contentTypeFor, imageContentType } from './image-types.ts';
import {
  registerFileHandler,
  type AssetPayload,
  type HandlerContext,
  type Manifest,
  type ParsedSource,
} from './registry.ts';
import { parseEpub, extractEpubCover } from '../metadata.ts';

/**
 * EPUB 2/3.
 *
 * This handler is deliberately thin — `metadata.ts` already parses the package
 * document for the scanner, and duplicating that here would give the two code
 * paths a chance to disagree about a book's identity.
 *
 * The one non-trivial job is rewriting resource URLs inside chapters. A chapter
 * arrives as XHTML with relative references (`images/pic1.png`, `../style.css`).
 * Sent to a WebView as-is those all 404, because the client fetched the chapter
 * from `/api/v1/books/:id/content`, not from inside the archive. So every
 * relative URL is rewritten to point back at our asset endpoint before the
 * chapter leaves the server.
 *
 * We deliberately do NOT inject any CSS or restructure the document. Preserving
 * the publisher's own layout is the product's core differentiator; the client's
 * WebView applies only minimal overrides on top.
 */

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

  async manifest(ctx: HandlerContext): Promise<Manifest> {
    const zip = await JSZip.loadAsync(await readAll(ctx.absPath));
    const { spine, titles } = await readSpine(zip, ctx.relPath);

    return {
      kind: 'reflowable',
      total: spine.length,
      groups: [{ id: 'spine', seq: 0, title: '正文', count: spine.length }],
      items: spine.map((item, index) => ({
        id: `s${index}`,
        seq: index,
        title: titles.get(item.href.split('#')[0]!) ?? item.title ?? `第 ${index + 1} 章`,
        kind: 'chapter' as const,
        mediaType: 'application/xhtml+xml',
        href: `chapter:${index}`,
      })),
    };
  },

  async asset(ctx: HandlerContext, req): Promise<AssetPayload> {
    const zip = await JSZip.loadAsync(await readAll(ctx.absPath));

    if (req.ref.startsWith('chapter:')) {
      const index = Number.parseInt(req.ref.slice('chapter:'.length), 10);
      const { spine } = await readSpine(zip, ctx.relPath);
      const item = spine[index];
      if (!item) throw new Error(`chapter ${index} is out of range`);

      const file = zip.file(item.href);
      if (!file) throw new Error(`missing chapter file: ${item.href}`);

      const xhtml = await file.async('string');
      // Rewrite relative references so a WebView can resolve them.
      const rewritten = rewriteRelativeReferences(
        xhtml,
        posix.dirname(item.href),
        // Point back at this same endpoint, keyed by the archive path. Using the
        // manifest id instead would need a lookup map that goes stale whenever
        // the container is repacked.
        (archivePath, fragment) =>
          `${assetBase(ctx)}?ref=${encodeURIComponent(archivePath)}${fragment ? `#${fragment}` : ''}`,
        (resolved) => Boolean(zip.file(resolved)),
      );
      return {
        data: Buffer.from(rewritten, 'utf8'),
        contentType: 'application/xhtml+xml; charset=utf-8',
        filename: posix.basename(item.href),
      };
    }

    // Everything else is addressed by its archive path, percent-encoded by the
    // client when it needs to. The OPF, images, fonts and styles all land here.
    const name = safeDecode(req.ref);
    const file = zip.file(name);
    if (!file) throw new Error(`resource not found: ${req.ref}`);

    return {
      data: await file.async('nodebuffer'),
      contentType: contentTypeFor(name),
      filename: posix.basename(name),
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

async function readAll(absPath: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(absPath);
}

interface SpineItem {
  id: string;
  href: string;
  title?: string;
}

/** Read the OPF spine: the reading order of the book. */
async function readSpine(zip: JSZip, relPath: string): Promise<{ spine: SpineItem[]; titles: Map<string, string> }> {
  const empty = { spine: [] as SpineItem[], titles: new Map<string, string>() };
  const container = zip.file('META-INF/container.xml');
  if (!container) return empty;

  const containerXml = await container.async('string');
  const opfPath =
    /full-path\s*=\s*"([^"]+)"/i.exec(containerXml)?.[1] ??
    Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf'));
  if (!opfPath) return empty;

  const opfFile = zip.file(opfPath);
  if (!opfFile) return empty;
  const opf = await opfFile.async('string');

  const base = posix.dirname(opfPath);
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0];
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    const href = /\bhref\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    if (id && href) {
      // Resolve against the OPF location: hrefs are relative to the package
      // document, not to the archive root.
      manifest.set(id, base === '.' ? href : posix.normalize(`${base}/${href}`));
    }
  }

  const spine: SpineItem[] = [];
  const spineBlock = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? '';
  for (const match of spineBlock.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = /\bidref\s*=\s*"([^"]+)"/i.exec(match[0])?.[1];
    const href = idref ? manifest.get(idref) : undefined;
    if (idref && href) spine.push({ id: idref, href });
  }

  return { spine, titles: await readTitles(zip, base) };
}

/** Best-effort chapter titles from the NCX or nav document. */
async function readTitles(zip: JSZip, base: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();

  const ncxName = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.ncx'));
  if (ncxName) {
    const ncx = await zip.file(ncxName)?.async('string');
    if (ncx) {
      for (const match of ncx.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/gi)) {
        const block = match[0];
        const label = /<text>([\s\S]*?)<\/text>/i.exec(block)?.[1]?.trim();
        const src = /<content\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(block)?.[1];
        if (!label || !src) continue;
        const resolved = posix.normalize(base === '.' ? src.split('#')[0]! : `${base}/${src.split('#')[0]!}`);
        if (!titles.has(resolved)) titles.set(resolved, decodeEntities(label));
      }
    }
  }

  const navName = Object.keys(zip.files).find((name) => /nav\.x?html?$/i.test(name));
  if (navName) {
    const nav = await zip.file(navName)?.async('string');
    if (nav) {
      for (const match of nav.matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const raw = match[1]!;
        const label = decodeEntities(match[2]!.replace(/<[^>]*>/g, '').trim());
        if (!label) continue;
        const href = raw.split('#')[0]!;
        const resolved = posix.normalize(
          base === '.' ? posix.normalize(href) : posix.normalize(`${base}/${href}`),
        );
        if (!titles.has(resolved)) titles.set(resolved, label);
      }
    }
  }

  return titles;
}

async function spineLength(buf: Buffer): Promise<number | null> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const { spine } = await readSpine(zip, '');
    return spine.length || null;
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
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

void imageContentType;
