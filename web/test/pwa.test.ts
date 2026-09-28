// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerPwa, watchPwaUpdates } from '../src/core/pwa.ts';

let registration: ServiceWorkerRegistration;
let serviceWorker: ServiceWorkerContainer;
let dispose: (() => void) | undefined;
const register = vi.fn();
beforeEach(() => {
  registration = Object.assign(new EventTarget(), { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) }) as unknown as ServiceWorkerRegistration;
  serviceWorker = Object.assign(new EventTarget(), { register, controller: {} }) as unknown as ServiceWorkerContainer;
  register.mockResolvedValue(registration);
  vi.useFakeTimers();
  vi.stubEnv('PROD', true);
  vi.stubEnv('BASE_URL', './');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { serviceWorker });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  register.mockClear();
});

function pendingUpdate() {
  const postMessage = vi.fn();
  Object.defineProperty(registration, 'waiting', { value: { postMessage }, configurable: true });
  return postMessage;
}

it('waits for successful persistence before activating and reloads only once after control changes', async () => {
  const postMessage = pendingUpdate();
  let saved!: () => void;
  const save = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
  const reload = vi.fn();
  dispose = watchPwaUpdates(registration, save, reload);
  document.querySelector<HTMLButtonElement>('.pwa-update button')!.click();
  expect(postMessage).not.toHaveBeenCalled();
  saved(); await Promise.resolve();
  expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  expect(reload).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('keeps the old page when saving fails and allows retry', async () => {
  const postMessage = pendingUpdate();
  const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  const reload = vi.fn();
  dispose = watchPwaUpdates(registration, save, reload);
  const button = document.querySelector<HTMLButtonElement>('.pwa-update button')!;
  button.click(); await Promise.resolve();
  expect(postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  button.click(); await Promise.resolve();
  expect(postMessage).toHaveBeenCalledTimes(1);
});

it('offers updates that finish downloading after registration', () => {
  dispose = watchPwaUpdates(registration);
  expect(document.querySelector('.pwa-update')).toBeNull();
  const worker = new EventTarget();
  Object.defineProperty(registration, 'installing', { value: worker });
  registration.dispatchEvent(new Event('updatefound'));
  pendingUpdate();
  worker.dispatchEvent(new Event('statechange'));
  expect(document.querySelector('.pwa-update button')?.textContent).toBe('立即更新');
});

it('does not reload when another tab activates, and saves before manual refresh', async () => {
  pendingUpdate();
  const save = vi.fn().mockResolvedValue(undefined), reload = vi.fn();
  dispose = watchPwaUpdates(registration, save, reload);
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  expect(reload).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('.pwa-update button')!.click();
  await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('allows retry if worker activation times out', async () => {
  pendingUpdate();
  dispose = watchPwaUpdates(registration, async () => {}, vi.fn());
  const button = document.querySelector<HTMLButtonElement>('.pwa-update button')!;
  button.click(); await Promise.resolve();
  vi.advanceTimersByTime(15_000);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('重试更新');
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
