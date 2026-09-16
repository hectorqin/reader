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
    const token = bearerToken(request);
    if (!token) throw unauthorized('missing bearer token', 'NO_TOKEN');
    const payload = verifyAccessToken(ctx.config, token);
    const row = ctx.users.byId(payload.sub);
    if (!row) throw unauthorized('account no longer exists', 'TOKEN_INVALID');
    if (row.disabled === 1) throw forbidden('account disabled', 'ACCOUNT_DISABLED');
    request.currentUser = toPublicUser(row);
  };
}

/**
 * The access token, from the header or — for sub-resources only — the query.
 *
 * A chapter document is rendered by a browser, which fetches its `<img src>` and
 * `<link href>` itself. Those requests cannot carry an `Authorization` header:
 * there is no API to attach one to an element's URL, and a `fetch` + Blob URL
 * would defeat caching and break the range requests a large image wants. So the
 * token travels in the query string for exactly those requests.
 *
 * The fallback is restricted to `GET` on asset and cover routes. Anywhere else a
 * token in a URL is a bad idea: URLs land in logs, history and `Referer` headers,
 * and a token that can trigger a scan or a metadata write is not one to leak. The
 * narrow allowlist keeps the exposure to reads of immutable content, and those
 * URLs are only ever built by the client for that purpose.
 */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();

  if (!queryTokenAllowed(request)) return null;
  const query = (request.query ?? {}) as Record<string, unknown>;
  const value = query.access_token;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Whether this request may authenticate from the query string. */
function queryTokenAllowed(request: FastifyRequest): boolean {
  if (request.method !== 'GET') return false;
  const path = (request.url.split('?')[0] ?? '').replace(/\/$/, '');

  // Speech, for the same reason: it is a resource an `<audio>` element fetches
  // itself. The allowlist is exact rather than a prefix, because the capability
  // route (`/tts/voices`) is an API call and must carry a header — the exposure
  // here is a read of audio derived from a sentence the client already holds.
  if (path === '/api/v1/tts') return true;

  if (!path.startsWith('/api/v1/books/')) return false;
  return path.endsWith('/assets') || path.endsWith('/cover') || path.endsWith('/content');
}

export function requireAdmin(request: FastifyRequest): void {
  if (request.currentUser?.role !== 'admin') throw forbidden('admin role required', 'ADMIN_REQUIRED');
}

export function currentUser(request: FastifyRequest) {
  if (!request.currentUser) throw unauthorized();
  return request.currentUser;
}
