import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rateLimiter.ts";

describe("RateLimiter", () => {
  it("enforces both windows", () => {
    let t = 0;
    const rl = new RateLimiter(
      [
        { limit: 2, periodMs: 1000 },
        { limit: 3, periodMs: 10_000 },
      ],
      () => t,
    );
    expect(rl.waitMs()).toBe(0);
    rl.record();
    expect(rl.waitMs()).toBe(0);
    rl.record();
    expect(rl.waitMs()).toBe(1000); // 1 s window full
    t = 1000;
    expect(rl.waitMs()).toBe(0);
    rl.record();
    expect(rl.waitMs()).toBe(9000); // long window full (3 total)
  });

  it("honours penalty", () => {
    let t = 0;
    const rl = new RateLimiter([{ limit: 5, periodMs: 1000 }], () => t);
    rl.penalise(500);
    expect(rl.waitMs()).toBe(500);
    t = 600;
    expect(rl.waitMs()).toBe(0);
  });
});
