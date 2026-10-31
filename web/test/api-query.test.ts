import { describe, expect, it, vi } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { affectedNavigationQuery } from '../src/api/query.ts';
import type { Session } from '../src/api/types.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

const session: Session = {
  user: { id: 'reader', username: 'reader', displayName: 'Reader', role: 'member', createdAt: 0 },
  accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15,
};

async function apiWith(transport: FakeTransport): Promise<ReaderApi> {
  const api = new ReaderApi(makePlatform(transport), { load: async () => session, save: async () => {}, clear: async () => {} });
  await api.restore();
  return api;
}

describe('ReaderApi navigation query cache', () => {
  it('refreshes explicitly, separates pages, and leaves polling uncached', async () => {
    const transport = new FakeTransport();
    transport.json({ items: [], total: 0 });
    const api = await apiWith(transport);
    await api.listBooks({ page: 1 });
    await api.listBooks({ page: 2 });
    api.refreshQueries();
    await api.listBooks({ page: 1 });
    expect(transport.requests).toHaveLength(3);
    await api.mediaRequest('/api/v1/media/scan-jobs');
    await api.mediaRequest('/api/v1/media/scan-jobs');
    expect(transport.requests).toHaveLength(5);
  });

  it('keeps media catalog cached across playback heartbeats', async () => {
    const transport = new FakeTransport();
    transport.json({ items: [] });
    const api = await apiWith(transport);
    await api.mediaRequest('/api/v1/media/browse?channel=music');
    await api.mediaRequest('/api/v1/media/playback/session/progress', 'PUT', { position: 10 });
    await api.mediaRequest('/api/v1/media/browse?channel=music');
    expect(transport.requests).toHaveLength(2);
  });

  it('deduplicates concurrent shelf reads and reuses them on return', async () => {
    const transport = new FakeTransport();
    transport.json({ items: [{ id: 'book-1' }], total: 1 });
    const api = await apiWith(transport);
    await Promise.all([api.listBooks(), api.listBooks()]);
    await api.listBooks();
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/books'))).toBe(1);
  });

  it('invalidates navigation data after a write', async () => {
    const transport = new FakeTransport();
    transport.respondWith(request => request.method === 'GET'
      ? { status: 200, headers: {}, json: { items: [{ id: 'book-1' }], total: 1 } }
      : { status: 200, headers: {}, json: {} });
    const api = await apiWith(transport);
    await api.listBooks();
    await api.browseBatchShelf({ bookIds: ['book-1'] }, 'remove');
    await api.listBooks();
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/books'))).toBe(2);
  });
});

describe('a shared in-flight navigation query', () => {
  it('does not hand the first caller’s abort to a caller that is still live', async () => {
    let calls = 0;
    const transport = { async send(request: { signal?: AbortSignal }) {
      calls += 1;
      if (calls === 1) {
        // The first request hangs until its caller aborts it.
        await new Promise((_, reject) => request.signal?.addEventListener('abort', () => reject(new ApiError('aborted', 'request aborted'))));
      }
      return { status: 200, headers: { 'content-type': 'application/json' }, json: { items: ['ok'] } };
    } } as any;
    const api = new ReaderApi(makePlatform(transport), { load: async () => session, save: async () => {}, clear: async () => {} });
    await api.restore();
    const first = new AbortController();
    const gone = api.listBooks({ page: 1 }, { signal: first.signal } as any).catch(error => error);
    const live = api.listBooks({ page: 1 });
    await vi.waitFor(() => expect(calls).toBe(1));
    first.abort();
    expect((await gone)?.kind).toBe('aborted');
    expect((await live).items).toEqual(['ok']);
  });
});

describe('media writes invalidate the navigation they change', () => {
  const detail = '/api/v1/media/items/album-1';
  const lists = ['/api/v1/media/browse?channel=music&kind=album', '/api/v1/media/search?query=a', '/api/v1/media/libraries/lib-1/items?kind=track', '/api/v1/media/favorites?offset=0', detail, detail + '/children'];
  it.each([
    '/api/v1/media/editions/ed-1', '/api/v1/media/editions/ed-1/item', '/api/v1/media/editions/ed-1/new-item',
    '/api/v1/media/editions/ed-1/split', '/api/v1/media/editions/ed-1/merge', '/api/v1/media/editions/ed-1/order',
    '/api/v1/media/items/track-1/metadata', '/api/v1/media/items/track-1/match', '/api/v1/media/items/track-1/auto-match',
    '/api/v1/media/items/track-1/hierarchy', '/api/v1/media/items/track-1/parent',
    '/api/v1/media/libraries/lib-1/missing-resources/cleanup', '/api/v1/media/libraries/lib-1/recognition-apply',
    '/api/v1/media/libraries/lib-1/recognition-rule', '/api/v1/media/libraries/lib-1/scan', '/api/v1/media/libraries/lib-1/access',
    '/api/v1/media/scan-jobs', '/api/v1/media/scrape-jobs',
  ])('%s refreshes item details and every catalog list', mutation => {
    for (const query of lists) expect(affectedNavigationQuery(mutation, query)).toBe(true);
    expect(affectedNavigationQuery(mutation, '/api/v1/books')).toBe(false);
  });

  it.each([
    '/api/v1/media/playback', '/api/v1/media/playback/s-1/progress', '/api/v1/media/background/playback/s-1/progress',
    '/api/v1/media/background-grants', '/api/v1/media/items/track-1/matches', '/api/v1/media/libraries/lib-1/recognition-preview',
    '/api/v1/media/queue/preview', '/api/v1/media/jobs/j-1/cancel', '/api/v1/media/scan-jobs/j-1', '/api/v1/media/scrape-jobs/j-1/cancel',
    '/api/v1/media/ai-scan-jobs', '/api/v1/media/ai-scan-jobs/j-1',
  ])('%s keeps the catalog cache', mutation => {
    for (const query of lists) expect(affectedNavigationQuery(mutation, query)).toBe(false);
  });

  it('keeps playback, queue and favorite invalidation narrow', () => {
    expect(affectedNavigationQuery('/api/v1/media/playback/s-1/progress', '/api/v1/media/history?channel=music')).toBe(true);
    expect(affectedNavigationQuery('/api/v1/media/queue/q-1/move', '/api/v1/media/queue')).toBe(true);
    expect(affectedNavigationQuery('/api/v1/media/queue/q-1/move', '/api/v1/media/browse?channel=music')).toBe(false);
    expect(affectedNavigationQuery('/api/v1/media/items/track-1/favorite', '/api/v1/media/favorites?offset=0')).toBe(true);
    expect(affectedNavigationQuery('/api/v1/media/items/track-1/favorite', '/api/v1/media/items/track-1/favorite')).toBe(true);
    expect(affectedNavigationQuery('/api/v1/media/items/track-1/favorite', '/api/v1/media/browse?channel=music')).toBe(false);
    expect(affectedNavigationQuery('/api/v1/media/libraries', '/api/v1/media/libraries')).toBe(true);
    expect(affectedNavigationQuery('/api/v1/media/libraries', '/api/v1/media/browse?channel=music')).toBe(false);
  });

  it('serves the edited catalog after an edition merge', async () => {
    const transport = new FakeTransport();
    let version = 1;
    transport.respondWith(request => request.method === 'GET'
      ? { status: 200, headers: {}, json: { items: [{ id: 'album-1', version }], total: 1 } }
      : (version += 1, { status: 200, headers: {}, json: { id: 'album-1' } }));
    const api = await apiWith(transport);
    const browse = '/api/v1/media/browse?channel=music&kind=album';
    await api.mediaRequest(browse);
    await api.mediaRequest('/api/v1/media/editions/ed-1/merge', 'POST', { expectedRevision: 'a', targetEditionId: 'ed-2', targetRevision: 'b' });
    expect((await api.mediaRequest<{ items: Array<{ version: number }> }>(browse)).items[0]!.version).toBe(2);
  });

  it('revalidates item details on every read so 刷新资源状态 sees a rescan', async () => {
    const transport = new FakeTransport();
    let available = false;
    transport.respondWith(() => ({ status: 200, headers: {}, json: { id: 'album-1', editions: [{ parts: [{ available }] }] } }));
    const api = await apiWith(transport);
    type D = { editions: Array<{ parts: Array<{ available: boolean }> }> };
    expect((await api.mediaRequest<D>(detail)).editions[0]!.parts[0]!.available).toBe(false);
    available = true; // restored on disk and rescanned; no write from this client
    expect((await api.mediaRequest<D>(detail)).editions[0]!.parts[0]!.available).toBe(true);
    // Concurrent readers still share one request.
    const before = transport.requests.length;
    await Promise.all([api.mediaRequest(detail), api.mediaRequest(detail)]);
    expect(transport.requests.length - before).toBe(1);
    // The catalog lists stay cached.
    await api.mediaRequest('/api/v1/media/browse?channel=music');
    await api.mediaRequest('/api/v1/media/browse?channel=music');
    expect(transport.countMatching(request => request.url.startsWith('/api/v1/media/browse'))).toBe(1);
  });
});

describe('aborts never escape as raw DOMExceptions', () => {
  it('retries for a live caller when the shared request failed with a raw AbortError', async () => {
    let calls = 0;
    const transport = { async send(request: { signal?: AbortSignal }) {
      calls += 1;
      if (calls === 1) {
        // A transport that rejects with the signal's own reason ("signal is aborted without reason").
        await new Promise((_, reject) => request.signal?.addEventListener('abort', () => reject(request.signal!.reason)));
      }
      return { status: 200, headers: {}, json: { items: ['ok'] } };
    } } as any;
    const api = new ReaderApi(makePlatform(transport), { load: async () => session, save: async () => {}, clear: async () => {} });
    await api.restore();
    const first = new AbortController();
    const gone = api.mediaRequest('/api/v1/media/browse?channel=music', 'GET', undefined, { signal: first.signal }).catch(error => error);
    const live = api.mediaRequest<{ items: string[] }>('/api/v1/media/browse?channel=music');
    await vi.waitFor(() => expect(calls).toBe(1));
    first.abort();
    const error = await gone as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('aborted');
    expect((await live).items).toEqual(['ok']);
  });

  it('reports a non-navigation request aborted by its caller as ApiError(aborted)', async () => {
    const transport = { async send(request: { signal?: AbortSignal }) {
      await new Promise((_, reject) => request.signal?.addEventListener('abort', () => reject(request.signal!.reason)));
      return { status: 200, headers: {} };
    } } as any;
    const api = new ReaderApi(makePlatform(transport), { load: async () => session, save: async () => {}, clear: async () => {} });
    await api.restore();
    const controller = new AbortController();
    const pending = api.mediaRequest('/api/v1/media/scan-jobs', 'GET', undefined, { signal: controller.signal }).catch(error => error);
    await Promise.resolve();
    controller.abort();
    const error = await pending as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('aborted');
  });
});
