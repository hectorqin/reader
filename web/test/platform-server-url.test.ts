// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/app.ts';
import { ReaderApi } from '../src/api/client.ts';

afterEach(() => { vi.unstubAllGlobals(); delete window.ReaderAndroid; });

it.each(['web', 'android'])('%s requests use the selected server after platform creation', async host => {
  if (host === 'android') window.ReaderAndroid = {
    shellVersion: () => 1, connectivity: () => 'online',
    watchConnectivity: () => undefined, deviceLabel: () => 'test',
    toast: () => undefined, hasNetwork: () => true, viewport: () => '{}',
    cacheUsage: () => '{}', diagnostics: () => '{}', renderPage: () => false,
    hidePage: () => undefined, canOpenDocument: () => false,
  };
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return Response.json(url.endsWith('/auth/login') || url.endsWith('/auth/refresh') ? {
      user: { id: 'user' }, accessToken: 'test', refreshToken: 'refresh', accessTokenExpiresAt: 0,
    } : {});
  }));
  const context = { options: { defaultServerUrl: '' }, api: undefined as ReaderApi | undefined };
  const platform = await Reflect.apply(App.prototype['createPlatform'], context, []);
  const api = context.api = new ReaderApi(platform, {
    load: async () => null, save: async () => undefined, clear: async () => undefined,
  });
  api.setBaseUrl('http://first.test:5888/');
  await api.login('user', 'password');
  await api.renewSessionIfNeeded();
  await api.upload([], '', 'skip');
  api.setBaseUrl('http://second.test:5888');
  await api.instance();
  expect(calls).toEqual([
    'http://first.test:5888/api/v1/auth/login',
    'http://first.test:5888/api/v1/auth/refresh',
    'http://first.test:5888/api/v1/library/upload',
    'http://second.test:5888/api/v1/instance',
  ]);
});
