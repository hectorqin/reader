import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppError } from '../lib/errors.ts';
import type {
  Acquisition, CatalogEntry, CatalogPage, SourceContext, SourceProvider,
  ResourceResponse, SourceHttpResponse,
} from './types.ts';

const ACQUISITION = 'http://opds-spec.org/acquisition';
const FILE_TYPES = new Set([
  'application/epub+zip', 'application/pdf', 'text/plain',
  'application/vnd.comicbook+zip', 'application/x-cbz',
]);

type ObjectValue = Record<string, unknown>;
interface OpdsLink { href: string; rel: string[]; type: string; title: string }
interface OpdsBook {
  id: string;
  title: string;
  authors: string[];
  description?: string;
  coverUrl?: string;
  detailUrl?: string;
  acquisitions: OpdsLink[];
}
interface OpdsDocument {
  title: string;
  books: OpdsBook[];
  navigation: Array<{ title: string; url: string }>;
  next?: string;
  search?: OpdsLink;
}

function object(value: unknown): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}

function list(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const record = object(value);
  return typeof record['#text'] === 'string' ? record['#text'] : '';
}

function url(value: string, base: string): string | undefined {
  try {
    const parsed = new URL(value, base);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch { return undefined; }
}

function links(value: unknown, base: string, atom = false): OpdsLink[] {
  return list(value).flatMap((item) => {
    const link = object(item);
    const prefix = atom ? '@_' : '';
    const href = url(text(link[`${prefix}href`]), base);
    if (!text(link[`${prefix}href`]) || !href) return [];
    const rel = list(link[`${prefix}rel`]).flatMap((value) => text(value).split(/\s+/)).filter(Boolean);
    return [{ href, rel, type: text(link[`${prefix}type`]), title: text(link[`${prefix}title`]) }];
  });
}

function plainType(type: string): string { return type.split(';')[0]!.trim().toLowerCase(); }
function hasRel(link: OpdsLink, rel: string): boolean { return link.rel.includes(rel); }
function isAcquisition(link: OpdsLink): boolean { return link.rel.some((rel) => rel === ACQUISITION || rel.startsWith(`${ACQUISITION}/`)); }
function downloadable(link: OpdsLink): boolean {
  return (hasRel(link, ACQUISITION) || hasRel(link, `${ACQUISITION}/open-access`)) && FILE_TYPES.has(plainType(link.type));
}

function documentLinks(parsed: OpdsDocument, all: OpdsLink[]): void {
  parsed.next = all.find((link) => hasRel(link, 'next'))?.href;
  parsed.search = all.find((link) => hasRel(link, 'search'));
}

function parseJsonPublication(raw: unknown, base: string): OpdsBook | undefined {
  const item = object(raw);
  const metadata = object(item.metadata);
  const all = links(item.links, base);
  const id = text(metadata.identifier) || all.find((link) => hasRel(link, 'self'))?.href || all.find(isAcquisition)?.href;
  const title = text(metadata.title);
  if (!id || !title) return undefined;
  return {
    id, title,
    authors: list(metadata.author).map((author) => text(author) || text(object(author).name)).filter(Boolean),
    description: text(metadata.description) || undefined,
    coverUrl: links(item.images, base)[0]?.href,
    detailUrl: all.find((link) => hasRel(link, 'self') && plainType(link.type) === 'application/opds-publication+json')?.href,
    acquisitions: all.filter(isAcquisition),
  };
}

function parseJson(raw: unknown, base: string): OpdsDocument {
  const feed = object(raw);
  if (!('metadata' in feed) || !text(object(feed.metadata).title)) throw new Error('Invalid OPDS JSON document');
  const parsed: OpdsDocument = { title: text(object(feed.metadata).title), books: [], navigation: [] };
  documentLinks(parsed, links(feed.links, base));
  const sections = [feed, ...list(feed.groups).map(object)];
  for (const section of sections) {
    for (const item of list(section.publications)) {
      const book = parseJsonPublication(item, base);
      if (book) parsed.books.push(book);
    }
    for (const link of links(section.navigation, base)) {
      parsed.navigation.push({ title: link.title || link.href, url: link.href });
    }
  }
  // A detail URL can return a single OPDS publication rather than a feed.
  if (!('publications' in feed) && !('navigation' in feed) && !('groups' in feed)) {
    const book = parseJsonPublication(feed, base);
    if (book) parsed.books.push(book);
  }
  return parsed;
}

function parseXml(body: string): ObjectValue {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) {
    throw new Error('Invalid OPDS XML document');
  }
  return object(new XMLParser({
    ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false,
    processEntities: true, trimValues: true,
  }).parse(body));
}

function parseAtom(body: string, base: string): OpdsDocument {
  const root = parseXml(body);
  if (!root.feed && !root.entry) throw new Error('Invalid OPDS Atom document');
  const feed = object(root.feed ?? root.entry);
  const feedBase = url(text(feed['@_base']), base) ?? base;
  const parsed: OpdsDocument = { title: text(feed.title), books: [], navigation: [] };
  documentLinks(parsed, links(feed.link, feedBase, true));
  for (const raw of root.entry ? [root.entry] : list(feed.entry)) {
    const entry = object(raw);
    const entryBase = url(text(entry['@_base']), feedBase) ?? feedBase;
    const all = links(entry.link, entryBase, true);
    const acquisitions = all.filter(isAcquisition);
    const title = text(entry.title);
    if (acquisitions.length === 0) {
      const navigation = all.find((link) => (!link.rel.length || hasRel(link, 'subsection') || hasRel(link, 'alternate')) && /atom\+xml|opds\+json/i.test(link.type));
      if (navigation) parsed.navigation.push({ title: title || navigation.title || navigation.href, url: navigation.href });
      continue;
    }
    const id = text(entry.id) || all.find((link) => hasRel(link, 'self'))?.href || acquisitions[0]!.href;
    if (!title) continue;
    parsed.books.push({
      id, title,
      authors: list(entry.author).map((author) => text(object(author).name)).filter(Boolean),
      description: text(entry.summary) || text(entry.content) || undefined,
      coverUrl: all.find((link) => hasRel(link, 'http://opds-spec.org/image/thumbnail'))?.href
        ?? all.find((link) => hasRel(link, 'http://opds-spec.org/image'))?.href,
      detailUrl: all.find((link) => hasRel(link, 'alternate') && /atom\+xml/i.test(link.type))?.href,
      acquisitions,
    });
  }
  return parsed;
}

function parseDocument(body: string, base: string): OpdsDocument {
  return body.trimStart().startsWith('<') ? parseAtom(body, base) : parseJson(JSON.parse(body), base);
}

interface OpdsConfig {
  url: string;
  username?: string;
  allowedOrigins?: string[];
}

export interface OpdsProviderOptions {
  fetch?: typeof globalThis.fetch;
  maxFeedBytes?: number;
  maxFileBytes?: number;
}

function fail(message: string, code = 'OPDS_INVALID_RESPONSE', status = 502): never {
  throw new AppError(status, code, message);
}

function configuration(raw: unknown): OpdsConfig {
  const value = object(raw);
  if (!text(value.url) || !url(text(value.url), text(value.url))) {
    fail('OPDS url must be an absolute HTTP(S) URL without credentials', 'INVALID_SOURCE_CONFIG', 400);
  }
  if ('password' in value) fail('Store the OPDS password in credentials, not public configuration', 'INVALID_SOURCE_CONFIG', 400);
  if (value.username !== undefined && typeof value.username !== 'string') {
    fail('OPDS username must be a string', 'INVALID_SOURCE_CONFIG', 400);
  }
  if (value.allowedOrigins !== undefined && (!Array.isArray(value.allowedOrigins) || value.allowedOrigins.some((origin) => {
    if (typeof origin !== 'string') return true;
    const normalized = url(origin, origin);
    return !normalized || new URL(normalized).origin !== origin;
  }))) fail('allowedOrigins must contain HTTP(S) origins without paths', 'INVALID_SOURCE_CONFIG', 400);
  return { url: new URL(text(value.url)).href, username: value.username as string | undefined, allowedOrigins: value.allowedOrigins as string[] | undefined };
}

function checkedUrl(candidate: string, config: OpdsConfig, file = false): string {
  const normalized = url(candidate, config.url);
  if (!normalized) fail('OPDS link must use HTTP(S) without URL credentials', 'OPDS_UNSAFE_URL', 400);
  const target = new URL(normalized);
  const allowed = [new URL(config.url).origin, ...(file ? config.allowedOrigins ?? [] : [])];
  if (!allowed.includes(target.origin)) fail('OPDS link origin is not allowed by this source', 'OPDS_UNSAFE_URL', 400);
  return target.href;
}

function encodeRef(prefix: string, value: unknown): string {
  return `${prefix}${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}

function decodeRef(ref: string, prefix: string): ObjectValue {
  if (!ref.startsWith(prefix) || ref.length > 16_384) fail('Invalid OPDS reference', 'INVALID_SOURCE_REF', 400);
  try { return object(JSON.parse(Buffer.from(ref.slice(prefix.length), 'base64url').toString('utf8'))); }
  catch { return fail('Invalid OPDS reference', 'INVALID_SOURCE_REF', 400); }
}

function optionId(link: OpdsLink): string {
  return createHash('sha256').update(`${link.href}\n${link.type}\n${link.rel.join(' ')}`).digest('hex').slice(0, 24);
}

function catalogEntry(book: OpdsBook, feedUrl: string): CatalogEntry {
  return {
    ref: encodeRef('opds:', { url: feedUrl, id: book.id }),
    title: book.title, authors: book.authors, description: book.description, coverUrl: book.coverUrl,
    options: book.acquisitions.map((link) => ({
      id: optionId(link), mediaType: link.type,
      label: link.title || (downloadable(link) ? plainType(link.type) : `Unsupported acquisition: ${link.rel.join(', ')}`),
      available: downloadable(link),
    })),
  };
}

function catalogPage(document: OpdsDocument, feedUrl: string): CatalogPage {
  return {
    title: document.title,
    items: document.books.map((book) => catalogEntry(book, feedUrl)),
    navigation: document.navigation.map((entry) => ({ ref: entry.url, title: entry.title, kind: 'catalog' })),
    nextCursor: document.next,
  };
}

function expandSearch(template: string, query: string, limit: number): string {
  const normalized = template.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  if (!normalized.includes('{searchTerms}')) fail('OPDS search template has no searchTerms parameter', 'SOURCE_UNSUPPORTED', 400);
  return normalized.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    if (name === 'searchTerms') return encodeURIComponent(query);
    if (name === 'count' || name === 'count?') return String(limit);
    if (name === 'startIndex' || name === 'startPage') return '1';
    if (name.endsWith('?')) return '';
    return fail(`Unsupported OPDS search parameter: ${name}`, 'SOURCE_UNSUPPORTED', 400);
  });
}

/** Built-in OPDS 1/2 source. Credentials and downloads stay inside the provider. */
export function createOpdsProvider(options: OpdsProviderOptions = {}): SourceProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxFeedBytes = options.maxFeedBytes ?? 4 * 1024 * 1024;
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024 * 1024;

  async function request(ctx: SourceContext, candidate: string, file = false): Promise<Response | SourceHttpResponse> {
    const config = configuration(ctx.instance.config);
    let target = checkedUrl(candidate, config, file);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      ctx.signal.throwIfAborted();
      const headers: Record<string, string> = { accept: file ? '*/*' : 'application/opds+json, application/atom+xml, application/opds-publication+json, application/opensearchdescription+xml' };
      if (config.username && new URL(target).origin === new URL(config.url).origin) {
        const password = await ctx.credentials?.get('password', ctx.signal);
        if (password === undefined) fail('OPDS credentials are required', 'AUTH_REQUIRED', 401);
        headers.authorization = `Basic ${Buffer.from(`${config.username}:${password}`).toString('base64')}`;
      }
      const response = ctx.http
        ? await ctx.http.request({ url: target, headers }, ctx.signal)
        : await fetcher(target, { headers, signal: ctx.signal, redirect: 'manual' });
      const responseUrl = response.url || target;
      checkedUrl(responseUrl, config, file);
      const header = (name: string) => response.headers instanceof Headers ? response.headers.get(name) : response.headers[name];
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = header('location');
        if (response instanceof Response) await response.body?.cancel();
        if (!location || redirects === 5) fail('OPDS redirect limit exceeded or Location missing');
        target = checkedUrl(new URL(location, target).href, config, file);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        if (response instanceof Response) await response.body?.cancel();
        if (response.status === 401 || response.status === 403) fail('OPDS authentication is required', 'AUTH_REQUIRED', 401);
        if (response.status === 404) fail('OPDS resource no longer exists', 'RESOURCE_GONE', 404);
        if (response.status === 429) fail('OPDS request rate is limited', 'RATE_LIMITED', 429);
        fail(`OPDS server returned HTTP ${response.status}`);
      }
      const size = Number(header('content-length'));
      if (Number.isFinite(size) && size > (file ? maxFileBytes : maxFeedBytes)) {
        if (response instanceof Response) await response.body?.cancel();
        fail('OPDS resource exceeds the configured size limit', 'RESOURCE_TOO_LARGE', 413);
      }
      return response;
    }
    return fail('OPDS redirect limit exceeded');
  }

  async function* bytes(response: Response | SourceHttpResponse, maxBytes: number): AsyncGenerator<Uint8Array> {
    let total = 0;
    const stream = response instanceof Response
      ? response.body ? Readable.fromWeb(response.body as never) : []
      : [response.body];
    for await (const chunk of stream) {
      total += chunk.byteLength;
      if (total > maxBytes) fail('OPDS resource exceeds the configured size limit', 'RESOURCE_TOO_LARGE', 413);
      yield chunk;
    }
  }

  async function document(ctx: SourceContext, target: string): Promise<{ parsed: OpdsDocument; url: string }> {
    const response = await request(ctx, target);
    const chunks: Uint8Array[] = [];
    for await (const chunk of bytes(response, maxFeedBytes)) chunks.push(chunk);
    const finalUrl = response.url || target;
    try { return { parsed: parseDocument(Buffer.concat(chunks).toString('utf8'), finalUrl), url: finalUrl }; }
    catch (error) {
      if (error instanceof AppError) throw error;
      return fail('OPDS response is not a valid Atom or JSON catalog');
    }
  }

  async function lookup(ctx: SourceContext, ref: string): Promise<{ book: OpdsBook; url: string }> {
    const stored = decodeRef(ref, 'opds:');
    if (!text(stored.url) || !text(stored.id)) fail('Invalid OPDS entry reference', 'INVALID_SOURCE_REF', 400);
    const feed = await document(ctx, text(stored.url));
    let book = feed.parsed.books.find((entry) => entry.id === stored.id);
    if (!book) fail('OPDS entry no longer exists in its catalog', 'RESOURCE_GONE', 404);
    if (book.detailUrl && book.detailUrl !== feed.url) {
      const full = await document(ctx, book.detailUrl);
      book = full.parsed.books.find((entry) => entry.id === stored.id) ?? book;
    }
    return { book, url: feed.url };
  }

  return {
    descriptor: {
      id: 'opds', label: 'OPDS', version: '1.0.0',
      capabilities: ['browse', 'search', 'detail', 'acquire.file'],
      credentialKeys: [{ key: 'password', label: 'OPDS 密码' }],
      configSchema: {
        type: 'object', required: ['url'], additionalProperties: false,
        properties: {
          url: { type: 'string', format: 'uri', title: 'OPDS catalog URL' },
          username: { type: 'string', title: 'Basic authentication username (password is stored separately)' },
          allowedOrigins: { type: 'array', items: { type: 'string', format: 'uri' }, title: 'Additional download origins' },
        },
      },
    },
    validateConfig: (config) => { configuration(config); },
    async browse(ctx, request) {
      const config = configuration(ctx.instance.config);
      const feed = await document(ctx, request.cursor || request.ref || config.url);
      return catalogPage(feed.parsed, feed.url);
    },
    async search(ctx, search) {
      const config = configuration(ctx.instance.config);
      if (search.cursor) {
        const feed = await document(ctx, search.cursor);
        return catalogPage(feed.parsed, feed.url);
      }
      if (!search.query.trim()) fail('Search query must not be empty', 'BAD_REQUEST', 400);
      const root = await document(ctx, config.url);
      const link = root.parsed.search;
      if (!link) fail('This OPDS catalog does not advertise search', 'SOURCE_UNSUPPORTED', 400);
      let template = link.href;
      if (plainType(link.type) === 'application/opensearchdescription+xml') {
        const response = await request(ctx, link.href);
        const chunks: Uint8Array[] = [];
        for await (const chunk of bytes(response, maxFeedBytes)) chunks.push(chunk);
        let description: ObjectValue;
        try { description = object(parseXml(Buffer.concat(chunks).toString('utf8')).OpenSearchDescription); }
        catch { return fail('Invalid OPDS OpenSearch description'); }
        const candidates = list(description.Url).map(object);
        const candidate = candidates.find((item) => /atom\+xml|opds\+json/i.test(text(item['@_type'])) && (!item['@_method'] || text(item['@_method']).toUpperCase() === 'GET'));
        const rawTemplate = candidate ? text(candidate['@_template']) : '';
        if (!rawTemplate) fail('OPDS search has no supported GET template', 'SOURCE_UNSUPPORTED', 400);
        template = new URL(rawTemplate, response.url || link.href).href;
      }
      const target = expandSearch(template, search.query, Math.max(1, Math.min(search.limit ?? 50, 200)));
      const feed = await document(ctx, target);
      return catalogPage(feed.parsed, feed.url);
    },
    async detail(ctx, entryRef) {
      const entry = await lookup(ctx, entryRef);
      return { ...catalogEntry(entry.book, entry.url), ref: entryRef };
    },
    async acquire(ctx, request): Promise<Acquisition> {
      const { book } = await lookup(ctx, request.entryRef);
      const selected = request.optionId
        ? book.acquisitions.find((link) => optionId(link) === request.optionId)
        : book.acquisitions.find(downloadable) ?? book.acquisitions[0];
      if (!selected) fail('OPDS acquisition option no longer exists', 'RESOURCE_GONE', 404);
      if (!downloadable(selected)) {
        return { kind: 'action-required', action: {
          type: hasRel(selected, `${ACQUISITION}/borrow`) ? 'borrow' : 'external',
          label: 'This release supports direct EPUB, PDF, TXT and CBZ downloads; borrowing, purchases and DRM require an external application.',
          url: selected.href,
        } };
      }
      checkedUrl(selected.href, configuration(ctx.instance.config), true);
      return {
        kind: 'file', mediaType: plainType(selected.type),
        acquisitionRef: encodeRef('opds-file:', { entryRef: request.entryRef, optionId: optionId(selected) }),
      };
    },
    async openFile(ctx, acquisition): Promise<ResourceResponse> {
      const ref = decodeRef(acquisition.acquisitionRef, 'opds-file:');
      if (!text(ref.entryRef) || !text(ref.optionId)) fail('Invalid OPDS acquisition reference', 'INVALID_SOURCE_REF', 400);
      const { book } = await lookup(ctx, text(ref.entryRef));
      const selected = book.acquisitions.find((link) => optionId(link) === ref.optionId && downloadable(link));
      if (!selected) fail('OPDS download no longer exists', 'RESOURCE_GONE', 404);
      const response = await request(ctx, selected.href, true);
      const header = (name: string) => response.headers instanceof Headers ? response.headers.get(name) : response.headers[name];
      const actualType = plainType(header('content-type') ?? '');
      if (actualType && actualType !== 'application/octet-stream' && actualType !== plainType(selected.type)) {
        if (response instanceof Response) await response.body?.cancel();
        fail('OPDS download media type differs from its catalog entry');
      }
      const length = header('content-length');
      return {
        mediaType: plainType(selected.type), stream: Readable.from(bytes(response, maxFileBytes)),
        size: length && Number.isFinite(Number(length)) ? Number(length) : undefined,
        etag: header('etag') ?? undefined,
      };
    },
  };
}

export const opdsProvider = createOpdsProvider();
