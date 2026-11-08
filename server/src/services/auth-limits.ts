import { RateLimitError } from '../lib/errors.ts';

export class AuthRateLimiter {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();
  private nextSweep = 0;

  constructor(private readonly now = Date.now, private readonly capacity = 10_000) {}

  consume(key: string, limit: number, windowMs: number): void {
    const now = this.now();
    if (now >= this.nextSweep) {
      for (const [entry, bucket] of this.buckets) if (bucket.expiresAt <= now) this.buckets.delete(entry);
      this.nextSweep = now + 10_000;
    }
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      if (!bucket && this.buckets.size >= this.capacity) throw new RateLimitError(10);
      bucket = { count: 0, expiresAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit) throw new RateLimitError(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)));
    bucket.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export class AuthWorkLimiter {
  private active = 0;

  constructor(private readonly capacity = 4) {}

  async run<Result>(work: () => Promise<Result>): Promise<Result> {
    if (this.active >= this.capacity) throw new RateLimitError(1, 'AUTH_BUSY');
    this.active += 1;
    try { return await work(); }
    finally { this.active -= 1; }
  }
}
