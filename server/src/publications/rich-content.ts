import sanitize from 'sanitize-html';
import { badRequest, AppError } from '../lib/errors.ts';
import type { ResourceResponse } from '../sources/types.ts';

export const MAX_RICH_BYTES = 8 * 1024 * 1024;
const TAGS = ['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ruby', 'rt', 'rp', 'pre', 'code', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'img'];
export function chapterMedia(type: string): string {
  const [media = '', ...params] = type.toLowerCase().split(';');
  if (!['text/plain', 'text/html', 'application/xhtml+xml'].includes(media.trim()) ||
      params.some((p) => /^charset\s*=/i.test(p.trim()) && !/^charset\s*=\s*"?utf-?8"?$/i.test(p.trim()))) {
    throw badRequest('chapter content must be UTF-8 text or HTML', 'UNSUPPORTED_FORMAT');
  }
  return media.trim() === 'text/plain' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8';
}

/** Only passive raster images are embedded. No URLs from a plugin reach the browser. */
export function raster(resource: ResourceResponse): { type: string; bytes: Buffer } {
  resource.stream?.destroy();
  if (!resource.data || resource.text !== undefined || resource.stream || resource.data.byteLength > 2 * 1024 * 1024) {
    throw badRequest('image must contain bounded binary data', 'INVALID_RESOURCE');
  }
  const bytes = Buffer.from(resource.data);
  const type = resource.mediaType.split(';')[0]!.trim().toLowerCase();
  const valid = (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
    (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (type === 'image/gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) ||
    (type === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
  if (!valid) throw badRequest('only PNG, JPEG, GIF and WebP images with matching bytes are supported', 'INVALID_RESOURCE');
  return { type, bytes };
}

export async function richContent(html: string, read: (ref: string) => Promise<ResourceResponse>): Promise<string> {
  const references = new Set<string>();
  const cleaned = sanitize(html, {
    allowedTags: TAGS,
    allowedAttributes: { img: ['src', 'alt'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
    allowedSchemes: ['reader-res'], allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attrs): sanitize.Tag => {
        const src = attrs.src ?? '';
        if (!src.startsWith('reader-res:') || src.length > 16_384 || src.length === 11) {
          return { tagName: 'span', attribs: {}, text: attrs.alt || '[图片不可用]' };
        }
        references.add(src.slice(11));
        return { tagName: 'img', attribs: { src, alt: attrs.alt ?? '' } };
      },
    },
  });
  if (references.size > 32) throw new AppError(413, 'CHAPTER_TOO_LARGE', 'chapter has more than 32 images');
  const images = new Map<string, string>();
  let size = Buffer.byteLength(cleaned);
  for (const ref of references) {
    const { type, bytes } = raster(await read(ref));
    const url = `data:${type};base64,${bytes.toString('base64')}`;
    size += url.length;
    if (size > MAX_RICH_BYTES) throw new AppError(413, 'CHAPTER_TOO_LARGE', 'chapter and images exceed 8 MiB');
    images.set(`reader-res:${ref}`, url);
  }
  const result = sanitize(cleaned, {
    allowedTags: TAGS, allowedAttributes: { '*': ['colspan', 'rowspan'], img: ['src', 'alt'] },
    allowedSchemes: ['data'], allowedSchemesByTag: { img: ['data'] },
    transformTags: { img: (_tag, attrs) => ({ tagName: 'img', attribs: { ...attrs, src: images.get(attrs.src ?? '') ?? '' } }) },
  });
  if (Buffer.byteLength(result) > MAX_RICH_BYTES) throw new AppError(413, 'CHAPTER_TOO_LARGE', 'expanded chapter exceeds 8 MiB');
  return result;
}
