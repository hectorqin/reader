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

  /**
   * True when the failure means the stored credentials are no longer usable.
   *
   * A 403 is ambiguous on this API and the distinction matters: the server uses it
   * both for "your account is gone" (`ACCOUNT_DISABLED`, which has to sign the
   * reader out) and for "that operation is refused" (`ADMIN_REQUIRED`,
   * `PATH_TRAVERSAL`, `READ_ONLY_MOUNT` — none of which say anything about the
   * session). Treating every 403 as a dead session meant a reader who tried to
   * rename a file on a read-only mount was thrown back to the login screen, with
   * their credentials silently discarded, for an error that had nothing to do
   * with signing in.
   *
   * So the code decides, and the status is only the fallback for a 403 whose code
   * the client cannot classify.
   */
  get isAuthFailure(): boolean {
    // Source credentials are independent of the reader account session.
    if (['AUTH_REQUIRED','AUTH_EXPIRED','VERIFICATION_REQUIRED'].includes(this.code)) return false;
    if (this.kind === 'unauthorized') return true;
    if (this.kind !== 'forbidden') return false;
    return AUTH_FAILURE_CODES.has(this.code);
  }
}

/** The 403 codes that mean the session itself is no longer valid. */
const AUTH_FAILURE_CODES = new Set(['ACCOUNT_DISABLED', 'TOKEN_INVALID', 'NO_TOKEN']);

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

const HAS_CJK = /[一-鿿]/;

const TEXT_BY_KIND: Record<ApiErrorKind, string> = {
  offline: '连不上服务器，请检查网络和服务地址后重试',
  unauthorized: '登录已失效，请重新登录',
  forbidden: '当前账号没有权限执行这个操作',
  not_found: '没有找到请求的内容，它可能已被移走或删除',
  conflict: '内容已在别处被修改，请刷新后重试',
  bad_request: '请求没有被服务器接受，请检查输入后重试',
  server: '服务器出错了，请稍后重试',
  aborted: '请求已取消',
};

/**
 * The sentence a screen shows for a failure (docs/ui.md §4: say what happened).
 *
 * Messages come from three places — the server's own wording, the transport
 * (`request failed with status 502`, a browser's `Failed to fetch`) and a
 * proxy's error page — and only the first is written for a reader. A message
 * with Chinese in it was written for the interface and is shown as is; anything
 * else is a diagnostic, and the screen says what kind of failure it was instead.
 * Connectivity failures always use our sentence: the browser's text for them is
 * never useful and differs per engine.
 */
export function describeError(error: unknown, fallback = '出错了，请重试'): string {
  if (error instanceof ApiError) {
    if (error.code === 'TIMEOUT') return '请求超时，请检查网络后重试';
    if (error.kind === 'offline' && error.code !== 'STREAM_INTERRUPTED') return TEXT_BY_KIND.offline;
    if (HAS_CJK.test(error.message)) return error.message;
    return TEXT_BY_KIND[error.kind];
  }
  if (error instanceof Error && HAS_CJK.test(error.message)) return error.message;
  return fallback;
}
