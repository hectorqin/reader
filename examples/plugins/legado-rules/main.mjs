#!/usr/bin/env node
/**
 * Legado-rule source plugin.
 *
 * The host protocol is newline-delimited JSON-RPC. This process adapts the
 * subset of Legado's HTML rule syntax used by `sources.json` (class/id/tag
 * selectors, indices, text/html/href/src, `##regex` cleanup, `||` and `&&`)
 * onto the host's search/detail/chapter protocol. It is deliberately not a
 * general Legado runtime: `@js:` and `<js>` rules are rejected, and sources are
 * vetted before being added here.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { load } from 'cheerio';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 45_000;
const CACHE_LIMIT = 30;
const MAX_CHAPTERS = 5000;
const OUTPUT_TOKENS = new Set(['text', 'textNodes', 'html', 'href', 'src', 'content', 'value', 'alt']);
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'dt', 'dd']);

const pageCache = new Map();

function pluginError(code, message) {
  return Object.assign(new Error(message), { code });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSource(config) {
  const id = config && typeof config === 'object' ? config.sourceId : undefined;
  const source = typeof id === 'string' ? SOURCES[id] : undefined;
  if (!source) throw pluginError('INVALID_CONFIG', `未知的 Legado 书源：${String(id ?? '')}`);
  return source;
}

function sourceOf(params) {
  return resolveSource(params?.context?.instance?.config);
}

function sameSiteUrl(value, source, label = '链接') {
  let url;
  try { url = new URL(String(value ?? '').trim(), source.url); } catch {
    throw pluginError('RESOURCE_GONE', `${label}无效`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw pluginError('RESOURCE_GONE', `${label}不是 HTTP 地址`);
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const roots = [new URL(source.url).hostname, ...(source.alternateHosts ?? [])]
    .map((name) => String(name).replace(/^www\./i, '').toLowerCase());
  if (!roots.some((root) => host === root || host.endsWith(`.${root}`))) {
    throw pluginError('RESOURCE_GONE', `${label}不在书源站点内`);
  }
  return url.toString();
}

function absoluteUrl(value, base) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function charsetFromContentType(contentType) {
  const match = /charset\s*=\s*([^;]+)/i.exec(contentType ?? '');
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

function detectCharset(buffer, contentType) {
  const fromHeader = charsetFromContentType(contentType);
  if (fromHeader) return fromHeader;
  const sample = buffer.subarray(0, 4096).toString('latin1');
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(sample);
  return meta ? meta[1] : 'utf-8';
}

function decodeBody(buffer, contentType, override) {
  const charset = override || detectCharset(buffer, contentType);
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function cacheGet(url) {
  const hit = pageCache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    pageCache.delete(url);
    return undefined;
  }
  // Refresh LRU order.
  pageCache.delete(url);
  pageCache.set(url, hit);
  return hit;
}

function cacheSet(url, entry) {
  pageCache.set(url, { ...entry, at: Date.now() });
  while (pageCache.size > CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value);
}

function requestHeaders(source, extra) {
  const headers = {
    'User-Agent': source.headers?.['User-Agent'] ?? DEFAULT_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    Referer: new URL(source.url).origin + '/',
    ...(source.headers ?? {}),
  };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (typeof value === 'string') headers[key] = value;
  }
  return headers;
}

async function fetchText(url, source, options = {}, useCache = true) {
  const cached = useCache ? cacheGet(url) : undefined;
  if (cached) return cached;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: requestHeaders(source, options.headers),
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = pluginError('SOURCE_UNAVAILABLE', `无法访问书源：${error?.message ?? error}`);
      if (attempt === 0) { await sleep(300); continue; }
      throw lastError;
    }
    if (!response.ok) {
      lastError = pluginError(response.status === 404 ? 'RESOURCE_GONE' : 'SOURCE_UNAVAILABLE',
        `书源返回 HTTP ${response.status}`);
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) { await sleep(300); continue; }
      throw lastError;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const entry = { text: decodeBody(buffer, response.headers.get('content-type'), options.charset), url: response.url || url };
    if (useCache) cacheSet(url, entry);
    return entry;
  }
  throw lastError ?? pluginError('SOURCE_UNAVAILABLE', '书源不可用');
}

async function fetchBinary(url, source) {
  let response;
  try {
    response = await fetch(url, {
      headers: requestHeaders(source, { Accept: 'image/*,*/*;q=0.8' }),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw pluginError('SOURCE_UNAVAILABLE', `无法读取封面：${error?.message ?? error}`);
  }
  if (!response.ok) throw pluginError('RESOURCE_GONE', `封面返回 HTTP ${response.status}`);
  const mediaType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) throw pluginError('RESOURCE_GONE', '封面内容为空');
  return { mediaType, data };
}

/* -------------------------------------------------------------------------
 * Rule interpreter
 * ---------------------------------------------------------------------- */

function splitCleanup(rule) {
  const value = String(rule ?? '');
  if (value.includes('@js:') || value.trim().startsWith('<js>')) {
    throw pluginError('RULE_UNSUPPORTED', '该规则使用了 JavaScript，插件不支持');
  }
  const at = value.indexOf('##');
  if (at < 0) return { expr: value, cleanup: null };
  const tail = value.slice(at + 2);
  const next = tail.indexOf('##');
  return {
    expr: value.slice(0, at),
    cleanup: next < 0
      ? { pattern: tail, replacement: '' }
      : { pattern: tail.slice(0, next), replacement: tail.slice(next + 2) },
  };
}

function applyCleanup(value, cleanup) {
  if (!cleanup || !cleanup.pattern) return value;
  try {
    return value.replace(new RegExp(cleanup.pattern, 'g'), cleanup.replacement);
  } catch {
    return value;
  }
}

function cssSelector(base) {
  if (base === 'tag') return '*';
  if (base.startsWith('class.')) return `.${base.slice(6)}`;
  if (base.startsWith('id.')) return `#${base.slice(3)}`;
  if (base.startsWith('tag.')) return base.slice(4);
  return base;
}

function parseSelector(token) {
  let base = token;
  let index = null;
  let match = /^(.*)\.(-?\d+)$/.exec(token);
  if (match && match[1]) {
    base = match[1];
    index = Number(match[2]);
  } else if ((match = /^(.*)!(\d+)$/.exec(token))) {
    base = match[1];
    index = -(Number(match[2]) + 1);
  }
  return { css: cssSelector(base), index };
}

function pickIndex(items, index) {
  if (index === null) return items;
  if (index < 0) return items.slice(index);
  return items.slice(index, index + 1);
}

function textOfFirst(nodes, $) {
  const node = nodes[0];
  if (!node) return '';
  return $(node).text();
}

function attrOfFirst(nodes, $, name) {
  const node = nodes[0];
  return node ? ($(node).attr(name) ?? '') : '';
}

function textNodesOf(node, $) {
  let out = '';
  $(node).contents().each((_, child) => {
    if (child.type === 'text') {
      out += child.data ?? '';
      return;
    }
    if (child.type !== 'tag') return;
    const name = String(child.name ?? '').toLowerCase();
    if (name === 'br') { out += '\n'; return; }
    if (name === 'script' || name === 'style') return;
    out += textNodesOf(child, $);
    if (BLOCK_TAGS.has(name)) out += '\n';
  });
  return out;
}

function evalChain(chain, initialNodes, $, rootMode) {
  const tokens = String(chain ?? '').split('@').map((token) => token.trim()).filter(Boolean);
  let nodes = Array.isArray(initialNodes) ? initialNodes : [];
  let root = rootMode;
  for (const token of tokens) {
    if (OUTPUT_TOKENS.has(token)) {
      if (token === 'text') return textOfFirst(nodes, $);
      if (token === 'textNodes') {
        const node = nodes[0];
        return node ? textNodesOf(node, $) : '';
      }
      if (token === 'html') {
        const node = nodes[0];
        return node ? ($(node).html() ?? '') : '';
      }
      return attrOfFirst(nodes, $, token);
    }
    const { css, index } = parseSelector(token);
    nodes = root ? $(css).toArray() : $(nodes).find(css).toArray();
    root = false;
    nodes = pickIndex(nodes, index);
  }
  return textOfFirst(nodes, $);
}

function evalExpr(expr, initialNodes, $, rootMode) {
  for (const alternative of String(expr ?? '').split('||')) {
    const value = evalAnd(alternative, initialNodes, $, rootMode);
    if (value) return value;
  }
  return '';
}

function evalAnd(expr, initialNodes, $, rootMode) {
  return String(expr ?? '')
    .split('&&')
    .map((part) => evalChain(part.trim(), initialNodes, $, rootMode))
    .filter((value) => value !== '')
    .join('\n');
}

function evalRule(rule, initialNodes, $, rootMode) {
  const { expr, cleanup } = splitCleanup(rule);
  return applyCleanup(evalExpr(expr, initialNodes, $, rootMode), cleanup);
}

function selectList(rule, $, rootMode, initialNodes = []) {
  const { expr } = splitCleanup(rule);
  const tokens = String(expr ?? '').split('@').map((token) => token.trim()).filter(Boolean);
  let nodes = initialNodes;
  let root = rootMode;
  for (const token of tokens) {
    if (OUTPUT_TOKENS.has(token)) throw pluginError('RULE_UNSUPPORTED', '列表规则不能以文本取值结尾');
    const { css, index } = parseSelector(token);
    nodes = root ? $(css).toArray() : $(nodes).find(css).toArray();
    root = false;
    nodes = pickIndex(nodes, index);
  }
  return nodes;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/ /g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function splitAuthors(value) {
  const text = cleanText(value);
  if (!text) return [];
  return text.split(/[,，、;；\/]+/).map(cleanText).filter(Boolean).slice(0, 6);
}

function metaContent($, name) {
  return cleanText($(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content') ?? '');
}

function normalizeContent(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* -------------------------------------------------------------------------
 * Source operations
 * ---------------------------------------------------------------------- */

function searchSpec(source) {
  const raw = String(source.searchUrl ?? '');
  const at = raw.lastIndexOf(',{');
  if (at < 0) return { template: raw, options: {} };
  let options = {};
  try { options = JSON.parse(raw.slice(at + 1)); } catch { /* Treat as part of the URL. */ }
  return { template: raw.slice(0, at), options: options && typeof options === 'object' ? options : {} };
}

function expandTemplate(template, query, page) {
  return template
    .replace(/\{\{key\}\}/g, encodeURIComponent(query))
    .replace(/\{\{page:1\}\}/g, String(page))
    .replace(/\{\{page:2\}\}/g, String(page - 1))
    .replace(/\{\{page\}\}/g, String(page));
}

async function search(source, request) {
  const query = String(request?.query ?? '').trim();
  if (!query || request?.cursor) return { title: source.name, items: [] };
  const spec = searchSpec(source);
  const url = absoluteUrl(expandTemplate(spec.template, query, 1), source.url);
  if (!url) throw pluginError('INVALID_CONFIG', '搜索地址无效');
  const page = await fetchText(url, source, spec.options);
  const $ = load(page.text);
  const rules = source.rules.search;
  const nodes = selectList(rules.bookList, $, true);
  const items = [];
  const seen = new Set();
  for (const node of nodes) {
    const ref = absoluteUrl(evalRule(rules.bookUrl, [node], $, false), page.url);
    if (!ref || seen.has(ref)) continue;
    const title = cleanText(evalRule(rules.name, [node], $, false));
    if (!title) continue;
    seen.add(ref);
    const authors = splitAuthors(evalRule(rules.author, [node], $, false));
    const description = cleanText(evalRule(rules.intro, [node], $, false));
    const latestChapter = cleanText(evalRule(rules.lastChapter, [node], $, false));
    const kind = cleanText(evalRule(rules.kind, [node], $, false));
    const cover = absoluteUrl(evalRule(rules.coverUrl, [node], $, false), page.url);
    items.push({
      ref,
      title,
      ...(authors.length ? { authors } : {}),
      ...(description ? { description } : {}),
      ...(latestChapter ? { latestChapter } : {}),
      sourceName: source.name,
      ...(cover ? { coverRef: 'cover' } : {}),
      ...(kind ? { metadata: { kind } } : {}),
    });
  }
  return { title: source.name, items };
}

async function detail(source, entryRef) {
  const ref = sameSiteUrl(entryRef, source, '书籍');
  const page = await fetchText(ref, source);
  const $ = load(page.text);
  const rules = source.rules.book;
  const title = cleanText(evalRule(rules.name, [], $, true)) || metaContent($, 'og:novel:book_name');
  if (!title) throw pluginError('RESOURCE_GONE', '没有读到书名，书源页面可能已失效');
  const authors = splitAuthors(evalRule(rules.author, [], $, true));
  const description = cleanText(evalRule(rules.intro, [], $, true)) || metaContent($, 'og:description');
  const latestChapter = cleanText(evalRule(rules.lastChapter, [], $, true)) || metaContent($, 'og:novel:latest_chapter_name');
  const kind = cleanText(evalRule(rules.kind, [], $, true));
  const cover = absoluteUrl(evalRule(rules.coverUrl, [], $, true), page.url) || metaContent($, 'og:image');
  return {
    ref,
    title,
    ...(authors.length ? { authors } : {}),
    ...(description ? { description } : {}),
    ...(latestChapter ? { latestChapter } : {}),
    sourceName: source.name,
    ...(cover ? { coverRef: 'cover' } : {}),
    ...(kind ? { metadata: { kind } } : {}),
  };
}

function chapterId(href) {
  try {
    const path = new URL(href).pathname;
    const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '');
    if (/^\d{4,}$/.test(stem)) return stem;
  } catch { /* Fall through to a hash. */ }
  return createHash('sha1').update(href).digest('hex').slice(0, 24);
}

async function getManifest(source, publicationRef) {
  const ref = sameSiteUrl(publicationRef, source, '书籍');
  const page = await fetchText(ref, source);
  const $ = load(page.text);
  const rules = source.rules.toc;
  const nodes = selectList(rules.chapterList, $, true);
  const items = [];
  const ids = new Set();
  const refs = new Set();
  for (const node of nodes) {
    if (items.length >= MAX_CHAPTERS) break;
    const href = absoluteUrl(evalRule(rules.chapterUrl, [node], $, false), page.url);
    const title = cleanText(evalRule(rules.chapterName, [node], $, false));
    if (!href || !title || refs.has(href)) continue;
    refs.add(href);
    let id = chapterId(href);
    if (ids.has(id)) {
      let n = 2;
      while (ids.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    ids.add(id);
    items.push({
      id,
      seq: items.length,
      title,
      kind: 'chapter',
      mediaType: 'text/plain; charset=utf-8',
      ref: href,
      sourceUrl: href,
    });
  }
  if (!items.length) throw pluginError('RESOURCE_GONE', '目录为空，书源页面可能已失效');
  return {
    publicationRef: ref,
    sourceName: source.name,
    version: `${items.length}:${items[items.length - 1].id}`,
    items,
  };
}

async function readResource(source, request) {
  const publicationRef = String(request?.publicationRef ?? '');
  const ref = String(request?.ref ?? '');
  if (!ref) throw pluginError('RESOURCE_GONE', '缺少资源引用');
  if (ref === 'cover') {
    const bookRef = sameSiteUrl(publicationRef, source, '书籍');
    const page = await fetchText(bookRef, source);
    const $ = load(page.text);
    const cover = absoluteUrl(evalRule(source.rules.book.coverUrl, [], $, true), page.url)
      || metaContent($, 'og:image');
    if (!cover) throw pluginError('RESOURCE_GONE', '该书没有封面');
    const image = await fetchBinary(cover, source);
    return { mediaType: image.mediaType, base64: image.data.toString('base64') };
  }
  const chapterRef = sameSiteUrl(ref, source, '章节');
  const page = await fetchText(chapterRef, source, {}, false);
  const $ = load(page.text);
  let content = evalRule(source.rules.content, [], $, true);
  if (!content.trim()) {
    // Last resort: plain text of #content when the rule's markers moved.
    content = $('#content').text();
  }
  content = normalizeContent(content);
  if (!content) throw pluginError('RESOURCE_GONE', '该章节没有可读正文，书源规则可能已失效');
  return { mediaType: 'text/plain; charset=utf-8', text: content };
}

/* -------------------------------------------------------------------------
 * RPC loop
 * ---------------------------------------------------------------------- */

const methods = {
  validateConfig: ({ config }) => {
    resolveSource(config);
    return null;
  },
  search: ({ context, request }) => search(sourceOf({ context }), request),
  detail: ({ context, entryRef }) => detail(sourceOf({ context }), entryRef),
  acquire: ({ context, request }) => {
    const source = sourceOf({ context });
    const entryRef = sameSiteUrl(request?.entryRef, source, '书籍');
    return { kind: 'chapters', publicationRef: entryRef };
  },
  getManifest: ({ context, publicationRef }) => getManifest(sourceOf({ context }), publicationRef),
  readResource: ({ context, request }) => readResource(sourceOf({ context }), request),
};

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
    if (!request || typeof request !== 'object') throw new Error('invalid request');
    if (request.method === '$/cancelRequest') continue;
    const method = methods[request.method];
    if (!method) throw pluginError('UNSUPPORTED_OPERATION', `不支持的方法：${String(request.method)}`);
    const result = await method(request.params ?? {});
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request?.id,
      error: { code: error?.code ?? 'PLUGIN_ERROR', message: error?.message ?? String(error) },
    })}\n`);
  }
}
