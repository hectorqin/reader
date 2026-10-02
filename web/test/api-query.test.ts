import { describe, expect, it } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
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
