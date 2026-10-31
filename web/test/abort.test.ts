import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortFailure, combineAbortSignals, isAbortError } from '../src/core/abort.ts';
import { ApiError } from '../src/api/errors.ts';
import { FetchTransport } from '../src/core/fetch-transport.ts';

it.each([0, 1])('forwards cancellation from input %s and removes all listeners', index => {
  const inputs = [new AbortController(), new AbortController()];
  const removes = inputs.map(input => vi.spyOn(input.signal, 'removeEventListener'));
  const combined = combineAbortSignals(inputs.map(input => input.signal));
  const reason = new Error('cancelled');
  inputs[index].abort(reason);
  expect(combined.signal.aborted).toBe(true);
  expect(combined.signal.reason).toBe(reason);
  for (const remove of removes) expect(remove).toHaveBeenCalledOnce();
  inputs[1 - index].abort(new Error('later'));
  expect(combined.signal.reason).toBe(reason);
  combined.dispose();
  for (const remove of removes) expect(remove).toHaveBeenCalledOnce();
});

it('honors an already aborted input and cleans up earlier listeners', () => {
  const first = new AbortController(), second = new AbortController();
  const remove = vi.spyOn(first.signal, 'removeEventListener');
  second.abort();
  const combined = combineAbortSignals([first.signal, second.signal]);
  expect(combined.signal.aborted).toBe(true);
  expect(combined.signal.reason).toBe(second.signal.reason);
  expect(remove).toHaveBeenCalledOnce();
});

it('releases listeners after success without aborting or retaining duplicate inputs', () => {
  const source = new AbortController();
  const add = vi.spyOn(source.signal, 'addEventListener');
  const remove = vi.spyOn(source.signal, 'removeEventListener');
  const combined = combineAbortSignals([source.signal, source.signal]);
  combined.dispose(); combined.dispose(); source.abort();
  expect(combined.signal.aborted).toBe(false);
  expect(add).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
});

describe('abort failures surface as ApiError(aborted)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const transport = () => new FetchTransport(() => 'http://server');

  it('maps a raw AbortError and the reason of a signal aborted without one', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(controller.signal.reason)).toBe(true);
    expect(abortFailure(controller.signal.reason)?.kind).toBe('aborted');
    expect(abortFailure(new Error('custom'), controller.signal)?.kind).toBe('aborted');
    expect(abortFailure(new TypeError('Failed to fetch'))).toBeNull();
    expect(abortFailure(new ApiError('server', 'boom'), controller.signal)).toBeNull();
  });

  it('treats a timed-out signal as a connectivity failure, not a cancellation', () => {
    const controller = new AbortController();
    controller.abort(new DOMException('timed out', 'TimeoutError'));
    expect(abortFailure(controller.signal.reason, controller.signal)?.kind).toBe('offline');
  });

  it('maps an abort while the response body is read', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => { controller.abort(); throw controller.signal.reason; },
    })));
    const error = await transport().send({ url: '/api/v1/media/browse', method: 'GET', headers: {}, signal: controller.signal }).catch(value => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('aborted');
  });

  it('maps a fetch rejected with a custom abort reason', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(new Error('screen replaced')); throw controller.signal.reason; }));
    const error = await transport().send({ url: '/api/v1/media/browse', method: 'GET', headers: {}, signal: controller.signal }).catch(value => value);
    expect(error.kind).toBe('aborted');
  });

  it('maps a binary body read aborted mid-way', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(),
      arrayBuffer: async () => { controller.abort(); throw new DOMException('signal is aborted without reason', 'AbortError'); },
    })));
    const error = await transport().send({ url: '/cover', method: 'GET', headers: {}, binary: true, signal: controller.signal }).catch(value => value);
    expect(error.kind).toBe('aborted');
  });
});
