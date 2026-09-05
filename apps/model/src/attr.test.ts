import { describe, it, expect } from "vitest";
import type { Position } from "@da/core";
import { attrPrior, DEFAULT_PARAMS, scoreDraft, type StatsSource, type WinLoss } from "./score.ts";
import { teamLogit, VARIANTS } from "./team.ts";

/**
 * SPEC-08 world: champion 1 (me, BOTTOM) has no games against enemy 4 specifically, but a large
 * record against *ranged* bottom laners: 1 000 games, 600 wins where independence expected 500.
 * Champion 7 is the same but has a well-measured specific cell vs 4 at exactly 50 %.
 */
function world(opts: { cellGames?: number; enemyKnowsMe?: boolean } = {}): StatsSource {
  const wl = (games: number, wr: number): WinLoss => ({ games, wins: Math.round(games * wr) });
  const strength: Record<string, WinLoss> = {
    "1:BOTTOM": wl(2000, 0.5), "7:BOTTOM": wl(2000, 0.5), "4:BOTTOM": wl(2000, 0.5), "5:UTILITY": wl(2000, 0.5),
  };
  const matchup: Record<string, WinLoss> = {};
  if (opts.cellGames) matchup["7:BOTTOM|4:BOTTOM"] = wl(opts.cellGames, 0.5);
  const attrs: Record<number, Record<string, string>> = { 1: { range: "melee" }, 7: { range: "melee" }, 4: { range: "ranged" }, 5: { range: "ranged" } };
  // "*" = pooled over all values of the dimension (the centring baseline); here the champion's
  // form is exactly as expected overall (1 000 wins where 1 000 were expected), so the contrast
  // "vs ranged" carries the whole +100 wins.
  const vs: Record<string, WinLoss & { expWins: number }> = {
    "1:BOTTOM|BOTTOM|range=ranged": { games: 1000, wins: 600, expWins: 500 }, "1:BOTTOM|BOTTOM|range=*": { games: 2000, wins: 1000, expWins: 1000 },
    "7:BOTTOM|BOTTOM|range=ranged": { games: 1000, wins: 600, expWins: 500 }, "7:BOTTOM|BOTTOM|range=*": { games: 2000, wins: 1000, expWins: 1000 },
  };
  // the enemy's own record against melee bottom laners: equally good for them (cancels half of the shift)
  if (opts.enemyKnowsMe) { vs["4:BOTTOM|BOTTOM|range=melee"] = { games: 1000, wins: 600, expWins: 500 }; vs["4:BOTTOM|BOTTOM|range=*"] = { games: 2000, wins: 1000, expWins: 1000 }; }
  const prior: Record<number, Partial<Record<Position, number>>> = { 4: { BOTTOM: 1000 }, 5: { UTILITY: 1000 } };
  return {
    strength: (c, p) => strength[`${c}:${p}`],
    matchup: (a, pa, b, pb) => matchup[`${a}:${pa}|${b}:${pb}`],
    synergy: () => undefined,
    positionPrior: (c) => prior[c],
    champions: () => [1, 4, 5, 7],
    attrs: (c) => attrs[c],
    vsAttr: (a, pa, pb, dim, v) => vs[`${a}:${pa}|${pb}|${dim}=${v}`],
  };
}
// priorNAttr 500 keeps the hand-computed numbers below readable; the production default is 2 000 (see ModelParams)
// attrWeight 1 here because the production default is 0 (validation, see ModelParams)
const base = { ...DEFAULT_PARAMS, mcSamples: 200, futureWeight: 0, pilotExpGames: 0, selectionCorrection: false, attrDims: ["range"], priorNAttr: 500, attrWeight: 1, priorNMatchup: 300 };

describe("SPEC-08: attribute prior for matchups", () => {
  it("shifts the matchup prior where the specific cell is empty, by the attribute-level deviation", () => {
    const shift = attrPrior(world(), base, 1, "BOTTOM", 4, "BOTTOM");
    // 600/1000 vs expected 0.5 with prior N 500: posterior mean (600+250)/(1500) = 0.5667 → logit 0.268; halved (symmetric) → 0.134
    expect(shift).toBeCloseTo(0.134, 2);
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [], enemies: [{ champ: 4, pos: "BOTTOM" }], bans: [] }, world(), base);
    const me = recs.find((r) => r.champ === 1)!;
    const m = me.contributions.find((c) => c.kind === "matchup")!;
    expect(m.logOdds).toBeCloseTo(shift, 6);   // empty cell: the whole term is the prior
    expect(m.attr).toBeCloseTo(shift, 6);
  });

  it("is centred: a champion's overall form (pooled deviation) is not attribute information", () => {
    // 600/1000 vs ranged AND 600/1000 vs melee: the champion simply over-performs its shrunk strength —
    // that belongs to the strength term, and the contrast vs ranged must be 0.
    const w = world();
    const inForm: StatsSource = { ...w, vsAttr: (a, pa, pb, dim, v) => (a === 1 && dim === "range" ? (v === "*" ? { games: 2000, wins: 1200, expWins: 1000 } : { games: 1000, wins: 600, expWins: 500 }) : w.vsAttr!(a, pa, pb, dim, v)) };
    // form and cell shrink with the same prior but different n, so the contrast is only ≈ 0 (0.03 here vs 0.13 uncentred)
    expect(Math.abs(attrPrior(inForm, base, 1, "BOTTOM", 4, "BOTTOM"))).toBeLessThan(0.04);
    expect(Math.abs(attrPrior(inForm, base, 1, "BOTTOM", 4, "BOTTOM"))).toBeLessThan(Math.abs(attrPrior(world(), base, 1, "BOTTOM", 4, "BOTTOM")) / 3);
  });

  it("is switched off by attrWeight 0", () => {
    expect(attrPrior(world(), { ...base, attrWeight: 0 }, 1, "BOTTOM", 4, "BOTTOM")).toBe(0);
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [], enemies: [{ champ: 4, pos: "BOTTOM" }], bans: [] }, world(), { ...base, attrWeight: 0 });
    const m = recs.find((r) => r.champ === 1)!.contributions.find((c) => c.kind === "matchup")!;
    expect(m.logOdds).toBe(0);
    expect(m.attr).toBeUndefined();
  });

  it("is symmetric: the enemy's record against my kind pulls the other way", () => {
    expect(attrPrior(world({ enemyKnowsMe: true }), base, 1, "BOTTOM", 4, "BOTTOM")).toBeCloseTo(0, 6);
    expect(attrPrior(world(), base, 4, "BOTTOM", 1, "BOTTOM")).toBeCloseTo(-attrPrior(world(), base, 1, "BOTTOM", 4, "BOTTOM"), 9);
  });

  it("is overridden by a well-measured specific cell (hierarchy, not addition)", () => {
    const recs = scoreDraft({ myPos: "BOTTOM", allies: [], enemies: [{ champ: 4, pos: "BOTTOM" }], bans: [] }, world({ cellGames: 20000 }), base);
    const m7 = recs.find((r) => r.champ === 7)!.contributions.find((c) => c.kind === "matchup")!;
    const m1 = recs.find((r) => r.champ === 1)!.contributions.find((c) => c.kind === "matchup")!;
    expect(Math.abs(m7.logOdds)).toBeLessThan(0.01);   // 20 000 games at 50 % say: no edge, whatever the attributes suggest
    expect(m1.logOdds).toBeGreaterThan(0.1);            // empty cell keeps the prior
  });

  it("enters the team model the same way and stays antisymmetric", () => {
    const blue = [{ champ: 1, pos: "BOTTOM" as const }];
    const red = [{ champ: 4, pos: "BOTTOM" as const }];
    const w = { ...VARIANTS.full, player: 0, synergy: 0 };
    const withAttr = teamLogit(blue, red, world(), base, w);
    const without = teamLogit(blue, red, world(), { ...base, attrWeight: 0 }, w);
    expect(without).toBeCloseTo(0, 9);
    expect(withAttr).toBeCloseTo(attrPrior(world(), base, 1, "BOTTOM", 4, "BOTTOM"), 6);
    expect(teamLogit(red, blue, world(), base, w)).toBeCloseTo(-withAttr, 9);
  });
});
