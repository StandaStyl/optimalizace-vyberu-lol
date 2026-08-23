import { describe, it, expect } from "vitest";
import type { Position } from "@da/core";
import { DEFAULT_PARAMS, indifferenceClasses, inferEnemyPositions, scoreDraft, type StatsSource, type WinLoss } from "./score.ts";
import { mean, posterior, sampleBeta, rng, quantile } from "./stats.ts";

/** Tiny synthetic world: champs 1..6. 1 = strong ADC, 2 = weak ADC, 3 = ADC that counters 4, 4 = enemy ADC, 5 = support, 6 = jungler. */
function world(): StatsSource {
  const wl = (games: number, wr: number): WinLoss => ({ games, wins: Math.round(games * wr) });
  const strength: Record<string, WinLoss> = {
    "1:BOTTOM": wl(2000, 0.54), "2:BOTTOM": wl(2000, 0.46), "3:BOTTOM": wl(2000, 0.5), "4:BOTTOM": wl(2000, 0.5),
    "5:UTILITY": wl(2000, 0.5), "6:JUNGLE": wl(2000, 0.5),
  };
  const matchup: Record<string, WinLoss> = { "3:BOTTOM|4:BOTTOM": wl(400, 0.62) };
  const synergy: Record<string, WinLoss> = { "2:BOTTOM|5:UTILITY": wl(400, 0.58) };
  const prior: Record<number, Partial<Record<Position, number>>> = {
    4: { BOTTOM: 900, MIDDLE: 100 }, 5: { UTILITY: 1000 }, 6: { JUNGLE: 1000 },
  };
  return {
    strength: (c, p) => strength[`${c}:${p}`],
    matchup: (a, pa, b, pb) => matchup[`${a}:${pa}|${b}:${pb}`],
    synergy: (a, pa, b, pb) => synergy[`${a}:${pa}|${b}:${pb}`],
    positionPrior: (c) => prior[c],
    player: (puuid, c) => (puuid === "me" && c === 2 ? { games: 60, wins: 40, lastPlayedDaysAgo: 5 } : undefined),
    champions: () => [1, 2, 3, 4, 5, 6],
  };
}

describe("stats", () => {
  it("posterior shrinks towards prior with little data", () => {
    expect(mean(posterior(1, 0, 0.5, 100))).toBeCloseTo(51 / 101, 6);
    expect(mean(posterior(600, 400, 0.5, 100))).toBeCloseTo(650 / 1100, 6);
  });
  it("beta sampler is roughly unbiased", () => {
    const u = rng(1);
    const b = posterior(300, 200, 0.5, 0);
    const xs = Array.from({ length: 4000 }, () => sampleBeta(b, u)).sort((a, c) => a - c);
    expect(quantile(xs, 0.5)).toBeCloseTo(0.6, 1);
  });
});

describe("inferEnemyPositions", () => {
  it("propagates constraints: a sure support pushes a flex champ off UTILITY", () => {
    const src = world();
    const dist = inferEnemyPositions([{ champ: 4 }, { champ: 5 }], src);
    expect(dist.get(5)!.UTILITY).toBeGreaterThan(0.99);
    expect(dist.get(4)!.UTILITY ?? 0).toBeLessThan(0.01);
    expect(dist.get(4)!.BOTTOM!).toBeGreaterThan(0.85);
  });
});

describe("scoreDraft", () => {
  const fast = { ...DEFAULT_PARAMS, mcSamples: 300 };

  it("ranks by strength when nothing else is known and returns intervals", () => {
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [], enemies: [], bans: [] }, world(), fast);
    expect(recs[0]!.champ).toBe(1);
    expect(recs.at(-1)!.champ).toBe(2);
    expect(recs.length).toBe(4); // 5 and 6 never played BOTTOM
    for (const r of recs) {
      expect(r.lo).toBeLessThanOrEqual(r.p);
      expect(r.hi).toBeGreaterThanOrEqual(r.p);
    }
  });

  it("excludes banned and picked champions", () => {
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [{ champ: 5, pos: "UTILITY" }], enemies: [{ champ: 4 }], bans: [1] }, world(), fast);
    expect(recs.map((r) => r.champ)).not.toContain(1);
    expect(recs.map((r) => r.champ)).not.toContain(4);
  });

  it("counter lifts champ 3 above the stronger champ 1 when enemy 4 is known", () => {
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [], enemies: [{ champ: 4 }], bans: [] }, world(), fast);
    expect(recs[0]!.champ).toBe(3);
    const c = recs[0]!.contributions.find((x) => x.kind === "matchup" && x.vs === 4 && x.vsPos === "BOTTOM")!;
    expect(c.logOdds).toBeGreaterThan(0.2);
  });

  it("synergy and player term lift the weak champ 2 for player 'me' with support 5", () => {
    const without = scoreDraft({ myPos: "BOTTOM", allies: [{ champ: 5, pos: "UTILITY" }], enemies: [], bans: [] }, world(), fast);
    const withMe = scoreDraft({ myPos: "BOTTOM", myPuuid: "me", allies: [{ champ: 5, pos: "UTILITY" }], enemies: [], bans: [] }, world(), fast);
    const p2 = (rs: typeof without) => rs.find((r) => r.champ === 2)!.p;
    expect(p2(withMe)).toBeGreaterThan(p2(without));
    expect(withMe.find((r) => r.champ === 2)!.contributions.some((c) => c.kind === "player")).toBe(true);
  });

  it("drops one-off picks on a position", () => {
    const s = world();
    const strength = s.strength;
    const withOneOff: StatsSource = { ...s, strength: (c, p) => (c === 6 && p === "BOTTOM" ? { games: 1, wins: 1 } : strength(c, p)) };
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [], enemies: [], bans: [] }, withOneOff, fast);
    expect(recs.map((r) => r.champ)).not.toContain(6); // 1 of 1001 games on BOTTOM < 3 %
  });

  it("indifference classes group overlapping intervals", () => {
    const classes = indifferenceClasses([
      { champ: 1, p: 0.55, lo: 0.52, hi: 0.58, contributions: [] },
      { champ: 2, p: 0.54, lo: 0.51, hi: 0.57, contributions: [] },
      { champ: 3, p: 0.48, lo: 0.45, hi: 0.51, contributions: [] },
    ]);
    expect(classes).toEqual([[1, 2], [3]]);
  });
});
