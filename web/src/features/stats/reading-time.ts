import type { KeyValueStore } from '../../core/platform.ts';
import type { ReadingTimeEntry } from '../../api/client.ts';
import { newId } from '../../core/id.ts';

/**
 * 时长统计: counts the time a reader actually spends reading a book.
 *
 * "Actually" is the whole design. The reader screen being open is not reading: a
 * phone left on the bedside table with a book open would otherwise log the night.
 * Time counts only while
 *
 *  - the page is visible, and the reader has turned, scrolled or tapped within the
 *    last `IDLE_MS` (a long page of dense text takes a minute or two, rarely three), or
 *  - 朗读 is speaking: listening to the book is reading it, screen on or off.
 *
 * The count is kept per book per 15-minute UTC slot (the server's unit, see
 * `server/src/services/time-stats.ts`) and saved locally on every tick, so a closed
 * app or a week offline loses nothing. Reports carry the running total per slot
 * under this install's random id, and the server keeps the larger total, so
 * sending a slot again is always safe. A slot is forgotten once a report that
 * included its final total has been accepted.
 */
export const SLOT_MS = 15 * 60 * 1000;
const IDLE_MS = 3 * 60 * 1000;
const TICK_MS = 15 * 1000;
const FLUSH_MS = 60 * 1000;
/** Slots older than this that still could not be sent are dropped, so the store stays small. */
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const STORE_KEY = 'reader.readingTime.v1';
const CLIENT_KEY = 'reader.clientId.v1';

export interface ReadingTimeSink {
  recordReadingTime(clientId: string, entries: ReadingTimeEntry[]): Promise<unknown>;
}

interface Stored { entries: ReadingTimeEntry[] }

export class ReadingTimeTracker {
  private bookId: string | null = null;
  private lastActivity = 0;
  private lastTick = 0;
  private speaking = false;
  private readonly pending = new Map<string, ReadingTimeEntry>();
  private loaded: Promise<void> | null = null;
  private clientId = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private sinceFlush = 0;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly sink: ReadingTimeSink,
    private readonly kv: KeyValueStore,
    private readonly now: () => number = Date.now,
    private readonly visible: () => boolean = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  ) {}

  /** Starts counting for a book; the previous one, if any, is closed first. */
  start(bookId: string): void {
    if (this.bookId) this.tick();
    this.bookId = bookId;
    this.lastActivity = this.lastTick = this.now();
    void this.load();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** The reader did something that means they are reading: a page turn, a scroll, a tap. */
  activity(): void {
    if (!this.bookId) return;
    // A first touch after a long idle starts counting from now, not from the idle start.
    if (!this.counting(this.now() - 1)) this.lastTick = this.now();
    this.lastActivity = this.now();
  }

  /** 朗读 started or stopped speaking. */
  setSpeaking(speaking: boolean): void {
    if (speaking === this.speaking) return;
    this.tick();
    this.speaking = speaking;
    if (speaking) this.lastTick = this.now();
  }

  /** Counts up to now and sends what is pending; for leaving the page or going to the background. */
  flush(): Promise<void> {
    this.tick();
    return this.send();
  }

  /** Stops counting and sends what is pending. */
  stop(): Promise<void> {
    this.tick();
    this.bookId = null;
    this.speaking = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.send();
  }

  private counting(at: number): boolean {
    return this.speaking || (this.visible() && at - this.lastActivity <= IDLE_MS);
  }

  /** Adds the time since the last tick to the current slot, if it counted. */
  tick(): void {
    const now = this.now();
    const bookId = this.bookId;
    if (!bookId) return;
    // A device that slept skips the interval; at most two ticks are ever credited at once.
    const from = Math.max(this.lastTick, now - TICK_MS * 2);
    this.lastTick = now;
    if (now <= from) return;
    let end = now;
    // Idle: count only up to the moment the idle window ran out.
    if (!this.speaking) {
      if (!this.visible()) return;
      end = Math.min(now, this.lastActivity + IDLE_MS);
    }
    if (end <= from) return;
    // A tick that straddles a slot boundary is split across both slots.
    for (let start = from; start < end;) {
      const slot = start - (start % SLOT_MS);
      const stop = Math.min(end, slot + SLOT_MS);
      this.add(bookId, slot, (stop - start) / 1000);
      start = stop;
    }
    void this.save();
    this.sinceFlush += now - from;
    if (this.sinceFlush >= FLUSH_MS) void this.send();
  }

  private add(bookId: string, slot: number, seconds: number): void {
    const key = `${bookId}\u0000${slot}`;
    const entry = this.pending.get(key) ?? { bookId, slot, seconds: 0 };
    entry.seconds = Math.min(SLOT_MS / 1000, entry.seconds + seconds);
    this.pending.set(key, entry);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        this.clientId = (await this.kv.get(CLIENT_KEY)) ?? '';
        if (!this.clientId) { this.clientId = newId(); await this.kv.set(CLIENT_KEY, this.clientId); }
        const stored = JSON.parse((await this.kv.get(STORE_KEY)) ?? '{"entries":[]}') as Stored;
        for (const entry of stored.entries ?? []) {
          if (typeof entry?.bookId !== 'string' || !Number.isFinite(entry.slot) || !Number.isFinite(entry.seconds)) continue;
          const key = `${entry.bookId}\u0000${entry.slot}`;
          const current = this.pending.get(key);
          // Counted this session before the store was read: the stored total adds to it.
          if (current) current.seconds = Math.min(SLOT_MS / 1000, current.seconds + entry.seconds);
          else this.pending.set(key, { ...entry });
        }
      } catch { /* an unreadable store only loses what it held */ }
    })();
    return this.loaded;
  }

  private async save(): Promise<void> {
    await this.load();
    try { await this.kv.set(STORE_KEY, JSON.stringify({ entries: [...this.pending.values()] } satisfies Stored)); } catch { /* best effort */ }
  }

  private send(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.load();
      this.sinceFlush = 0;
      const cutoff = this.now() - KEEP_MS;
      for (const [key, entry] of this.pending) if (entry.slot < cutoff) this.pending.delete(key);
      const entries = [...this.pending.values()].map(entry => ({ ...entry, seconds: Math.round(entry.seconds) })).filter(entry => entry.seconds > 0);
      if (!entries.length || !this.clientId) return;
      try {
        await this.sink.recordReadingTime(this.clientId, entries);
      } catch {
        return; // kept, and sent again with the next report
      }
      // Slots that can no longer grow are done; the current one keeps its running total.
      const current = this.now() - (this.now() % SLOT_MS);
      for (const [key, entry] of this.pending) if (entry.slot < current) this.pending.delete(key);
      await this.save();
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
