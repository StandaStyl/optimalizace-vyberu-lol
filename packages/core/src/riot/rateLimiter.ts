/**
 * Multi-window token bucket matching Riot's per-key limits
 * (e.g. 20 requests / 1 s and 100 requests / 120 s). Also honours
 * Retry-After from 429 responses via `penalise()`.
 */
export interface Window {
  limit: number;
  periodMs: number;
}

export class RateLimiter {
  private stamps: number[][];
  private blockedUntil = 0;

  private windows: Window[];
  private now: () => number;

  constructor(windows: Window[], now: () => number = Date.now) {
    this.windows = windows;
    this.now = now;
    this.stamps = windows.map(() => []);
  }

  /** Milliseconds to wait before the next request may be sent (0 = now). */
  waitMs(): number {
    const t = this.now();
    let wait = Math.max(0, this.blockedUntil - t);
    this.windows.forEach((w, i) => {
      const s = this.stamps[i]!;
      while (s.length && t - s[0]! >= w.periodMs) s.shift();
      if (s.length >= w.limit) wait = Math.max(wait, s[0]! + w.periodMs - t);
    });
    return wait;
  }

  record(): void {
    const t = this.now();
    this.stamps.forEach((s) => s.push(t));
  }

  penalise(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
  }

  async acquire(
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ): Promise<void> {
    for (;;) {
      const w = this.waitMs();
      if (w === 0) {
        this.record();
        return;
      }
      await sleep(w);
    }
  }
}
