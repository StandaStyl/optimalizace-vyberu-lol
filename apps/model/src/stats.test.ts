import { describe, expect, it } from "vitest";
import { ebShrink } from "./stats.ts";

describe("ebShrink (winner's-curse correction)", () => {
  it("keeps estimates untouched when noise is negligible", () => {
    const xs = [-0.2, -0.1, 0, 0.1, 0.3];
    const { mu, lambda } = ebShrink(xs, xs.map(() => 1e-8));
    for (const l of lambda) expect(l).toBeGreaterThan(0.999);
    expect(mu).toBeCloseTo(0.02, 1);
  });

  it("collapses to the field mean when spread is all noise", () => {
    // spread of xs is far below the known noise level -> tau2 = 0, lambda = 0
    const xs = [0.01, -0.02, 0.02, -0.01, 0.0];
    const { lambda } = ebShrink(xs, xs.map(() => 1.0));
    for (const l of lambda) expect(l).toBeLessThan(1e-6);
  });

  it("pulls a high-variance outlier harder than a well-measured leader", () => {
    // two candidates above the pack: same estimate, one noisy, one solid
    const xs = [0.4, 0.4, 0, 0, 0, 0, -0.05, 0.05];
    const vars = [0.2, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005];
    const { mu, lambda } = ebShrink(xs, vars);
    const corrected = xs.map((x, i) => mu + lambda[i]! * (x - mu));
    expect(corrected[0]!).toBeLessThan(corrected[1]!); // noisy leader shrinks below the solid one
    expect(corrected[1]!).toBeLessThan(0.4); // and even the solid one moves toward the field
    expect(corrected[1]!).toBeGreaterThan(corrected[2]!); // ordering vs the pack survives
  });

  it("preserves order among candidates with equal variance", () => {
    const xs = [0.3, 0.1, -0.1, -0.3, 0.2];
    const { mu, lambda } = ebShrink(xs, xs.map(() => 0.005));
    const corrected = xs.map((x, i) => mu + lambda[i]! * (x - mu));
    const order = (a: number[]) => [...a.keys()].sort((i, j) => a[j]! - a[i]!);
    expect(order(corrected)).toEqual(order(xs));
  });
});
