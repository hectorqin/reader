import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/index.ts';
import { unauthorized } from '../lib/errors.ts';

export interface TokenPayload {
  sub: string;
  role: 'admin' | 'member';
  type: 'access';
  iat: number;
  exp: number;
}

/**
 * Minimal, dependency-free signed token (JWT-compatible HS256 shape).
 *
 * Access tokens are stateless and short lived; refresh tokens are opaque random
 * strings persisted in the database so a device can be revoked individually.
 */
export function signAccessToken(
  config: AppConfig,
  user: { id: string; role: 'admin' | 'member' },
): { token: string; expiresAt: number } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + config.accessTokenTtl;
  const payload: TokenPayload = { sub: user.id, role: user.role, type: 'access', iat: issuedAt, exp: expiresAt };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = sign(config.jwtSecret, `${header}.${body}`);
  return { token: `${header}.${body}.${signature}`, expiresAt: expiresAt * 1000 };
}

export function verifyAccessToken(config: AppConfig, token: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('malformed token', 'TOKEN_INVALID');
  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(config.jwtSecret, `${header}.${body}`);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw unauthorized('bad token signature', 'TOKEN_INVALID');
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    throw unauthorized('bad token payload', 'TOKEN_INVALID');
  }
  if (payload.type !== 'access') throw unauthorized('wrong token type', 'TOKEN_INVALID');
  if (payload.exp * 1000 <= Date.now()) throw unauthorized('token expired', 'TOKEN_EXPIRED');
  return payload;
}

export function newRefreshToken(): { token: string; hash: string; id: string } {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  return { token, hash: hashToken(token), id: randomUUID() };
}

export function hashToken(token: string): string {
  return sign('refresh-token-pepper', token);
}

function sign(secret: string, data: string): string {
  return base64url(createHmac('sha256', secret).update(data).digest());
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}
