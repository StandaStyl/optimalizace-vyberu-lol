import { describe, it, expect } from "vitest";
import { auc, evaluate } from "./metrics.ts";
import { teamLogit, teamWinProb, VARIANTS, type TeamSlot } from "./team.ts";
import { DEFAULT_PARAMS, type StatsSource, type WinLoss } from "./score.ts";

describe("metrics", () => {
  it("auc handles perfect, random and ties", () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBe(0.5);
  });
  it("constant 0.5 gives logloss ln2 and ECE = |0.5 - base rate|", () => {
    const m = evaluate([0.5, 0.5, 0.5, 0.5], [1, 1, 1, 0]);
    expect(m.logloss).toBeCloseTo(Math.log(2), 10);
    expect(m.brier).toBeCloseTo(0.25, 10);
    expect(m.ece).toBeCloseTo(0.25, 10);
  });
  it("calibration bins accumulate", () => {
    const m = evaluate([0.05, 0.95, 0.95], [0, 1, 0], 10);
    expect(m.calibration[0]!.n).toBe(1);
    expect(m.calibration[9]!.n).toBe(2);
    expect(m.calibration[9]!.obs).toBeCloseTo(0.5, 10);
  });
});

function src(): StatsSource {
  const wl = (g: number, wr: number): WinLoss => ({ games: g, wins: Math.round(g * wr) });
  const strength: Record<string, WinLoss> = { "1:TOP": wl(1000, 0.6), "2:TOP": wl(1000, 0.4) };
  const matchup: Record<string, WinLoss> = { "3:MIDDLE|4:MIDDLE": wl(500, 0.7) };
  return {
    strength: (c, p) => strength[`${c}:${p}`],
    matchup: (a, pa, b, pb) => matchup[`${a}:${pa}|${b}:${pb}`],
    synergy: () => undefined,
    positionPrior: () => undefined,
    player: (puuid, c) => (puuid === "smurf" && c === 5 ? { games: 50, wins: 45, lastPlayedDaysAgo: 1 } : undefined),
    champions: () => [1, 2, 3, 4, 5],
  };
}

describe("teamLogit", () => {
  const blue: TeamSlot[] = [{ champ: 1, pos: "TOP" }, { champ: 3, pos: "MIDDLE" }, { champ: 5, pos: "JUNGLE", puuid: "smurf" }];
  const red: TeamSlot[] = [{ champ: 2, pos: "TOP" }, { champ: 4, pos: "MIDDLE" }, { champ: 6, pos: "JUNGLE" }];

  it("is antisymmetric", () => {
    const a = teamLogit(blue, red, src(), DEFAULT_PARAMS, VARIANTS.full);
    const b = teamLogit(red, blue, src(), DEFAULT_PARAMS, VARIANTS.full);
    expect(a).toBeCloseTo(-b, 10);
    expect(a).toBeGreaterThan(0);
  });
  it("variants are nested: const < strength < pairwise < full in blue's favour here", () => {
    const s = src();
    const c = teamWinProb(blue, red, s, DEFAULT_PARAMS, VARIANTS.const);
    const st = teamWinProb(blue, red, s, DEFAULT_PARAMS, VARIANTS.strength);
    const pw = teamWinProb(blue, red, s, DEFAULT_PARAMS, VARIANTS.pairwise);
    const full = teamWinProb(blue, red, s, DEFAULT_PARAMS, VARIANTS.full);
    expect(c).toBe(0.5);
    expect(st).toBeGreaterThan(c);
    expect(pw).toBeGreaterThan(st);
    expect(full).toBeGreaterThan(pw);
  });
  it("uses the reverse matchup when only one direction is stored", () => {
    const s = src();
    const a = teamLogit([{ champ: 4, pos: "MIDDLE" }], [{ champ: 3, pos: "MIDDLE" }], s, DEFAULT_PARAMS, VARIANTS.pairwise);
    expect(a).toBeLessThan(0);
  });
});
