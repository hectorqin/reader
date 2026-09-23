import sanitize from 'sanitize-html';
import { badRequest } from '../lib/errors.ts';
/** Counts readable Unicode characters, excluding whitespace; never treats markup as prose. */
export function chapterQuality(body: string, mediaType: string): { characters: number; images: number; bytes: number } {
  let text = body, images = 0;
  if (mediaType.startsWith('text/html')) {
    text = sanitize(body, { allowedTags: [], allowedAttributes: {} });
    text = text.replace(/&(?:nbsp|#160|#xA0);/gi, ' ').replace(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);/gi, 'x');
    // Images were already validated and embedded by richContent.
    images = (body.match(/<img\s[^>]*src="data:image\//g) ?? []).length;
  }
  const characters = Array.from(text.replace(/[\s\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '')).length;
  return { characters, images, bytes: Buffer.byteLength(body,'utf8') };
}
export function requireChapterContent(body: string, mediaType: string): ReturnType<typeof chapterQuality> {
  const quality = chapterQuality(body,mediaType);
  if (!quality.characters && !quality.images) throw badRequest('此章节没有可读正文，请选择其他章节或书源', 'EMPTY_CHAPTER');
  return quality;
}
