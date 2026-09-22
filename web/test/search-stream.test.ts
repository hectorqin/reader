import { afterEach, expect, it, vi } from 'vitest';
import { eventStream } from '../src/api/event-stream.ts';
import { ReaderApi } from '../src/api/client.ts';
import { FetchTransport } from '../src/core/fetch-transport.ts';
import type { Session } from '../src/api/types.ts';
import { FakeTransport, makePlatform, bodyText } from './helpers/env.ts';
const encoder = new TextEncoder();
const event = (name: string, value: unknown) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
const result = { items: [{ ref: 'one', title: '中文书籍' }], batch: { completed: 1, total: 2 }, nextCursor: 'next' };
const query = { query: '中文', sessionId: 'stream-session-id', filters: { group: '小说' } };
function body(text: string, width = 999999) { const bytes = encoder.encode(text); let offset = 0; return new ReadableStream<Uint8Array>({ pull(controller) {
  if (offset >= bytes.length) { controller.close(); return; }
  controller.enqueue(bytes.slice(offset, offset += width));
} }); }
const session = (id: string): Session => ({ user: { id, username: id, displayName: id, role: 'member', createdAt: 0 }, accessToken: 'token-' + id, refreshToken: 'refresh-' + id, accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 });
async function setup() {
  const transport = new FakeTransport(); const api = new ReaderApi(makePlatform(transport), { async load() { return session('a'); }, async save() {}, async clear() {} });
  await api.restore(); return { transport, api };
}
afterEach(() => vi.unstubAllGlobals());

it('decodes byte-split UTF-8, CRLF, comments and multiline data', async () => {
  const received = [];
  for await (const value of eventStream(body(': heartbeat\r\nevent: results\r\ndata: {"title":\r\ndata: "中文书籍"}\r\n\r\n', 1))) received.push(value);
  expect(received).toEqual([{ event: 'results', data: '{"title":\n"中文书籍"}' }]);
});

it('returns the first event before HTTP closes and sends one authenticated POST', async () => {
  const { api, transport } = await setup(); let controller!: ReadableStreamDefaultController<Uint8Array>;
  transport.respondWith(() => ({ status: 200, headers: {}, stream: new ReadableStream({ start(value) { controller = value; } }) }));
  const stream = api.searchSource('id', query); const first = stream.next();
  await vi.waitFor(() => expect(controller).toBeDefined());
  controller.enqueue(encoder.encode(event('results', result)));
  expect((await first).value).toEqual(result); expect(transport.requests).toHaveLength(1);
  expect(transport.requests[0]).toMatchObject({ method: 'POST', url: '/api/v1/sources/id/search', headers: { authorization: 'Bearer token-a', accept: 'text/event-stream' } });
  expect(JSON.parse(bodyText(transport.requests[0]))).toEqual(query);
  controller.enqueue(encoder.encode(event('done', { reason: 'complete' })));
  expect((await stream.next()).done).toBe(true);
});

it('refreshes before opening a stream but never replays a partially consumed stream', async () => {
  const { api, transport } = await setup();
  transport.respondWith(request => {
    if (request.url.endsWith('/refresh')) return { status: 200, headers: {}, json: { ...session('a'), accessToken: 'rotated' } };
    if (request.headers.authorization === 'Bearer token-a') return { status: 401, headers: {}, json: { error: { code: 'TOKEN_EXPIRED' } } };
    return { status: 200, headers: {}, stream: body(event('results', result) + event('error', { code: 'SITE_ERROR', message: '失败', status: 502 })) };
  });
  const stream = api.searchSource('id', query);
  expect((await stream.next()).value).toEqual(result);
  await expect(stream.next()).rejects.toMatchObject({ code: 'SITE_ERROR' });
  expect(transport.requests).toHaveLength(3); expect(api.currentSession()?.accessToken).toBe('rotated');
});

it('reports unexpected EOF instead of silently completing', async () => {
  const { api, transport } = await setup(); transport.respondWith(() => ({ status: 200, headers: {}, stream: body(event('results', result), 3) }));
  const stream = api.searchSource('id', query); expect((await stream.next()).value).toEqual(result);
  await expect(stream.next()).rejects.toMatchObject({ code: 'STREAM_INTERRUPTED' });
});

it('aborts an idle stream when the user stops or changes server', async () => {
  for (const changeServer of [false, true]) {
    const { api, transport } = await setup(); let cancelled = false;
    transport.respondWith(() => ({ status: 200, headers: {}, stream: new ReadableStream({ cancel() { cancelled = true; } }) }));
    const stop = new AbortController(), stream = api.searchSource('id', query, { signal: stop.signal });
    const pending = stream.next(); const rejected = changeServer
      ? expect(pending).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
      : expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
    if (changeServer) api.setBaseUrl('http://other'); else stop.abort();
    await rejected; expect(cancelled).toBe(true);
  }
});

it('fetch transport leaves successful streams unbuffered and rejects unexpected content types', async () => {
  const transport = new FetchTransport(() => 'http://reader.test');
  const source = new ReadableStream<Uint8Array>();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(source, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })).mockResolvedValueOnce(new Response('{}', { headers: { 'content-type': 'application/json' } })));
  const request = { url: '/search', method: 'POST', headers: {}, stream: true };
  const response = await transport.send(request); expect(response.stream).toBe(source); await response.stream!.cancel();
  await expect(transport.send(request)).rejects.toMatchObject({ code: 'INVALID_STREAM' });
});

it('rejects oversized unfinished events and cancels the reader', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('data: ' + 'x'.repeat(2 * 1024 * 1024))); }, cancel() { cancelled = true; } });
  await expect(eventStream(stream).next()).rejects.toMatchObject({ code: 'INVALID_STREAM' }); expect(cancelled).toBe(true);
});
