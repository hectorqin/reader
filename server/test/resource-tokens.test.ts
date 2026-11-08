import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { AppConfig } from '../src/config/index.ts';
import { Db } from '../src/db/index.ts';
import { authenticate, currentUser } from '../src/http/auth.ts';
import { registerErrorHandler } from '../src/http/errors.ts';
import { signAccessToken, signResourceToken, verifyAccessToken, verifyResourceToken } from '../src/services/tokens.ts';
import { UserService, type UserRow } from '../src/services/users.ts';

const config = { jwtSecret: 'resource-token-test-secret', accessTokenTtl: 604_800, refreshTokenTtl: 31_536_000 } as AppConfig;
const identity = { id: 'user', role: 'member' as const, authVersion: 0 };

test('resource credentials are short lived and cannot be used as access tokens', () => {
  const resource = signResourceToken(config, identity);
  assert.ok(resource.expiresAt <= Date.now() + 15 * 60_000);
  assert.equal(verifyResourceToken(config, resource.token).type, 'resource');
  assert.throws(() => verifyAccessToken(config, resource.token), { code: 'TOKEN_INVALID' });
  assert.throws(() => verifyResourceToken(config, signAccessToken(config, identity).token), { code: 'TOKEN_INVALID' });
  assert.throws(() => verifyResourceToken(config, resource.token + 'tampered'), { code: 'TOKEN_INVALID' });
  const expired = signResourceToken({ ...config, accessTokenTtl: -1 }, identity);
  assert.throws(() => verifyResourceToken(config, expired.token), { code: 'TOKEN_EXPIRED' });
});

test('resource tickets authenticate only allowlisted reads and still enforce account revocation', async () => {
  const row: UserRow = { id: 'user', username: 'reader', display_name: '', password_hash: '', role: 'member', disabled: 0, created_at: 0, updated_at: 0, auth_version: 0 };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const auth = authenticate({ config, users: { byId: id => id === row.id ? row : undefined } });
  for (const path of ['/api/v1/books/book/assets', '/api/v1/books/book/cover', '/api/v1/books/book/content', '/api/v1/books/book/manifest', '/api/v1/tts', '/api/v1/auth/me']) {
    app.get(path, { preHandler: auth }, request => ({ user: currentUser(request).id }));
  }
  app.post('/api/v1/books/book/assets', { preHandler: auth }, () => ({ ok: true }));
  const token = signResourceToken(config, identity).token;
  try {
    for (const path of ['/api/v1/books/book/assets', '/api/v1/books/book/cover', '/api/v1/books/book/content', '/api/v1/tts']) {
      for (const method of ['GET', 'HEAD'] as const) assert.equal((await app.inject({ method, url: `${path}?resource_token=${token}` })).statusCode, 200);
    }
    for (const path of ['/api/v1/auth/me', '/api/v1/books/book/manifest']) assert.equal((await app.inject(`${path}?resource_token=${token}`)).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/books/book/assets?resource_token=${token}` })).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.equal((await app.inject(`/api/v1/books/book/assets?access_token=${token}`)).statusCode, 401);
    const access = signAccessToken(config, identity).token;
    assert.equal((await app.inject(`/api/v1/books/book/assets?resource_token=${access}`)).statusCode, 401);
    assert.equal((await app.inject(`/api/v1/books/book/assets?resource_token=invalid&access_token=${access}`)).statusCode, 401);
    row.disabled = 1;
    assert.equal((await app.inject(`/api/v1/books/book/assets?resource_token=${token}`)).statusCode, 403);
    row.disabled = 0;
    row.auth_version = 1;
    assert.equal((await app.inject(`/api/v1/books/book/assets?resource_token=${token}`)).statusCode, 401);
  } finally { await app.close(); }
});

test('login and refresh issue resource credentials tied to the current account version', async () => {
  const db = new Db(':memory:');
  try {
    const users = new UserService(db, config);
    const user = await users.create({ username: 'resource-reader', password: 'password123' });
    const session = await users.login('resource-reader', 'password123');
    assert.equal(verifyResourceToken(config, session.resourceToken).sub, user.id);
    assert.ok(session.resourceTokenExpiresAt < session.accessTokenExpiresAt);
    const refreshed = await users.refresh(session.refreshToken);
    assert.equal(verifyResourceToken(config, refreshed.resourceToken).ver, 0);
    await users.resetPassword(user.id, 'another-password');
    const replacement = await users.login('resource-reader', 'another-password');
    assert.equal(verifyResourceToken(config, replacement.resourceToken).ver, 1);
  } finally { db.close(); }
});
