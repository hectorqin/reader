import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context.ts';
import { verifyAccessToken } from '../services/tokens.ts';
import { toPublicUser } from '../services/users.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';

/**
 * Resolves the bearer token into `request.currentUser`.
 *
 * A deleted or disabled account must lose access immediately, so the user is
 * re-read from the database on every request instead of trusting the claims
 * embedded in the token.
 */
export function authenticate(ctx: AppContext) {
  return async function preHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('missing bearer token', 'NO_TOKEN');
    const payload = verifyAccessToken(ctx.config, header.slice('Bearer '.length).trim());
    const row = ctx.users.byId(payload.sub);
    if (!row) throw unauthorized('account no longer exists', 'TOKEN_INVALID');
    if (row.disabled === 1) throw forbidden('account disabled', 'ACCOUNT_DISABLED');
    request.currentUser = toPublicUser(row);
  };
}

export function requireAdmin(request: FastifyRequest): void {
  if (request.currentUser?.role !== 'admin') throw forbidden('admin role required', 'ADMIN_REQUIRED');
}

export function currentUser(request: FastifyRequest) {
  if (!request.currentUser) throw unauthorized();
  return request.currentUser;
}
