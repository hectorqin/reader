import type { Book, Note, Progress, SyncPull } from '../api/types.ts';
import type { KeyValueStore } from '../core/platform.ts';

/**
 * Local mirror of everything the reader needs to keep working with no server.
 *
 * Scope is deliberately the *reading-critical* state only: the shelf, progress,
 * notes and the sync cursor. Book bodies live in the blob store; covers are
 * re-fetched lazily. Nothing here is authoritative — the server is (§4), so a
 * wipe of this cache must never destroy anything the user cannot recover.
 */

const KEY = 'reader.offline.v1';
const LEGACY_CLAIM_KEY = 'reader.offline.v1.legacy-claimed';

export interface PendingNote {
  note: Note;
  /** Client-side creation timestamp, used to order the outbox. */
  queuedAt: number;
}

export interface OfflineSnapshot {
  /** Books known to the client, keyed by book id. */
  books: Record<string, Book>;
  /** The client's full view of progress, used to render the shelf offline. */
  progress: Record<string, Progress>;
  notes: Record<string, Note>;
  /**
   * The outbox: what still has to reach the server.
   *
   * Kept as a dirty-set rather than "everything is always sent" because the two
   * differ in a way that matters. A record can be *modified* between building a
   * request and receiving its response (the reader turns a page while the push is
   * in flight). With a dirty-set that update stays marked dirty until *its own*
   * acknowledgement arrives; with "send everything" it would be cleared by the
   * earlier response and silently never reach the server — a lost reading
   * position, which is the one failure this product cannot have.
   */
  dirtyProgress: string[];
  dirtyNotes: string[];
  /** Note ids deleted locally but not yet acknowledged by the server. */
  pendingNoteDeletes: string[];
  /** Last `serverTime` seen from a pull, the cursor for incremental sync. */
  serverTime: number;
  /** Milliseconds since epoch of the last successful contact with the server. */
  lastSyncAt: number | null;
}

export function emptySnapshot(): OfflineSnapshot {
  return {
    books: {},
    progress: {},
    notes: {},
    dirtyProgress: [],
    dirtyNotes: [],
    pendingNoteDeletes: [],
    serverTime: 0,
    lastSyncAt: null,
  };
}

/** True when there is nothing waiting to be sent. */
export function isOutboxEmpty(snapshot: OfflineSnapshot): boolean {
  return (
    snapshot.dirtyProgress.length === 0 &&
    snapshot.dirtyNotes.length === 0 &&
    snapshot.pendingNoteDeletes.length === 0
  );
}

/** Validates a snapshot read back from storage. */
function coerceSnapshot(raw: unknown): OfflineSnapshot {
  const base = emptySnapshot();
  if (typeof raw !== 'object' || raw === null) return base;
  const value = raw as Partial<OfflineSnapshot>;
  return {
    books: typeof value.books === 'object' && value.books !== null ? value.books : {},
    progress: typeof value.progress === 'object' && value.progress !== null ? value.progress : {},
    notes: typeof value.notes === 'object' && value.notes !== null ? value.notes : {},
    dirtyProgress: stringArray(value.dirtyProgress),
    dirtyNotes: stringArray(value.dirtyNotes),
    pendingNoteDeletes: stringArray(value.pendingNoteDeletes),
    serverTime: typeof value.serverTime === 'number' && Number.isFinite(value.serverTime) ? value.serverTime : 0,
    lastSyncAt: typeof value.lastSyncAt === 'number' ? value.lastSyncAt : null,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export class OfflineStore {
  private snapshot: OfflineSnapshot = emptySnapshot();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();
  private key = KEY;

  constructor(private readonly kv: KeyValueStore) {}

  /** Select an account before loading or syncing its shelf and reading state. */
  async setScope(scope: string, options: { claimLegacy?: boolean } = {}): Promise<void> {
    const key = `${KEY}:${encodeURIComponent(scope)}`;
    if (key === this.key) return;
    await this.writeChain;
    const claimedBy = await this.kv.get(LEGACY_CLAIM_KEY);
    if (!claimedBy) await this.kv.set(LEGACY_CLAIM_KEY, options.claimLegacy ? key : 'unclaimed');
    if (options.claimLegacy && (!claimedBy || claimedBy === key) && !(await this.kv.get(key))) {
      const legacy = await this.kv.get(KEY);
      if (legacy) {
        // Keep the legacy value as a backup. A failed upgrade must never destroy
        // the only copy of an unsynchronised position or note.
        await this.kv.set(key, legacy);
      }
    }
    this.key = key;
    this.snapshot = emptySnapshot();
    this.loaded = false;
    await this.load();
  }

  async load(): Promise<OfflineSnapshot> {
    if (this.loaded) return this.snapshot;
    const raw = await this.kv.get(this.key);
    if (raw) {
      try {
        this.snapshot = coerceSnapshot(JSON.parse(raw));
      } catch {
        // A corrupt cache is recoverable by definition — drop it and re-pull.
        this.snapshot = emptySnapshot();
      }
    }
    this.loaded = true;
    return this.snapshot;
  }

  get current(): OfflineSnapshot {
    return this.snapshot;
  }

  /**
   * Writes are serialised through a promise chain.
   *
   * Reading progress updates on every visible page turn; without this, two
   * rapid turns would interleave two read-modify-write cycles and lose one.
   * A queue is enough here because only the UI thread mutates the snapshot.
   */
  private persist(): Promise<void> {
    const payload = JSON.stringify(this.snapshot);
    const key = this.key;
    // Recover the queue from an earlier failure, but report this write's error
    // to its caller. Treating disk/quota failure as success loses the outbox.
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.kv.set(key, payload));
    return this.writeChain;
  }

  async replaceBooks(books: Book[]): Promise<void> {
    for (const book of books) this.snapshot.books[book.id] = book;
    await this.persist();
  }

  async removeBooks(ids: string[]): Promise<void> {
    for (const id of ids) {
      delete this.snapshot.books[id];
      delete this.snapshot.progress[id];
    }
    await this.persist();
  }

  async setProgress(progress: Progress): Promise<void> {
    const existing = this.snapshot.progress[progress.bookId];
    // Same last-writer-wins rule the server applies, so the local view does not
    // briefly disagree with what a pull would return.
    if (existing && existing.updatedAt > progress.updatedAt) return;
    this.snapshot.progress[progress.bookId] = progress;
    this.markDirty('dirtyProgress', progress.bookId);
    await this.persist();
  }

  private markDirty(key: 'dirtyProgress' | 'dirtyNotes', id: string): void {
    if (!this.snapshot[key].includes(id)) this.snapshot[key].push(id);
  }

  async getProgress(bookId: string): Promise<Progress | undefined> {
    return this.snapshot.progress[bookId];
  }

  /**
   * Synchronous read of one book's progress.
   *
   * The async form above is what the sync engine uses; this is for the shelf,
   * which draws a progress bar on every card and cannot await one per card — an
   * `await` inside a render loop is how a 200-book shelf takes a second to appear.
   * The snapshot is already in memory by then, so the promise would have resolved
   * immediately anyway.
   */
  progressFor(bookId: string): Progress | undefined {
    return this.snapshot.progress[bookId];
  }

  async upsertNotes(notes: Note[]): Promise<void> {
    for (const note of notes) {
      if (note.deleted) {
        delete this.snapshot.notes[note.id];
        this.snapshot.dirtyNotes = this.snapshot.dirtyNotes.filter((id) => id !== note.id);
        if (!this.snapshot.pendingNoteDeletes.includes(note.id)) {
          this.snapshot.pendingNoteDeletes.push(note.id);
        }
      } else {
        const existing = this.snapshot.notes[note.id];
        if (existing && existing.updatedAt > note.updatedAt) continue;
        this.snapshot.notes[note.id] = note;
        this.snapshot.pendingNoteDeletes = this.snapshot.pendingNoteDeletes.filter((id) => id !== note.id);
        this.markDirty('dirtyNotes', note.id);
      }
    }
    await this.persist();
  }

  async deleteNote(id: string): Promise<void> {
    delete this.snapshot.notes[id];
    this.snapshot.dirtyNotes = this.snapshot.dirtyNotes.filter((entry) => entry !== id);
    if (!this.snapshot.pendingNoteDeletes.includes(id)) this.snapshot.pendingNoteDeletes.push(id);
    await this.persist();
  }

  /** The records that still need to reach the server, in a stable order. */
  outbox(): { progress: Progress[]; notes: Note[]; deletes: string[] } {
    return {
      progress: this.snapshot.dirtyProgress
        .map((id) => this.snapshot.progress[id])
        .filter((entry): entry is Progress => entry !== undefined),
      notes: this.snapshot.dirtyNotes
        .map((id) => this.snapshot.notes[id])
        .filter((entry): entry is Note => entry !== undefined),
      deletes: [...this.snapshot.pendingNoteDeletes],
    };
  }

  notesFor(bookId: string): Note[] {
    return Object.values(this.snapshot.notes).filter((note) => note.bookId === bookId && !note.deleted);
  }

  books(): Book[] {
    return Object.values(this.snapshot.books);
  }

  /** Applies a pull result, honouring last-writer-wins per record. */
  async applyPulled(pull: SyncPull): Promise<void> {
    for (const progress of pull.progress) {
      const existing = this.snapshot.progress[progress.bookId];
      if (existing && existing.updatedAt > progress.updatedAt) continue;
      this.snapshot.progress[progress.bookId] = progress;
    }
    for (const note of pull.notes) {
      if (note.deleted) {
        delete this.snapshot.notes[note.id];
        // Do not clear a local pending delete: the server already has the
        // tombstone, so the outbox entry is satisfied either way.
        continue;
      }
      const existing = this.snapshot.notes[note.id];
      if (existing && existing.updatedAt > note.updatedAt) continue;
      this.snapshot.notes[note.id] = note;
    }
    this.snapshot.serverTime = Math.max(this.snapshot.serverTime, pull.serverTime);
    this.snapshot.lastSyncAt = Date.now();
    await this.persist();
  }

  /**
   * Marks a batch as delivered.
   *
   * Only the ids that were actually in the batch are cleared, and only if the
   * record has not been modified in the meantime. Both conditions matter:
   *
   *  - Clearing "everything" would drop a position written while the request was
   *    in flight.
   *  - Clearing without the timestamp check would drop it too, via the same
   *    window but arriving through a different path.
   *
   * The `serverTime` is still adopted so the next pull is incremental.
   */
  async markDelivered(batch: { progress: Progress[]; notes: Note[]; deletes: string[] }, serverTime: number): Promise<void> {
    const deliveredProgress = new Set(
      batch.progress
        .filter((entry) => this.snapshot.progress[entry.bookId]?.updatedAt === entry.updatedAt)
        .map((entry) => entry.bookId),
    );
    const deliveredNotes = new Set(
      batch.notes.filter((note) => this.snapshot.notes[note.id]?.updatedAt === note.updatedAt).map((note) => note.id),
    );
    const deliveredDeletes = new Set(batch.deletes);

    this.snapshot.dirtyProgress = this.snapshot.dirtyProgress.filter((id) => !deliveredProgress.has(id));
    this.snapshot.dirtyNotes = this.snapshot.dirtyNotes.filter((id) => !deliveredNotes.has(id));
    this.snapshot.pendingNoteDeletes = this.snapshot.pendingNoteDeletes.filter((id) => !deliveredDeletes.has(id));
    this.snapshot.serverTime = Math.max(this.snapshot.serverTime, serverTime);
    this.snapshot.lastSyncAt = Date.now();
    await this.persist();
  }

  async clear(): Promise<void> {
    this.snapshot = emptySnapshot();
    this.loaded = true;
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}

export type { Progress, Note, Book };
export type { KeyValueStore };
