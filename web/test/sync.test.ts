import { describe, expect, it, vi } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';
import { SyncEngine } from '../src/core/sync.ts';
import { OfflineStore, isOutboxEmpty } from '../src/store/offline.ts';
import { FakeTransport, MemoryKv, bodyText, makePlatform } from './helpers/env.ts';

const SESSION = {
  user: { id: 'u1', username: 'me', displayName: '我', role: 'member' as const, createdAt: 0 },
  accessToken: 'access-1',
  accessTokenExpiresAt: Date.now() + 3_600_000,
  refreshToken: 'refresh-1',
  refreshTokenExpiresAt: Date.now() + 86_400_000,
};

it('reports a failed local progress write and permits retry without losing the outbox', async () => {
  const kv = new MemoryKv();
  const offline = new OfflineStore(kv);
  const progress = { bookId: 'b', locator: 'chapter:12', percentage: 0.5, chapterTitle: '12', device: 'phone', updatedAt: 20 };
  vi.spyOn(kv, 'set').mockRejectedValueOnce(new Error('disk full'));
  await expect(offline.setProgress(progress)).rejects.toThrow('disk full');
  expect(offline.outbox().progress).toEqual([progress]);
  await offline.setProgress(progress);
  const restored = new OfflineStore(kv);
  await restored.load();
  expect(restored.progressFor('b')).toEqual(progress);
});

function sessions() {
  const kv = new MemoryKv();
  return {
    kv,
    store: {
      async load() {
        const raw = await kv.get('s');
        return raw ? JSON.parse(raw) : null;
      },
      async save(session: unknown) {
        await kv.set('s', JSON.stringify(session));
      },
      async clear() {
        await kv.remove('s');
      },
    },
  };
}

function build() {
  const transport = new FakeTransport();
  const platform = makePlatform(transport);
  const session = sessions();
  const api = new ReaderApi(platform, session.store);
  api.setBaseUrl('http://test.local');
  const offline = new OfflineStore(platform.kv);
  const engine = new SyncEngine(api, offline, platform);
  return { transport, platform, api, offline, engine };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const SECOND_SESSION = { ...SESSION, user: { ...SESSION.user, id: 'u2', username: 'other' }, accessToken: 'access-other' };

describe('ReaderApi', () => {
  it('attaches the bearer token once a session exists', async () => {
    const { api, transport } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    transport.json({ items: [], total: 0, page: 1, pageSize: 50 });
    await api.listBooks();
    const last = transport.requests.at(-1)!;
    expect(last.headers['authorization']).toBe('Bearer access-1');
  });

  it('does not send a token to the public endpoints', async () => {
    const { api, transport } = build();
    transport.json({ name: 'reader', apiVersion: 1, registrationOpen: true, userCount: 0 });
    await api.instance();
    expect(transport.requests[0]!.headers['authorization']).toBeUndefined();
  });

  it('refreshes an expired token once and retries the original request', async () => {
    const { api, transport } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');

    transport.respondWith((request) => {
      if (request.url.endsWith('/api/v1/auth/refresh')) {
        return { status: 200, headers: {}, json: { ...SESSION, accessToken: 'access-2', refreshToken: 'refresh-2' } };
      }
      if (request.headers['authorization'] === 'Bearer access-1') {
        return { status: 401, headers: {}, json: { error: { code: 'TOKEN_EXPIRED', message: 'expired' } } };
      }
      return { status: 200, headers: {}, json: { items: [], total: 0, page: 1, pageSize: 50 } };
    });

    await api.listBooks();
    const refreshCalls = transport.countMatching((request) => request.url.endsWith('/auth/refresh'));
    expect(refreshCalls).toBe(1);
    expect(transport.requests.at(-1)!.headers['authorization']).toBe('Bearer access-2');
  });

  it('does not refresh or retry when the token signature is invalid', async () => {
    // `TOKEN_INVALID` means refreshing cannot help. Retrying would burn the
    // single-use refresh chain on a request that can never succeed.
    const { api, transport } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    transport.json({ error: { code: 'TOKEN_INVALID', message: 'bad signature' } }, 401);

    await expect(api.listBooks()).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    expect(transport.countMatching((request) => request.url.endsWith('/auth/refresh'))).toBe(0);
  });

  it('de-duplicates concurrent refreshes so a rotation is not burned twice', async () => {
    // The server rotates refresh tokens (single-use). Three parallel requests
    // hitting an expired token must share one refresh, or the second and third
    // would present a token that was already consumed and sign the reader out.
    const { api, transport } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');

    let refreshCount = 0;
    let releaseRefresh = (): void => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    transport.respondWith(async (request) => {
      if (request.url.endsWith('/auth/refresh')) {
        refreshCount += 1;
        await refreshGate;
        return { status: 200, headers: {}, json: { ...SESSION, accessToken: 'access-2', refreshToken: 'refresh-2' } };
      }
      if (request.headers['authorization'] === 'Bearer access-1') {
        return { status: 401, headers: {}, json: { error: { code: 'TOKEN_EXPIRED', message: 'expired' } } };
      }
      return { status: 200, headers: {}, json: { items: [], total: 0, page: 1, pageSize: 50 } };
    });

    const inFlight = Promise.all([api.listBooks(), api.listBooks(), api.listBooks()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseRefresh();
    await inFlight;
    expect(refreshCount).toBe(1);
  });

  it('clears the session when the refresh token itself is rejected', async () => {
    const { api, transport } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    transport.respondWith((request) =>
      request.url.endsWith('/auth/refresh')
        ? { status: 401, headers: {}, json: { error: { code: 'REFRESH_INVALID', message: 'used' } } }
        : { status: 401, headers: {}, json: { error: { code: 'TOKEN_EXPIRED', message: 'expired' } } },
    );
    await expect(api.listBooks()).rejects.toBeInstanceOf(ApiError);
    expect(api.currentSession()).toBeNull();
  });

  it('reports an unreachable server as an offline error, not a server error', async () => {
    // A rejected fetch is what a LAN address that is not reachable looks like,
    // and the whole three-state design keys off this being `offline` so the UI
    // can silently fall back to cached content instead of showing an error.
    const transport = new FakeTransport();
    transport.failWith(new TypeError('Failed to fetch'));
    const platform = makePlatform(transport);
    const session = sessions();
    const api = new ReaderApi(platform, session.store);
    api.setBaseUrl('http://test.local');
    await expect(api.instance()).rejects.toMatchObject({ kind: 'offline' });
  });

  it('treats a non-JSON 200 as a connectivity problem rather than crashing', async () => {
    // A captive portal or a misconfigured reverse proxy answers 200 with HTML.
    // Parsing that as JSON would throw a SyntaxError and lose the offline path.
    const transport = new FakeTransport();
    transport.nonJson();
    const platform = makePlatform(transport);
    const api = new ReaderApi(platform, sessions().store);
    api.setBaseUrl('http://test.local');
    await expect(api.instance()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('OfflineStore', () => {
  it('keeps the newer progress and discards a stale write', async () => {
    const store = new OfflineStore(new MemoryKv());
    await store.setProgress({ bookId: 'b1', locator: 'r1:0.5:c1', percentage: 0.5, chapterTitle: 'c1', device: 'a', updatedAt: 2000 });
    await store.setProgress({ bookId: 'b1', locator: 'r1:0.1:c1', percentage: 0.1, chapterTitle: 'c1', device: 'a', updatedAt: 1000 });
    expect(store.current.progress['b1']!.percentage).toBe(0.5);
  });

  it('does not let a stale pull overwrite newer local progress', async () => {
    const store = new OfflineStore(new MemoryKv());
    await store.setProgress({ bookId: 'b1', locator: 'r1:0.9:c1', percentage: 0.9, chapterTitle: 'c1', device: 'a', updatedAt: 5000 });
    await store.applyPulled({
      serverTime: 100,
      progress: [{ bookId: 'b1', locator: 'r1:0.2:c1', percentage: 0.2, chapterTitle: 'c1', device: 'b', updatedAt: 1000 }],
      notes: [],
    });
    expect(store.current.progress['b1']!.percentage).toBe(0.9);
  });

  it('records a note deletion as a pending tombstone, not a lost write', async () => {
    const store = new OfflineStore(new MemoryKv());
    await store.upsertNotes([
      { id: 'n1', bookId: 'b1', type: 'highlight', locator: 'x', text: 't', comment: '', color: '', updatedAt: 1 },
    ]);
    await store.deleteNote('n1');
    expect(store.notesFor('b1')).toHaveLength(0);
    expect(store.current.pendingNoteDeletes).toContain('n1');
  });

  it('clears a pending tombstone when the same note is written again', async () => {
    const store = new OfflineStore(new MemoryKv());
    await store.deleteNote('n1');
    await store.upsertNotes([
      { id: 'n1', bookId: 'b1', type: 'note', locator: 'x', text: 't', comment: '', color: '', updatedAt: 50 },
    ]);
    expect(store.current.pendingNoteDeletes).not.toContain('n1');
  });

  it('recovers from a corrupt snapshot instead of failing to start', async () => {
    const kv = new MemoryKv();
    await kv.set('reader.offline.v1', '{not json');
    const store = new OfflineStore(kv);
    const snapshot = await store.load();
    expect(snapshot.books).toEqual({});
    expect(snapshot.serverTime).toBe(0);
  });

  it('keeps a position written while its own push was in flight', async () => {
    // The failure this guards against is the one this product cannot have: a lost
    // reading position. It happens with a "send everything, clear everything"
    // outbox — the reader turns a page between the request going out and the
    // response arriving, the response clears the whole set, and the new position
    // is silently never sent. A dirty-set plus a timestamp check on the way back
    // is what makes the window not exist.
    const store = new OfflineStore(new MemoryKv());
    const first = { bookId: 'b1', locator: 'r1:0.10:c1', percentage: 0.1, chapterTitle: 'c1', device: 'a', updatedAt: 1000 };
    await store.setProgress(first);

    // The batch that the engine is about to send.
    const batch = store.outbox();

    // In flight: the reader turns the page.
    await store.setProgress({ ...first, locator: 'r1:0.20:c1', percentage: 0.2, updatedAt: 1100 });

    await store.markDelivered(batch, 5000);

    expect(store.current.dirtyProgress).toContain('b1');
    expect(store.outbox().progress[0]!.percentage).toBe(0.2);
    // The cursor is still adopted, so the next pull stays incremental.
    expect(store.current.serverTime).toBe(5000);
  });

  it('clears a position that was not touched while in flight', async () => {
    const store = new OfflineStore(new MemoryKv());
    await store.setProgress({ bookId: 'b1', locator: 'r1:0.5:c1', percentage: 0.5, chapterTitle: 'c1', device: 'a', updatedAt: 1000 });
    await store.markDelivered(store.outbox(), 1);
    expect(store.current.dirtyProgress).toEqual([]);
    expect(isOutboxEmpty(store.current)).toBe(true);
  });

  it('does not let a delivered batch clear a different book', async () => {
    // Clearing by "the batch's ids" rather than by timestamps would still be
    // wrong here if the ids were taken from the wrong side of the call.
    const store = new OfflineStore(new MemoryKv());
    await store.setProgress({ bookId: 'b1', locator: 'x', percentage: 0.1, chapterTitle: 'c', device: 'a', updatedAt: 1000 });
    const batch = store.outbox();
    await store.setProgress({ bookId: 'b2', locator: 'x', percentage: 0.2, chapterTitle: 'c', device: 'a', updatedAt: 1000 });
    await store.markDelivered(batch, 1);
    expect(store.current.dirtyProgress).toEqual(['b2']);
  });

  it('serialises concurrent writes so a fast reader does not lose a position', async () => {
    const store = new OfflineStore(new MemoryKv());
    await Promise.all(
      Array.from({ length: 20 }, (_value, index) =>
        store.setProgress({
          bookId: `b${index}`,
          locator: `r1:0:s${index}`,
          percentage: index / 20,
          chapterTitle: 'x',
          device: 'a',
          updatedAt: 1000 + index,
        }),
      ),
    );
    await store.flush();
    expect(Object.keys(store.current.progress)).toHaveLength(20);
  });
});

describe('SyncEngine', () => {
  it('discards an old account pull and its finally while the new account is syncing', async () => {
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.setScope('account-a');
    const oldStarted = deferred<void>();
    const oldResponse = deferred<{ status: number; headers: {}; json: unknown }>();
    const newStarted = deferred<void>();
    const newResponse = deferred<{ status: number; headers: {}; json: unknown }>();
    transport.respondWith((request) => {
      if (request.headers.authorization === 'Bearer access-1') {
        oldStarted.resolve();
        return oldResponse.promise;
      }
      newStarted.resolve();
      return newResponse.promise;
    });
    const oldRun = engine.syncNow();
    await oldStarted.promise;
    engine.stop();
    transport.json(SECOND_SESSION);
    await api.login('other', 'password12');
    await offline.setScope('account-b');
    transport.respondWith(() => { newStarted.resolve(); return newResponse.promise; });
    engine.start();
    await newStarted.promise;
    oldResponse.resolve({ status: 200, headers: {}, json: {
      serverTime: 900,
      progress: [{ bookId: 'private-a', locator: 'private', percentage: 0, chapterTitle: '', device: 'a', updatedAt: 1 }],
      notes: [{ id: 'private-note', bookId: 'private-a', type: 'note', locator: '', text: 'account A secret', comment: '', color: '', updatedAt: 1 }],
    } });
    await oldRun;
    expect(offline.current.progress).toEqual({});
    expect(offline.current.notes).toEqual({});
    expect(offline.current.serverTime).toBe(0);
    expect(engine.status().state).toBe('syncing');
    const count = transport.requests.length;
    await engine.syncNow();
    expect(transport.requests).toHaveLength(count);
    newResponse.resolve({ status: 200, headers: {}, json: { serverTime: 5, progress: [], notes: [] } });
    await vi.waitFor(() => expect(engine.status().state).toBe('idle'));
    expect(offline.current.serverTime).toBe(5);
    engine.stop();
    await offline.setScope('account-b');
    expect(offline.current.notes).toEqual({});
  });

  it.each(['syncNow', 'flush'] as const)('does not acknowledge an old %s push against the new account outbox', async (method) => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.setScope('account-a');
    const progress = { bookId: 'shared-id', locator: 'account A position', percentage: 0.5, chapterTitle: '', device: 'a', updatedAt: 1 };
    await offline.setProgress(progress);
    const started = deferred<void>();
    const response = deferred<{ status: number; headers: {}; json: unknown }>();
    transport.respondWith(() => { started.resolve(); return response.promise; });
    const oldRun = engine[method]();
    await started.promise;
    engine.stop();
    transport.json(SECOND_SESSION);
    await api.login('other', 'password12');
    await offline.setScope('account-b');
    await offline.setProgress({ ...progress, locator: 'account B position' });
    platform.setOnline(false);
    engine.start();
    response.resolve({ status: 200, headers: {}, json: { accepted: 1, rejected: 3, serverTime: 900, progress: [], notes: [] } });
    await oldRun;
    await vi.waitFor(() => expect(engine.status().state).toBe('offline'));
    expect(offline.current.dirtyProgress).toEqual(['shared-id']);
    expect(offline.current.progress['shared-id']!.locator).toBe('account B position');
    expect(offline.current.serverTime).toBe(0);
    expect(engine.rejected()).toBe(0);
    engine.stop();
  });

  it('stops the remaining chunks of the old account batch after switching accounts', async () => {
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.setScope('account-a');
    for (let index = 0; index < 1001; index += 1) {
      await offline.setProgress({ bookId: `a-${index}`, locator: 'private', percentage: 0, chapterTitle: '', device: 'a', updatedAt: 1 });
    }
    const started = deferred<void>();
    const response = deferred<{ status: number; headers: {}; json: unknown }>();
    transport.respondWith(() => { started.resolve(); return response.promise; });
    const oldRun = engine.syncNow();
    await started.promise;
    engine.stop();
    transport.json(SECOND_SESSION);
    await api.login('other', 'password12');
    await offline.setScope('account-b');
    transport.json({ accepted: 1, rejected: 0, serverTime: 2, progress: [], notes: [] });
    response.resolve({ status: 200, headers: {}, json: { accepted: 1000, rejected: 0, serverTime: 1, progress: [], notes: [] } });
    await oldRun;
    expect(transport.countMatching((request) => request.url === '/api/v1/sync')).toBe(1);
    expect(offline.current.serverTime).toBe(0);
    expect(offline.current.progress).toEqual({});
    await offline.setScope('account-a');
    expect(offline.current.dirtyProgress).toHaveLength(1001);
  });

  it('clears account-specific note ownership when restarting for another account', async () => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.setScope('account-a');
    transport.json({ serverTime: 1, progress: [], notes: [
      { id: 'n1', bookId: 'private-a', type: 'note', locator: '', text: 'private', comment: '', color: '', updatedAt: 1 },
    ] });
    await engine.syncNow();
    engine.stop();
    transport.json(SECOND_SESSION);
    await api.login('other', 'password12');
    await offline.setScope('account-b');
    await offline.deleteNote('n1');
    platform.setOnline(false);
    engine.start();
    await vi.waitFor(() => expect(engine.status().state).toBe('offline'));
    transport.json({ accepted: 0, rejected: 1, serverTime: 2, progress: [], notes: [] });
    await engine.flush();
    const sent = JSON.parse(bodyText(transport.requests.at(-1)!));
    expect(sent.notes[0].bookId).toBe('');
    expect(sent.notes[0].bookId).not.toBe('private-a');
    engine.stop();
  });

  it('pushes the outbox and then pulls only the delta', async () => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    await offline.setProgress({ bookId: 'b1', locator: 'r1:0.5:c1', percentage: 0.5, chapterTitle: 'c1', device: platform.deviceLabel, updatedAt: 1000 });

    const seen: string[] = [];
    transport.respondWith((request) => {
      seen.push(`${request.method} ${request.url}`);
      if (request.method === 'POST' && request.url.endsWith('/api/v1/sync')) {
        return { status: 200, headers: {}, json: { accepted: 1, rejected: 0, serverTime: 5000, progress: [], notes: [] } };
      }
      return { status: 200, headers: {}, json: { serverTime: 5000, progress: [], notes: [] } };
    });

    await engine.syncNow();
    // One request, not two.
    //
    // `POST /api/v1/sync` already answers with the merged state — the server's own
    // comment says so — and the engine used to throw that answer away and then
    // issue a second request for it. Every page turn therefore cost a POST *and* a
    // GET carrying the same body, which is the doubling a reader sees in the
    // network panel as "sync 接口在不停重复". Asserting the *length* is what makes
    // the fix visible: a test that only checked the cursor would pass either way.
    expect(seen).toEqual(['POST /api/v1/sync']);
    expect(isOutboxEmpty(offline.current)).toBe(true);
    // The cursor is still adopted from the push's answer, so the next real pull is
    // incremental rather than a re-download of the entire server state.
    expect(offline.current.serverTime).toBe(5000);
  });

  it('pulls with the incremental cursor when a poll has nothing to push', async () => {
    // The other half of the same contract: with an empty outbox the push has no
    // answer to reuse, so the pull is the real work and it must still happen — and
    // still be incremental.
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();

    const seen: string[] = [];
    transport.respondWith((request) => {
      seen.push(`${request.method} ${request.url}`);
      return { status: 200, headers: {}, json: { serverTime: 9000, progress: [], notes: [] } };
    });

    await engine.syncNow();
    expect(seen).toEqual(['GET /api/v1/sync?since=0']);
    expect(offline.current.serverTime).toBe(9000);

    await engine.syncNow();
    expect(seen[1]).toBe('GET /api/v1/sync?since=9000');
  });

  it('does not notify its listeners twice for one unchanged state', async () => {
    // The reported symptom: "sync 接口会不停的重复渲染". The reader screen repaints
    // its whole chrome tree on every notification, and a cycle announced itself
    // three times (syncing, idle, and a redundant explicit emit) whether or not
    // anything had changed — with a 30s poll keeping the cycle going while the
    // reader did nothing at all.
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    transport.json({ serverTime: 10, progress: [], notes: [] });

    const states: string[] = [];
    engine.onStatus((status) => states.push(`${status.state}:${status.message}`));

    await engine.syncNow();
    expect(states).toEqual(['syncing:', 'idle:']);

    // A second cycle that ends in the same state as the first adds nothing new, so
    // it must add nothing to the stream either.
    const before = states.length;
    await engine.syncNow();
    expect(states.slice(before)).toEqual(['syncing:', 'idle:']);
  });

  it('folds a burst of scheduled pushes into one round trip', async () => {
    // The reported symptom: "sync 接口调用太过频繁". Every page turn scheduled its
    // own round trip, so a reader flipping through a book produced a POST and a GET
    // every 1.5 seconds for as long as they kept reading.
    vi.useFakeTimers();
    try {
      const { api, transport, offline, engine, platform } = build();
      transport.json(SESSION);
      await api.login('me', 'password12');
      await offline.load();
      transport.json({ serverTime: 10, progress: [], notes: [] });

      for (let page = 0; page < 20; page += 1) {
        await offline.setProgress({
          bookId: 'b1', locator: `r1:${page / 20}:c1`, percentage: page / 20,
          chapterTitle: 'c1', device: platform.deviceLabel, updatedAt: 1000 + page,
        });
        engine.schedule();
        // A page turn every 700ms, well inside the coalescing window.
        await vi.advanceTimersByTimeAsync(700);
      }
      await vi.advanceTimersByTimeAsync(5000);

      const syncPosts = transport.countMatching(
        (request) => request.method === 'POST' && request.url.endsWith('/api/v1/sync'),
      );
      // Twenty page turns, one push. The bound is not "exactly one" — the window
      // may legitimately close more than once across 14 seconds of activity — but
      // it must be a handful rather than one per page.
      expect(syncPosts).toBeGreaterThan(0);
      expect(syncPosts).toBeLessThanOrEqual(6);
      expect(isOutboxEmpty(offline.current)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('always makes the trailing push, so the last page turn is not lost', async () => {
    // The failure mode a debounce without a trailing run has: the reader turns one
    // final page, closes the book, and that page never reaches the server. So the
    // last call has to fire even though nothing followed it to re-arm the timer.
    vi.useFakeTimers();
    try {
      const { api, transport, offline, engine, platform } = build();
      transport.json(SESSION);
      await api.login('me', 'password12');
      await offline.load();
      transport.json({ serverTime: 42, progress: [], notes: [] });

      await offline.setProgress({
        bookId: 'b1', locator: 'r1:0.99:c9', percentage: 0.99,
        chapterTitle: 'c9', device: platform.deviceLabel, updatedAt: 9000,
      });
      engine.schedule();
      expect(engine.pendingRequest).toBe(true);
      await vi.advanceTimersByTimeAsync(4000);
      expect(engine.pendingRequest).toBe(false);
      expect(isOutboxEmpty(offline.current)).toBe(true);
      expect(transport.countMatching((r) => r.method === 'POST' && r.url.endsWith('/api/v1/sync'))).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing at all when there is no session', async () => {
    // A signed-out app must not queue work it can never perform: the timer would
    // fire, find no session, and re-queue itself forever on a device with no
    // account — which is a background wake-up per few seconds on a phone.
    vi.useFakeTimers();
    try {
      const { engine } = build();
      engine.schedule();
      expect(engine.pendingRequest).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(engine.pendingRequest).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a scheduled push when the engine is stopped', async () => {
    vi.useFakeTimers();
    try {
      const { api, transport, engine } = build();
      transport.json(SESSION);
      await api.login('me', 'password12');
      engine.schedule();
      expect(engine.pendingRequest).toBe(true);
      engine.stop();
      expect(engine.pendingRequest).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(engine.pendingRequest).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing but a pull when the outbox is empty', async () => {
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    transport.json({ serverTime: 10, progress: [], notes: [] });
    await engine.syncNow();
    // Counting only /sync: the login above is itself a POST, and counting all
    // POSTs would make this assertion vacuous.
    const syncPosts = transport.countMatching(
      (request) => request.method === 'POST' && request.url.endsWith('/api/v1/sync'),
    );
    expect(syncPosts).toBe(0);
  });

  it('uses the stored cursor for the next pull', async () => {
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    transport.json({ serverTime: 777, progress: [], notes: [] });
    await engine.syncNow();
    transport.json({ serverTime: 999, progress: [], notes: [] });
    await engine.syncNow();
    const pulls = transport.requests.filter((request) => request.method === 'GET' && request.url.includes('/sync?'));
    expect(pulls[0]!.url).toContain('since=0');
    expect(pulls[1]!.url).toContain('since=777');
  });

  it('degrades to offline without surfacing an error', async () => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    platform.setOnline(false);
    await engine.syncNow();
    expect(engine.status().state).toBe('offline');
    expect(engine.status().message).toContain('离线');
  });

  it('does not lose the outbox when the network fails mid-push', async () => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    await offline.setProgress({ bookId: 'b1', locator: 'r1:0.5:c1', percentage: 0.5, chapterTitle: 'c1', device: platform.deviceLabel, updatedAt: 1000 });
    transport.failWith(new Error('boom'));
    await engine.syncNow();
    // The position must still be there to send on the next attempt.
    expect(isOutboxEmpty(offline.current)).toBe(false);
    expect(offline.current.progress['b1']).toBeDefined();
  });

  it('chunks a large outbox instead of sending an oversized batch', async () => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    for (let index = 0; index < 2500; index += 1) {
      await offline.setProgress({
        bookId: `b${index}`,
        locator: `r1:0:s${index}`,
        percentage: 0,
        chapterTitle: '',
        device: platform.deviceLabel,
        updatedAt: 1000,
      });
    }
    const sizes: number[] = [];
    transport.respondWith((request) => {
      if (request.method === 'POST') {
        const body = JSON.parse(bodyText(request)) as { progress?: unknown[] };
        sizes.push(body.progress?.length ?? 0);
        return { status: 200, headers: {}, json: { accepted: 1, rejected: 0, serverTime: 1, progress: [], notes: [] } };
      }
      return { status: 200, headers: {}, json: { serverTime: 1, progress: [], notes: [] } };
    });
    await engine.syncNow();
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1000);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(2500);
  });

  it('reports rejection counts without blocking later flushes', async () => {
    const { api, transport, offline, engine, platform } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    await offline.setProgress({ bookId: 'gone', locator: 'x', percentage: 0, chapterTitle: '', device: platform.deviceLabel, updatedAt: 1 });
    transport.respondWith((request) =>
      request.method === 'POST'
        ? { status: 200, headers: {}, json: { accepted: 0, rejected: 1, serverTime: 2, progress: [], notes: [] } }
        : { status: 200, headers: {}, json: { serverTime: 2, progress: [], notes: [] } },
    );
    await engine.syncNow();
    // A record the server will never accept must not stay in the outbox
    // forever, or every later position would queue behind it.
    expect(isOutboxEmpty(offline.current)).toBe(true);
    expect(engine.status().message).toContain('拒绝');
  });

  it('does nothing when there is no session', async () => {
    const { engine } = build();
    await engine.syncNow();
    expect(engine.status().state).toBe('signed-out');
  });

  it('does not run two syncs at once', async () => {
    const { api, transport, offline, engine } = build();
    transport.json(SESSION);
    await api.login('me', 'password12');
    await offline.load();
    let concurrent = 0;
    let peak = 0;
    transport.respondWith(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return { status: 200, headers: {}, json: { serverTime: 1, progress: [], notes: [] } };
    });
    await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);
    expect(peak).toBe(1);
  });
});
