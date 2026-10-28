// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * In-memory token bucket. One process serves everything, so this is enough to stop
 * accidental floods and password guessing; it is not meant as a distributed limiter.
 */
const MAX_BUCKETS = 10_000;
const PRUNE_EVERY_MS = 10_000;

export class RateLimiter {
  // Map order doubles as recency: a bucket is re-inserted on every take.
  private buckets = new Map<string, { tokens: number; updated: number }>();
  private pruned = 0;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Limiter allowing `count` events per `windowMs`, with a burst of `count`. */
  static perWindow(count: number, windowMs: number, now?: () => number): RateLimiter {
    return new RateLimiter(count, count / windowMs, now);
  }

  take(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (t - bucket.updated) * this.refillPerMs);
    bucket.updated = t;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size > MAX_BUCKETS) this.shrink(t);
    return allowed;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Drops full buckets (they hold nothing), at most once per PRUNE_EVERY_MS so a flood of new
   * keys does not make every take() scan the map; then the least recently used, down to the cap.
   */
  private shrink(t: number): void {
    if (t - this.pruned >= PRUNE_EVERY_MS) {
      this.pruned = t;
      for (const [key, b] of this.buckets) {
        if (b.tokens + (t - b.updated) * this.refillPerMs >= this.capacity) this.buckets.delete(key);
      }
    }
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= MAX_BUCKETS) break;
      this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
