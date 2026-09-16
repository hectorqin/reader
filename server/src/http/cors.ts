import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/index.ts';

/**
 * CORS for the H5 client.
 *
 * Three deployments have to work, and the same policy covers all of them:
 *
 *  1. H5 served *by* this server at `/` — same origin, CORS is not even
 *     involved beyond the origin header being echoed.
 *  2. H5 served from somewhere else (a static host, a dev server on :5174)
 *     against a LAN server at an IP the client cannot know in advance.
 *  3. The Android shell, whose WebView origin is `file://` or a custom scheme.
 *
 * There are no cookies anywhere in the design: authentication is a bearer token
 * that the client attaches explicitly. That is what makes a permissive default
 * defensible — a malicious page cannot ride an ambient session, it would have to
 * already hold the token. `CORS_ORIGINS` narrows it for public deployments.
 */
export function resolveCorsOrigin(config: AppConfig, request: FastifyRequest): string {
  const origin = request.headers.origin;
  // Non-browser clients (curl, the Android native layer) send no Origin; the
  // header is then irrelevant and echoing nothing is correct.
  if (!origin) return '*';
  if (config.corsOrigins.length === 0) return origin;

  if (config.corsOrigins.includes(origin)) return origin;

  // `file://` requests arrive with the literal origin "null". The Android shell
  // needs this whenever the H5 bundle is loaded from assets, and it cannot be
  // expressed as a normal origin entry.
  if (origin === 'null' && config.corsOrigins.includes('null')) return 'null';

  return config.corsOrigins[0] ?? origin;
}

export function isOriginAllowed(config: AppConfig, request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (config.corsOrigins.length === 0) return true;
  return config.corsOrigins.includes(origin) || (origin === 'null' && config.corsOrigins.includes('null'));
}
