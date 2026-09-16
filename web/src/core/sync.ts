import { ApiError } from '../api/errors.ts';
import type { ReaderApi, NoteInput } from '../api/client.ts';
import { isOutboxEmpty, type OfflineStore } from '../store/offline.ts';
import type { Connectivity, Platform } from './platform.ts';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  pending: boolean;
  message: string;
}

const IDLE_INTERVAL_MS = 30_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 120_000;

/**
 * Keeps local state and the server in step, and never surfaces a connectivity
 * failure to the reader as an error (product design §8.2, "三态切换不能报错").
 *
 * Three things make this the piece that decides whether the product feels solid:
 *
 *  1. A push is a *merge*, not an overwrite. The server resolves conflicts by
 *     updatedAt, so replaying a stale offline outbox is harmless.
 *  2. The outbox survives a crash. It lives in the offline snapshot, not in
 *     memory, so closing the app mid-flight does not lose a reading position.
 *  3. Retries back off exponentially and stop when the OS says there is no
 *     network. Polling a server we know is unreachable wastes battery on a
 *     phone, which is the one resource a reader app must respect.
 */
export class SyncEngine {
  private state: SyncState = 'idle';
  private message = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = RETRY_BASE_MS;
  private running = false;
  private rejectedCount = 0;
  /** Book id per note id, so a tombstone can still be scoped after a restart. */
  private readonly noteBooks = new Map<string, string>();
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private unwatch: (() => void) | null = null;

  constructor(
    private readonly api: ReaderApi,
    private readonly offline: OfflineStore,
    private readonly platform: Platform,
  ) {}

  status(): SyncStatus {
    return {
      state: this.state,
      lastSyncAt: this.offline.current.lastSyncAt,
      pending: !isOutboxEmpty(this.offline.current),
      message: this.message,
    };
  }

  /** Number of records the server refused in the last push. */
  rejected(): number {
    return this.rejectedCount;
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  private setState(state: SyncState, message = ''): void {
    this.state = state;
    this.message = message;
    this.emit();
  }

  start(): void {
    if (this.unwatch) return;
    this.unwatch = this.platform.onConnectivityChange((connectivity) => {
      if (connectivity === 'online') {
        // Coming back online is the moment the user expects their last pages
        // to be pushed, so do not wait for the next poll.
        this.backoff = RETRY_BASE_MS;
        void this.syncNow();
      } else {
        this.setState('offline', '离线，进度会缓存在本机');
      }
    });
    void this.syncNow();
  }

  stop(): void {
    this.unwatch?.();
    this.unwatch = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  /**
   * One full round trip: flush the outbox, then pull the deltas.
   *
   * Safe to call concurrently — extra calls during a run are folded into the
   * one in flight, which is what the UI needs when several screens wake up at
   * the same time.
   */
  async syncNow(): Promise<void> {
    if (this.running) return;
    if (!this.api.currentSession()) {
      this.setState('signed-out');
      return;
    }
    this.running = true;
    this.setState('syncing');
    try {
      const connectivity = await this.platform.connectivity();
      if (connectivity === 'offline') {
        this.setState('offline', '离线，进度会缓存在本机');
        this.scheduleNext(IDLE_INTERVAL_MS);
        return;
      }

      await this.pushOutbox();
      const pull = await this.api.pull(this.offline.current.serverTime);
      await this.offline.applyPulled(pull);
      this.rememberNoteBooks();

      this.backoff = RETRY_BASE_MS;
      // A rejection message has to survive the state transition to idle,
      // otherwise the reader never learns that a record was dropped.
      this.setState('idle', this.rejectedCount > 0 ? `${this.rejectedCount} 条记录被服务端拒绝` : this.message);
      this.emit();
      this.scheduleNext(IDLE_INTERVAL_MS);
    } catch (err) {
      this.handleFailure(err);
    } finally {
      this.running = false;
    }
  }

  /**
   * Sends whatever is in the outbox and marks exactly that batch as delivered.
   *
   * The batch is captured once, before the first request, and carries the
   * timestamps it was built from. That is what makes a concurrent page turn safe:
   * the record's own update will still be dirty after this returns, so the next
   * cycle picks it up instead of it being cleared by a response that predates it.
   */
  private async pushOutbox(): Promise<void> {
    const batch = this.offline.outbox();
    const deletes: NoteInput[] = batch.deletes.map((id) => ({
      id,
      // The tombstone has to carry the book id so the server can scope the
      // delete to a book the caller can see. A note that was already pulled from
      // the server and then deleted locally is not in `notes` any more, so the
      // id is looked up in the last known note if it is still around.
      bookId: this.lastKnownNoteBook(id) ?? '',
      type: 'note',
      locator: '',
      text: '',
      comment: '',
      color: '',
      updatedAt: Date.now(),
      deleted: true,
    }));
    const notes: NoteInput[] = [
      ...batch.notes.map((note) => ({
        id: note.id,
        bookId: note.bookId,
        type: note.type,
        locator: note.locator,
        text: note.text,
        comment: note.comment,
        color: note.color,
        updatedAt: note.updatedAt,
        deleted: false,
      })),
      ...deletes,
    ];
    if (batch.progress.length === 0 && notes.length === 0) return;

    // The server caps a batch at 5000 records; chunk well below that so a long
    // offline session cannot fail wholesale on one oversized request.
    const CHUNK = 1000;
    const batches = Math.max(1, Math.ceil(Math.max(batch.progress.length, notes.length) / CHUNK));
    let serverTime = 0;
    let rejected = 0;
    for (let index = 0; index < batches; index += 1) {
      const offset = index * CHUNK;
      const progressChunk = batch.progress.slice(offset, offset + CHUNK);
      const noteChunk = notes.slice(offset, offset + CHUNK);
      const result = await this.api.push({
        ...(progressChunk.length > 0 ? { progress: progressChunk } : {}),
        ...(noteChunk.length > 0 ? { notes: noteChunk } : {}),
      });
      serverTime = Math.max(serverTime, result.serverTime);
      rejected += result.rejected;
    }
    await this.offline.markDelivered(batch, serverTime);
    // Rejections are informational. The server refuses records it can never
    // accept (unknown book, malformed locator), and retrying them forever would
    // block every later flush behind a permanently bad entry. The count is kept
    // on the engine rather than in a transient message so the status bar can
    // still show it after the state settles.
    this.rejectedCount = rejected;
  }

  /**
   * Best-effort lookup of a deleted note's book.
   *
   * `pendingNoteDeletes` can outlive a restart during which the note itself was
   * evicted, and a tombstone with no book id is rejected by the server. Losing
   * the tombstone is preferable to stalling the outbox, and the server has its
   * own copy to reconcile against on the next pull.
   */
  private lastKnownNoteBook(id: string): string | null {
    return this.noteBooks.get(id) ?? null;
  }

  private handleFailure(err: unknown): void {
    if (err instanceof ApiError && err.kind === 'aborted') {
      this.setState('idle');
      return;
    }
    if (err instanceof ApiError && err.isConnectivity) {
      // Silent degradation: the reader keeps reading from cache.
      this.setState('offline', '离线，进度会缓存在本机');
      this.backoff = RETRY_BASE_MS;
      this.scheduleNext(IDLE_INTERVAL_MS);
      return;
    }
    if (err instanceof ApiError && err.isAuthFailure) {
      this.setState('signed-out', '登录已失效，请重新登录');
      return;
    }
    this.setState('error', err instanceof Error ? err.message : '同步失败');
    this.backoff = Math.min(this.backoff * 2, RETRY_MAX_MS);
    this.scheduleNext(this.backoff);
  }

  /**
   * Records which book each note belongs to.
   *
   * Needed because a tombstone must name a book, and the note row is gone by the
   * time the delete is sent. Rebuilt on every pull so it also survives a restart.
   */
  private rememberNoteBooks(): void {
    for (const note of Object.values(this.offline.current.notes)) {
      this.noteBooks.set(note.id, note.bookId);
    }
  }

  /** Force a synchronous flush, used when the app goes to the background. */
  async flush(): Promise<void> {
    if (!this.api.currentSession()) return;
    try {
      await this.pushOutbox();
    } catch {
      // Nothing to do: the outbox is durable and the next attempt will retry.
    }
  }
}

export type { Connectivity };
