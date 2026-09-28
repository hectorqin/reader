// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { App } from '../src/app.ts';

it('persists the current reading position before draining local writes, without waiting for sync', async () => {
  const calls: string[] = [];
  const sync = { flush: vi.fn() };
  await App.prototype.saveBeforeUpdate.call({
    reader: { async flushProgress() { calls.push('position'); } },
    offline: { async flush() { calls.push('storage'); } },
    sync,
  } as unknown as App);
  expect(calls).toEqual(['position', 'storage']);
  expect(sync.flush).not.toHaveBeenCalled();
});

it('propagates local save failures so PWA activation can be stopped', async () => {
  const error = new Error('quota exceeded');
  await expect(App.prototype.saveBeforeUpdate.call({
    reader: { async flushProgress() { throw error; } },
    offline: { flush: vi.fn() },
  } as unknown as App)).rejects.toBe(error);
});
