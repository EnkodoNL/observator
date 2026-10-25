// SPDX-License-Identifier: FSL-1.1-ALv2

/**
 * In-memory token bucket. One process serves everything, so this is enough to stop
 * accidental floods and password guessing; it is not meant as a distributed limiter.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

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
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.prune(t);
    return allowed;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(t: number): void {
    for (const [key, b] of this.buckets) {
      if (b.tokens + (t - b.updated) * this.refillPerMs >= this.capacity) this.buckets.delete(key);
    }
  }
}
