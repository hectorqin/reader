import { describe, expect, it } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import type { HttpResponse } from '../src/core/platform.ts';
import type { Session } from '../src/api/types.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

function session(id: string): Session {
  return {
    user: { id, username: id, displayName: id, role: 'member', createdAt: 0 },
    accessToken: `access-${id}`, refreshToken: `refresh-${id}`,
    accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

const expired: HttpResponse = { status: 401, headers: {}, json: { error: { code: 'TOKEN_EXPIRED', message: 'expired' } } };
const ok = (json: unknown): HttpResponse => ({ status: 200, headers: {}, json });

async function setup() {
  const transport = new FakeTransport();
  let stored: Session | null = session('a');
  const api = new ReaderApi(makePlatform(transport), {
    async load() { return stored; },
    async save(value) { stored = value; },
    async clear() { stored = null; },
  });
  await api.restore();
  return { api, transport, stored: () => stored };
}

describe('requests across an account change', () => {
  it('keeps the reader signed in when an OPDS source requires separate credentials', async () => {
    const env = await setup();
    env.transport.respondWith(() => ({ status: 401, headers: {}, json: { error: { code: 'AUTH_REQUIRED', message: 'OPDS password required' } } }));
    await expect(env.api.sourceCatalog('private')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', isAuthFailure: false });
    expect(env.api.currentSession()?.user.id).toBe('a');
    expect(env.transport.requests).toHaveLength(1);
  });
  it('rotates an expired token before loading chapter bytes through the same guarded request path', async () => {
    const env = await setup();
    env.transport.respondWith((request) => {
      if (request.url.endsWith('/refresh')) return ok({ ...session('a'), accessToken: 'access-a-rotated' });
      if (request.headers.authorization === 'Bearer access-a') return expired;
      return { status: 200, headers: {}, bytes: new TextEncoder().encode('chapter body') };
    });
    expect(await (await env.api.asset('book', 'resource:revision:chapter')).text()).toBe('chapter body');
    expect(env.transport.requests.at(-1)?.headers.authorization).toBe('Bearer access-a-rotated');
    expect(env.transport.requests.at(-1)?.headers.accept).toBe('*/*');
  });
  it('does not refresh, retry with B credentials, or clear B when A receives a delayed 401', async () => {
    const env = await setup();
    const delayed = deferred<HttpResponse>();
    env.transport.respondWith((request) => request.url.endsWith('/login') ? ok(session('b')) : delayed.promise);
    const old = env.api.listBooks().catch((error: unknown) => error);
    await env.api.login('b', 'password');
    delayed.resolve(expired);
    expect(await old).toMatchObject({ kind: 'aborted', code: 'ACCOUNT_CHANGED' });
    expect(env.api.currentSession()?.user.id).toBe('b');
    expect(env.stored()?.user.id).toBe('b');
    expect(env.transport.requests.filter((request) => request.url.endsWith('/books'))).toHaveLength(1);
    expect(env.transport.requests.some((request) => request.url.endsWith('/refresh'))).toBe(false);
  });

  it.each([false, true])('does not adopt or reject B based on an old in-flight token refresh (failed=%s)', async (failed) => {
    const env = await setup();
    const started = deferred<void>();
    const delayed = deferred<HttpResponse>();
    env.transport.respondWith((request) => {
      if (request.url.endsWith('/login')) return ok(session('b'));
      if (request.url.endsWith('/refresh')) {
        started.resolve();
        return delayed.promise;
      }
      return expired;
    });
    const old = env.api.listBooks().catch((error: unknown) => error);
    await started.promise;
    await env.api.login('b', 'password');
    delayed.resolve(failed ? expired : ok({ ...session('a'), accessToken: 'access-a-rotated' }));
    expect(await old).toMatchObject({ kind: 'aborted', code: 'ACCOUNT_CHANGED' });
    expect(env.api.currentSession()?.user.id).toBe('b');
    expect(env.stored()?.user.id).toBe('b');
    expect(env.transport.requests.filter((request) => request.url.endsWith('/books'))).toHaveLength(1);
  });

  it('rejects a successful stale response so callers cannot put A data into B caches', async () => {
    const env = await setup();
    const delayed = deferred<HttpResponse>();
    env.transport.respondWith((request) => request.url.endsWith('/login') ? ok(session('b')) : delayed.promise);
    const old = env.api.listBooks().catch((error: unknown) => error);
    await env.api.login('b', 'password');
    delayed.resolve(ok({ items: ['a-private-book'] }));
    expect(await old).toMatchObject({ kind: 'aborted' });
  });
});
