import { expect, it } from 'vitest';
import { ReaderApi } from '../src/api/client.ts';
import { FakeTransport, makePlatform } from './helpers/env.ts';

function setup() {
  const transport = new FakeTransport();
  const api = new ReaderApi(makePlatform(transport), { load: async () => null, save: async () => {}, clear: async () => {} });
  api.setBaseUrl('https://reader.test');
  const session = {
    user: { id: 'reader', username: 'reader', displayName: '', role: 'member' as const, createdAt: 0 },
    accessToken: 'private-access', accessTokenExpiresAt: Date.now() + 3_600_000,
    resourceToken: 'old-resource', resourceTokenExpiresAt: Date.now() + 1000,
    refreshToken: 'refresh', refreshTokenExpiresAt: Date.now() + 86_400_000,
  };
  return { transport, api, session };
}

it('renews expiring resource tickets even when the access token is still valid', async () => {
  const { transport, api, session } = setup();
  transport.json(session);
  await api.login('reader', 'password');
  transport.json({ ...session, resourceToken: 'new-resource', resourceTokenExpiresAt: Date.now() + 900_000 });
  await api.renewSessionIfNeeded();
  expect(transport.requests.at(-1)!.url).toContain('/auth/refresh');
  expect(api.currentSession()?.resourceToken).toBe('new-resource');
});

it('keeps legacy sessions without resource ticket fields compatible', async () => {
  const { transport, api, session } = setup();
  const { resourceToken: _token, resourceTokenExpiresAt: _expiresAt, ...legacy } = session;
  transport.json(legacy);
  await api.login('reader', 'password');
  await api.renewSessionIfNeeded();
  expect(transport.requests).toHaveLength(1);
});

it('keeps an unexpired access session usable if proactive resource renewal loses connectivity', async () => {
  const { transport, api, session } = setup();
  transport.json(session);
  await api.login('reader', 'password');
  transport.respondWith(request => {
    if (request.url.endsWith('/auth/refresh')) throw new Error('network unavailable');
    return { status: 200, headers: {}, json: { items: [], total: 0, page: 1, pageSize: 50 } };
  });
  const result = await api.listBooks();
  expect(result.items).toEqual([]);
  expect(api.currentSession()?.accessToken).toBe('private-access');
  expect(transport.requests.at(-1)!.headers.authorization).toBe('Bearer private-access');
});
