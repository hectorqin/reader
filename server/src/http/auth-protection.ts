import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AuthRateLimiter } from '../services/auth-limits.ts';

function accountKey(request: FastifyRequest): string | null {
  if (request.routeOptions.url !== '/api/v1/auth/login') return null;
  const username = (request.body as { username?: unknown } | null)?.username;
  return typeof username === 'string' && username.length <= 100
    ? JSON.stringify(['login', request.ip, username.trim().toLowerCase()]) : null;
}

export function registerAuthProtection(app: FastifyInstance): void {
  const limiter = new AuthRateLimiter();
  app.addHook('onRequest', async request => {
    if (request.method !== 'POST') return;
    const path = request.routeOptions.url;
    let policy: { limit: number; windowMs: number } | undefined;
    if (path === '/api/v1/auth/login') policy = { limit: 60, windowMs: 60_000 };
    else if (path === '/api/v1/auth/register') policy = { limit: 5, windowMs: 600_000 };
    else if (path === '/api/v1/auth/refresh') policy = { limit: 240, windowMs: 60_000 };
    else if (path === '/api/v1/auth/password' || path === '/api/v1/admin/users/:id/password') policy = { limit: 20, windowMs: 600_000 };
    if (policy) limiter.consume(JSON.stringify([path, request.ip]), policy.limit, policy.windowMs);
  });
  app.addHook('preHandler', async request => {
    const key = accountKey(request);
    if (key) limiter.consume(key, 10, 60_000);
  });
  app.addHook('onResponse', async (request, reply) => {
    const key = accountKey(request);
    if (key && reply.statusCode < 400) limiter.reset(key);
  });
}
