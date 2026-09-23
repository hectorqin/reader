import { AppError } from '../lib/errors.ts';
import type { Acquisition, CatalogEntry, CatalogPage, ManifestSnapshot } from './types.ts';

function invalid(message: string): never {
  throw new AppError(502, 'PLUGIN_PROTOCOL_ERROR', message);
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`invalid plugin ${label}`);
  return input as Record<string, unknown>;
}

function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) invalid(`plugin ${label} must be a nonempty string`);
}

/** Validate wire data before it can become host-owned catalog or reading state. */
export function decodeCatalogEntry(input: unknown): CatalogEntry {
  const value = object(input, 'catalog entry');
  string(value.ref, 'entry ref');
  string(value.title, 'entry title');
  for (const key of ['description', 'coverUrl', 'language', 'publishedAt', 'latestChapter', 'sourceName']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') invalid(`invalid plugin entry ${key}`);
  }
  if (value.authors !== undefined &&
      (!Array.isArray(value.authors) || value.authors.some((author) => typeof author !== 'string'))) {
    invalid('plugin authors must be strings');
  }
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) invalid('plugin acquisition options must be an array');
    const ids = new Set<string>();
    for (const option of value.options) {
      const acquisition = object(option, 'acquisition option');
      string(acquisition.id, 'acquisition option id');
      string(acquisition.label, 'acquisition option label');
      if (ids.has(acquisition.id)) invalid('duplicate plugin acquisition option id');
      ids.add(acquisition.id);
    }
  }
  return input as CatalogEntry;
}

export function decodeCatalogPage(input: unknown): CatalogPage {
  const value = object(input, 'catalog page');
  if (!Array.isArray(value.items)) invalid('plugin catalog items must be an array');
  value.items.forEach(decodeCatalogEntry);
  if (value.limitReached !== undefined && typeof value.limitReached !== 'boolean') invalid('invalid plugin result limit flag');
  for (const key of ['title', 'nextCursor']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') invalid(`invalid plugin catalog ${key}`);
  }
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors)) invalid('plugin catalog errors must be an array');
    for (const entry of value.errors) {
      const error = object(entry, 'catalog error');
      string(error.source, 'catalog error source');
      string(error.code, 'catalog error code');
      string(error.message, 'catalog error message');
    }
  }
  if (value.batch !== undefined) {
    const batch = object(value.batch, 'catalog batch');
    if (!Number.isSafeInteger(batch.completed) || !Number.isSafeInteger(batch.total)
      || (batch.completed as number) < 0 || (batch.total as number) < (batch.completed as number)
      || (batch.total as number) > 10000) invalid('invalid plugin catalog batch progress');
    if ((batch.completed as number) < (batch.total as number) && !value.nextCursor && !value.limitReached) invalid('unfinished catalog batch requires a cursor');
  }
  if (value.navigation !== undefined) {
    if (!Array.isArray(value.navigation)) invalid('plugin navigation must be an array');
    for (const entry of value.navigation) {
      const navigation = object(entry, 'navigation');
      string(navigation.ref, 'navigation ref');
      string(navigation.title, 'navigation title');
    }
  }
  return input as CatalogPage;
}

export function decodeChapterAcquisition(input: unknown): Acquisition {
  const value = object(input, 'acquisition');
  if (value.kind === 'chapters') {
    string(value.publicationRef, 'publication ref');
  } else if (value.kind === 'action-required') {
    const action = object(value.action, 'acquisition action');
    if (!['login', 'borrow', 'external'].includes(action.type as string)) invalid('invalid plugin acquisition action type');
    string(action.label, 'action label');
    if (action.url !== undefined) {
      string(action.url, 'action URL');
      let url: URL;
      try { url = new URL(action.url); } catch { invalid('invalid plugin action URL'); }
      if (!['http:', 'https:'].includes(url.protocol)) invalid('plugin action URL must use HTTP or HTTPS');
    }
  } else {
    invalid('process plugins must acquire chapter content or request an action');
  }
  return input as Acquisition;
}

export function decodeManifest(input: unknown, publicationRef: string): ManifestSnapshot {
  const value = object(input, 'manifest');
  if (value.publicationRef !== publicationRef) invalid('plugin manifest publication ref does not match the request');
  if (!Array.isArray(value.items)) invalid('plugin manifest items must be an array');
  if (value.sourceName !== undefined && typeof value.sourceName !== 'string') invalid('invalid source name');
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const entry of value.items) {
    const item = object(entry, 'manifest item');
    if (item.sourceUrl !== undefined) {
      try { const url = new URL(String(item.sourceUrl)); if (typeof item.sourceUrl !== 'string' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { invalid('chapter source URL must use HTTP or HTTPS without credentials'); }
    }
    string(item.id, 'chapter id');
    string(item.ref, 'chapter ref');
    string(item.title, 'chapter title');
    string(item.mediaType, 'chapter media type');
    if (item.kind !== 'chapter' && item.kind !== 'page') invalid('invalid plugin chapter kind');
    if (typeof item.seq !== 'number' || !Number.isSafeInteger(item.seq) || item.seq < 0) invalid('invalid plugin chapter order');
    if (ids.has(item.id) || sequences.has(item.seq)) invalid('plugin manifest contains duplicate chapter ids or order');
    ids.add(item.id);
    sequences.add(item.seq);
  }
  return input as ManifestSnapshot;
}
