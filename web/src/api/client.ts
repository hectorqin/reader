import { ApiError, errorForStatus, parseErrorBody } from './errors.ts';
import type {
  Book,
  BookContent,
  BookListPage,
  ContinueReadingItem,
  Facets,
  InstanceInfo,
  Manifest,
  Note,
  NoteType,
  Progress,
  Session,
  SyncPull,
  SyncPushResult,
  TocEntry,
  User,
} from './types.ts';
import type { Platform } from '../core/platform.ts';

export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

export interface ListQuery {
  search?: string;
  author?: string;
  series?: string;
  tag?: string;
  format?: string;
  sort?: 'title' | 'author' | 'added' | 'updated';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ProgressInput {
  bookId: string;
  locator: string;
  percentage: number;
  chapterTitle: string;
  /** Device label; the server records it so the UI can say "read on Pixel". */
  device: string;
  updatedAt: number;
}

export interface NoteInput {
  id: string;
  bookId: string;
  type: NoteType;
  locator: string;
  text: string;
  comment: string;
  color: string;
  updatedAt: number;
  deleted: boolean;
}

/** One entry per HTTP call, so callers can drive their own retry policy. */
export interface RequestOptions {
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry, used by the refresh call itself. */
  noRetry?: boolean;
}

/**
 * The single place that knows how to talk to a reader server.
 *
 * Responsibilities kept here on purpose:
 *   - attaching the access token
 *   - refreshing it exactly once when it expires, for any in-flight call
 *   - de-duplicating concurrent refreshes, so a screen that fires six requests
 *     after waking up does not rotate the refresh token six times (rotation is
 *     single-use on the server — the extra five would be rejected and would
 *     sign the user out)
 */
export class ReaderApi {
  private session: Session | null = null;
  private refreshPromise: Promise<Session> | null = null;
  private readonly listeners = new Set<(session: Session | null) => void>();

  constructor(
    private readonly platform: Platform,
    private readonly sessions: SessionStore,
  ) {}

  get baseUrl(): string {
    return this.currentBaseUrl;
  }

  private currentBaseUrl = '';

  setBaseUrl(url: string): void {
    this.currentBaseUrl = url.replace(/\/+$/, '');
  }

  async restore(): Promise<Session | null> {
    const stored = await this.sessions.load();
    if (!stored) return null;
    this.session = stored;
    return stored;
  }

  currentSession(): Session | null {
    return this.session;
  }

  onSessionChange(listener: (session: Session | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async setSession(session: Session | null): Promise<void> {
    this.session = session;
    if (session) await this.sessions.save(session);
    else await this.sessions.clear();
    for (const listener of this.listeners) listener(session);
  }

  async signOut(): Promise<void> {
    const refreshToken = this.session?.refreshToken;
    if (refreshToken) {
      // Best effort: a failed revocation must not trap the user in a session
      // they asked to leave. The local credentials are cleared either way.
      await this.call('/api/v1/auth/logout', 'POST', { refreshToken }).catch(() => undefined);
    }
    await this.setSession(null);
  }

  // ---- auth ----

  async instance(): Promise<InstanceInfo> {
    return this.get<InstanceInfo>('/api/v1/instance');
  }

  async register(username: string, password: string, displayName?: string): Promise<Session> {
    const session = await this.call<Session>('/api/v1/auth/register', 'POST', {
      username,
      password,
      ...(displayName ? { displayName } : {}),
    });
    await this.setSession(session);
    return session;
  }

  async login(username: string, password: string): Promise<Session> {
    const session = await this.call<Session>('/api/v1/auth/login', 'POST', { username, password });
    await this.setSession(session);
    return session;
  }

  async me(): Promise<User> {
    const result = await this.get<{ user: User }>('/api/v1/auth/me');
    return result.user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.call('/api/v1/auth/password', 'POST', { currentPassword, newPassword });
    // The server revokes every session on a password change, including this one.
    await this.setSession(null);
  }

  // ---- shelf ----

  async listBooks(query: ListQuery = {}, options: RequestOptions = {}): Promise<BookListPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<BookListPage>(`/api/v1/books${suffix}`, options);
  }

  async getBook(id: string, options: RequestOptions = {}): Promise<{ book: Book; progress: Progress | null }> {
    return this.get(`/api/v1/books/${encodeURIComponent(id)}`, options);
  }

  async manifest(id: string, options: RequestOptions = {}): Promise<Manifest> {
    return this.get<Manifest>(`/api/v1/books/${encodeURIComponent(id)}/manifest`, options);
  }

  /**
   * One addressable resource, as bytes.
   *
   * `ref` is opaque and must be passed through unchanged: it is whatever the
   * manifest handed out (`xhtml:OEBPS/ch1.xhtml`, `page:17`), and a chapter is
   * never addressed by index because an index means a different chapter in a
   * different window.
   */
  async asset(id: string, ref: string, options: RequestOptions = {}): Promise<Blob> {
    const response = await this.platform.transport.send({
      url: `/api/v1/books/${encodeURIComponent(id)}/assets?ref=${encodeURIComponent(ref)}`,
      method: 'GET',
      headers: {
        accept: '*/*',
        ...(this.session ? { authorization: `Bearer ${this.session.accessToken}` } : {}),
      },
      binary: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.status >= 400) {
      throw new ApiError(errorForStatus(response.status), 'resource request failed', 'ASSET_FAILED', response.status);
    }
    const bytes = response.bytes ?? new Uint8Array();
    // A Blob rather than the raw view: callers hand chapters to a frame as text
    // and pages to an `<img>` as bytes, and the copy is what makes that safe.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer]);
  }

  /**
   * One window of a book's addressable structure.
   *
   * Used to jump to a chapter that is not in the loaded window: the response
   * carries both the items and the group metadata, so the client can splice it
   * into the whole-book ordering without re-reading every earlier window.
   */
  async items(id: string, group?: number, options: RequestOptions = {}): Promise<BookContent> {
    const query = group === undefined ? '' : `?group=${group}`;
    return this.get<BookContent>(`/api/v1/books/${encodeURIComponent(id)}/items${query}`, options);
  }

  /**
   * The book's complete table of contents.
   *
   * A separate call from `manifest` because the two want opposite things: a
   * manifest is windowed so opening a 1200-chapter book is cheap, and a table of
   * contents has to be whole to be worth showing. Reading the contents off a
   * manifest is the mistake this endpoint exists to prevent.
   */
  async toc(id: string, options: RequestOptions = {}): Promise<TocEntry[]> {
    const result = await this.get<{ toc: TocEntry[] }>(
      `/api/v1/books/${encodeURIComponent(id)}/toc`,
      options,
    );
    return result.toc;
  }

  async facets(options: RequestOptions = {}): Promise<Facets> {
    return this.get<Facets>('/api/v1/library/facets', options);
  }

  async continueReading(limit = 20, options: RequestOptions = {}): Promise<ContinueReadingItem[]> {
    const result = await this.get<{ items: ContinueReadingItem[] }>(`/api/v1/library/continue?limit=${limit}`, options);
    return result.items;
  }

  // ---- content ----

  /** Authenticated book body. Not cacheable by the service worker: it needs a token. */
  async bookBytes(id: string, options: RequestOptions = {}): Promise<Uint8Array> {
    const response = await this.request(
      `/api/v1/books/${encodeURIComponent(id)}/content`,
      'GET',
      undefined,
      { ...options, binary: true },
    );
    return response.bytes ?? new Uint8Array();
  }

  async coverBytes(coverUrl: string, options: RequestOptions = {}): Promise<Uint8Array> {
    const response = await this.request(coverUrl, 'GET', undefined, { ...options, binary: true });
    return response.bytes ?? new Uint8Array();
  }

  // ---- sync ----

  async pull(since: number, bookId?: string, options: RequestOptions = {}): Promise<SyncPull> {
    const params = new URLSearchParams({ since: String(since) });
    if (bookId) params.set('bookId', bookId);
    return this.get<SyncPull>(`/api/v1/sync?${params.toString()}`, options);
  }

  async push(
    payload: { progress?: ProgressInput[]; notes?: NoteInput[] },
    options: RequestOptions = {},
  ): Promise<SyncPushResult> {
    return this.call<SyncPushResult>('/api/v1/sync', 'POST', payload, options);
  }

  /**
   * Single progress write. Cheaper than a batch and used for the periodic
   * "still reading" report, where there is nothing to reconcile.
   */
  async putProgress(progress: ProgressInput, options: RequestOptions = {}): Promise<Progress | null> {
    const result = await this.call<{ progress: Progress | null }>(
      `/api/v1/sync/progress/${encodeURIComponent(progress.bookId)}`,
      'PUT',
      progress,
      options,
    );
    return result.progress;
  }

  async getProgress(bookId: string, options: RequestOptions = {}): Promise<Progress | null> {
    const result = await this.get<{ progress: Progress | null }>(
      `/api/v1/sync/progress/${encodeURIComponent(bookId)}`,
      options,
    );
    return result.progress;
  }

  async listNotes(bookId?: string, since = 0, options: RequestOptions = {}): Promise<Note[]> {
    const params = new URLSearchParams();
    if (bookId) params.set('bookId', bookId);
    if (since > 0) params.set('since', String(since));
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const result = await this.get<{ notes: Note[] }>(`/api/v1/notes${query}`, options);
    return result.notes;
  }

  async createNote(note: NoteInput, options: RequestOptions = {}): Promise<Note> {
    return this.call<Note>('/api/v1/notes', 'POST', note, options);
  }

  async deleteNote(id: string, options: RequestOptions = {}): Promise<void> {
    await this.call(`/api/v1/notes/${encodeURIComponent(id)}`, 'DELETE', undefined, options);
  }

  // ---- transport plumbing ----

  private async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(path, 'GET', undefined, options);
    return response.json as T;
  }

  private async call<T>(
    path: string,
    method: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.request(path, method, body, options);
    return response.json as T;
  }

  private async request(
    path: string,
    method: string,
    body: unknown,
    options: RequestOptions & { binary?: boolean } = {},
  ): Promise<import('../core/platform.ts').HttpResponse> {
    const attempt = async (token: string | null) => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = `Bearer ${token}`;
      return this.platform.transport.send({
        url: path,
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(options.binary ? { binary: true } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    };

    const token = this.session?.accessToken ?? null;
    try {
      return await attempt(token);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      this.platform.reportError?.(err);
      // Only an expired access token is worth a retry, and only if there is a
      // refresh token to spend. `TOKEN_INVALID` means the signature or payload
      // is wrong — refreshing would not help and could burn the refresh chain.
      const retryable =
        !options.noRetry &&
        err.status === 401 &&
        (err.code === 'TOKEN_EXPIRED' || err.code === '' || err.code === 'NO_TOKEN') &&
        this.session?.refreshToken !== undefined;
      if (!retryable) {
        if (err.isAuthFailure) await this.setSession(null);
        throw err;
      }
      const refreshed = await this.refreshSession();
      try {
        return await attempt(refreshed.accessToken);
      } catch (retryErr) {
        if (retryErr instanceof ApiError && retryErr.isAuthFailure) await this.setSession(null);
        throw retryErr;
      }
    }
  }

  /** De-duplicated refresh: concurrent callers share one rotation. */
  private refreshSession(): Promise<Session> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshToken = this.session?.refreshToken;
    if (!refreshToken) return Promise.reject(new ApiError('unauthorized', 'no refresh token'));

    this.refreshPromise = (async () => {
      try {
        const response = await this.platform.transport.send({
          url: '/api/v1/auth/refresh',
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const session = response.json as Session;
        if (!session?.accessToken) throw new ApiError('unauthorized', 'refresh returned no session');
        await this.setSession(session);
        return session;
      } catch (err) {
        if (err instanceof ApiError) {
          // A rejected refresh token is terminal: the user must sign in again.
          await this.setSession(null);
        }
        throw err;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }
}

export { ApiError, errorForStatus, parseErrorBody };
