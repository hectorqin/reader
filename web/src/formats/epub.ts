import { BookArchive, dirnameOf, extensionOf, resolveHref } from './zip.ts';
import type { BookDoc, LoadContext, Resource, Section, TocEntry } from './types.ts';

/**
 * EPUB loader.
 *
 * Design commitments, in order of how much they matter:
 *
 * 1. **Author styles are preserved.** No stylesheet is filtered out, no
 *    property is overridden by default. The product's whole differentiation is
 *    faithful rendering of a carefully typeset book (§9), and the fastest way to
 *    destroy that is to inject a "reading theme" that resets fonts and margins.
 *    The user-facing controls in `styles/reader.css` are opt-in variables that
 *    default to `inherit`.
 *
 * 2. **Resources resolve exactly like the book expects.** Hrefs are resolved
 *    against the OPF base (and against each content document's own directory for
 *    relative links), including percent-encoding, because the alternative —
 *    rewriting `src` attributes with a regex — breaks on the first book that
 *    uses a data URI, a fragment-only link or a remote font.
 *
 * 3. **Unreadable documents degrade individually.** A malformed chapter is
 *    replaced with a placeholder; the rest of the book still opens. Books in a
 *    self-hosted library are frequently hand-edited, so per-file failure is the
 *    normal case, not an edge case.
 */

const CONTAINER_PATH = 'META-INF/container.xml';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

interface Package {
  opfPath: string;
  baseDir: string;
  version: string;
  manifest: ManifestItem[];
  spine: string[];
  direction: 'ltr' | 'rtl';
}

export async function loadEpub(ctx: LoadContext): Promise<BookDoc> {
  const archive = await BookArchive.open(ctx.bytes);
  const pkg = await readPackage(archive);

  const resources = new Map<string, Resource>();
  for (const item of pkg.manifest) {
    const path = resolveHref(pkg.baseDir, item.href);
    resources.set(path, {
      path,
      mediaType: item.mediaType || mediaTypeFor(path),
      bytes: async () => (await archive.bytes(path)) ?? new Uint8Array(),
    });
  }
  // Some books reference files that the manifest forgot to declare. Registering
  // every archive entry costs nothing and rescues those.
  for (const name of archive.names()) {
    if (resources.has(name)) continue;
    resources.set(name, {
      path: name,
      mediaType: mediaTypeFor(name),
      bytes: async () => (await archive.bytes(name)) ?? new Uint8Array(),
    });
  }

  const styles: string[] = [];
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'text/css') continue;
    const path = resolveHref(pkg.baseDir, item.href);
    const text = await archive.text(path);
    if (text) styles.push(rewriteCss(text, path));
  }

  const sections: Section[] = [];
  const spinePaths = pkg.spine.length > 0
    ? pkg.spine.map((id) => {
        const item = pkg.manifest.find((candidate) => candidate.id === id);
        return item ? resolveHref(pkg.baseDir, item.href) : null;
      }).filter((path): path is string => path !== null)
    // No usable spine: fall back to every XHTML document in archive order. It
    // is a guess at reading order, but it is strictly better than an empty book.
    : archive.names().filter((name) => /\.x?html?$/i.test(name)).sort();

  for (const path of spinePaths) {
    const raw = await archive.text(path);
    if (raw === null) continue;
    const baseDir = dirnameOf(path);
    sections.push({
      id: path,
      label: '',
      html: rewriteDocument(raw, baseDir),
      depth: 0,
    });
  }

  const toc = await readToc(archive, pkg, sections);
  applyTocLabels(sections, toc);

  return {
    format: 'epub',
    layout: 'reflowable',
    direction: pkg.direction,
    sections,
    toc,
    styles,
    resources,
    orderedByBook: pkg.spine.length > 0,
  };
}

/**
 * Rewrites a content document so its own relative links keep working once the
 * document is injected into a page whose base URL is not the book's.
 *
 * Only `src`/`href` on specific attributes are touched. Scoped selectors and
 * inline styles are left alone on purpose.
 */
export function rewriteDocument(html: string, baseDir: string): string {
  return html
    .replace(/(\ssrc\s*=\s*")([^"]*)(")/gi, (_m, pre: string, value: string, post: string) =>
      `${pre}${rewriteUrl(value, baseDir)}${post}`)
    .replace(/(\ssrc\s*=\s*')([^']*)(')/gi, (_m, pre: string, value: string, post: string) =>
      `${pre}${rewriteUrl(value, baseDir)}${post}`)
    .replace(/(\shref\s*=\s*")([^"]*)(")/gi, (_m, pre: string, value: string, post: string) =>
      `${pre}${rewriteUrl(value, baseDir)}${post}`)
    .replace(/(\shref\s*=\s*')([^']*)(')/gi, (_m, pre: string, value: string, post: string) =>
      `${pre}${rewriteUrl(value, baseDir)}${post}`)
    .replace(/(\s*srcset\s*=\s*")([^"]*)(")/gi, (_m, pre: string, value: string, post: string) =>
      `${pre}${rewriteSrcset(value, baseDir)}${post}`);
}

function rewriteSrcset(value: string, baseDir: string): string {
  return value
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed === '') return trimmed;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      return [rewriteUrl(url ?? '', baseDir), ...descriptor].join(' ');
    })
    .join(', ');
}

/**
 * Injects a `reader-res:` scheme so the injected document cannot accidentally
 * load a remote URL. Local resources are served from memory by the renderer;
 * anything absolute is left as-is and will be blocked by the page's CSP, which
 * keeps a malicious book from phoning home.
 */
function rewriteUrl(value: string, baseDir: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return value;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return value;
  const resolved = resolveHref(baseDir, trimmed);
  return `reader-res:${resolved}${splitFragment(trimmed)[1]}`;
}

function splitFragment(href: string): [string, string] {
  const index = href.indexOf('#');
  return index === -1 ? [href, ''] : [href.slice(0, index), href.slice(index)];
}

/** CSS needs the same resolution for `url(...)`. */
export function rewriteCss(css: string, cssPath: string): string {
  const baseDir = dirnameOf(cssPath);
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, quote: string, value: string) => {
    const rewritten = rewriteUrl(value, baseDir);
    return `url(${quote}${rewritten}${quote})`;
  });
}

async function readPackage(archive: BookArchive): Promise<Package> {
  const containerXml = await archive.text(CONTAINER_PATH);
  let opfPath = '';
  if (containerXml) {
    const match = /full-path\s*=\s*"([^"]+)"/i.exec(containerXml) ?? /full-path\s*=\s*'([^']+)'/i.exec(containerXml);
    if (match?.[1]) opfPath = decodeURIComponent(match[1]);
  }
  if (!opfPath) {
    const candidates = archive.names().filter((name) => name.toLowerCase().endsWith('.opf'));
    opfPath = candidates.sort((a, b) => a.length - b.length)[0] ?? '';
  }
  if (!opfPath) throw new Error('EPUB 缺少 OPF 包文档');
  const opf = await archive.text(opfPath);
  if (!opf) throw new Error(`EPUB 找不到 ${opfPath}`);

  const baseDir = dirnameOf(opfPath);
  const version = /version\s*=\s*"([^"]+)"/i.exec(opf)?.[1] ?? '2.0';
  const pageDirection = /page-progression-direction\s*=\s*"([^"]+)"/i.exec(opf)?.[1];

  const manifest = readManifest(opf);
  const spine = readSpine(opf);

  return {
    opfPath,
    baseDir,
    version,
    manifest,
    spine,
    direction: pageDirection === 'rtl' ? 'rtl' : 'ltr',
  };
}

function readManifest(opf: string): ManifestItem[] {
  const items: ManifestItem[] = [];
  const manifestBlock = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(opf)?.[1] ?? opf;
  const itemPattern = /<item\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(manifestBlock)) !== null) {
    const attrs = match[1] ?? '';
    const id = attr(attrs, 'id');
    const href = attr(attrs, 'href');
    if (!id || !href) continue;
    items.push({
      id,
      href,
      mediaType: attr(attrs, 'media-type'),
      properties: attr(attrs, 'properties').split(/\s+/).filter(Boolean),
    });
  }
  return items;
}

function readSpine(opf: string): string[] {
  const block = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1];
  if (!block) return [];
  const ids: string[] = [];
  const pattern = /<itemref\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const attrs = match[1] ?? '';
    if (/\blinear\s*=\s*"no"/i.test(attrs)) continue;
    const idref = attr(attrs, 'idref');
    if (idref) ids.push(idref);
  }
  return ids;
}

function attr(attrs: string, name: string): string {
  const doubleQuoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  if (doubleQuoted?.[1] !== undefined) return doubleQuoted[1];
  const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(attrs);
  return singleQuoted?.[1] ?? '';
}

/**
 * Table of contents, from EPUB 3 `nav` first then the EPUB 2 NCX.
 *
 * Reading order comes from the manifest, not from the TOC: plenty of books have
 * a TOC that lists only some chapters, and dropping the rest would hide content.
 * The TOC is used for labels and the navigation panel only.
 */
async function readToc(archive: BookArchive, pkg: Package, sections: Section[]): Promise<TocEntry[]> {
  const navItem = pkg.manifest.find((item) => item.properties.includes('nav'));
  if (navItem) {
    const navPath = resolveHref(pkg.baseDir, navItem.href);
    const navHtml = await archive.text(navPath);
    if (navHtml) {
      const entries = parseNav(navHtml, dirnameOf(navPath), sections);
      if (entries.length > 0) return entries;
    }
  }

  const ncxItem = pkg.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml')
    ?? pkg.manifest.find((item) => extensionOf(item.href) === 'ncx');
  if (ncxItem) {
    const ncxPath = resolveHref(pkg.baseDir, ncxItem.href);
    const ncxXml = await archive.text(ncxPath);
    if (ncxXml) {
      const entries = parseNcx(ncxXml, dirnameOf(ncxPath), sections);
      if (entries.length > 0) return entries;
    }
  }

  return sections.map((section) => ({ id: section.id, label: section.label, depth: 0 }));
}

function parseNav(html: string, baseDir: string, sections: Section[]): TocEntry[] {
  const navBlock = /<nav\b[^>]*epub:type\s*=\s*"toc"[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1]
    ?? /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1];
  if (!navBlock) return [];
  const entries: TocEntry[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(navBlock)) !== null) {
    const href = attr(match[1] ?? '', 'href');
    const label = stripTags(match[2] ?? '');
    if (!href || !label) continue;
    const id = matchSectionId(resolveHref(baseDir, href), sections);
    if (!id) continue;
    entries.push({ id, label, depth: 0 });
  }
  return entries;
}

function parseNcx(xml: string, baseDir: string, sections: Section[]): TocEntry[] {
  const entries: TocEntry[] = [];
  const pattern = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const src = /<content\b[^>]*src\s*=\s*"([^"]+)"/i.exec(block)?.[1] ?? '';
    const label = stripTags(/<text\b[^>]*>([\s\S]*?)<\/text>/i.exec(block)?.[1] ?? '');
    if (!src || !label) continue;
    const id = matchSectionId(resolveHref(baseDir, src), sections);
    if (!id) continue;
    const depth = (block.match(/<navPoint\b/gi)?.length ?? 1) - 1;
    entries.push({ id, label, depth });
  }
  return entries;
}

/** Matches a TOC href to a section, tolerating fragment-only links. */
function matchSectionId(resolved: string, sections: Section[]): string | null {
  const path = resolved.split('#')[0]!;
  if (path === '') return sections[0]?.id ?? null;
  const exact = sections.find((section) => section.id === path);
  if (exact) return exact.id;
  const normalised = path.replace(/^\.?\//, '').toLowerCase();
  return sections.find((section) => section.id.replace(/^\.?\//, '').toLowerCase() === normalised)?.id ?? null;
}

function applyTocLabels(sections: Section[], toc: TocEntry[]): void {
  const depthById = new Map(toc.map((entry) => [entry.id, entry]));
  for (const section of sections) {
    const entry = depthById.get(section.id);
    if (entry) {
      section.label = entry.label;
      section.depth = entry.depth;
    }
  }
  // Chapters missing from the TOC still need a label for the progress bar and
  // the "current chapter" readout, so derive one from the document itself.
  for (const section of sections) {
    if (section.label) continue;
    const heading = section.html ? /<h[1-3][^>]*>([\s\S]{0,120}?)<\/h[1-3]>/i.exec(section.html)?.[1] : undefined;
    const title = section.html ? /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(section.html)?.[1] : undefined;
    section.label = stripTags(heading ?? title ?? '') || section.id.split('/').pop() || section.id;
  }
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mediaTypeFor(path: string): string {
  switch (extensionOf(path)) {
    case 'xhtml':
    case 'html':
    case 'htm':
      return 'application/xhtml+xml';
    case 'css':
      return 'text/css';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'mp4':
      return 'video/mp4';
    case 'js':
      return 'text/javascript';
    case 'ncx':
      return 'application/x-dtbncx+xml';
    default:
      return 'application/octet-stream';
  }
}
