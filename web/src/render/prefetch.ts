/**
 * Neighbour prefetching.
 *
 * The reader's perceived speed is almost entirely about whether the next thing
 * the user does is already in memory. Turning a page, opening the next chapter,
 * scrolling a comic — all three are predictable one step ahead, and a phone on a
 * tunnel feels a two-second round trip on every one of them.
 *
 * The policy is deliberately conservative:
 *
 *  - **One step ahead, at most** (configurable). A comic pager that fetched three
 *    pages ahead on every turn would download a whole volume in a few swipes,
 *    on the reader's data plan.
 *  - **A byte budget, not just a count.** A chapter can be 2KB or 8MB; counting
 *    requests is not the same as bounding bytes.
 *  - **Skipped when the connection says so.** `navigator.connection.saveData`
 *    exists for a reason, and `2g` makes prefetching actively harmful.
 *  - **Cancelled on navigation.** Prefetching the chapter after the one the user
 *    just left is pure waste; the in-flight request is dropped instead of being
 *    allowed to finish.
 */

export interface PrefetchOptions {
  /** How many items past the current one to fetch. */
  ahead?: number;
  /** Ceiling on total prefetched bytes. */
  maxBytes?: number;
  /** Item sizes from the manifest, when the format reports them. */
  sizeOf?: (key: string) => number | undefined;
}

interface Entry {
  blob: Blob;
  bytes: number;
  /** Order of arrival, for eviction. */
  seq: number;
}

/**
 * A bounded, ordered cache of fetched resources.
 *
 * Keys are format-private refs. The cache stores Blobs rather than strings so the
 * same instance serves chapter documents and comic pages; callers decode.
 */
export class PrefetchCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Blob>>();
  private bytes = 0;
  private counter = 0;
  private readonly ahead: number;
  private readonly maxBytes: number;

  constructor(options: PrefetchOptions = {}) {
    this.ahead = options.ahead ?? 1;
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  }

  /** A cached resource, if it is already here. */
  peek(key: string): Blob | undefined {
    return this.entries.get(key)?.blob;
  }

  /** Await a resource, joining an in-flight request rather than duplicating it. */
  async get(key: string, load: (key: string) => Promise<Blob>): Promise<Blob> {
    const cached = this.entries.get(key);
    if (cached) return cached.blob;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = load(key).then((blob) => {
      this.store(key, blob);
      return blob;
    });
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Warm the cache for the items around `keys[from]`.
   *
   * Returns a function that cancels the still-running requests, which the caller
   * invokes when the reader moves somewhere else.
   */
  warm(
    keys: readonly string[],
    from: number,
    load: (key: string) => Promise<Blob>,
    options: PrefetchOptions = {},
  ): () => void {
    if (!shouldPrefetch()) return () => undefined;
    const ahead = options.ahead ?? this.ahead;
    const sizeOf = options.sizeOf;

    let budget = this.maxBytes - this.bytes;
    const aborted = new Set<string>();

    for (let step = 1; step <= ahead; step += 1) {
      const key = keys[from + step];
      if (!key || this.entries.has(key) || this.pending.has(key)) continue;
      const estimate = sizeOf?.(key);
      if (estimate !== undefined && estimate > budget) continue;
      if (estimate !== undefined) budget -= estimate;

      void this.get(key, load).catch(() => {
        // A failed prefetch is not an error the reader needs to see: the item is
        // still reachable by asking for it, and the foreground request will
        // report the real problem.
      });
      aborted.add(key);
    }

    return () => {
      for (const key of aborted) {
        this.entries.delete(key);
        this.pending.delete(key);
      }
    };
  }

  /** Drop everything but `keep`, oldest first. Used when the book changes. */
  trim(keep: number): void {
    if (this.entries.size <= keep) return;
    const ordered = [...this.entries.entries()].sort((a, b) => a[1].seq - b[1].seq);
    for (const [key, entry] of ordered.slice(0, ordered.length - keep)) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }

  private store(key: string, blob: Blob): void {
    const bytes = blob.size;
    // An oversized single resource is not cached: keeping it would evict
    // everything else and still blow the budget.
    if (bytes > this.maxBytes) return;
    this.bytes += bytes;
    this.entries.set(key, { blob, bytes, seq: this.counter++ });
    while (this.bytes > this.maxBytes) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].seq - b[1].seq)[0];
      if (!oldest) break;
      this.bytes -= oldest[1].bytes;
      this.entries.delete(oldest[0]);
    }
  }
}

/**
 * Whether prefetching is welcome.
 *
 * `saveData` is an explicit request from the user and is honoured as one. A 2G
 * connection is not going to finish a prefetch before the reader wants the item,
 * so the bandwidth is better left for the foreground.
 */
export function shouldPrefetch(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}
