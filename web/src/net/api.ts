/**
 * The server contract, in one place.
 *
 * Every call a renderer needs goes through this client. Two rules shape it:
 *
 *  1. **No renderer knows a URL.** A PDF viewer, a comic pager and a chapter
 *     loader all ask for "page 12 of book X" and get bytes; the `ref` they pass
 *     is whatever the manifest handed them, treated as opaque. That is what lets
 *     the server add a format without a client release.
 *  2. **Concurrency is bounded.** A reader flipping quickly through a comic would
 *     otherwise open one request per page per flip, on a phone, over a tunnel.
 *     The limiter below is crude and that is fine — it exists to keep a reader
 *     from DoSing its own server.
 */

export interface ContentItem {
  id: string;
  seq: number;
  title: string;
  kind: 'chapter' | 'page';
  mediaType: string;
  href: string;
  /** Byte length when known, so a prefetch can be budgeted. */
  size?: number;
}

export interface ContentGroup {
  id: string;
  seq: number;
  title: string;
  count: number;
  /** Global seq of this group's first item. */
  offset: number;
}

export interface BookContent {
  kind: 'reflowable' | 'paged' | 'text' | 'document' | 'single-image';
  total: number;
  groups: ContentGroup[];
  items: ContentItem[];
  /** Present when the request narrowed the items to one group. */
  group?: number;
}

/** One entry of a book's own navigation. */
export interface TocEntry {
  href: string;
  title: string;
  level: number;
  spine?: number;
}

export interface BookDto {
  id: string;
  title: string;
  author: string;
  series: string;
  seriesIndex: number | null;
  tags: string[];
  format: string;
  language: string;
  coverUrl: string | null;
  fileSize: number;
  pageCount: number | null;
  source: string;
  manualFields: string[];
  addedAt: number;
  updatedAt: number;
}

/**
 * One file backing a book, as the manifest lists it.
 *
 * `ref` is the server's opaque reference for this file's bytes, and it is what a
 * client passes back to `/assets?ref=`. It matters for a directory book: a page
 * inside a volume archive is addressed as `page:<volume>:<page>`, and only the
 * server knows where its volumes begin. Deriving it from the path or from the
 * position in this array asks for a different page — a wrong page with a 200,
 * which is worse than an error.
 */
export interface ManifestFile {
  rel_path: string;
  ref?: string;
  size: number;
  missing: number;
}

export interface ManifestResponse {
  book: BookDto;
  contentUrl: string;
  coverUrl: string | null;
  files: ManifestFile[];
  kind?: BookContent['kind'];
  total?: number;
  groups?: ContentGroup[];
  items?: ContentItem[];
  content: BookContent | null;
}

export interface ProgressDto {
  bookId: string;
  locator: string;
  percentage: number;
  chapterTitle: string;
  device: string;
  updatedAt: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Raised for a non-2xx response, carrying the server's error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  /** Server origin. Empty means "same origin", which is the H5 deployment. */
  baseUrl?: string;
  /** Called when a request fails with 401 and a refresh is not possible. */
  onAuthLost?: () => void;
  /** Persistence for the session; defaults to localStorage when available. */
  storage?: SessionStorage;
}

export interface SessionStorage {
  read(): Session | null;
  write(session: Session | null): void;
}

/** Bounded parallel requests: enough to prefetch, not enough to flood. */
const MAX_INFLIGHT = 4;

export class ApiClient {
  private session: Session | null;
  private refreshInFlight: Promise<Session | null> | null = null;
  private inflight = 0;
  private queue: Array<() => void> = [];
  /** Server origin, without a trailing slash. Empty means same origin. */
  readonly baseUrl: string;

  constructor(private readonly options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.session = (options.storage ?? defaultStorage()).read();
  }

  get currentSession(): Session | null {
    return this.session;
  }

  /** Drop the session and tell the host, so it can show a login screen. */
  signOut(): void {
    this.session = null;
    (this.options.storage ?? defaultStorage()).write(null);
    this.options.onAuthLost?.();
  }

  private setSession(session: Session | null): void {
    this.session = session;
    (this.options.storage ?? defaultStorage()).write(session);
  }

  async login(username: string, password: string): Promise<Session> {
    const session = await this.request<Session>('POST', '/api/v1/auth/login', {
      body: { username, password },
      anonymous: true,
    });
    this.setSession(session);
    return session;
  }

  async register(username: string, password: string, displayName?: string): Promise<Session> {
    const result = await this.request<{ session: Session }>('POST', '/api/v1/auth/register', {
      body: { username, password, ...(displayName ? { displayName } : {}) },
      anonymous: true,
    });
    this.setSession(result.session);
    return result.session;
  }

  /** Instance info, used to decide whether to offer registration. */
  async instance(): Promise<{ name: string; apiVersion: number; registrationOpen: boolean; userCount: number }> {
    return this.request('GET', '/api/v1/instance', { anonymous: true });
  }

  /**
   * Everything needed to open a book, in one round trip.
   *
   * `group` narrows the items to one window (a comic volume, a chapter range) so
   * opening a 40-volume series transfers one volume's worth of entries.
   */
  async manifest(bookId: string, group?: number): Promise<ManifestResponse> {
    const query = group === undefined ? '' : `?group=${group}`;
    return this.request('GET', `/api/v1/books/${encodeURIComponent(bookId)}/manifest${query}`);
  }

  /**
   * The book's table of contents.
   *
   * A separate call from `manifest` because a TOC has to be complete to be
   * useful, while the manifest is deliberately windowed. Fetching the manifest
   * of a 1200-chapter book to show its contents would be the one thing windowing
   * exists to prevent.
   */
  async toc(bookId: string): Promise<TocEntry[]> {
    const result = await this.request<{ toc: TocEntry[] }>('GET', `/api/v1/books/${encodeURIComponent(bookId)}/toc`);
    return result.toc;
  }

  /** One window of items, for a book already open. */
  async items(bookId: string, group?: number): Promise<BookContent> {
    const query = group === undefined ? '' : `?group=${group}`;
    return this.request('GET', `/api/v1/books/${encodeURIComponent(bookId)}/items${query}`);
  }

  /**
   * A single addressable resource, as bytes.
   *
   * Returns a Blob rather than text: the same method serves a chapter document, a
   * comic page and a PDF, and the caller decides how to interpret it. `ref` is
   * opaque and must be passed through unchanged.
   */
  async asset(bookId: string, ref: string): Promise<Blob> {
    return this.requestBlob('GET', `/api/v1/books/${encodeURIComponent(bookId)}/assets?ref=${encodeURIComponent(ref)}`);
  }

  /** A chapter document as text, which is what the container mounts. */
  async chapterText(bookId: string, ref: string): Promise<string> {
    const blob = await this.asset(bookId, ref);
    return blob.text();
  }

  /** The raw book file; a client uses this to cache a book for offline reading. */
  contentUrl(bookId: string): string {
    return this.url(`/api/v1/books/${encodeURIComponent(bookId)}/content`);
  }

  /**
   * A URL a plain `<img>` can load.
   *
   * The token travels in the query because an `<img src>` cannot carry a header —
   * the same constraint that shapes `render/asset-url.ts`, and the same bounded
   * exposure: the server only accepts a query token on read endpoints for
   * immutable content, and a cover is addressed by content hash.
   *
   * Fetching the cover in JavaScript and handing over a Blob URL would keep the
   * token out of the URL, at the cost of buffering every cover of a 2000-book
   * shelf before any of them can render — which is exactly what lazy loading
   * exists to avoid.
   */
  coverUrl(bookId: string): string {
    const token = this.session?.accessToken;
    const path = `/api/v1/books/${encodeURIComponent(bookId)}/cover`;
    return this.url(token ? `${path}?access_token=${encodeURIComponent(token)}` : path);
  }

  async shelf(params: { search?: string; page?: number; pageSize?: number } = {}): Promise<{
    items: BookDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    const suffix = query.toString() ? `?${query}` : '';
    return this.request('GET', `/api/v1/books${suffix}`);
  }

  async progress(bookId: string): Promise<{ progress: ProgressDto | null }> {
    return this.request('GET', `/api/v1/sync/progress/${encodeURIComponent(bookId)}`);
  }

  async putProgress(bookId: string, progress: Omit<ProgressDto, 'bookId'>): Promise<void> {
    await this.request('PUT', `/api/v1/sync/progress/${encodeURIComponent(bookId)}`, { body: progress });
  }

  /** Absolute URL for an API path, including the origin when one is configured. */
  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // ---------------------------------------------------------------- plumbing

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; anonymous?: boolean } = {},
  ): Promise<T> {
    const response = await this.fetch(method, path, options);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async requestBlob(method: string, path: string): Promise<Blob> {
    const response = await this.fetch(method, path, {});
    return response.blob();
  }

  /**
   * One request, with auth, one retry after a token refresh, and a queue slot.
   *
   * The refresh is deduplicated: a comic prefetching four pages at once would
   * otherwise revoke its own refresh token three times, because the server
   * rotates them on use.
   */
  private async fetch(
    method: string,
    path: string,
    options: { body?: unknown; anonymous?: boolean },
  ): Promise<Response> {
    await this.acquire();
    try {
      const response = await this.send(method, path, options);
      if (response.status !== 401 || options.anonymous) {
        if (!response.ok) throw await toApiError(response);
        return response;
      }

      const refreshed = await this.refresh();
      if (!refreshed) {
        this.signOut();
        throw await toApiError(response);
      }
      const retry = await this.send(method, path, options);
      if (!retry.ok) throw await toApiError(retry);
      return retry;
    } finally {
      this.release();
    }
  }

  private send(method: string, path: string, options: { body?: unknown; anonymous?: boolean }): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (!options.anonymous && this.session) headers.authorization = `Bearer ${this.session.accessToken}`;
    return fetch(this.url(path), {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  }

  private async refresh(): Promise<boolean> {
    this.refreshInFlight ??= (async () => {
      const current = this.session;
      if (!current?.refreshToken) return null;
      try {
        const response = await fetch(this.url('/api/v1/auth/refresh'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!response.ok) return null;
        const session = (await response.json()) as Session;
        return session;
      } catch {
        return null;
      } finally {
        // Cleared in a microtask so concurrent callers awaited on this same
        // promise still observe its result.
        queueMicrotask(() => {
          this.refreshInFlight = null;
        });
      }
    })();

    const session = await this.refreshInFlight;
    if (!session) return false;
    this.setSession(session);
    return true;
  }

  private acquire(): Promise<void> {
    if (this.inflight < MAX_INFLIGHT) {
      this.inflight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.inflight += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.inflight -= 1;
    this.queue.shift()?.();
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `request failed with ${response.status}`;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // A non-JSON error body (a proxy's HTML error page) is not worth a second
    // failure; the status code is the useful part.
  }
  return new ApiError(response.status, code, message);
}

/** localStorage when it exists; an in-memory stub in a worker or a test. */
function defaultStorage(): SessionStorage {
  const key = 'reader.session';
  try {
    const probe = globalThis.localStorage;
    if (!probe) throw new Error('no localStorage');
    return {
      read: () => {
        const raw = probe.getItem(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as Session;
        } catch {
          return null;
        }
      },
      write: (session) => {
        if (session) probe.setItem(key, JSON.stringify(session));
        else probe.removeItem(key);
      },
    };
  } catch {
    let memory: Session | null = null;
    return {
      read: () => memory,
      write: (session) => {
        memory = session;
      },
    };
  }
}
