// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerPwa } from '../src/core/pwa.ts';

const register = vi.fn().mockResolvedValue({});
beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('BASE_URL', './');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  register.mockClear();
});

it('registers the worker relative to the deployed document and bypasses the HTTP cache', () => {
  registerPwa();
  const base = new URL('./', document.baseURI);
  expect(register).toHaveBeenCalledWith(new URL('sw.js', base), {
    scope: base.pathname, updateViaCache: 'none',
  });
});

it('does not register in development', () => {
  vi.stubEnv('PROD', false);
  registerPwa();
  expect(register).not.toHaveBeenCalled();
});

it('does not register in the Android shell', () => {
  vi.stubGlobal('ReaderAndroid', {});
  registerPwa();
  expect(register).not.toHaveBeenCalled();
});

it('keeps ordinary HTTP and unsupported browsers usable', () => {
  vi.stubGlobal('isSecureContext', false);
  registerPwa();
  expect(register).not.toHaveBeenCalled();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {});
  expect(registerPwa).not.toThrow();
});

it('reports failed registration without an unhandled rejection', async () => {
  const error = new Error('storage unavailable');
  register.mockRejectedValueOnce(error);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  registerPwa();
  await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('离线应用缓存注册失败', error));
});
