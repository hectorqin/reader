import { expect, it, vi } from 'vitest';
import { combineAbortSignals } from '../src/core/abort.ts';

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
