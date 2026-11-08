import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { requestLogPath, serializeRequest } from '../src/http/request-log.ts';
import { registerMediaProxy } from '../src/http/routes/media-proxy.ts';

test('request logs omit query credentials without changing the request', async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(String(chunk)); callback(); } });
  const app = Fastify({ logger: { stream, serializers: { req: serializeRequest } } });
  app.get('/resource', request => ({ query: request.query }));
  try {
    const response = await app.inject('/resource?access_token=private-access&ticket=private-ticket');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().query, { access_token: 'private-access', ticket: 'private-ticket' });
    const output = lines.join('');
    assert.ok(output.includes('incoming request'));
    assert.ok(output.includes('/resource'));
    assert.ok(!output.includes('private-access'));
    assert.ok(!output.includes('private-ticket'));
    assert.equal(requestLogPath('/resource?access_token=secret#fragment'), '/resource');
  } finally { await app.close(); }
});

test('media proxy errors do not log upstream credential-bearing messages', async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(String(chunk)); callback(); } });
  const app = Fastify({ logger: { stream, serializers: { req: serializeRequest } } });
  registerMediaProxy(app, {
    async request() { throw new Error('failed URL with private-ticket'); },
    async close() {},
  });
  try {
    const response = await app.inject('/api/v1/media/play?ticket=private-ticket');
    assert.equal(response.statusCode, 503);
    assert.ok(!lines.join('').includes('private-ticket'));
  } finally { await app.close(); }
});
