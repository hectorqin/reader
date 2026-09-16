/**
 * Image extensions and their content types.
 *
 * Shared by the comic handlers and the scanner so the two can never disagree
 * about what counts as a page — a mismatch there means an image is listed in
 * the manifest but returns an error when the client requests it.
 */
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  jxl: 'image/jxl',
};

export function isImageExtension(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(IMAGE_CONTENT_TYPES, ext.toLowerCase().replace(/^\./, ''));
}

export function imageContentType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

const ZIP_IMAGE_TYPES: Record<string, string> = {
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.cbz': 'application/vnd.comicbook+zip',
  '.cbr': 'application/vnd.comicbook-rar',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ncx': 'application/x-dtbncx+xml',
  '.opf': 'application/oebps-package+xml',
};

/**
 * Content type for a resource inside a container, falling back to the declared
 * media type and then to the extension. Containers routinely declare
 * `application/octet-stream` for images, which would make a WebView refuse to
 * render them, so the extension wins over a generic declared type.
 */
export function contentTypeFor(name: string, declared?: string | undefined): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const generic = !declared || declared === 'application/octet-stream';
  if (!generic) return declared;
  return ZIP_IMAGE_TYPES[ext] ?? imageContentType(name);
}
