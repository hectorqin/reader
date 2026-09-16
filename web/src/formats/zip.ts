import JSZip from 'jszip';

/**
 * Read-only ZIP access shared by EPUB and CBZ.
 *
 * The whole archive is held in memory. That is a deliberate trade for a mobile
 * renderer: a second read pass would mean either re-downloading the book or
 * running a random-access file layer over IndexedDB, and both cost more than
 * the archive itself for the sizes this product targets (a few hundred MB of
 * pages is already at the edge of what a phone should hold open).
 */
export class BookArchive {
  private constructor(private readonly zip: JSZip) {}

  static async open(bytes: Uint8Array): Promise<BookArchive> {
    const zip = await JSZip.loadAsync(bytes);
    return new BookArchive(zip);
  }

  names(): string[] {
    const out: string[] = [];
    this.zip.forEach((path, entry) => {
      if (!entry.dir) out.push(path);
    });
    return out;
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const file = this.zip.file(path);
    if (!file) {
      // Some archives store paths with a leading slash or in a different case;
      // retry the common variants rather than failing the whole book.
      const normalised = normalise(path);
      const found = this.names().find((name) => normalise(name) === normalised);
      if (!found) return null;
      const fallback = this.zip.file(found);
      return fallback ? fallback.async('uint8array') : null;
    }
    return file.async('uint8array');
  }

  async text(path: string): Promise<string | null> {
    const bytes = await this.bytes(path);
    if (!bytes) return null;
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function normalise(path: string): string {
  return decodeURIComponent(path).replace(/^\.?\//, '').toLowerCase();
}

/** Resolves a relative href against a base directory, collapsing `../`. */
export function resolveHref(base: string, href: string): string {
  const cleanHref = href.split('#')[0]!.split('?')[0]!;
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleanHref)) return cleanHref; // absolute URL
  const baseParts = base === '' ? [] : base.split('/').filter(Boolean);
  const hrefParts = decodeURIComponent(cleanHref).split('/');
  const stack = [...baseParts];
  for (const part of hrefParts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

export function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function extensionOf(path: string): string {
  const clean = path.split('#')[0]!.split('?')[0]!;
  const index = clean.lastIndexOf('.');
  return index === -1 ? '' : clean.slice(index + 1).toLowerCase();
}
