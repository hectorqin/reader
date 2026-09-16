import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { badRequest } from '../../lib/errors.ts';

interface Credentials {
  username?: string;
  password?: string;
  displayName?: string;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticateFn = authenticate(ctx);

  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = (request.body ?? {}) as Credentials;
    if (!body.username || !body.password) throw badRequest('username and password are required');
    if (!ctx.users.canRegisterPublicly()) {
      throw badRequest('public registration is disabled on this instance', 'REGISTRATION_DISABLED');
    }
    const user = await ctx.users.create({
      username: body.username,
      password: body.password,
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    });
    const session = await ctx.users.login(body.username, body.password, request.headers['user-agent'] ?? '');
    reply.status(201);
    return { user, session };
  });

  app.post('/api/v1/auth/login', async (request) => {
    const body = (request.body ?? {}) as Credentials;
    if (!body.username || !body.password) throw badRequest('username and password are required');
    const session = await ctx.users.login(body.username, body.password, request.headers['user-agent'] ?? '');
    return session;
  });

  app.post('/api/v1/auth/refresh', async (request) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    if (!body.refreshToken) throw badRequest('refreshToken is required');
    return ctx.users.refresh(body.refreshToken);
  });

  app.post('/api/v1/auth/logout', async (request) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    // Logout is idempotent: a client that is already signed out must not error.
    if (body.refreshToken) ctx.users.revokeByToken(body.refreshToken);
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: authenticateFn }, async (request) => {
    return { user: currentUser(request) };
  });

  app.post('/api/v1/auth/password', { preHandler: authenticateFn }, async (request) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) throw badRequest('currentPassword and newPassword are required');
    await ctx.users.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  });

  app.get('/api/v1/instance', async () => {
    // Advertised so a client can tell a fresh instance from a claimed one
    // without attempting registration.
    return {
      name: 'reader',
      apiVersion: 1,
      registrationOpen: ctx.users.canRegisterPublicly(),
      userCount: ctx.users.count(),
    };
  });
}
