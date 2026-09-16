/**
 * Format registry bootstrap.
 *
 * Importing this module registers every supported format. Import order is
 * precedence, and it matters:
 *
 *   epub    -> .epub
 *   pdf     -> .pdf
 *   cbz     -> .cbz, .zip   (claims .zip only when the contents look like a comic)
 *   txt     -> .txt
 *   image   -> image extensions (last, so nothing specific is shadowed)
 *
 * Directory handlers have no extension and are consulted by the scanner after
 * the file walk.
 *
 * The scanner and HTTP layers only talk to `./registry.ts`; nothing outside this
 * folder needs to change when a format is added or removed.
 */

import './epub.ts';
import './pdf.ts';
import './comic-archive.ts';
import './text.ts';
import './image.ts';
import './comic-directory.ts';

export * from './registry.ts';
export { ZipArchive, ZipError } from './zip-reader.ts';
export { naturalCompare, naturalSortBy } from './natural-sort.ts';
export { decodeTextBuffer, splitChapters, readTextFile } from './text.ts';
export { isImageExtension, imageContentType, contentTypeFor } from './image-types.ts';
export { looksLikeComicDirectory } from './comic-directory.ts';
export { rewriteRelativeReferences } from './epub.ts';
