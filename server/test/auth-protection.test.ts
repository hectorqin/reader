import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AuthRateLimiter, AuthWorkLimiter } from '../src/services/auth-limits.ts';
import { registerAuthProtection } from '../src/http/auth-protection.ts';
import { registerErrorHandler } from '../src/http/errors.ts';
import { unauthorized } from '../src/lib/errors.ts';

test('rate windows expire and distinct keys do not share an allowance', () => {
  let now = 100;
  const limiter = new AuthRateLimiter(() => now);
  limiter.consume('first', 1, 60_000);
  assert.throws(() => limiter.consume('first', 1, 60_000), { statusCode: 429, retryAfter: 60 });
  limiter.consume('second', 1, 60_000);
  now += 60_000;
  limiter.consume('first', 1, 60_000);
  limiter.reset('first');
  limiter.consume('first', 1, 60_000);
});

test('rate limiter bounds memory without evicting active limits', () => {
  let now = 0;
  const limiter = new AuthRateLimiter(() => now, 2);
  limiter.consume('first', 1, 60_000);
  limiter.consume('second', 1, 60_000);
  assert.throws(() => limiter.consume('third', 1, 60_000), { statusCode: 429 });
  assert.throws(() => limiter.consume('first', 1, 60_000), { statusCode: 429 });
  now += 60_000;
  limiter.consume('third', 1, 60_000);
});

test('password work is bounded and slots are released after failures', async () => {
  const limiter = new AuthWorkLimiter(1);
  let release!: () => void;
  const pending = limiter.run(() => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(limiter.run(async () => 'blocked'), { statusCode: 429, code: 'AUTH_BUSY' });
  release();
  await pending;
  await assert.rejects(limiter.run(async () => { throw new Error('failure'); }), /failure/);
  assert.equal(await limiter.run(async () => 'available'), 'available');
});

function build(trustProxy: false | string[] = false) {
  const app = Fastify({ trustProxy, logger: false });
  registerErrorHandler(app);
  registerAuthProtection(app);
  app.post('/api/v1/auth/login', async request => {
    if ((request.body as { password: string }).password !== 'correct') throw unauthorized('bad credentials');
    return { ok: true, ip: request.ip };
  });
  return app;
}

test('failed account attempts return 429 and Retry-After without a proxy-header bypass', async () => {
  const app = build();
  try {
    for (let index = 0; index < 11; index++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-forwarded-for': `10.0.0.${index}` }, payload: { username: ' OWNER ', password: 'wrong' } });
      assert.equal(response.statusCode, index < 10 ? 401 : 429);
      if (index === 10) assert.ok(Number(response.headers['retry-after']) > 0);
    }
    const other = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '192.0.2.2', payload: { username: 'owner', password: 'wrong' } });
    assert.equal(other.statusCode, 401);
  } finally { await app.close(); }
});

test('successful authentication clears account failures, not the per-IP budget', async () => {
  const app = build();
  try {
    for (let round = 0; round < 2; round++) {
      for (let index = 0; index < 9; index++) {
        const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'wrong' } });
        assert.equal(response.statusCode, 401);
      }
      const success = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'OWNER', password: 'correct' } });
      assert.equal(success.statusCode, 200);
    }
    for (let index = 20; index <= 60; index++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: `user-${index}`, password: 'correct' } });
      assert.equal(response.statusCode, index < 60 ? 200 : 429);
    }
  } finally { await app.close(); }
});

test('forwarded client addresses are honored only for explicitly trusted proxies', async () => {
  for (const trustProxy of [false, ['loopback']] as const) {
    const app = build(trustProxy === false ? false : [...trustProxy]);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-forwarded-for': '192.0.2.5' }, payload: { username: 'owner', password: 'correct' } });
      assert.equal(response.json().ip, trustProxy === false ? '127.0.0.1' : '192.0.2.5');
    } finally { await app.close(); }
  }
});

test('registration attempts are bounded independently for each client address', async () => {
  const app = build();
  app.post('/api/v1/auth/register', async () => ({ ok: true }));
  try {
    for (let index = 0; index < 6; index++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register' });
      assert.equal(response.statusCode, index < 5 ? 200 : 429);
      if (index === 5) assert.ok(Number(response.headers['retry-after']) > 0);
    }
    const other = await app.inject({ method: 'POST', url: '/api/v1/auth/register', remoteAddress: '192.0.2.2' });
    assert.equal(other.statusCode, 200);
  } finally { await app.close(); }
});
