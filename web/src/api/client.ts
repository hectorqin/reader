import type { ExtensionField, ExtensionPage } from './sources.ts';
import { ApiError, errorForStatus, parseErrorBody } from './errors.ts';
import type {
  BatchResult,
  Book,
  BookContent,
  BrowseListing,
  ConflictPolicy,
  BookListPage,
  ContinueReadingItem,
  Facets,
  InstanceInfo,
  Manifest,
  Note,
  NoteType,
  Progress,
  Session,
  ShelfAction,
  SyncPull,
  SyncPushResult,
  TocEntry,
  UploadResult,
  User,
} from './types.ts';
import type { Platform } from '../core/platform.ts';
import type { SourceType, SourceInstance, SourcePlugin, SourceEntry, SourcePage, SourceAcquisition, ChapterSubscription } from './sources.ts';

export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

/**
 * What this instance says it can synthesise.
 *
 * `http: false` is the normal answer for a deployment with no `TTS_URL`, and it
 * is deliberately a 200 rather than a 404: the client's question is "which
 * engines may I offer here", not "does this endpoint exist".
 */
export interface TtsCapabilities {
  http: boolean;
  formats: string[];
  maxLength: number;
  voices: Array<{ id: string; name: string; lang: string }>;
}

export interface ListQuery {
  search?: string;
  author?: string;
  series?: string;
  tag?: string;
  format?: string;
  /**
   * Sort key.
   *
   * `updated` is what the shelf has always used and stays the default: a library
   * is browsed by "what did I just add", and a reader who wants A–Z can ask for
   * `title`. The list is the server's own `ListOptions.sort`, so the two cannot
   * drift.
   */
  sort?: 'title' | 'author' | 'added' | 'updated';
  order?: 'asc' | 'desc';
  /**
   * Restrict the list to books with a file inside this folder.
   *
   * Library-relative and recursive, `''` meaning the whole library. It is what the
   * library screen's preview page asks with, and it is *not* a filter the shelf
   * uses: the shelf is "my books" and a folder is a place inside the library, which
   * are different questions (see `library-screen.tsx`).
   */
  path?: string;
  /**
   * Which set to list: the reader's shelf (default), or the library's index.
   *
   * `scope: 'library'` answers "what is in this folder" — every indexed book, each
   * carrying `shelfState` — instead of "what is on my shelf". The browsing page is
   * the only caller: it is the page that has to show a book the reader has *not*
   * shelved, in order to offer to shelve it.
   */
  scope?: 'shelf' | 'library';
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
  private sessionGeneration = 0;
  private sessionWrites: Promise<void> = Promise.resolve();
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
    const next = url.replace(/\/+$/, '');
    if (next !== this.currentBaseUrl) {
      this.sessionGeneration += 1;
      this.refreshPromise = null;
    }
    this.currentBaseUrl = next;
  }

  async restore(): Promise<Session | null> {
    const stored = await this.sessions.load();
    if (!stored) return null;
    this.sessionGeneration += 1;
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

  private async setSession(session: Session | null, rotation = false): Promise<void> {
    if (!rotation) {
      this.sessionGeneration += 1;
      this.refreshPromise = null;
    }
    const generation = this.sessionGeneration;
    this.session = session;
    const write = this.sessionWrites.catch(() => undefined).then(() =>
      session ? this.sessions.save(session) : this.sessions.clear());
    this.sessionWrites = write;
    await write;
    if (generation !== this.sessionGeneration) return;
    for (const listener of this.listeners) listener(session);
  }

  async signOut(): Promise<void> {
    const generation = this.sessionGeneration;
    const refreshToken = this.session?.refreshToken;
    if (refreshToken) {
      // Best effort: a failed revocation must not trap the user in a session
      // they asked to leave. The local credentials are cleared either way.
      await this.call('/api/v1/auth/logout', 'POST', { refreshToken }).catch(() => undefined);
    }
    if (generation !== this.sessionGeneration) return;
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

  async pluginPage(id: string, pageId: string, action?: string, values?: Record<string, unknown>): Promise<ExtensionPage> {
    const path = '/api/v1/plugins/' + encodeURIComponent(id) + '/pages/' + encodeURIComponent(pageId);
    return action ? this.call(path, 'POST', { action, values }) : this.get(path);
  }
  async sourceFilters(id: string): Promise<ExtensionField[]> { return this.get('/api/v1/sources/' + encodeURIComponent(id) + '/search-filters'); }
  async sourceOptions(id: string): Promise<{ canSwitch: boolean }> { return this.get('/api/v1/books/' + encodeURIComponent(id) + '/source-options'); }
  async alternatives(id: string, cursor?: string): Promise<SourcePage> { return this.get('/api/v1/books/' + encodeURIComponent(id) + '/alternatives' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')); }
  async switchPreview(id: string, entryRef: string): Promise<{ chapters: Array<{ id: string; title: string }> }> {
    return this.call('/api/v1/books/' + encodeURIComponent(id) + '/switch-preview', 'POST', { entryRef });
  }
  async switchSource(id: string, entryRef: string, chapterId: string, revision: string): Promise<{ content: BookContent; href: string }> {
    return this.call('/api/v1/books/' + encodeURIComponent(id) + '/switch-source', 'POST', { entryRef, chapterId, revision });
  }
  async sourceTypes(): Promise<SourceType[]> { return (await this.get<{ types: SourceType[] }>('/api/v1/sources/types')).types; }
  async sources(): Promise<SourceInstance[]> { return (await this.get<{ sources: SourceInstance[] }>('/api/v1/sources')).sources; }
  async plugins(): Promise<SourcePlugin[]> { return (await this.get<{ plugins: SourcePlugin[] }>('/api/v1/plugins')).plugins; }
  async saveSource(id: string | null, input: Record<string, unknown>): Promise<SourceInstance> {
    return (await this.call<{ source: SourceInstance }>(`/api/v1/sources${id ? `/${encodeURIComponent(id)}` : ''}`, id ? 'PATCH' : 'POST', input)).source;
  }
  async removeSource(id: string): Promise<void> { await this.call(`/api/v1/sources/${encodeURIComponent(id)}`, 'DELETE'); }
  async sourceCredential(id: string, key: string, value: string): Promise<void> {
    await this.call(`/api/v1/sources/${encodeURIComponent(id)}/credentials/${encodeURIComponent(key)}`, 'PUT', { value });
  }
  async installPlugin(folder: string): Promise<void> { await this.call('/api/v1/plugins', 'POST', { folder, trusted: true }); }
  async enablePlugin(id: string, enabled: boolean): Promise<void> { await this.call(`/api/v1/plugins/${encodeURIComponent(id)}`, 'PATCH', { enabled }); }
  async uninstallPlugin(id: string): Promise<void> { await this.call(`/api/v1/plugins/${encodeURIComponent(id)}`, 'DELETE'); }
  async sourceCatalog(id: string, query: { ref?: string; query?: string; cursor?: string; filters?: Record<string, string> } = {}): Promise<SourcePage> {
    const params = new URLSearchParams();
    if (query.ref) params.set('ref', query.ref);
    if (query.query) params.set('q', query.query);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.filters) params.set('filters', JSON.stringify(query.filters));
    return this.get(`/api/v1/sources/${encodeURIComponent(id)}/${query.query ? 'search' : 'browse'}?${params}`);
  }
  async sourceDetail(id: string, ref: string): Promise<SourceEntry> {
    return this.get(`/api/v1/sources/${encodeURIComponent(id)}/entries?ref=${encodeURIComponent(ref)}`);
  }
  async acquireSource(id: string, entryRef: string, optionId?: string): Promise<SourceAcquisition> {
    return this.call(`/api/v1/sources/${encodeURIComponent(id)}/acquire`, 'POST', { entryRef, ...(optionId ? { optionId } : {}) });
  }
  async subscriptions(): Promise<ChapterSubscription[]> {
    return (await this.get<{ subscriptions: ChapterSubscription[] }>('/api/v1/subscriptions')).subscriptions;
  }
  async configureSubscription(id: string, patch: { enabled?: boolean; intervalMinutes?: number; acknowledge?: boolean }): Promise<void> {
    await this.call(`/api/v1/books/${encodeURIComponent(id)}/subscription`, 'PATCH', patch);
  }

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

  async refreshPublication(id: string, options: RequestOptions = {}): Promise<BookContent> {
    return this.call<BookContent>(`/api/v1/books/${encodeURIComponent(id)}/refresh`, 'POST', undefined, options);
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
    const response = await this.request(
      `/api/v1/books/${encodeURIComponent(id)}/assets?ref=${encodeURIComponent(ref)}`,
      'GET', undefined, { ...options, binary: true },
    );
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

  /** Whether this instance has a server-side speech engine, and what it offers. */
  async ttsCapabilities(options: RequestOptions = {}): Promise<TtsCapabilities | null> {
    try {
      return await this.get<TtsCapabilities>('/api/v1/tts/voices', options);
    } catch {
      // An old server has no such route and a stale one answers 404; both mean
      // the same thing to the caller, which is "no HTTP engine here".
      return null;
    }
  }

  /**
   * The shelf's "继续阅读" strip: whole books, newest reading first.
   *
   * ## The two normalisations, and why they live here
   *
   * This endpoint is the one place where the server and the client disagreed about
   * the *name* of a field, and the disagreement was invisible: the card is typed as
   * `ContinueReadingItem extends Book` and reads `book.id`, while the server answered
   * the progress row's `bookId`. `title` and `coverUrl` happen to be spelled the same
   * in both shapes, so the card drew correctly, and the tap carried `id: undefined` —
   * `#/book/undefined`, a 404, and "这本书不在书架上了" on a book that was plainly on
   * the shelf behind the toast.
   *
   * The server is fixed, so this is not the repair; it is what stops the repair from
   * being *deployed in halves*. The H5 bundle and the API version independently: an
   * Android WebView can hold a cached client against a newer server, and a browser
   * can hold a cached client against an older one. Normalising at the boundary means
   * either combination works, rather than the six weeks in which one does not.
   *
   * A row with no id at all is **dropped**, not drawn: a card whose tap goes nowhere
   * is precisely the reported symptom, and losing one shortcut out of twenty is a
   * smaller failure than growing a control that lies about being one.
   */
  async continueReading(limit = 20, options: RequestOptions = {}): Promise<ContinueReadingItem[]> {
    const result = await this.get<{ items: Array<ContinueReadingItem & { bookId?: string }> }>(
      `/api/v1/library/continue?limit=${limit}`, options,
    );
    return result.items.flatMap((item) => {
      // `bookId` is the old spelling of `id`; `updatedAt` the old spelling of
      // `lastReadAt`. See the type for the full history.
      const id = item.id ?? item.bookId;
      if (!id) return [];
      return [{ ...item, id, lastReadAt: item.lastReadAt ?? item.updatedAt ?? null }];
    });
  }

  // ---- library file manager ----

  /**
   * One directory of the library tree.
   *
   * `path` is library-relative and `''` means the root; the server resolves it
   * through the same containment check every other filesystem access uses.
   */
  async browse(path = '', page = 1, options: RequestOptions = {}): Promise<BrowseListing> {
    /*
     * `page` is sent even when it is 1, and the path is not sent when it is empty.
     *
     * The asymmetry is deliberate: an empty path *is* the root and the server
     * defaults it, while a page of one is a position the client asked for — and a
     * request that omits it says "whatever you think", which stops being the same
     * request the day the default changes.
     */
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    params.set('page', String(page > 0 ? page : 1));
    return this.get<BrowseListing>(`/api/v1/library/browse?${params.toString()}`, options);
  }

  async browseMove(paths: string[], target: string, options: RequestOptions = {}): Promise<{ moved: number; target: string }> {
    return this.call('/api/v1/library/browse/move', 'POST', { paths, target }, options);
  }

  async browseRename(path: string, name: string, options: RequestOptions = {}): Promise<{ path: string }> {
    return this.call('/api/v1/library/browse/rename', 'POST', { path, name }, options);
  }

  async browseMkdir(path: string, name: string, options: RequestOptions = {}): Promise<{ path: string }> {
    return this.call('/api/v1/library/browse/mkdir', 'POST', { path, name }, options);
  }

  async browseDelete(paths: string[], options: RequestOptions = {}): Promise<{ removed: number }> {
    return this.call('/api/v1/library/browse/delete', 'POST', { paths }, options);
  }


  /**
   * Applies one metadata patch to many paths.
   *
   * A path may name a folder, which the server reads as "every book indexed
   * inside it" — a series is organised as a folder, and asking for the folder's
   * own row would find nothing. The client never expands a folder itself: that
   * mapping is the index's, and a second implementation of it here would be a
   * second thing to keep in step.
   */
  async browseBatchMetadata(
    paths: string[],
    fields: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<BatchResult> {
    return this.call('/api/v1/library/browse/metadata', 'POST', { paths, fields }, options);
  }

  /**
   * Adds or removes books on this account's shelf.
   *
   * Nothing on disk changes. Kept a separate call from move/delete because the
   * two are one word apart in a list of rows and could not be more different in
   * consequence.
   *
   * **Two ways to name the target, and the caller must pick one.** The file
   * manager has *paths* (that is what a row is), and a shelf card has a *book id*
   * (that is what a card is).
   *
   * The `bookIds` form is the fix for 「从书架移除时，找不到「xxx」在磁盘上的路径」.
   * The shelf used to send paths it had reconstructed by matching a book's *title*
   * against filenames in the library root — a guess that fails whenever the
   * metadata title is not the filename (which is the normal case for anything the
   * scanner read a title out of) and whenever the file is in a subfolder or past
   * the first page. The server has the real mapping in `book_files`, so the card
   * sends the id it already holds and no title has to match anything.
   */
  async browseBatchShelf(
    target: { paths: string[] } | { bookIds: string[] },
    action: ShelfAction,
    options: RequestOptions = {},
  ): Promise<BatchResult> {
    return this.call('/api/v1/library/browse/shelf', 'POST', { ...target, action }, options);
  }

  /** Whether the mount accepts an upload at all; asked before sending bytes. */
  async uploadProbe(options: RequestOptions = {}): Promise<boolean> {
    const result = await this.get<{ writable: boolean }>('/api/v1/library/upload', options);
    return result.writable;
  }

  /**
   * Uploads files into a library directory.
   *
   * `FormData`, not a hand-built body: a browser sets the multipart boundary and
   * streams a `File` off disk, and reimplementing either would mean buffering a
   * 400MB comic in memory on a phone.
   *
   * The progress hook rides on the request rather than replacing the transport.
   * The browser itself cannot report upload progress — `fetch` has no such event
   * in any shipping engine — so the H5 build simply never calls it and the UI
   * shows "上传中…"; a host that can (the Android shell's native path) does, and
   * the same screen then shows a real percentage. What must *not* happen is a
   * second implementation of the upload that only one host exercises.
   */
  async upload(
    files: File[],
    target: string,
    onConflict: ConflictPolicy,
    onProgress?: (fraction: number) => void,
    options: RequestOptions = {},
  ): Promise<UploadResult> {
    const form = new FormData();
    for (const file of files) form.append('file', file, file.name);
    if (target) form.append('path', target);
    form.append('onConflict', onConflict);

    // No `content-type` is set: only the host knows the multipart boundary, and
    // a header naming `application/json` over a `FormData` leaves the server
    // unable to parse a body that is perfectly well formed.
    const response = await this.platform.transport.send({
      url: '/api/v1/library/upload',
      method: 'POST',
      headers: { accept: 'application/json', ...this.authHeader() },
      body: form,
      ...(onProgress ? { onUploadProgress: onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return response.json as UploadResult;
  }

  private authHeader(): Record<string, string> {
    return this.session ? { authorization: `Bearer ${this.session.accessToken}` } : {};
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
    const generation = this.sessionGeneration;
    const assertCurrent = (): void => this.assertSession(generation);
    const attempt = async (token: string | null) => {
      assertCurrent();
      const headers: Record<string, string> = { accept: options.binary ? '*/*' : 'application/json' };
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
      const response = await attempt(token);
      assertCurrent();
      return response;
    } catch (err) {
      assertCurrent();
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
        if (err.isAuthFailure) await this.clearSessionIfCurrent(generation);
        throw err;
      }
      const refreshed = await this.refreshSession(generation);
      assertCurrent();
      try {
        const response = await attempt(refreshed.accessToken);
        assertCurrent();
        return response;
      } catch (retryErr) {
        assertCurrent();
        if (retryErr instanceof ApiError && retryErr.isAuthFailure) await this.clearSessionIfCurrent(generation);
        throw retryErr;
      }
    }
  }

  /** De-duplicated refresh: concurrent callers share one rotation. */
  private refreshSession(generation: number): Promise<Session> {
    this.assertSession(generation);
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
        this.assertSession(generation);
        const session = response.json as Session;
        if (!session?.accessToken) throw new ApiError('unauthorized', 'refresh returned no session');
        if (session.user.id !== this.session?.user.id) throw new ApiError('unauthorized', 'refresh returned another account');
        await this.setSession(session, true);
        this.assertSession(generation);
        return session;
      } catch (err) {
        this.assertSession(generation);
        if (err instanceof ApiError) {
          // A rejected refresh token is terminal: the user must sign in again.
          await this.clearSessionIfCurrent(generation);
        }
        throw err;
      } finally {
        if (generation === this.sessionGeneration) this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private assertSession(generation: number): void {
    if (generation !== this.sessionGeneration) {
      throw new ApiError('aborted', 'account or server changed', 'ACCOUNT_CHANGED');
    }
  }

  private async clearSessionIfCurrent(generation: number): Promise<void> {
    this.assertSession(generation);
    await this.setSession(null);
    // Clearing changes the generation once. A further change while persistent
    // storage was being written belongs to a new login and invalidates this error.
    this.assertSession(generation + 1);
  }
}

export { ApiError, errorForStatus, parseErrorBody };
