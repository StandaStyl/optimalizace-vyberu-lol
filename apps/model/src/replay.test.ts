import { describe, it, expect } from "vitest";
import type { Position } from "@da/core";
import { replayGame, summarise } from "./replay.ts";
import { DEFAULT_PARAMS, type StatsSource, type WinLoss } from "./score.ts";
import { rng } from "./stats.ts";
import type { TestGame } from "./eval.ts";

const POS: Position[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
function src(): StatsSource {
  const wl = (g: number, w: number): WinLoss => ({ games: g, wins: Math.round(g * w) });
  const strength = new Map<string, WinLoss>();
  const prior = new Map<number, Partial<Record<Position, number>>>();
  // champs 1..10: champ i plays position POS[i % 5] only; even champs strong, odd weak
  for (let c = 1; c <= 10; c++) { const p = POS[c % 5]!; strength.set(`${c}:${p}`, wl(500, c % 2 ? 0.45 : 0.55)); prior.set(c, { [p]: 500 }); }
  return { strength: (c, p) => strength.get(`${c}:${p}`), matchup: () => undefined, synergy: () => undefined, positionPrior: (c) => prior.get(c), champions: () => [1,2,3,4,5,6,7,8,9,10] };
}
const game: TestGame = {
  matchId: "m1", blueWon: true,
  blue: [2, 4, 6, 8, 10].map((c) => ({ champ: c, pos: POS[c % 5]!, puuid: "b" + c })),
  red: [1, 3, 5, 7, 9].map((c) => ({ champ: c, pos: POS[c % 5]!, puuid: "r" + c })),
};

describe("replay", () => {
  it("produces 10 picks with growing knowledge and correct position inference", () => {
    const obs = replayGame(game, src(), { ...DEFAULT_PARAMS, mcSamples: 50 }, rng(1));
    expect(obs.length).toBe(10);
    expect(obs[0]!.knownAllies + obs[0]!.knownEnemies).toBe(0);
    expect(obs[9]!.knownAllies).toBe(4);
    expect(obs[9]!.knownEnemies).toBe(5);
    // every champ has a single position → inference must be perfect
    const tot = obs.reduce((a, o) => a + o.posTotal, 0), ok = obs.reduce((a, o) => a + o.posCorrect, 0);
    expect(tot).toBeGreaterThan(0); expect(ok).toBe(tot);
    // each position has exactly 2 candidates (one strong, one weak); strong one ranks 1
    // the position partner may already be taken → 1 or 2 candidates; the strong (even) champ always ranks 1
    for (const o of obs) { expect(o.candidates).toBeGreaterThanOrEqual(1); if (o.chosen % 2 === 0) expect(o.rank).toBe(1); else expect(o.rank).toBe(o.candidates); }
  });
  it("summarises lift and coverage", () => {
    const obs = replayGame(game, src(), { ...DEFAULT_PARAMS, mcSamples: 50 }, rng(2));
    const rep = summarise(obs, 1);
    expect(rep.coverage).toBe(1);
    expect(rep.picks).toBe(10);
    expect(rep.positionAccuracy.every((x) => x.n === 0 || x.accuracy === 1)).toBe(true);
    expect(rep.calibration.n).toBe(10);
  });
});
