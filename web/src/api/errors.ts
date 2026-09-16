import type { ApiErrorBody } from './types.ts';

/**
 * Every failure the client can distinguish, in one place.
 *
 * `offline` is not a server error: it means the request never reached a server.
 * The whole three-state design (LAN / public / fully offline, product design
 * §4) hangs off this being a first-class outcome rather than a generic throw.
 */
export type ApiErrorKind =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'bad_request'
  | 'server'
  | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: string;
  readonly status: number;

  constructor(kind: ApiErrorKind, message: string, code = '', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.code = code;
    this.status = status;
  }

  /** True when the failure is a connectivity problem and a retry may succeed. */
  get isConnectivity(): boolean {
    return this.kind === 'offline';
  }

  /** True when the failure means the stored credentials are no longer usable. */
  get isAuthFailure(): boolean {
    return this.kind === 'unauthorized' || this.kind === 'forbidden';
  }
}

const KIND_BY_STATUS: Record<number, ApiErrorKind> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
};

export function errorForStatus(status: number): ApiErrorKind {
  if (KIND_BY_STATUS[status]) return KIND_BY_STATUS[status]!;
  if (status >= 500) return 'server';
  return 'server';
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function parseErrorBody(raw: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(raw) as ApiErrorBody;
    if (parsed?.error?.code) return { code: parsed.error.code, message: parsed.error.message ?? '' };
  } catch {
    // Non-JSON error bodies (a proxy's HTML error page, an empty 502) are
    // common when a self-hosted instance sits behind a reverse proxy.
  }
  return { code: '', message: raw.slice(0, 200) };
}
