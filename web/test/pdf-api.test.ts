import { describe, expect, it } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

async function setup() {
  const transport = new FakeTransport();
  const api = new ReaderApi(makePlatform(transport), {
    load: async () => ({
      user: { id: 'reader', username: 'reader', displayName: '', role: 'member', createdAt: 0 },
      accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15,
    }),
    save: async () => undefined, clear: async () => undefined,
  });
  await api.restore();
  transport.respondWith(request => request.method === 'HEAD'
    ? { status: 200, headers: { 'content-length': '1000000', 'accept-ranges': 'bytes' } }
    : { status: 206, headers: { 'content-range': 'bytes 100-103/1000000' }, bytes: new Uint8Array([1, 2, 3, 4]) });
  return { api, transport };
}

describe('PDF range source', () => {
  it('opens with HEAD only, then requests authenticated byte ranges through the transport', async () => {
    const { api, transport } = await setup();
    const source = await api.pdfSource('book/id');
    expect(source.length).toBe(1000000);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({ method: 'HEAD', url: '/api/v1/books/book%2Fid/content' });
    const controller = new AbortController();
    expect(await source.readRange(100, 104, controller.signal)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(transport.requests[1]).toMatchObject({
      method: 'GET', headers: { range: 'bytes=100-103', authorization: 'Bearer access' },
    });
  });

  it('renews credentials on later range requests rather than storing a token in the document', async () => {
    const { api, transport } = await setup();
    const source = await api.pdfSource('book');
    api.currentSession()!.accessTokenExpiresAt = Date.now() + 1000;
    transport.respondWith(request => request.url.endsWith('/refresh')
      ? { status: 200, headers: {}, json: { ...api.currentSession(), accessToken: 'renewed', accessTokenExpiresAt: 9e15 } }
      : { status: 206, headers: { 'content-range': 'bytes 100-103/1000000' }, bytes: new Uint8Array(4) });
    await source.readRange(100, 104, new AbortController().signal);
    expect(transport.requests.at(-1)?.headers.authorization).toBe('Bearer renewed');
  });

  it.each([200, 206])('rejects incomplete or non-range responses (status=%s)', async status => {
    const { api, transport } = await setup();
    const source = await api.pdfSource('book');
    transport.respondWith(() => ({ status, headers: { 'content-range': 'bytes 100-103/1000000' }, bytes: new Uint8Array(3) }));
    await expect(source.readRange(100, 104, new AbortController().signal)).rejects.toThrow('无效的 PDF 字节范围');
  });

  it('rejects servers without Range support without downloading a full file', async () => {
    const { api, transport } = await setup();
    transport.respondWith(() => ({ status: 200, headers: { 'content-length': '1000000' } }));
    await expect(api.pdfSource('book')).rejects.toThrow('字节范围请求');
    expect(transport.requests).toHaveLength(1);
  });

  it('invalidates an existing source when the server changes', async () => {
    const { api, transport } = await setup();
    const source = await api.pdfSource('book');
    api.setBaseUrl('https://another.test');
    await expect(source.readRange(100, 104, new AbortController().signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(transport.requests).toHaveLength(1);
  });
});
