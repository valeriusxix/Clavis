/** Fixed-window, in-memory rate limiter: at most `limit` hits per key per `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Records a hit; false when the key is over its limit for the current window. */
  hit(key: string): boolean {
    const t = this.now();
    const start = t - (t % this.windowMs);
    const h = this.hits.get(key);
    if (!h || h.windowStart !== start) {
      if (this.hits.size > 10_000) this.hits.clear(); // old windows only; bounded memory
      this.hits.set(key, { windowStart: start, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= this.limit;
  }
}
