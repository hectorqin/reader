/**
 * API client tests.
 *
 * Two behaviours here cause real failures rather than cosmetic ones: the refresh
 * token rotation, and the concurrency limiter.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError } from '../src/net/api.ts';

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];
let responder: (url: string, init: RequestInit) => Response;

const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  responder = () => json({ ok: true });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function client(): ApiClient {
  let stored: string | null = null;
  return new ApiClient({
    baseUrl: 'http://nas:8080',
    storage: {
      read: () => (stored ? (JSON.parse(stored) as never) : null),
      write: (session) => {
        stored = session ? JSON.stringify(session) : null;
      },
    },
  });
}

describe('api client', () => {
  test('a 401 is retried once after a refresh, and the new token is used', async () => {
    const api = client();
    responder = (url) => {
      if (url.includes('/auth/login')) {
        return json({ accessToken: 'old', refreshToken: 'r1', accessTokenExpiresAt: 0, refreshTokenExpiresAt: 0 });
      }
      if (url.includes('/auth/refresh')) {
        return json({ accessToken: 'new', refreshToken: 'r2', accessTokenExpiresAt: 1, refreshTokenExpiresAt: 1 });
      }
      const auth = (calls.at(-1)!.init.headers as Record<string, string>)['authorization'];
      return auth === 'Bearer new' ? json({ items: [] }) : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401);
    };

    await api.login('reader', 'password');
    const shelf = await api.shelf();
    assert.deepEqual(shelf.items, []);
    // Rotation: the server revokes the token it was given, so the client must
    // keep the one it got back.
    assert.equal(api.currentSession?.refreshToken, 'r2');
  });

  test('concurrent 401s share one refresh instead of revoking each other', async () => {
    // The server rotates refresh tokens on use, so four parallel page fetches that
    // each refreshed independently would invalidate three of their own tokens and
    // sign the reader out in the middle of a comic.
    const api = client();
    let refreshes = 0;
    responder = (url) => {
      if (url.includes('/auth/login')) {
        return json({ accessToken: 'old', refreshToken: 'r1', accessTokenExpiresAt: 0, refreshTokenExpiresAt: 0 });
      }
      if (url.includes('/auth/refresh')) {
        refreshes += 1;
        return json({ accessToken: 'new', refreshToken: `r${refreshes + 1}`, accessTokenExpiresAt: 1, refreshTokenExpiresAt: 1 });
      }
      const auth = (calls.at(-1)!.init.headers as Record<string, string>)['authorization'];
      return auth === 'Bearer new' ? new Response('page', { status: 200 }) : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401);
    };

    await api.login('reader', 'password');
    await Promise.all([
      api.asset('b', 'page:0'),
      api.asset('b', 'page:1'),
      api.asset('b', 'page:2'),
      api.asset('b', 'page:3'),
    ]);
    assert.equal(refreshes, 1, 'all four requests must share a single refresh');
  });

  test('a failed refresh signs the reader out rather than looping', async () => {
    const api = client();
    let signedOut = false;
    const auth = new ApiClient({
      storage: {
        read: () => ({ accessToken: 'x', refreshToken: 'y', accessTokenExpiresAt: 0, refreshTokenExpiresAt: 0 }),
        write: () => undefined,
      },
      onAuthLost: () => {
        signedOut = true;
      },
    });
    responder = () => json({ error: { code: 'REFRESH_INVALID', message: 'x' } }, 401);

    await assert.rejects(() => auth.shelf(), (error: unknown) => error instanceof ApiError);
    assert.equal(signedOut, true);
    void api;
  });

  test('an error code is preserved, so the UI can explain it', async () => {
    const api = client();
    responder = () => json({ error: { code: 'REGISTRATION_DISABLED', message: 'nope' } }, 400);
    await assert.rejects(
      () => api.register('a', 'password123'),
      (error: unknown) => error instanceof ApiError && error.code === 'REGISTRATION_DISABLED',
    );
  });

  test('a non-JSON error body still produces a usable error', async () => {
    // A reverse proxy's HTML error page is the common case; failing to parse it
    // must not turn a 502 into a crash.
    const api = client();
    responder = () => new Response('<html>502</html>', { status: 502 });
    await assert.rejects(
      () => api.instance(),
      (error: unknown) => error instanceof ApiError && error.status === 502,
    );
  });

  test('refs are sent through untouched', async () => {
    // `ref` is opaque: the client must not decode, re-encode or normalise it, or
    // a chapter path containing a slash breaks.
    const api = client();
    responder = () => new Response('x', { status: 200 });
    await api.asset('book1', 'xhtml:OEBPS/text/ch 1.xhtml');
    const url = calls.at(-1)!.url;
    assert.match(url, /ref=xhtml%3AOEBPS%2Ftext%2Fch%201\.xhtml/);
  });
});
