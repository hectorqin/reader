import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SourceHost } from '../src/services/source-host.ts';
import { AppError } from '../src/lib/errors.ts';
import { searchResponse } from '../src/http/search-stream.ts';

for (const reason of ['complete', 'provider_error', 'connection_closed']) test(`stream diagnostics distinguish ${reason} from cancellation acknowledgement failure`, async () => {
  const logs: Array<{ data: Record<string, unknown>; message: string }> = [];
  const log = (data: Record<string, unknown>, message: string) => logs.push({ data, message });
  const request = { raw: new EventEmitter(), log: { info: log, warn: log } } as unknown as FastifyRequest;
  const raw = new EventEmitter(), reply = { raw } as unknown as FastifyReply;
  const host = {
    async search() {
      if (reason === 'provider_error') throw new AppError(504, 'PLUGIN_TIMEOUT', 'deadline');
      if (reason === 'connection_closed') raw.emit('close');
      return { items: [], batch: { completed: 1, total: 1 } };
    },
    async cancelSearch() { throw new AppError(504, 'PLUGIN_TIMEOUT', 'cancel deadline'); },
  } as unknown as SourceHost;
  const stream = searchResponse(request, reply, host, 'user', 'source', { query: 'private-query', sessionId: 'test-session' });
  for await (const chunk of stream) void chunk;
  const ended = logs.find(item => item.message === 'search stream ended')!;
  assert.equal(ended.data.reason, reason);
  assert.equal(ended.data.sessionId, 'test-session');
  const failed = logs.find(item => item.message === 'search session cancellation failed')!;
  assert.equal(failed.data.reason, ended.data.reason);
  assert.equal(typeof failed.data.cleanupMs, 'number');
  assert.ok(!JSON.stringify(logs).includes('private-query'));
});
