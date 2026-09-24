import { Parser } from 'htmlparser2';
import { createHash } from 'node:crypto';
import type { Manifest, AssetPayload, ContentItem } from '../indexer/formats/registry.ts';
import type { ReadingOverrides } from './reading-overrides.ts';
import { badRequest, conflict } from '../lib/errors.ts';

// Match the plain-text rendition's paragraph and heading boundaries so returned
// offsets describe what the reader sees, including the separating newlines.
export function plainSearchText(input: string): string {
  let text = input.replace(/\r\n?/g, '\n'), heading = '';
  const lines = text.split('\n'), first = lines.findIndex(line => line.trim());
  const line = (lines[first] ?? '').trim();
  if (line.length <= 60 && [/^第\s*[0-9０-９零一二三四五六七八九十百千万两]+\s*[章回节卷部篇集]/, /^(?:序章|序言|楔子|引子|前言|后记|尾声|终章|番外|附录)/, /^[卷部]\s*[0-9０-９零一二三四五六七八九十百千万两]+/, /^Chapter\s*\d+/i, /^#{1,3}\s+.+/].some(pattern => pattern.test(line))) {
    heading = line + '\n'; text = lines.slice(first + 1).join('\n');
  }
  const paragraphs = text.split(/\n{2,}/).flatMap(block => {
    const parts = block.split('\n'); let current = parts.shift() ?? ''; const out: string[] = [];
    for (const part of parts) {
      const content = part.replace(/^[\s\u3000\u00a0]+/, '');
      if (/[。！？…”』】]$/.test(current.trimEnd()) && content && !/^[，。！？、；：”』】）\u3001-\u303f\uff01-\uff5e]/.test(content)) { out.push(current); current = part; }
      else current += content;
    }
    out.push(current); return out.map(value => value.trim()).filter(Boolean);
  });
  return '\n' + heading + paragraphs.join('\n') + '\n\n';
}
export function htmlSearchText(html: string): string {
  let result = ''; const skipped: string[] = [];
  const parser = new Parser({
    onopentag(name) { if (skipped.length || ['head','script','style','noscript'].includes(name)) skipped.push(name); },
    onclosetag(name) { if (skipped.at(-1) === name) skipped.pop(); },
    ontext(text) { if (!skipped.length) result += text; },
  }, { decodeEntities: true });
  parser.end(html); return result;
}
export function correctedSearchText(text: string, sectionId: string, overrides: ReadingOverrides): string {
  for (const { anchor, replacement } of overrides.corrections) {
    if (anchor.sectionId.replace(/^xhtml:/,'') !== sectionId.replace(/^xhtml:/,'')) continue;
    let start = anchor.start;
    if (text.slice(start, start + anchor.quote.length) !== anchor.quote) {
      const context = anchor.prefix + anchor.quote + anchor.suffix, at = text.indexOf(context);
      if (at >= 0 && text.indexOf(context, at + 1) < 0) start = at + anchor.prefix.length;
      else { start = text.indexOf(anchor.quote); if (start < 0 || text.indexOf(anchor.quote, start + 1) >= 0) continue; }
    }
    text = text.slice(0,start) + replacement + text.slice(start + anchor.quote.length);
  }
  return text;
}
export async function searchBookPage(manifest: Manifest, query: string, cursor: string | undefined, overrides: ReadingOverrides,
  load: (item: ContentItem, signal: AbortSignal) => Promise<AssetPayload>, signal: AbortSignal, batchSize = 8) {
  if (!query.trim() || query.length > 200) throw badRequest('关键词须为 1–200 个字符');
  if (!['text','reflowable'].includes(manifest.kind)) throw badRequest('此格式暂不支持正文搜索','UNSUPPORTED_FORMAT');
  const signature = createHash('sha256').update(JSON.stringify([manifest.revision, manifest.items.map(i=>[i.href,i.resourceRef]), query, overrides.version])).digest('hex').slice(0,24);
  let index = 0;
  if (cursor) {
    const match = /^(\d+)\.([a-f0-9]{24})$/.exec(cursor);
    if (!match) throw badRequest('无效的搜索游标');
    if (match[2] !== signature) throw conflict('书籍或搜索条件已变化，请重新搜索');
    index = Number(match[1]); if (!Number.isSafeInteger(index) || index > manifest.items.length) throw badRequest('无效的搜索游标');
  }
  const hits = [], failures: Array<{title: string; code: string}> = [];
  const end = Math.min(index + batchSize, manifest.items.length);
  let limited = false;
  for (; index < end; index++) {
    signal.throwIfAborted(); const item = manifest.items[index]!;
    let payload: AssetPayload | undefined;
    try {
      const chapterSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
      payload = await load(item, chapterSignal); chapterSignal.throwIfAborted();
      if (!payload.data || payload.data.length > 8 * 1024 * 1024) throw badRequest('章节超过搜索大小限制','SEARCH_CHAPTER_TOO_LARGE');
      const raw = payload.data.toString('utf8');
      const text = correctedSearchText(/html|xml/i.test(payload.contentType) ? htmlSearchText(raw) : plainSearchText(raw), item.href, overrides);
      let start = text.indexOf(query);
      while (start >= 0 && hits.length < 200) {
        const stop = start + query.length;
        hits.push({title:item.title,excerpt:text.slice(Math.max(0,start-35),stop+65),anchor:{sectionId:item.href,start,end:stop,quote:query,prefix:text.slice(Math.max(0,start-32),start),suffix:text.slice(stop,stop+32)}});
        start = text.indexOf(query,stop);
      }
      if (hits.length >= 200) { limited = true; index++; break; }
    } catch (error) {
      signal.throwIfAborted();
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'CHAPTER_UNAVAILABLE';
      failures.push({title:item.title,code});
    } finally { payload?.stream?.destroy(); }
    await new Promise(resolve => setImmediate(resolve));
  }
  return { hits, failures, scanned:index, total:manifest.items.length, limited,
    ...(index < manifest.items.length && !limited ? { nextCursor:index+'.'+signature } : {}) };
}
