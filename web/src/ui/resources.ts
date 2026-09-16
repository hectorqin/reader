import type { Resource } from '../formats/types.ts';

/**
 * Resolves `reader-res:` URLs found in injected content.
 *
 * Injected chapter markup never touches the network directly. The loader rewrote
 * every local reference into `reader-res:<archive path>`, and the page installs a
 * protocol handler that looks the path up in this map. Two reasons:
 *
 *  - **Books cannot phone home.** A document with absolute URLs is left alone
 *    and blocked by the page's CSP, so a book from an unknown source cannot
 *    leak a reading session to a remote host.
 *  - **Nothing is pre-extracted.** Only resources the rendered chapter actually
 *    asks for are ever materialised, which is what keeps a 400MB comic-adjacent
 *    EPUB from expanding into memory when it is opened.
 */
export class ResourceResolver {
  private readonly urls = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(private readonly resources: Map<string, Resource>) {}

  has(path: string): boolean {
    return this.resources.has(path);
  }

  /**
   * Returns a URL the browser can load. Object URLs are preferred: a data URL
   * for a 2MB page image re-encodes the whole payload as base64 and doubles it
   * in memory.
   */
  async urlFor(path: string): Promise<string | null> {
    const cached = this.urls.get(path);
    if (cached) return cached;
    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight;

    const resource = this.resources.get(path);
    if (!resource) return null;

    const promise = (async () => {
      const bytes = await resource.bytes();
      const url = toObjectUrl(bytes, resource.mediaType);
      this.urls.set(path, url);
      this.pending.delete(path);
      return url;
    })().catch(() => {
      this.pending.delete(path);
      return null;
    });
    this.pending.set(path, promise);
    return promise;
  }

  /** Routes a `reader-res:` URL, returning null when it is not one. */
  async resolveReaderUrl(url: string): Promise<string | null> {
    if (!url.startsWith('reader-res:')) return null;
    return this.urlFor(url.slice('reader-res:'.length));
  }

  /** Frees every object URL. Called when a book is closed. */
  dispose(): void {
    for (const url of this.urls.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // A revoked or already-freed URL is not worth reporting.
      }
    }
    this.urls.clear();
    this.pending.clear();
  }
}

export function toObjectUrl(bytes: Uint8Array, mediaType: string): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mediaType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

/**
 * Rewrites every `reader-res:` occurrence in a live DOM subtree to a resolved
 * URL, and keeps the original path for later cleanup.
 *
 * `<img>`, `<image>` (inline SVG), `<link>`, `<source>` and `<video>` cover
 * everything an EPUB actually uses for local assets.
 */
export async function hydrateResources(root: ParentNode, resolver: ResourceResolver): Promise<void> {
  const tasks: Array<Promise<void>> = [];

  for (const element of root.querySelectorAll('[src]')) {
    const value = element.getAttribute('src') ?? '';
    if (!value.startsWith('reader-res:')) continue;
    tasks.push(
      resolver.resolveReaderUrl(value).then((url) => {
        if (url) element.setAttribute('src', url);
      }),
    );
  }

  for (const element of root.querySelectorAll('use')) {
    const value = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
    if (!value.startsWith('reader-res:')) continue;
    tasks.push(
      resolver.resolveReaderUrl(value).then((url) => {
        if (url) {
          element.setAttribute('href', url);
          element.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
        }
      }),
    );
  }

  for (const link of root.querySelectorAll('link[rel~="stylesheet"], link[rel~="icon"]')) {
    const value = link.getAttribute('href') ?? '';
    if (!value.startsWith('reader-res:')) continue;
    tasks.push(
      resolver.resolveReaderUrl(value).then((url) => {
        if (url) link.setAttribute('href', url);
      }),
    );
  }

  for (const element of root.querySelectorAll('[srcset]')) {
    const value = element.getAttribute('srcset') ?? '';
    const rewritten = await rewriteSrcset(value, resolver);
    if (rewritten !== value) element.setAttribute('srcset', rewritten);
  }

  await Promise.all(tasks);
}

async function rewriteSrcset(value: string, resolver: ResourceResolver): Promise<string> {
  const parts = value.split(',');
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [url, ...descriptor] = trimmed.split(/\s+/);
    const resolved = url ? await resolver.resolveReaderUrl(url) : null;
    out.push([resolved ?? url ?? '', ...descriptor].join(' '));
  }
  return out.join(', ');
}
